import express from "express";
import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";
import { launchBrowser, getActivePage } from "./browser.js";
import { runAutonomousAgent, stopAgentExecution } from "./agent/autonomous.js";
import {
  runCopilotMode,
  registerConsoleListener,
  registerNavigationListener,
} from "./agent/copilot.js";
import { listenerScript } from "./recorder/listener.js";
import { PlaywrightGenerator } from "./generator/playwright.js";
import { agentEvents } from "./utils/logger.js";
import { healPlaywrightScript } from "./agent/llm.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware de CORS nativo
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Servir os arquivos estáticos do Dashboard Web
const publicPath = path.resolve("public");
app.use(express.static(publicPath));

// Estado global do servidor
let browserInstance: any = null;
let browserContext: any = null;
let activePage: any = null;
let currentCdpPort: number = 9222;

let sessionType: "idle" | "running_agent" | "recording_copilot" = "idle";
let generatorInstance: PlaywrightGenerator | null = null;

// Lista de clientes conectados ao SSE
let sseClients: express.Response[] = [];

let activeCdpSession: any = null;

async function startScreencast(page: any) {
  try {
    if (activeCdpSession) {
      try {
        await activeCdpSession.send("Page.stopScreencast");
      } catch (e) {}
      activeCdpSession = null;
    }

    // Cria nova sessão CDP para capturar frames da tela do navegador
    const session = await page.context().newCDPSession(page);
    activeCdpSession = session;
    await session.send("Page.startScreencast", { format: "jpeg", quality: 50 });

    session.on("Page.screencastFrame", async (event: any) => {
      if (activeCdpSession !== session) {
        return;
      }
      const sseData = `data: ${JSON.stringify({
        type: "frame",
        image: event.data,
        metadata: event.metadata,
      })}\n\n`;
      sseClients.forEach((client) => {
        client.write(sseData);
      });
      await session
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch(() => {});
    });

    agentEvents.log("📸 Screencast do navegador iniciado via CDP.");
  } catch (err: any) {
    console.error("Erro ao iniciar screencast:", err);
  }
}

function setupPageListeners(page: any) {
  if (!page) return;

  // Previne adicionar múltiplos listeners na mesma página
  if (page.__screencast_listeners_attached) return;
  page.__screencast_listeners_attached = true;

  page.on("framenavigated", async (frame: any) => {
    // Apenas reinicia o screencast se for a página ativa e for o frame principal
    if (frame === page.mainFrame() && activePage === page) {
      agentEvents.log(
        `[Screencast] Página ativa navegada para: ${page.url()}. Reiniciando screencast.`,
      );
      await startScreencast(page);

      // Reinjetar listeners e script de escuta do co-piloto após a navegação para manter a gravação ativa
      if (sessionType === "recording_copilot") {
        agentEvents.log(
          `[Co-piloto] Re-injetando ouvintes e script de escuta na página ativa.`,
        );
        registerConsoleListener(page);
        registerNavigationListener(page);
        await page.evaluate(listenerScript).catch(() => {});
      }
    }
  });

  page.on("close", () => {
    agentEvents.log(`[Screencast] Página fechada: ${page.url()}`);
    // Se a página fechada for a ativa, tenta obter outra página ativa
    if (activePage === page) {
      if (browserContext) {
        const pages = browserContext.pages();
        if (pages.length > 0) {
          activePage = pages[pages.length - 1];
          startScreencast(activePage).catch(() => {});
        } else {
          activePage = null;
          activeCdpSession = null;
        }
      } else {
        activePage = null;
        activeCdpSession = null;
      }
    }
  });
}

async function handleNewBrowserConnection(connection: any) {
  browserInstance = connection.browser;
  browserContext = connection.context;
  activePage = connection.page;

  if (browserContext) {
    const pages = browserContext.pages();
    for (const page of pages) {
      setupPageListeners(page);
    }
  }

  if (activePage) {
    await startScreencast(activePage);
  }

  // Escuta troca de abas/páginas abertas para atualizar o screencast
  browserContext.on("page", async (newPage: any) => {
    agentEvents.log("[Screencast] Nova aba detectada, alternando stream.");
    activePage = newPage;
    setupPageListeners(newPage);
    await startScreencast(activePage);
  });
}

// Redireciona todos os eventos de agentEvents para os clientes SSE conectados
agentEvents.on("message", (data) => {
  const sseData = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    client.write(sseData);
  });
});

/**
 * Rota SSE para streaming de eventos em tempo real
 */
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Envia o status atual do sistema imediatamente na conexão
  res.write(
    `data: ${JSON.stringify({ type: "status", status: sessionType })}\n\n`,
  );

  sseClients.push(res);

  req.on("close", () => {
    sseClients = sseClients.filter((client) => client !== res);
  });
});

/**
 * Retorna o status atual do servidor
 */
