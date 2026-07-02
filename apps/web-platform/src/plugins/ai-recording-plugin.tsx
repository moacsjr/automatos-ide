import React, { useState, useEffect, useRef, useCallback } from "react";
import { pluginRegistry } from "@pluggable-js/core";
import { Script } from "./scripts-plugin/schema";
import { DynamoDbScriptsService } from "./scripts-plugin/service";
import { authFetch } from "../auth/cognito";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Node,
  Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "https://8agnfud1gh.execute-api.us-east-1.amazonaws.com";
const API_BASE = isLocal ? "http://localhost:3001" : `${API_BASE_URL}/ia`;

interface TimelineStep {
  action: string;
  value?: string;
  selector?: string;
  description: string;
}

export function AiRecordingComponent({
  recordingScript,
  onCloseRecording,
}: {
  recordingScript?: Script;
  onCloseRecording?: () => void;
}) {
  // Browser Connection & Stream State
  const [isConnected, setIsConnected] = useState(false);
  const [sessionType, setSessionType] = useState<
    "idle" | "running_agent" | "recording_copilot"
  >("idle");
  const [frameSrc, setFrameSrc] = useState<string>("");
  const [browserUrl, setBrowserUrl] = useState<string>("https://google.com");
  const [inputUrl, setInputUrl] = useState<string>("https://google.com");

  // Real-time Logs & Chat State
  const [logs, setLogs] = useState<
    Array<{
      sender: "user" | "assistant" | "system" | "error" | "ai-thought";
      text: string;
    }>
  >([
    {
      sender: "assistant",
      text: "Olá! Eu sou o assistente IA. Digite um objetivo (ex: 'Faça login no UOL') ou clique em 'Iniciar Gravação' para começar.",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [variables, setVariables] = useState<string[]>([
    "{{user.username}}",
    "{{user.password}}",
    "{{product.name}}",
  ]);
  const [typingValue, setTypingValue] = useState("");
  const [showTypingPanel, setShowTypingPanel] = useState(false);

  // React Flow State
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [recordedSteps, setRecordedSteps] = useState<TimelineStep[]>([]);

  // New States for Hybrid Mode
  const [activeTimelineTab, setActiveTimelineTab] = useState<
    "timeline" | "code"
  >("timeline");
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // States and refs for Test Runner
  const [testLogs, setTestLogs] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testFailed, setTestFailed] = useState(false);
  const [isHealing, setIsHealing] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isInputFocusedRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleFinishRecording = async () => {
    if (!recordingScript) return;

    setIsSaving(true);
    try {
      // 1. Parar a sessão se estiver ativa
      if (sessionType !== "idle") {
        await stopSession();
      }

      // 2. Resolver o serviço de scripts
      const service =
        pluginRegistry.getService<DynamoDbScriptsService>("scripts-service");

      // 3. Atualizar o rawScript com o código gerado
      await service.update(recordingScript.id, {
        ...recordingScript,
        rawScript: generatedCode || "// Nenhum comando foi gravado.",
      });

      alert(
        `Script "${recordingScript.Title}" atualizado com sucesso com as ações gravadas!`,
      );

      if (onCloseRecording) {
        onCloseRecording();
      }
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao salvar o script no DynamoDB: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelRecording = () => {
    if (
      generatedCode &&
      !confirm("Deseja descartar as ações gravadas para este script?")
    ) {
      return;
    }
    if (sessionType !== "idle") {
      stopSession().catch(() => {});
    }
    if (onCloseRecording) {
      onCloseRecording();
    }
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Fetch connection status from automatos-ia
  const checkStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/status`);
      const data = await res.json();
      setIsConnected(data.connected);
      setSessionType(data.sessionType);
      if (data.currentUrl) {
        setBrowserUrl(data.currentUrl);
        if (!isInputFocusedRef.current) {
          setInputUrl(data.currentUrl);
        }
      }
    } catch (err) {
      setIsConnected(false);
    }
  }, []);

  // Processa um evento (mesmo formato do SSE antigo) vindo do polling.
  const handleEvent = useCallback((data: any) => {
    if (data.type === "status") {
      setSessionType(data.status);
    } else if (data.type === "step") {
      setRecordedSteps((prev) => {
        const stepExists = prev.some(
          (s) =>
            s.action === data.step.action &&
            s.selector === data.step.selector &&
            s.value === data.step.value &&
            s.description === data.step.description,
        );
        if (stepExists) return prev;
        return [...prev, data.step];
      });
      authFetch(`${API_BASE}/api/script`)
        .then((res) => res.json())
        .then((resData) => {
          if (resData.code) {
            setGeneratedCode(resData.code);
          }
        })
        .catch(() => {});
    } else if (data.type === "log") {
      const isThought =
        data.message.includes("🧠") || data.message.includes("Pensando");
      setLogs((prev) => [
        ...prev,
        { sender: isThought ? "ai-thought" : "assistant", text: data.message },
      ]);
    } else if (data.type === "error") {
      setLogs((prev) => [...prev, { sender: "error", text: data.message }]);
    } else if (data.type === "warn") {
      setLogs((prev) => [
        ...prev,
        { sender: "system", text: `⚠️ ${data.message}` },
      ]);
    }
  }, []);

  // Modo polling: substitui o SSE. O EventSource não permite header
  // Authorization e o API Gateway (proxy autenticado) não faz streaming, então
  // fazemos polling autenticado em /api/poll pelo mesmo proxy.
  const setupPolling = useCallback(() => {
    let active = true;
    let cursor = 0;
    let frameSeq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await authFetch(
          `${API_BASE}/api/poll?cursor=${cursor}&frameSeq=${frameSeq}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (!active) return;
          setIsConnected(true);
          if (typeof data.cursor === "number") cursor = data.cursor;
          if (data.frame && typeof data.frame.seq === "number") {
            frameSeq = data.frame.seq;
            setFrameSrc(`data:image/jpeg;base64,${data.frame.image}`);
          }
          if (Array.isArray(data.events)) {
            for (const ev of data.events) handleEvent(ev);
          }
          if (typeof data.sessionType === "string") {
            setSessionType(data.sessionType);
          }
        } else {
          setIsConnected(false);
        }
      } catch {
        if (active) setIsConnected(false);
      } finally {
        if (active) timer = setTimeout(poll, 700);
      }
    };

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [handleEvent]);

  // Trigger initial checks and connection
  useEffect(() => {
    checkStatus();
    const cleanupPolling = setupPolling();

    const interval = setInterval(checkStatus, 3000);
    return () => {
      clearInterval(interval);
      cleanupPolling();
    };
  }, [checkStatus, setupPolling]);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollTop = terminalEndRef.current.scrollHeight;
    }
  }, [testLogs]);

  // Executa o script do Playwright no backend
  const runPlaywrightTest = async () => {
    if (!generatedCode) return;

    setIsTesting(true);
    setTestFailed(false);
    setShowTerminal(true);
    setTestLogs(["⏳ Enviando script para o servidor..."]);

    try {
      const response = await authFetch(`${API_BASE}/api/session/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: generatedCode }),
      });

      if (!response.body) {
        throw new Error("Resposta sem corpo de streaming (body) recebida.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      setTestLogs((prev) => [
        ...prev,
        "🔌 Conectado ao executor. Recebendo logs em tempo real...",
      ]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        if (lines.length > 0) {
          setTestLogs((prev) => [...prev, ...lines]);
        }
      }

      if (buffer) {
        setTestLogs((prev) => [...prev, buffer]);
      }

      // Verifica se houve falha examinando os logs ao final da execução
      setTestLogs((currentLogs) => {
        const failed = currentLogs.some(
          (log) =>
            log.includes("❌ [Automatos-IA]") ||
            log.includes("💥 [Automatos-IA]") ||
            log.includes("Error:") ||
            log.includes("fail"),
        );
        setTestFailed(failed);
        return currentLogs;
      });
    } catch (err: any) {
      setTestLogs((prev) => [
        ...prev,
        `💥 Erro de conexão com o executor de testes: ${err.message}`,
      ]);
      setTestFailed(true);
    } finally {
      setIsTesting(false);
    }
  };

  // Aciona a LLM para auto-correção do script (Self-Healing)
  const handleSelfHealingScript = async () => {
    if (!generatedCode || testLogs.length === 0) return;

    setIsHealing(true);
    setTestLogs((prev) => [
      ...prev,
      "",
      "🩹 [Self-Healing] Enviando script e logs para a IA analisar...",
      "🧠 [Self-Healing] IA está analisando a causa raiz da falha e corrigindo o script...",
    ]);

    try {
      const response = await authFetch(`${API_BASE}/api/session/heal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: generatedCode, logs: testLogs }),
      });

      if (!response.ok) {
        throw new Error(`Servidor retornou status ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.fixedCode) {
        setGeneratedCode(data.fixedCode);
        setTestFailed(false);
        setTestLogs((prev) => [
          ...prev,
          "",
          `✅ [Self-Healing] Script auto-corrigido com sucesso!`,
          `📝 Explicação da Correção: ${data.explanation}`,
          "💡 Novo código carregado no editor. Clique em 'Testar Script' para revalidar.",
        ]);
      } else {
        throw new Error(data.error || "Retorno inválido do servidor.");
      }
    } catch (err: any) {
      setTestLogs((prev) => [
        ...prev,
        "",
        `❌ [Self-Healing] Falha ao tentar auto-corrigir o script: ${err.message}`,
      ]);
    } finally {
      setIsHealing(false);
    }
  };

  // Connect to Chrome CDP Browser Instance
  const connectBrowser = async () => {
    setLogs((prev) => [
      ...prev,
      { sender: "system", text: "Conectando ao Chrome..." },
    ]);
    try {
      const res = await authFetch(`${API_BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: 9222 }),
      });
      const data = await res.json();
      if (data.success) {
        setIsConnected(true);
        setLogs((prev) => [
          ...prev,
          {
            sender: "assistant",
            text: "🟢 Conectado ao Chrome na porta 9222! O feed está ativo.",
          },
        ]);
        checkStatus();
      } else {
        setLogs((prev) => [
          ...prev,
          { sender: "error", text: "Falha na conexão: " + data.error },
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { sender: "error", text: "Falha na conexão: " + err.message },
      ]);
    }
  };

  // Start Copilot mode
  const startRecording = async () => {
    setLogs((prev) => [
      ...prev,
      { sender: "system", text: "Iniciando sessão de gravação Co-piloto..." },
    ]);
    try {
      const res = await authFetch(`${API_BASE}/api/copilot/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setSessionType("recording_copilot");
        setRecordedSteps([]);
        setGeneratedCode("");
        setLogs((prev) => [
          ...prev,
          {
            sender: "assistant",
            text: "🎙️ Gravação iniciada. Suas interações no Viewport serão gravadas e integradas ao script.",
          },
        ]);
      } else {
        setLogs((prev) => [
          ...prev,
          { sender: "error", text: "Erro ao iniciar: " + data.error },
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { sender: "error", text: "Erro ao iniciar: " + err.message },
      ]);
    }
  };

  // Stop current active session (Copilot or Agent)
  const stopSession = async () => {
    setLogs((prev) => [
      ...prev,
      { sender: "system", text: "Finalizando sessão ativa..." },
    ]);
    try {
      const res = await authFetch(`${API_BASE}/api/session/stop`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setSessionType("idle");
        setLogs((prev) => [
          ...prev,
          {
            sender: "assistant",
            text: "🟢 Sessão finalizada com sucesso! Script compilado gerado.",
          },
        ]);
        if (data.steps && data.steps.length > 0) {
          setRecordedSteps(data.steps);
        }
        if (data.code) {
          setGeneratedCode(data.code);
          setActiveTimelineTab("code");
        }
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { sender: "error", text: "Erro ao finalizar: " + err.message },
      ]);
    }
  };

  // Start Autonomous Agent with prompt/objective
  const startAutonomousAgent = async () => {
    if (!prompt.trim()) return;
    const userPrompt = prompt;
    setPrompt("");
    setLogs((prev) => [...prev, { sender: "user", text: userPrompt }]);

    try {
      const res = await authFetch(`${API_BASE}/api/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: userPrompt, maxSteps: 20 }),
      });
      const data = await res.json();
      if (data.success) {
        setSessionType("running_agent");
      } else {
        setLogs((prev) => [
          ...prev,
          { sender: "error", text: "Erro ao iniciar agente: " + data.error },
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        { sender: "error", text: "Erro ao iniciar agente: " + err.message },
      ]);
    }
  };

  // Periodically poll script steps to update the timeline flow chart
  useEffect(() => {
    if (sessionType === "idle") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await authFetch(`${API_BASE}/api/script`);
        const data = await res.json();
        if (data.steps) {
          setRecordedSteps(data.steps);
        }
        if (data.code) {
          setGeneratedCode(data.code);
        }
      } catch (e) {}
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [sessionType]);

  // Map recorded steps to React Flow nodes and edges
  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Add Start Node
    newNodes.push({
      id: "node-start",
      type: "input",
      data: {
        label: (
          <div
            className="rf-node-title"
            style={{ color: "var(--color-primary)" }}
          >
            ⚡ Início do Fluxo
          </div>
        ),
      },
      position: { x: 100, y: 20 },
      className: "rf-node-module",
    });

    recordedSteps.forEach((step, index) => {
      const nodeId = `node-step-${index}`;
      const prevNodeId = index === 0 ? "node-start" : `node-step-${index - 1}`;

      let icon = "🔗";
      if (step.action === "navigate") icon = "🌐";
      if (step.action === "click") icon = "🖱️";
      if (step.action === "fill") icon = "✏️";
      if (step.action === "condition") icon = "❓";

      newNodes.push({
        id: nodeId,
        data: {
          label: (
            <div
              title={`${step.description}${step.value ? `\nValor: ${step.value}` : ""}${step.selector ? `\nSeletor: ${step.selector}` : ""}`}
            >
              <div className="rf-node-title">
                <span>{icon}</span> {step.action.toUpperCase()}
              </div>
              <div className="rf-node-desc">{step.description}</div>
              {step.value && (
                <div
                  className="rf-node-desc-value"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-accent)",
                    fontSize: "0.65rem",
                    marginTop: "2px",
                  }}
                >
                  Valor: {step.value}
                </div>
              )}
            </div>
          ),
        },
        position: { x: 100, y: 120 + index * 150 },
        className: "rf-node-module active",
      });

      newEdges.push({
        id: `edge-${prevNodeId}-${nodeId}`,
        source: prevNodeId,
        target: nodeId,
        animated: true,
        style: { stroke: "var(--color-primary)", strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-primary)",
        },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [recordedSteps, setNodes, setEdges]);

  // Execute interactive mouse click on viewport mirror
  const handleViewportClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isConnected) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Show typing overlay if they click an input/textbox area (user convenience)
    // and keep focus so we can send interaction
    try {
      await authFetch(`${API_BASE}/api/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "click",
          x,
          y,
          width: rect.width,
          height: rect.height,
        }),
      });

      // Request active page URL refresh
      setTimeout(checkStatus, 500);
    } catch (err) {
      console.error("Falha ao clicar:", err);
    }
  };

  // Navigate Chrome to specified url
  const handleNavigate = async () => {
    if (!inputUrl) return;
    try {
      await authFetch(`${API_BASE}/api/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "navigate",
          url: inputUrl,
        }),
      });
      setBrowserUrl(inputUrl);
    } catch (err) {
      console.error("Falha ao navegar:", err);
    }
  };

  // Handle typing input into browser
  const handleTypeSubmit = async () => {
    if (!typingValue) return;
    try {
      await authFetch(`${API_BASE}/api/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fill",
          value: typingValue,
        }),
      });
      setLogs((prev) => [
        ...prev,
        { sender: "user", text: `Digitado no Navegador: "${typingValue}"` },
      ]);
      setTypingValue("");
      setShowTypingPanel(false);

      // Request status refresh
      setTimeout(checkStatus, 500);
    } catch (err) {
      console.error("Falha ao digitar:", err);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: "16px",
      }}
    >
      {recordingScript && (
        <div
          className="glass-panel"
          style={{
            padding: "12px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(220, 38, 38, 0.08)",
            borderColor: "rgba(220, 38, 38, 0.25)",
            boxShadow: "0 0 15px rgba(220, 38, 38, 0.15)",
            animation: "slide-in 0.3s ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#ef4444",
                animation: "pulse-glow 1s infinite",
              }}
            />
            <div>
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: "bold",
                  color: "#f87171",
                }}
              >
                Modo de Gravação Ativo:
              </span>
              <span
                style={{
                  fontSize: "0.85rem",
                  marginLeft: "6px",
                  fontWeight: "600",
                }}
              >
                {recordingScript.Title} ({recordingScript.Name})
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className="btn-secondary"
              style={{
                fontSize: "0.8rem",
                padding: "6px 14px",
                borderColor: "rgba(255,255,255,0.15)",
              }}
              onClick={handleCancelRecording}
            >
              Cancelar
            </button>
            <button
              className="btn-primary"
              style={{
                fontSize: "0.8rem",
                padding: "6px 14px",
                background: "var(--color-success)",
                boxShadow: "0 0 10px var(--color-success-glow)",
              }}
              onClick={handleFinishRecording}
              disabled={isSaving}
            >
              {isSaving ? "Salvando..." : "💾 Concluir Gravação"}
            </button>
          </div>
        </div>
      )}

      <div
        className="recording-workspace-grid"
        style={{
          marginTop: 0,
          height: recordingScript
            ? "calc(100vh - 180px)"
            : "calc(100vh - 120px)",
        }}
      >
        {/* COLUMN 1: The Mirror Viewport */}
        <div className="glass-panel">
          <div className="viewport-controls">
            <button
              className="btn-secondary"
              onClick={connectBrowser}
              disabled={isConnected}
              style={{
                borderColor: isConnected
                  ? "var(--color-success)"
                  : "var(--border-color)",
              }}
            >
              {isConnected ? "🟢 Conectado" : "🔌 Conectar"}
            </button>

            <input
              type="text"
              className="control-input"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Navegar para URL..."
              onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
              onFocus={() => {
                isInputFocusedRef.current = true;
              }}
              onBlur={() => {
                isInputFocusedRef.current = false;
              }}
            />

            <button
              className="btn-primary"
              onClick={handleNavigate}
              disabled={!isConnected}
            >
              Ir
            </button>
          </div>

          <div
            className="panel-content"
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "10px",
            }}
          >
            <div className="viewport-container">
              {isConnected && frameSrc ? (
                <div
                  style={{
                    position: "relative",
                    display: "inline-block",
                    maxWidth: "100%",
                    maxHeight: "100%",
                  }}
                >
                  <img
                    src={frameSrc}
                    alt="Mirror View"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      width: "auto",
                      height: "auto",
                      display: "block",
                      borderRadius: "4px",
                    }}
                  />
                  <div
                    className="viewport-overlay"
                    onClick={handleViewportClick}
                  />
                </div>
              ) : (
                <div className="viewport-placeholder">
                  <span className="viewport-placeholder-icon">📺</span>
                  <p style={{ fontSize: "0.9rem" }}>
                    {isConnected
                      ? "Aguardando transmissão do browser..."
                      : "Conecte o Chrome para espelhar a tela em tempo real."}
                  </p>
                  {!isConnected && (
                    <button
                      className="btn-primary"
                      onClick={connectBrowser}
                      style={{ marginTop: "10px" }}
                    >
                      Conectar Agora
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Quick Interaction Bar */}
            {isConnected && (
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginTop: "10px",
                  alignItems: "center",
                }}
              >
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                  onClick={() => setShowTypingPanel(!showTypingPanel)}
                >
                  {showTypingPanel
                    ? "Ocultar Painel Escrita"
                    : "⌨️ Digitar Texto"}
                </button>

                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  Browser URL: {browserUrl}
                </span>
              </div>
            )}

            {/* Overlay Panel for Input Typing */}
            {showTypingPanel && (
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.8)",
                  border: "1px solid var(--border-color)",
                  padding: "12px",
                  borderRadius: "8px",
                  marginTop: "10px",
                  display: "flex",
                  gap: "8px",
                  animation: "slide-in 0.2s ease-out",
                }}
              >
                <input
                  type="text"
                  className="control-input"
                  value={typingValue}
                  onChange={(e) => setTypingValue(e.target.value)}
                  placeholder="Insira o texto e pressione Enviar..."
                  onKeyDown={(e) => e.key === "Enter" && handleTypeSubmit()}
                  autoFocus
                />
                <button
                  className="btn-primary"
                  style={{ padding: "6px 12px" }}
                  onClick={handleTypeSubmit}
                >
                  Enviar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 2: Workflow Timeline & Code */}
        <div className="glass-panel">
          <div
            className="panel-header"
            style={{ gap: "10px", flexWrap: "wrap" }}
          >
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <h3 className="panel-title">
                <span>📊</span> Workspace
              </h3>

              {/* Tabs for Timeline and Code */}
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  background: "rgba(255, 255, 255, 0.03)",
                  padding: "2px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <button
                  className={`tab-btn`}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    borderRadius: "4px",
                    background:
                      activeTimelineTab === "timeline"
                        ? "var(--color-primary)"
                        : "transparent",
                    color:
                      activeTimelineTab === "timeline"
                        ? "#fff"
                        : "var(--text-secondary)",
                    boxShadow:
                      activeTimelineTab === "timeline"
                        ? "0 2px 6px var(--color-primary-glow)"
                        : "none",
                  }}
                  onClick={() => setActiveTimelineTab("timeline")}
                >
                  Fluxo Visual
                </button>
                <button
                  className={`tab-btn`}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    borderRadius: "4px",
                    background:
                      activeTimelineTab === "code"
                        ? "var(--color-primary)"
                        : "transparent",
                    color:
                      activeTimelineTab === "code"
                        ? "#fff"
                        : "var(--text-secondary)",
                    boxShadow:
                      activeTimelineTab === "code"
                        ? "0 2px 6px var(--color-primary-glow)"
                        : "none",
                  }}
                  onClick={() => setActiveTimelineTab("code")}
                >
                  Código Playwright
                </button>
              </div>
            </div>
            {sessionType !== "idle" ? (
              <button
                className="btn-primary"
                style={{
                  background: "var(--color-danger)",
                  fontSize: "0.8rem",
                  padding: "4px 10px",
                }}
                onClick={stopSession}
              >
                🛑 Parar
              </button>
            ) : (
              <button
                className="btn-primary"
                style={{
                  background: "var(--color-success)",
                  fontSize: "0.8rem",
                  padding: "4px 10px",
                }}
                onClick={startRecording}
                disabled={!isConnected}
              >
                🎙️ Gravar
              </button>
            )}
          </div>

          <div className="panel-content" style={{ padding: 0 }}>
            {activeTimelineTab === "timeline" ? (
              <div className="timeline-flow-container">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  fitView
                >
                  <Background color="#222" gap={16} />
                  <Controls
                    style={{
                      background: "#1f2937",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "6px",
                    }}
                  />
                </ReactFlow>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {recordedSteps.length} passos registrados
                  </span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="btn-secondary"
                      style={{
                        fontSize: "0.75rem",
                        padding: "4px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        borderColor: isTesting
                          ? "var(--color-primary)"
                          : "var(--border-color)",
                        color: isTesting
                          ? "var(--color-primary)"
                          : "var(--text-primary)",
                      }}
                      onClick={runPlaywrightTest}
                      disabled={!generatedCode || isTesting}
                    >
                      {isTesting ? "⏳ Testando..." : "🧪 Testar Script"}
                    </button>
                    <button
                      className="btn-secondary"
                      style={{
                        fontSize: "0.75rem",
                        padding: "4px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        borderColor: copied
                          ? "var(--color-success)"
                          : "var(--border-color)",
                        color: copied
                          ? "var(--color-success)"
                          : "var(--text-primary)",
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(
                          generatedCode || "// Nenhum script gerado ainda.",
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      disabled={!generatedCode}
                    >
                      {copied ? "Copiado!" : "📋 Copiar Código"}
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    overflow: "auto",
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "16px",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      color: "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {generatedCode || (
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        O script do Playwright será compilado e exibido aqui à
                        medida que as ações forem executadas ou quando você
                        clicar em "Parar".
                      </span>
                    )}
                  </pre>
                </div>

                {/* Painel do Terminal de Logs de Execução do Teste */}
                {showTerminal && (
                  <div
                    style={{
                      marginTop: "16px",
                      background: "#0c0f12",
                      border: "1px solid #1f2937",
                      borderRadius: "6px",
                      display: "flex",
                      flexDirection: "column",
                      height: "220px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div
                      style={{
                        background: "#161b22",
                        padding: "6px 12px",
                        borderBottom: "1px solid #1f2937",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTopLeftRadius: "5px",
                        borderTopRightRadius: "5px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontFamily: "var(--font-mono)",
                          color: "#8b949e",
                          fontWeight: "bold",
                        }}
                      >
                        💻 TERMINAL DE EXECUÇÃO PLAYWRIGHT
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        {testFailed && (
                          <button
                            style={{
                              background:
                                "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                              border: "none",
                              color: "#fff",
                              fontSize: "0.68rem",
                              cursor: isHealing ? "not-allowed" : "pointer",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontWeight: "bold",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
                              opacity: isHealing ? 0.7 : 1,
                              transition: "var(--transition-smooth)",
                            }}
                            onClick={handleSelfHealingScript}
                            disabled={isHealing}
                          >
                            {isHealing
                              ? "🩹 Auto-corrigindo..."
                              : "🔧 Auto-corrigir (Self-Healing)"}
                          </button>
                        )}
                        <button
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#8b949e",
                            fontSize: "0.7rem",
                            cursor: "pointer",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                          onClick={() => setTestLogs([])}
                        >
                          Limpar
                        </button>
                        <button
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--color-danger)",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            fontWeight: "bold",
                            padding: "2px 6px",
                          }}
                          onClick={() => setShowTerminal(false)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div
                      ref={terminalEndRef}
                      style={{
                        flex: 1,
                        overflow: "auto",
                        padding: "12px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        color: "#c9d1d9",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: "1.4",
                      }}
                    >
                      {testLogs.length === 0 ? (
                        <span style={{ color: "#8b949e", fontStyle: "italic" }}>
                          Aguardando início do teste...
                        </span>
                      ) : (
                        testLogs.map((log, index) => {
                          let color = "#c9d1d9";
                          if (
                            log.includes("Passed") ||
                            log.includes("sucesso") ||
                            log.includes("✓")
                          )
                            color = "#3fb950";
                          if (
                            log.includes("erro") ||
                            log.includes("Error") ||
                            log.includes("❌") ||
                            log.includes("💥")
                          )
                            color = "#f85149";
                          if (
                            log.includes("Iniciando") ||
                            log.includes("Running")
                          )
                            color = "#58a6ff";
                          return (
                            <div key={index} style={{ color }}>
                              {log}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 3: AI Assistant & Variables */}
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <span>🧠</span> Co-piloto de IA
            </h3>
            {sessionType === "recording_copilot" ? (
              <span
                style={{
                  fontSize: "0.7rem",
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "var(--color-danger)",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "var(--color-danger)",
                    animation: "pulse-glow 1.5s infinite",
                  }}
                />
                COPILOT GRAVANDO
              </span>
            ) : sessionType === "running_agent" ? (
              <span
                style={{
                  fontSize: "0.7rem",
                  background: "var(--color-primary-glow)",
                  color: "var(--color-primary)",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "var(--color-primary)",
                    animation: "pulse-glow 1s infinite",
                  }}
                />
                IA EXECUTANDO
              </span>
            ) : (
              <span
                style={{
                  fontSize: "0.7rem",
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "var(--text-muted)",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: "bold",
                  border: "1px solid var(--border-color)",
                }}
              >
                INATIVO
              </span>
            )}
          </div>

          <div className="panel-content">
            <div className="chat-container">
              <div className="chat-messages">
                {logs.map((log, index) => (
                  <div key={index} className={`chat-bubble ${log.sender}`}>
                    {log.text}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>

              {/* Variable Binder Section */}
              <div className="variables-panel">
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "600",
                  }}
                >
                  Variáveis Disponíveis
                </span>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {variables.map((v, i) => (
                    <span
                      key={i}
                      className="variable-badge"
                      onClick={() => {
                        setPrompt((p) => p + " " + v);
                      }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>

              <div className="chat-input-container">
                <input
                  type="text"
                  className="control-input"
                  placeholder={
                    sessionType === "running_agent"
                      ? "IA está executando..."
                      : "Instrua a IA..."
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && startAutonomousAgent()}
                  disabled={sessionType === "running_agent"}
                />
                <button
                  className="btn-primary"
                  onClick={startAutonomousAgent}
                  disabled={sessionType === "running_agent" || !prompt.trim()}
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Register component inside uiRegistry
pluginRegistry.register({
  id: "ai-recording-plugin",
  name: "IA Assisted Recording (Fase 1)",
  version: "1.0.0",
  type: "feature",
  contributions: {
    "ai-recording-view": [AiRecordingComponent],
  },
});
