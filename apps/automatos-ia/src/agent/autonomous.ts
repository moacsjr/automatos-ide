import { Page, BrowserContext } from "playwright";
import { captureDOMState, getActivePage } from "../browser.js";
import { askGeminiForNextAction, AgentDecision } from "./llm.js";
import { PlaywrightGenerator } from "../generator/playwright.js";
import { agentEvents } from "../utils/logger.js";

export let cancelAgentExecution = false;
export let isAgentExecuting = false;

export function getAgentExecuting(): boolean {
  return isAgentExecuting;
}

export function setAgentExecuting(value: boolean): void {
  isAgentExecuting = value;
}

export function stopAgentExecution() {
  cancelAgentExecution = true;
}

/**
 * Executa o loop do agente autônomo.
 */
export async function runAutonomousAgent(
  context: BrowserContext,
  objective: string,
  generator: PlaywrightGenerator,
  maxSteps: number = 20,
): Promise<void> {
  let stepsCount = 0;
  const history: string[] = [];

  cancelAgentExecution = false;
  setAgentExecuting(true);
  agentEvents.log(`\n🤖 [Agente Autônomo] Iniciando execução.`);
  agentEvents.log(`🎯 Objetivo: "${objective}"\n`);

  try {
    while (stepsCount < maxSteps) {
      if (cancelAgentExecution) {
        agentEvents.log("🛑 Execução cancelada pelo usuário.");
        break;
      }
      stepsCount++;
      agentEvents.log(
        `\n=================== PASSO ${stepsCount}/${maxSteps} ===================`,
      );

      let page: Page;
      try {
        page = await getActivePage(context);
      } catch (err: any) {
        agentEvents.error(`❌ Erro ao obter página ativa: ${err.message}`);
        break;
      }

      const currentUrl = page.url();
      agentEvents.log(`🌐 URL Atual: ${currentUrl}`);

      agentEvents.log("🔍 Analisando a página e estruturando o DOM...");
      let domState;
      try {
        domState = await captureDOMState(page);
      } catch (err: any) {
        agentEvents.error(
          `❌ Falha ao analisar o DOM: ${err.message}. Tentando aguardar um instante...`,
        );
        await page.waitForTimeout(2000);
        try {
          domState = await captureDOMState(page);
        } catch (retryErr: any) {
          agentEvents.error(`❌ Falha persistente no DOM: ${retryErr.message}`);
          break;
        }
      }

      const { simplifiedDOM, elementsMap } = domState;

      agentEvents.log("🧠 Pensando com Gemini...");
      let decision: AgentDecision;
      try {
        decision = await askGeminiForNextAction(
          objective,
          currentUrl,
          simplifiedDOM,
          history,
        );
      } catch (err: any) {
        agentEvents.error(`❌ Erro ao obter decisão do LLM: ${err.message}`);
        break;
      }

      agentEvents.log(`\n📋 Raciocínio: ${decision.reasoning}`);
      agentEvents.log(`🚀 Ação planejada: ${decision.explanation}`);

      if (decision.action === "finish") {
        agentEvents.log("\n✅ Objetivo concluído com sucesso pelo agente!");
        break;
      }

      if (decision.action === "navigate") {
        const url = decision.value;
        if (!url) {
          agentEvents.warn(
            "⚠️ Ação 'navigate' solicitada, mas nenhuma URL foi fornecida.",
          );
          continue;
        }

        agentEvents.log(`✈️ Navegando para: ${url}`);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          history.push(`Navegou para "${url}"`);
          generator.addStep({
            action: "navigate",
            value: url,
            description: `Navegou para a URL: ${url}`,
          });
        } catch (err: any) {
          agentEvents.error(`❌ Falha ao navegar para ${url}: ${err.message}`);
          history.push(`Falhou ao tentar navegar para "${url}"`);
        }
        continue;
      }

      if (decision.action === "wait") {
        const ms = decision.value ? parseInt(decision.value, 10) : 2000;
        agentEvents.log(`⏱️ Aguardando ${ms}ms...`);
        await page.waitForTimeout(ms);

        history.push(`Aguardou por ${ms}ms`);
        generator.addStep({
          action: "wait",
          value: ms.toString(),
          description: `Aguardou por ${ms}ms`,
        });
        continue;
      }

      // Ações que requerem targetId: click e fill
      const targetId = decision.targetId;
      if (
        targetId === undefined ||
        targetId === null ||
        !elementsMap[targetId]
      ) {
        agentEvents.warn(
          `⚠️ ID de elemento alvo inválido ou ausente: "${targetId}". Solicitando nova decisão.`,
        );
        history.push(
          `Tentou interagir com ID de elemento inválido: "${targetId}"`,
        );
        continue;
      }

      const element = elementsMap[targetId];
      const agentSelector = `[data-agent-id="${targetId}"]`;
      const resilientSelector = element.resilientSelector;
      const elementDesc = element.text
        ? `"${element.text}" (${element.tagName})`
        : `elemento ${element.tagName}`;

      if (decision.action === "click") {
        agentEvents.log(`🖱️ Clicando em: ${elementDesc}`);
        agentEvents.log(`   Seletor de gravação: ${resilientSelector}`);

        try {
          // Tenta clicar usando o data-agent-id visível com timeout curto
          await page
            .locator(agentSelector)
            .filter({ visible: true })
            .first()
            .click({ timeout: 5000 });
          // Pequena pausa pós-clique para permitir atualizações parciais de estado
          await page.waitForTimeout(1000);

          history.push(`Clicou em ${elementDesc}`);
          generator.addStep({
            action: "click",
            selector: resilientSelector,
            description: `Clicou em: ${elementDesc}`,
          });
        } catch (err: any) {
          agentEvents.warn(
            `⚠️ Falha ao clicar com ID temporário (${err.message}). Tentando fallback com seletor resiliente: ${resilientSelector}`,
          );
          try {
            await page
              .locator(resilientSelector)
              .filter({ visible: true })
              .first()
              .click({ timeout: 10000 });
            await page.waitForTimeout(1000);

            history.push(`Clicou em ${elementDesc} (via seletor resiliente)`);
            generator.addStep({
              action: "click",
              selector: resilientSelector,
              description: `Clicou em: ${elementDesc}`,
            });
          } catch (fallbackErr: any) {
            agentEvents.error(
              `❌ Falha persistente ao clicar no elemento: ${fallbackErr.message}`,
            );
            history.push(`Falhou ao clicar em ${elementDesc}`);
          }
        }
        continue;
      }

      if (decision.action === "fill") {
        const textToFill = decision.value || "";
        agentEvents.log(`✍️ Preenchendo: ${elementDesc} com "${textToFill}"`);
        agentEvents.log(`   Seletor de gravação: ${resilientSelector}`);

        try {
          // Tenta preencher usando o data-agent-id visível com timeout curto
          await page
            .locator(agentSelector)
            .filter({ visible: true })
            .first()
            .fill(textToFill, { timeout: 5000 });

          history.push(`Preenceu ${elementDesc} com "${textToFill}"`);
          generator.addStep({
            action: "fill",
            selector: resilientSelector,
            value: textToFill,
            description: `Preenceu ${elementDesc} com o valor: "${textToFill}"`,
          });
        } catch (err: any) {
          agentEvents.warn(
            `⚠️ Falha ao preencher com ID temporário (${err.message}). Tentando fallback com seletor resiliente: ${resilientSelector}`,
          );
          try {
            await page
              .locator(resilientSelector)
              .filter({ visible: true })
              .first()
              .fill(textToFill, { timeout: 10000 });

            history.push(
              `Preenceu ${elementDesc} com "${textToFill}" (via seletor resiliente)`,
            );
            generator.addStep({
              action: "fill",
              selector: resilientSelector,
              value: textToFill,
              description: `Preenceu ${elementDesc} com o valor: "${textToFill}"`,
            });
          } catch (fallbackErr: any) {
            agentEvents.error(
              `❌ Falha persistente ao preencher o elemento: ${fallbackErr.message}`,
            );
            history.push(`Falhou ao preencher ${elementDesc}`);
          }
        }
        continue;
      }
    }
  } finally {
    setAgentExecuting(false);
  }

  if (stepsCount >= maxSteps) {
    agentEvents.warn(
      "\n⚠️ Limite máximo de passos atingido antes de alcançar o objetivo.",
    );
  }
}