app.get("/api/status", async (req, res) => {
  let isConnected = false;
  let currentUrl = "";

  if (browserContext) {
    try {
      isConnected = true;
      const page = await getActivePage(browserContext);
      currentUrl = page.url();
    } catch (e) {
      // Se deu erro ao acessar, provavelmente a conexão caiu
      isConnected = false;
      browserContext = null;
      browserInstance = null;
    }
  }

  res.json({
    connected: isConnected,
    sessionType,
    cdpPort: currentCdpPort,
    currentUrl,
  });
});

/**
 * Inicia o Agente Autônomo
 */
app.post("/api/agent/start", async (req, res) => {
  if (!browserContext) {
    try {
      agentEvents.log(
        "Navegador não conectado. Iniciando uma nova instância do Chrome...",
      );
      const connection = await launchBrowser();
      await handleNewBrowserConnection(connection);
    } catch (err: any) {
      agentEvents.error(
        `❌ Falha ao iniciar o navegador Chrome: ${err.message}`,
      );
      return res
        .status(500)
        .json({ error: `Falha ao iniciar o navegador Chrome: ${err.message}` });
    }
  }

  // Permite executar agente se estiver ocioso (idle) ou no meio de uma gravação co-piloto (modo híbrido)
  if (sessionType !== "idle" && sessionType !== "recording_copilot") {
    return res
      .status(400)
      .json({ error: "Já existe uma sessão ativa em execução." });
  }

  const { objective, maxSteps } = req.body;
  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res
      .status(400)
      .json({ error: "O objetivo (objective) é obrigatório." });
  }

  const stepsLimit = maxSteps ? parseInt(maxSteps, 10) : 20;
  const isHybrid = sessionType === "recording_copilot";

  if (!isHybrid) {
    generatorInstance = new PlaywrightGenerator();
  }
  sessionType = "running_agent";
  agentEvents.status("running_agent");

  // Inicia o agente de forma assíncrona para liberar a resposta HTTP imediatamente
  runAutonomousAgent(browserContext, objective, generatorInstance!, stepsLimit)
    .then(() => {
      agentEvents.log("🤖 Agente Autônomo finalizou a execução.");
    })
    .catch((err) => {
      agentEvents.error(`💥 Erro durante a execução do agente: ${err.message}`);
    })
    .finally(() => {
      if (isHybrid) {
        sessionType = "recording_copilot";
        agentEvents.status("recording_copilot");
      } else {
        sessionType = "idle";
        agentEvents.status("idle");
      }
    });

  res.json({ success: true, message: "Agente iniciado com sucesso!" });
});

/**
 * Inicia o modo Co-piloto (sessão de gravação híbrida)
 */
