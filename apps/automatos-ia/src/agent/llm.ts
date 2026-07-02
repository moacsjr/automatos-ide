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
  // Node's built-in fetch (undici) instead of the SDK's default node-fetch@2,
  // which reliably drops gzip'd OpenRouter responses mid-stream (ERR_STREAM_PREMATURE_CLOSE).
  fetch: fetch as any,
});

export interface AgentDecision {
  action: "click" | "fill" | "navigate" | "finish" | "wait";
  targetId?: string;
  value?: string;
  reasoning: string;
  explanation: string;
}

/**
 * Alguns modelos ignoram response_format: json_object e envolvem a resposta
 * em um bloco de código markdown (```json ... ```). Remove o fence se presente.
 */
function stripMarkdownJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
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
      return stripMarkdownJsonFence(content);
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

  // Loga só a mensagem — o objeto de erro cru pode conter headers com a API key.
  console.error(
    `Erro na comunicação com a API do OpenRouter (${context}): ${lastError?.message ?? lastError}`,
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
You are an autonomous agent responsible for controlling an active Chrome tab to perform an automated test/action.
Your final objective is: "${objective}"

---
Current State:
- Current URL: ${currentUrl}
- Action History:
${history.map((h, i) => `  ${i + 1}. ${h}`).join("\n") || "  (No action taken yet)"}

---
Interactive Elements Available on the Page (Simplified DOM):
${simplifiedDOM || "(No interactive element detected)"}

---
Instructions:
1. Carefully assess whether the main objective has been achieved. If so, respond with the "finish" action.
2. Otherwise, select the next most logical action to progress toward the objective.
3. To interact with any element, use the corresponding ID shown in the list above (e.g. "targetId": "12").
4. Only select elements that are listed above.
5. Write the 'explanation' in Portuguese (pt-BR), clearly, for the end user.
6. For 'select' elements (Role: combobox), when using the "fill" action, the "value" field must contain exactly the text of one of the options listed in "Opções disponíveis" for that element.
7. The "fill" action is only valid on elements with Type "input", "textarea" or "select", or Role "textbox" or "combobox". Never use "fill" on links (a), buttons (button), or any element without an editable field — use "click" instead.
8. Before repeating an action, check the Action History: if the last action is already identical to the one you're about to take (same action, same target) and the Current URL hasn't changed since then, it had no effect — choose a different action instead of repeating it.

---
Respond STRICTLY in valid JSON, without markdown, following exactly this format:
{
  "action": "click" | "fill" | "navigate" | "finish" | "wait",
  "targetId": "numeric element ID (string), required only for 'click' and 'fill'",
  "value": "text to fill (fill), full URL (navigate), or time in ms (wait)",
  "reasoning": "internal reasoning in Portuguese (pt-BR) explaining the decision",
  "explanation": "short, friendly message in Portuguese (pt-BR) explaining to the user what you're about to do"
}
`;

  const responseText = await callOpenRouterJSON(prompt, "next step planning");
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
You are an automation and Playwright testing expert.
We received an automatically generated Playwright test script that failed during execution.

Below is the code of the script that failed:
\`\`\`typescript
${code}
\`\`\`

Below are the terminal execution logs containing the failure's error message:
\`\`\`
${errorLogs}
\`\`\`

Important instructions:
1. Carefully analyze the error shown in the logs and the corresponding script code.
2. Identify which line, selector, assertion, or parameter caused the test to fail.
3. Fix the error in the Playwright script while keeping the original flow logic, adjusting only the selector, visibility selector, wait, or logic that caused the test to break.
4. Ensure the code returned in the 'fixedCode' property is the COMPLETE and valid Playwright TypeScript script, including the imports (e.g. from '@playwright/test') and the main 'test(...)' block.
5. Do not add markdown code block markers (\`\`\`ts) to the 'fixedCode' value.
6. Briefly explain in the 'explanation' property (in Portuguese, pt-BR) what the problem was and how you fixed it.

---
Respond STRICTLY in valid JSON, without markdown, following exactly this format:
{
  "fixedCode": "complete, updated code of the fixed Playwright script",
  "explanation": "explanation in Portuguese (pt-BR) detailing what the error in the logs was and how it was fixed"
}
`;

  const responseText = await callOpenRouterJSON(prompt, "script self-healing");
  return JSON.parse(responseText) as HealedScriptResult;
}
