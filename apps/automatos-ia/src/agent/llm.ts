import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";

const openrouter = new OpenAI({
  apiKey: apiKey || "",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/moacsjr/automatos-ide",
    "X-Title": "Automatos IA",
  },
});

export interface AgentDecision {
  action: "click" | "fill" | "navigate" | "finish" | "wait";
  targetId?: string;
  value?: string;
  reasoning: string;
  explanation: string;
}

function assertApiKeyConfigured() {
  if (
    !process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY === "your_openrouter_api_key_here"
  ) {
    throw new Error(
      "OPENROUTER_API_KEY não configurada no arquivo .env. Por favor, insira uma chave válida.",
    );
  }
}

/**
 * Chama a LLM via OpenRouter esperando uma resposta JSON, com retry/backoff
 * para erros de rate limit (429) e erros transitórios de servidor (5xx).
 */
async function callOpenRouterJSON(
  prompt: string,
  context: string,
): Promise<string> {
  const maxRetries = 3;
  const baseDelay = 2000;
  let lastError: any = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const completion = await openrouter.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Resposta vazia da LLM.");
      }
      return content;
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || "";
      const errorStatus = error.status;

      const isAuthError =
        errorStatus === 401 ||
        errorStatus === 403 ||
        errorMessage.includes("API_KEY_INVALID") ||
        errorMessage.includes("invalid API key") ||
        errorMessage.includes("No auth credentials found");

      if (isAuthError) {
        throw error; // Não vale a pena retentar erro de autenticação
      }

      const isRateLimit =
        errorStatus === 429 ||
        errorMessage.includes("429") ||
        errorMessage.includes("rate limit");

      const isTransientError =
        errorStatus === 500 ||
        errorStatus === 502 ||
        errorStatus === 503 ||
        errorStatus === 504 ||
        errorMessage.includes("Service Unavailable") ||
        errorMessage.includes("overloaded");

      const isNetworkError =
        error.code === "ERR_STREAM_PREMATURE_CLOSE" ||
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "EPIPE" ||
        errorMessage.includes("Premature close") ||
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("socket hang up");

      if (
        (isRateLimit || isTransientError || isNetworkError) &&
        attempt < maxRetries - 1
      ) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.warn(
          `⚠️ Erro (${errorStatus || errorMessage}) no modelo ${MODEL} durante ${context}. Aguardando ${waitTime}ms antes da tentativa ${attempt + 2}/${maxRetries}...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      break;
    }
  }

  console.error(
    `Erro na comunicação com a API do OpenRouter (${context}):`,
    lastError,
  );
  throw lastError;
}

/**
 * Consulta a LLM (via OpenRouter) para planejar o próximo passo lógico do agente autônomo
 */
export async function askLLMForNextAction(
  objective: string,
  currentUrl: string,
  simplifiedDOM: string,
  history: string[],
): Promise<AgentDecision> {
  assertApiKeyConfigured();

  const prompt = `
Você é um agente autônomo encarregado de controlar uma aba ativa do Chrome para realizar um teste/ação automatizada.
Seu objetivo final é: "${objective}"

---
Informações do Estado Atual:
- URL Atual: ${currentUrl}
- Histórico de Ações Tomadas:
${history.map((h, i) => `  ${i + 1}. ${h}`).join("\n") || "  (Nenhuma ação tomada ainda)"}

---
Elementos Interativos Disponíveis na Página (DOM Simplificado):
${simplifiedDOM || "(Nenhum elemento interativo detectado)"}

---
Instruções:
1. Avalie cuidadosamente se o objetivo principal foi alcançado. Se sim, responda com a ação "finish".
2. Caso contrário, selecione a próxima ação mais lógica para progredir em direção ao objetivo.
3. Para interagir com qualquer elemento, use o ID correspondente indicado na lista acima (ex: "targetId": "12").
4. Apenas selecione elementos que estão listados acima.
5. Escreva a 'explanation' em português e de forma clara para o usuário final.
6. Para elementos do tipo 'select' (Role: combobox), ao usar a ação "fill", o campo "value" deve conter exatamente o texto de uma das opções listadas em "Opções disponíveis" daquele elemento.

---
Responda ESTRITAMENTE em JSON válido, sem markdown, seguindo exatamente este formato:
{
  "action": "click" | "fill" | "navigate" | "finish" | "wait",
  "targetId": "ID numérico do elemento (string), obrigatório apenas para 'click' e 'fill'",
  "value": "texto a preencher (fill), URL completa (navigate) ou tempo em ms (wait)",
  "reasoning": "raciocínio interno em português explicando a decisão",
  "explanation": "mensagem curta e amigável em português explicando ao usuário o que está prestes a fazer"
}
`;

  const responseText = await callOpenRouterJSON(
    prompt,
    "planejamento do próximo passo",
  );
  return JSON.parse(responseText) as AgentDecision;
}

export interface HealedScriptResult {
  fixedCode: string;
  explanation: string;
}

/**
 * Envia o script quebrado e os logs de erro para a LLM (via OpenRouter) corrigir
 */
export async function healPlaywrightScript(
  code: string,
  errorLogs: string,
): Promise<HealedScriptResult> {
  assertApiKeyConfigured();

  const prompt = `
Você é um especialista em automação e testes com Playwright.
Recebemos um script de teste Playwright gerado automaticamente que falhou durante a execução.

Abaixo está o código do script que falhou:
\`\`\`typescript
${code}
\`\`\`

Abaixo estão os logs de execução do terminal que contêm a mensagem de erro da falha:
\`\`\`
${errorLogs}
\`\`\`

Instruções importantes:
1. Analise cuidadosamente o erro indicado nos logs e o código do script correspondente.
2. Identifique qual linha, seletor, asserção ou parâmetro causou a falha do teste.
3. Corrija o erro no script Playwright mantendo a lógica original do fluxo, porém ajustando o seletor, seletor de visibilidade, espera ou lógica que causou a quebra do teste.
4. Garanta que o código retornado na propriedade 'fixedCode' seja o script COMPLETO e válido em TypeScript do Playwright, incluindo as importações (ex: de '@playwright/test') e o bloco principal 'test(...)'.
5. Não adicione marcações de bloco de código markdown (\`\`\`ts) no valor de 'fixedCode'.
6. Explique em poucas palavras na propriedade 'explanation' (em português) qual era o problema e como você o corrigiu.

---
Responda ESTRITAMENTE em JSON válido, sem markdown, seguindo exatamente este formato:
{
  "fixedCode": "código completo e atualizado do script Playwright corrigido",
  "explanation": "explicação em português detalhando qual era o erro nos logs e como ele foi corrigido"
}
`;

  const responseText = await callOpenRouterJSON(
    prompt,
    "self-healing do script",
  );
  return JSON.parse(responseText) as HealedScriptResult;
}
