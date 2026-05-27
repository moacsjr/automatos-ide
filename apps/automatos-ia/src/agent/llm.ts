import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey || "");

export interface AgentDecision {
  action: "click" | "fill" | "navigate" | "finish" | "wait";
  targetId?: string;
  value?: string;
  reasoning: string;
  explanation: string;
}

/**
 * Consulta o modelo Gemini para planejar o próximo passo lógico do agente autônomo
 */
export async function askGeminiForNextAction(
  objective: string,
  currentUrl: string,
  simplifiedDOM: string,
  history: string[],
): Promise<AgentDecision> {
  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
  ) {
    throw new Error(
      "GEMINI_API_KEY não configurada no arquivo .env. Por favor, insira uma chave válida.",
    );
  }

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
`;

  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];
  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      action: {
        type: SchemaType.STRING,
        enum: ["click", "fill", "navigate", "finish", "wait"],
        description: "A ação de navegação a ser realizada.",
      },
      targetId: {
        type: SchemaType.STRING,
        description:
          "O ID numérico do elemento no DOM simplificado (ex: '3') para ações 'click' ou 'fill'.",
      },
      value: {
        type: SchemaType.STRING,
        description:
          "O texto a preencher (se fill), a URL completa (se navigate) ou tempo em ms (se wait).",
      },
      reasoning: {
        type: SchemaType.STRING,
        description: "Raciocínio interno em português explicando a decisão.",
      },
      explanation: {
        type: SchemaType.STRING,
        description:
          "Mensagem curta e amigável em português explicando ao usuário o que está prestes a fazer.",
      },
    },
    required: ["action", "reasoning", "explanation"],
  };

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const maxRetries = 3;
    let delay = 2000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        return JSON.parse(responseText) as AgentDecision;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || "";
        const errorStatus = error.status;

        // Check if it's an invalid key / authentication error
        const isAuthError =
          errorStatus === 401 ||
          errorStatus === 403 ||
          errorMessage.includes("API_KEY_INVALID") ||
          errorMessage.includes("API key not valid") ||
          errorMessage.includes("invalid API key");

        if (isAuthError) {
          throw error; // Throw immediately, no point in retrying or switching models
        }

        // Check if it's a rate limit error (429)
        const isRateLimit =
          errorStatus === 429 ||
          errorMessage.includes("429") ||
          errorMessage.includes("Quota exceeded") ||
          errorMessage.includes("RESOURCE_EXHAUSTED");

        // Check if it's a transient server/service error
        const isTransientError =
          errorStatus === 500 ||
          errorStatus === 502 ||
          errorStatus === 503 ||
          errorStatus === 504 ||
          errorMessage.includes("503") ||
          errorMessage.includes("500") ||
          errorMessage.includes("Service Unavailable") ||
          errorMessage.includes("experiencing high demand") ||
          errorMessage.includes("overloaded");

        // Check if it's a model not found / invalid model error (e.g. 404)
        const isModelNotFoundError =
          errorStatus === 404 ||
          errorMessage.includes("404") ||
          errorMessage.includes("model not found") ||
          errorMessage.includes("not found");

        if (isRateLimit) {
          const isDailyLimit =
            errorMessage.includes(
              "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            ) ||
            errorMessage.includes("requests per day") ||
            errorMessage.includes("quota");

          if (isDailyLimit) {
            console.warn(
              `⚠️ Limite/Cota excedido para o modelo ${modelName}. Alternando para o próximo modelo...`,
            );
            break; // Sai do loop de retentativas para este modelo e tenta o próximo
          }

          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Limite de requisições atingido (429) no modelo ${modelName}. Aguardando ${waitTime}ms antes da tentativa ${attempt + 2}/${maxRetries}...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        } else if (isTransientError) {
          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Erro temporário do servidor (${errorStatus || "503"}) no modelo ${modelName}. Aguardando ${waitTime}ms antes da tentativa ${attempt + 2}/${maxRetries}...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else {
            console.warn(
              `⚠️ Erro temporário do servidor persistente no modelo ${modelName} após todas as tentativas. Alternando para o próximo modelo...`,
            );
            break; // Tenta o próximo modelo
          }
        } else if (isModelNotFoundError) {
          console.warn(
            `⚠️ Modelo ${modelName} não encontrado/desabilitado. Alternando para o próximo modelo...`,
          );
          break; // Tenta o próximo modelo
        } else {
          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Erro inesperado (${errorMessage}) no modelo ${modelName}. Aguardando ${waitTime}ms antes da tentativa ${attempt + 2}/${maxRetries}...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else {
            console.warn(
              `⚠️ Erro inesperado persistente no modelo ${modelName}. Alternando para o próximo modelo...`,
            );
            break; // Tenta o próximo modelo
          }
        }
      }
    }
  }

  console.error(
    "Erro na comunicação com a API do Gemini (todos os modelos falharam/estão sem cota):",
    lastError,
  );
  throw lastError;
}

export interface HealedScriptResult {
  fixedCode: string;
  explanation: string;
}

/**
 * Envia o script quebrado e os logs de erro para a LLM Gemini corrigir
 */
export async function healPlaywrightScript(
  code: string,
  errorLogs: string,
): Promise<HealedScriptResult> {
  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
  ) {
    throw new Error(
      "GEMINI_API_KEY não configurada no arquivo .env. Por favor, insira uma chave válida.",
    );
  }

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
`;

  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];
  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      fixedCode: {
        type: SchemaType.STRING,
        description:
          "O código completo e atualizado do script Playwright corrigido.",
      },
      explanation: {
        type: SchemaType.STRING,
        description:
          "Explicação em português detalhando qual era o erro nos logs e como ele foi corrigido.",
      },
    },
    required: ["fixedCode", "explanation"],
  };

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const maxRetries = 3;
    let delay = 2000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        return JSON.parse(responseText) as HealedScriptResult;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || "";
        const errorStatus = error.status;

        // Check if it's an invalid key / authentication error
        const isAuthError =
          errorStatus === 401 ||
          errorStatus === 403 ||
          errorMessage.includes("API_KEY_INVALID") ||
          errorMessage.includes("API key not valid") ||
          errorMessage.includes("invalid API key");

        if (isAuthError) {
          throw error;
        }

        // Check if it's a rate limit error (429)
        const isRateLimit =
          errorStatus === 429 ||
          errorMessage.includes("429") ||
          errorMessage.includes("Quota exceeded") ||
          errorMessage.includes("RESOURCE_EXHAUSTED");

        // Check if it's a transient server/service error
        const isTransientError =
          errorStatus === 500 ||
          errorStatus === 502 ||
          errorStatus === 503 ||
          errorStatus === 504 ||
          errorMessage.includes("503") ||
          errorMessage.includes("500") ||
          errorMessage.includes("Service Unavailable") ||
          errorMessage.includes("experiencing high demand") ||
          errorMessage.includes("overloaded");

        // Check if it's a model not found / invalid model error (e.g. 404)
        const isModelNotFoundError =
          errorStatus === 404 ||
          errorMessage.includes("404") ||
          errorMessage.includes("model not found") ||
          errorMessage.includes("not found");

        if (isRateLimit) {
          const isDailyLimit =
            errorMessage.includes(
              "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            ) ||
            errorMessage.includes("requests per day") ||
            errorMessage.includes("quota");

          if (isDailyLimit) {
            console.warn(
              `⚠️ Limite/Cota excedido para o modelo ${modelName} no Self-Healing. Alternando...`,
            );
            break;
          }

          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Limite atingido (429) no Self-Healing com modelo ${modelName}. Aguardando ${waitTime}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        } else if (isTransientError) {
          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Erro temporário (${errorStatus}) no Self-Healing com modelo ${modelName}. Aguardando ${waitTime}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else {
            break;
          }
        } else if (isModelNotFoundError) {
          break;
        } else {
          if (attempt < maxRetries - 1) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(
              `⚠️ Erro inesperado (${errorMessage}) no Self-Healing com modelo ${modelName}. Aguardando ${waitTime}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else {
            break;
          }
        }
      }
    }
  }

  console.error(
    "Erro na comunicação com a API do Gemini para Self-Healing:",
    lastError,
  );
  throw lastError;
}
