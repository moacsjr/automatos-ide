import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ExtensionPoint } from "@pluggable-js/react";
import { pluginRegistry } from "@pluggable-js/core";
import "./index.css";
import "./plugins/rpa-cockpit";
import "./plugins/ai-recording-plugin";

pluginRegistry.init();

function App() {
  const [activeTab, setActiveTab] = useState<"cockpit" | "recording">(
    "recording",
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-6 font-sans">
      <header className="mb-6 border-b border-slate-900 pb-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Cognitive RPA Engine
        </h1>

        {/* Navigation Tabs */}
        <div className="nav-tabs">
          <button
            className={`tab-btn ${activeTab === "cockpit" ? "active" : ""}`}
            onClick={() => setActiveTab("cockpit")}
          >
            Monitor de Execução
          </button>
          <button
            className={`tab-btn ${activeTab === "recording" ? "active" : ""}`}
            onClick={() => setActiveTab("recording")}
          >
            Gravação Assistida por IA
          </button>
        </div>
      </header>

      <main
        className={activeTab === "cockpit" ? "max-w-4xl mx-auto" : "w-full"}
        style={
          activeTab === "recording"
            ? { maxWidth: "1600px", margin: "0 auto" }
            : undefined
        }
      >
        {activeTab === "cockpit" ? (
          <ExtensionPoint
            id="rpa-workspace-view"
            passProps={{ websocketUrl: "wss://api.rpa-saas.com/stream" }}
          />
        ) : (
          <ExtensionPoint id="ai-recording-view" passProps={{}} />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
