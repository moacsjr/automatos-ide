import { BrowserContext, Page } from "playwright";
import { PlaywrightGenerator } from "../generator/playwright.js";
import { listenerScript } from "../recorder/listener.js";
import { agentEvents } from "../utils/logger.js";
import { getAgentExecuting } from "./autonomous.js";

// Mantém uma referência dinâmica ao gerador ativo e ao último URL da sessão de gravação atual
let activeGenerator: PlaywrightGenerator | null = null;
let lastUrl = "";

// Helper para monitorar logs do console
export const registerConsoleListener = (page: Page) => {
  if ((page as any).__automatos_page_listeners) return;
  (page as any).__automatos_page_listeners = true;

  page.on("console", (msg) => {
    const txt = msg.text();
    if (txt.includes("[Automatos-IA]") || msg.type() === "error") {
      agentEvents.log(`💻 [Console do Navegador] [${msg.type()}] ${txt}`);
    }
  });
  page.on("pageerror", (err) => {
    agentEvents.error(`❌ [Erro na Página] ${err.message}`);
  });
};

// Helper para registrar navegações
export const registerNavigationListener = (page: Page) => {
  if ((page as any).__automatos_nav_listeners) return;
  (page as any).__automatos_nav_listeners = true;

  page.on("framenavigated", (frame) => {
    // Registrar apenas para o frame principal
    if (frame === page.mainFrame()) {
      const url = page.url();
      if (
        url !== lastUrl &&
        url !== "about:blank" &&
        !url.startsWith("chrome-extension://")
      ) {
        // Ignora navegações do agente autônomo
        if (getAgentExecuting()) {
          lastUrl = url;
          return;
        }
        agentEvents.log(`[Ação Gravada] Navegou para: ${url}`);
        lastUrl = url;
        if (activeGenerator) {
          activeGenerator.addStep({
            action: "navigate",
            value: url,
            description: `Navegou para a URL: ${url}`,
          });
        }
      }
    }
  });
};

/**
 * Inicia o modo Co-piloto para escutar as ações do usuário no Chrome.
 */
export async function runCopilotMode(
  context: BrowserContext,
  generator: PlaywrightGenerator,
): Promise<void> {
  activeGenerator = generator;
  lastUrl = "";

  agentEvents.log("\n🎙️ [Co-piloto] Modo de escuta ativado!");
  agentEvents.log(
    "👉 Por favor, navegue e realize as ações desejadas no Chrome.",
  );
  agentEvents.log("   Suas ações serão gravadas em tempo real.\n");

  const pages = context.pages();

  if (pages.length > 0 && pages[0].url() !== "about:blank") {
    lastUrl = pages[0].url();
    agentEvents.log(`[Co-piloto] Iniciando gravação a partir de: ${lastUrl}`);
    generator.addStep({
      action: "navigate",
      value: lastUrl,
      description: `Iniciou a navegação em: ${lastUrl}`,
    });
  }

  // Se o contexto do navegador já foi inicializado com os ouvintes do co-piloto,
  // ainda precisamos registrar os ouvintes de página nas abas atuais e injetar o script
  if ((context as any).__automatos_initialized) {
    for (const page of pages) {
      registerConsoleListener(page);
      registerNavigationListener(page);
      try {
        await page.evaluate(listenerScript).catch(() => {});
      } catch (e) {}
    }
    return;
  }
  (context as any).__automatos_initialized = true;

  // Registra a função de retorno no contexto
  try {
    await context.exposeFunction("onUserAction", (action: any) => {
      // Ignora ações que foram realizadas pelo agente autônomo em execução
      if (getAgentExecuting()) {
        return;
      }
      agentEvents.log(`[Ação Gravada] ${action.description || action.action}`);
      if (activeGenerator) {
        activeGenerator.addStep(action);
      }
    });
  } catch (err) {
    // Função já registrada anteriormente no contexto
  }

  // Registra o script de inicialização para qualquer nova aba
  await context.addInitScript(listenerScript);

  // Monitora novas páginas/guias abertas
  context.on("page", async (newPage) => {
    agentEvents.log(`[Co-piloto] Nova guia detectada.`);
    registerConsoleListener(newPage);
    registerNavigationListener(newPage);
  });

  // Aplica aos navegadores/páginas já abertas
  for (const page of pages) {
    registerConsoleListener(page);
    registerNavigationListener(page);
    try {
      // Injeta manualmente na aba atual
      await page.evaluate(listenerScript).catch(() => {});
    } catch (e) {
      // Ignora falhas se a página não estiver totalmente carregada
    }
  }
}