app.post("/api/copilot/start", async (req, res) => {
  if (!browserContext) {
    try {
      agentEvents.log(
        "Navegador não conectado. Iniciando uma nova instância do Chrome...",
      );
      const connection = await launchBrowser();
      await handleNewBrowserConnection(connection);
    } catch (err: any) {
      agentEvents.error(
        `❌ Falha ao iniciar o navegador Chrome: ${err.message}`,
      );
      return res
        .status(500)
        .json({ error: `Falha ao iniciar o navegador Chrome: ${err.message}` });
    }
  }

  if (sessionType !== "idle") {
    return res
      .status(400)
      .json({ error: "Já existe uma sessão ativa em execução." });
  }

  // Prepara o navegador: abre uma nova aba limpa e fecha todas as outras abas abertas
  try {
    agentEvents.log(
      "[Sessão] Preparando abas para gravação (abrindo nova aba e fechando anteriores)...",
    );
    const newPage = await browserContext.newPage();
    const pages = browserContext.pages();
    for (const page of pages) {
      if (page !== newPage) {
        await page.close().catch(() => {});
      }
    }
    activePage = newPage;
    await startScreencast(activePage);
  } catch (err: any) {
    agentEvents.error(
      `❌ Falha ao inicializar nova aba de gravação: ${err.message}`,
    );
    return res
      .status(500)
      .json({ error: `Falha ao preparar abas para gravação: ${err.message}` });
  }

  generatorInstance = new PlaywrightGenerator();
  sessionType = "recording_copilot";
  agentEvents.status("recording_copilot");

  try {
    // Interceptamos as ações apenas se a gravação estiver ativamente no modo copilot
    await runCopilotMode(browserContext, generatorInstance);
    res.json({ success: true, message: "Gravação do co-piloto iniciada!" });
  } catch (err: any) {
    sessionType = "idle";
    agentEvents.status("idle");
    agentEvents.error(`Erro ao iniciar co-piloto: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Para a gravação ou execução ativa e retorna o código gerado
 */
app.post("/api/session/stop", async (req, res) => {
  if (sessionType === "idle") {
    return res.json({
      success: true,
      message: "Nenhuma sessão ativa.",
      code: generatorInstance ? generatorInstance.generateCode() : "",
      steps: generatorInstance ? generatorInstance.getSteps() : [],
    });
  }

  const previousType = sessionType;

  if (sessionType === "running_agent") {
    stopAgentExecution();
    // Aguarda um pequeno delay para que a iteração atual do agente receba o cancelamento
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  sessionType = "idle";
  agentEvents.status("idle");
  agentEvents.log(`Sessão (${previousType}) interrompida pelo usuário.`);

  const code = generatorInstance ? generatorInstance.generateCode() : "";
  const steps = generatorInstance ? generatorInstance.getSteps() : [];

  res.json({
    success: true,
    message: "Sessão finalizada com sucesso!",
    code,
    steps,
  });
});

/**
 * Retorna o script compilado e os passos atuais acumulados
 */
app.get("/api/script", (req, res) => {
  if (!generatorInstance) {
    return res.json({ code: "", steps: [] });
  }
  res.json({
    code: generatorInstance.generateCode(),
    steps: generatorInstance.getSteps(),
  });
});

/**
 * Executa uma interação manual enviada pela viewport espelhada (clique, digitação, navegação)
 */
app.post("/api/interaction", async (req, res) => {
  const { action, x, y, value, url, width, height } = req.body;

  if (browserContext && (!activePage || activePage.isClosed())) {
    try {
      activePage = await getActivePage(browserContext);
    } catch (e) {
      activePage = null;
    }
  }

  if (!activePage) {
    return res.status(400).json({ error: "Navegador não conectado." });
  }

  try {
    if (action === "click") {
      let targetX = x;
      let targetY = y;

      if (width && height) {
        const viewport = activePage.viewportSize() || {
          width: 1280,
          height: 720,
        };
        targetX = (x / width) * viewport.width;
        targetY = (y / height) * viewport.height;
      }

      await activePage.bringToFront().catch(() => {});
      await activePage.mouse.click(targetX, targetY);
    } else if (action === "navigate") {
      await activePage.goto(url, { waitUntil: "load" });
    } else if (action === "fill") {
      await activePage.keyboard.type(value);
    } else if (action === "press") {
      await activePage.keyboard.press(value);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Executa o script gerado em um ambiente isolado do Playwright e faz streaming dos logs
 */
app.post("/api/session/test", async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "O código do script é obrigatório." });
  }

  try {
    fs.mkdirSync("spec", { recursive: true });
    fs.writeFileSync("spec/temp_test.spec.ts", code, "utf-8");
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: `Falha ao salvar o script de teste: ${err.message}` });
  }

  // Define headers para streaming de texto chunked
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
  });

  res.write("🧪 [Automatos-IA] Iniciando Playwright Test Runner...\n");

  const child = spawn(
    "npx",
    ["playwright", "test", "spec/temp_test.spec.ts", "--headed"],
    {
      env: { ...process.env, FORCE_COLOR: "0" }, // Desativa cores ANSI nos logs
    },
  );

  child.stdout.on("data", (data) => {
    res.write(data.toString());
  });

  child.stderr.on("data", (data) => {
    res.write(data.toString());
  });

  child.on("close", (code) => {
    res.write(`\n=======================================================\n`);
    if (code === 0) {
      res.write(
        "✅ [Automatos-IA] Execução finalizada com sucesso! (Passed)\n",
      );
    } else {
      res.write(
        `❌ [Automatos-IA] Execução finalizada com erro (Exit Code: ${code})\n`,
      );
    }
    res.end();
  });

  child.on("error", (err) => {
    res.write(
      `\n💥 [Automatos-IA] Falha ao executar o runner: ${err.message}\n`,
    );
    res.end();
  });
});

/**
 * Endpoint de Self-Healing: Recebe o script falho e os logs de erro,
 * consulta a LLM para corrigir o script e retorna a versão reparada.
 */
app.post("/api/session/heal", async (req, res) => {
  const { code, logs } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "O código do script é obrigatório." });
  }

  const logsString = Array.isArray(logs) ? logs.join("\n") : logs || "";

  try {
    console.log("🩹 [Self-Healing] Iniciando auto-correção via LLM...");
    const result = await healPlaywrightScript(code, logsString);
    res.json({
      success: true,
      fixedCode: result.fixedCode,
      explanation: result.explanation,
    });
  } catch (err: any) {
    console.error("❌ [Self-Healing] Erro no reparo do script:", err);
    res.status(500).json({ error: `Falha no Self-Healing: ${err.message}` });
  }
});

// Inicialização do servidor
export async function startServer() {
  console.log("Iniciando navegador Chrome na inicialização...");
  try {
    const connection = await launchBrowser();
    await handleNewBrowserConnection(connection);
    console.log(
      "🟢 Navegador Chrome lançado e conectado com sucesso na inicialização!",
    );
  } catch (err: any) {
    console.error(
      `❌ Erro crítico ao iniciar o navegador Chrome na inicialização: ${err.message}`,
    );
  }

  app.listen(PORT, () => {
    console.log(`\n=======================================================`);
    console.log(
      `🚀 AUTOMATOS-IA API Server rodando em http://localhost:${PORT}`,
    );
    console.log(`📂 Servindo painel web estático da pasta './public'`);
    console.log(`=======================================================\n`);
  });
}
