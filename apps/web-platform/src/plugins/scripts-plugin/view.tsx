import React, { useState, useEffect, useMemo } from "react";
import { pluginRegistry } from "@pluggable-js/core";
import { Script, ScriptSchema } from "./schema";
import { DynamoDbScriptsService } from "./service";

export function ScriptsCrudComponent({
  onRecordScript,
}: {
  onRecordScript?: (script: Script) => void;
}) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modais
  const [showFormModal, setShowFormModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);

  // Script sendo editado ou visualizado
  const [activeScript, setActiveScript] = useState<Script | null>(null);

  // Código ativo no visualizador de scripts
  const [activeCodeTab, setActiveCodeTab] = useState<
    "raw" | "compiled" | "automated"
  >("raw");

  // Formulário State
  const [formData, setFormData] = useState({
    Name: "",
    Title: "",
    Description: "",
    rawScript: "",
    compiledScript: "",
    automatedScript: "",
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Obter serviço a partir do pluginRegistry
  const service = useMemo(() => {
    try {
      return pluginRegistry.getService<DynamoDbScriptsService>(
        "scripts-service",
      );
    } catch (e) {
      console.warn(
        "scripts-service não registrado no pluginRegistry, instanciando fallback local.",
      );
      return new DynamoDbScriptsService();
    }
  }, []);

  // Carregar scripts
  const loadScripts = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await service.list();
      setScripts(list);
    } catch (err: any) {
      console.error(err);
      setError(`Erro ao conectar ao DynamoDB: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, [service]);

  // Limpar formulário
  const resetForm = () => {
    setFormData({
      Name: "",
      Title: "",
      Description: "",
      rawScript: "",
      compiledScript: "",
      automatedScript: "",
    });
    setFormErrors({});
    setActiveScript(null);
  };

  // Abrir formulário para criação
  const handleNewScript = () => {
    resetForm();
    setShowFormModal(true);
  };

  // Abrir formulário para edição
  const handleEditScript = (script: Script) => {
    setActiveScript(script);
    setFormData({
      Name: script.Name,
      Title: script.Title,
      Description: script.Description || "",
      rawScript: script.rawScript || "",
      compiledScript: script.compiledScript || "",
      automatedScript: script.automatedScript || "",
    });
    setFormErrors({});
    setShowFormModal(true);
  };

  // Abrir modal de visualização
  const handleViewScript = (script: Script) => {
    setActiveScript(script);
    if (script.automatedScript) {
      setActiveCodeTab("automated");
    } else if (script.compiledScript) {
      setActiveCodeTab("compiled");
    } else {
      setActiveCodeTab("raw");
    }
    setShowViewModal(true);
  };

  // Excluir script
  const handleDeleteScript = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este script permanentemente?"))
      return;

    setError(null);
    setSuccess(null);
    try {
      await service.delete(id);
      setSuccess("Script excluído com sucesso!");
      loadScripts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(`Erro ao excluir script: ${err.message}`);
    }
  };

  // Enviar formulário (Criar ou Atualizar)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    setError(null);
    setSuccess(null);

    const validationPayload = {
      id: activeScript ? activeScript.id : "temp-id",
      ...formData,
    };

    // Validação com Zod
    const validation = ScriptSchema.safeParse(validationPayload);
    if (!validation.success) {
      const errors: Record<string, string> = {};
      validation.error.issues.forEach((issue) => {
        const path = issue.path[0] as string;
        errors[path] = issue.message;
      });
      setFormErrors(errors);
      return;
    }

    try {
      if (activeScript) {
        await service.update(activeScript.id, formData);
        setSuccess(`Script "${formData.Title}" atualizado com sucesso!`);
      } else {
        await service.create(formData);
        setSuccess(`Script "${formData.Title}" cadastrado com sucesso!`);
      }
      setShowFormModal(false);
      resetForm();
      loadScripts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(`Erro ao salvar script no DynamoDB: ${err.message}`);
    }
  };

  // Filtrar scripts da pesquisa
  const filteredScripts = useMemo(() => {
    return scripts.filter(
      (s) =>
        s.Title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.Name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.Description?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [scripts, searchQuery]);

  return (
    <div
      style={{ maxWidth: "1200px", margin: "0 auto", padding: "10px" }}
      className="animation-fade-in"
    >
      {/* Mensagens Flutuantes */}
      {success && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: "var(--color-success-glow)",
            border: "1px solid var(--color-success)",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: "8px",
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            fontWeight: "bold",
            fontSize: "0.85rem",
          }}
        >
          ✅ {success}
        </div>
      )}

      {error && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid var(--color-danger)",
            color: "#fca5a5",
            padding: "12px 24px",
            borderRadius: "8px",
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            fontSize: "0.85rem",
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* Header e Barra de Pesquisa */}
      <div
        className="glass-panel"
        style={{ marginBottom: "20px", padding: "16px 20px" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "1.2rem",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>📦</span> Gerenciador de Scripts
            </h2>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                marginTop: "2px",
              }}
            >
              Persistência, versionamento e refatoração de scripts diretamente
              no AWS DynamoDB
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flex: "1",
              maxWidth: "450px",
              justifyContent: "flex-end",
            }}
          >
            <input
              type="text"
              className="control-input"
              placeholder="Pesquisar por título ou nome..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ maxWidth: "280px" }}
            />
            <button className="btn-primary" onClick={handleNewScript}>
              <span>➕</span> Novo Script
            </button>
          </div>
        </div>
      </div>

      {/* Listagem de Scripts */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            ⏳ Carregando scripts do DynamoDB...
          </p>
        </div>
      ) : filteredScripts.length === 0 ? (
        <div
          className="glass-panel"
          style={{ padding: "60px 20px", textAlign: "center" }}
        >
          <span style={{ fontSize: "2.5rem", opacity: 0.4 }}>📂</span>
          <h3
            style={{
              fontSize: "1rem",
              marginTop: "12px",
              color: "var(--text-primary)",
            }}
          >
            Nenhum script encontrado
          </h3>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              marginTop: "4px",
            }}
          >
            {searchQuery
              ? "Nenhum resultado corresponde à pesquisa."
              : "Crie um novo script para começar."}
          </p>
          {!searchQuery && (
            <button
              className="btn-primary"
              style={{ margin: "16px auto 0" }}
              onClick={handleNewScript}
            >
              Criar Primeiro Script
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: "20px",
          }}
        >
          {filteredScripts.map((script) => (
            <div
              key={script.id}
              className="glass-panel"
              style={{
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontFamily: "var(--font-mono)",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border-color)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    color: "var(--text-secondary)",
                  }}
                >
                  {script.Name}
                </span>

                {/* Indicadores de Conteúdo */}
                <div style={{ display: "flex", gap: "4px" }}>
                  {script.rawScript && (
                    <span
                      title="Possui código bruto"
                      style={{ fontSize: "0.7rem", opacity: 0.8 }}
                    >
                      📝
                    </span>
                  )}
                  {script.compiledScript && (
                    <span
                      title="Possui código compilado"
                      style={{ fontSize: "0.7rem", opacity: 0.8 }}
                    >
                      ⚡
                    </span>
                  )}
                  {script.automatedScript && (
                    <span
                      title="Possui código IA"
                      style={{ fontSize: "0.7rem", opacity: 0.8 }}
                    >
                      🤖
                    </span>
                  )}
                </div>
              </div>

              <h3
                style={{
                  fontSize: "1rem",
                  fontWeight: "bold",
                  color: "var(--text-primary)",
                }}
              >
                {script.Title}
              </h3>
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text-secondary)",
                  marginTop: "6px",
                  flex: 1,
                  lineClamp: 3,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {script.Description || (
                  <span
                    style={{ fontStyle: "italic", color: "var(--text-muted)" }}
                  >
                    Sem descrição.
                  </span>
                )}
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginTop: "16px",
                  borderTop: "1px solid var(--border-color)",
                  paddingTop: "12px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn-secondary"
                  style={{
                    flex: 1,
                    minWidth: "90px",
                    fontSize: "0.75rem",
                    padding: "6px",
                  }}
                  onClick={() => handleViewScript(script)}
                >
                  👁️ Ver
                </button>
                {onRecordScript && (
                  <button
                    className="btn-secondary"
                    style={{
                      fontSize: "0.75rem",
                      padding: "6px 10px",
                      borderColor: "rgba(239, 68, 68, 0.4)",
                      color: "#ff6b6b",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      background: "rgba(239, 68, 68, 0.05)",
                    }}
                    onClick={() => onRecordScript(script)}
                    title="Gravar passos para este script usando IA"
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#ff6b6b",
                        animation: "pulse-glow 1.5s infinite",
                      }}
                    />
                    Gravar
                  </button>
                )}
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "6px 10px" }}
                  onClick={() => handleEditScript(script)}
                >
                  ✏️
                </button>
                <button
                  className="btn-secondary"
                  style={{
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                    color: "var(--color-danger)",
                    borderColor: "rgba(239, 68, 68, 0.2)",
                  }}
                  onClick={() => handleDeleteScript(script.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FORM MODAL (Novo / Editar) */}
      {showFormModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
        >
          <div
            className="glass-panel animation-fade-in"
            style={{
              width: "90%",
              maxWidth: "750px",
              maxHeight: "90vh",
              boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
              border: "1px solid var(--border-hover)",
            }}
          >
            <div className="panel-header">
              <h3 className="panel-title">
                {activeScript
                  ? `✏️ Editar Script: ${activeScript.Title}`
                  : "➕ Criar Novo Script"}
              </h3>
              <button
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                }}
                onClick={() => setShowFormModal(false)}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                display: "flex",
                flexDirection: "column",
                height: "calc(90vh - 60px)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {/* Nome e Título em Linha Dupla */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "16px",
                  }}
                >
                  <div>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        display: "block",
                        marginBottom: "4px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Nome do Identificador{" "}
                      <span style={{ color: "var(--color-danger)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="control-input"
                      placeholder="Ex: login-flow"
                      value={formData.Name}
                      onChange={(e) =>
                        setFormData({ ...formData, Name: e.target.value })
                      }
                    />
                    {formErrors.Name && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--color-danger)",
                          display: "block",
                          marginTop: "2px",
                        }}
                      >
                        ⚠️ {formErrors.Name}
                      </span>
                    )}
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        display: "block",
                        marginBottom: "4px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Título do Script{" "}
                      <span style={{ color: "var(--color-danger)" }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="control-input"
                      placeholder="Ex: Fluxo de Login no UOL"
                      value={formData.Title}
                      onChange={(e) =>
                        setFormData({ ...formData, Title: e.target.value })
                      }
                    />
                    {formErrors.Title && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--color-danger)",
                          display: "block",
                          marginTop: "2px",
                        }}
                      >
                        ⚠️ {formErrors.Title}
                      </span>
                    )}
                  </div>
                </div>

                {/* Descrição */}
                <div>
                  <label
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      display: "block",
                      marginBottom: "4px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Descrição
                  </label>
                  <textarea
                    className="control-input"
                    placeholder="Descreva o propósito deste script de automação..."
                    value={formData.Description}
                    onChange={(e) =>
                      setFormData({ ...formData, Description: e.target.value })
                    }
                    style={{
                      minHeight: "60px",
                      resize: "vertical",
                      fontFamily: "var(--font-sans)",
                    }}
                  />
                </div>

                {/* Código Gravador Bruto */}
                <div>
                  <label
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      display: "block",
                      marginBottom: "4px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Código Bruto (rawScript)
                  </label>
                  <textarea
                    className="control-input"
                    placeholder="// Código bruto do gravador..."
                    value={formData.rawScript}
                    onChange={(e) =>
                      setFormData({ ...formData, rawScript: e.target.value })
                    }
                    style={{
                      minHeight: "100px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      resize: "vertical",
                    }}
                  />
                </div>

                {/* Código Compilado e Código Automatizado */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "16px",
                  }}
                >
                  <div>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        display: "block",
                        marginBottom: "4px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Código Compilado (compiledScript)
                    </label>
                    <textarea
                      className="control-input"
                      placeholder="// Código compilado final..."
                      value={formData.compiledScript}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          compiledScript: e.target.value,
                        })
                      }
                      style={{
                        minHeight: "120px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        resize: "vertical",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        display: "block",
                        marginBottom: "4px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Código IA/Automatizado (automatedScript)
                    </label>
                    <textarea
                      className="control-input"
                      placeholder="// Refatorações com Self-Healing ou IA..."
                      value={formData.automatedScript}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          automatedScript: e.target.value,
                        })
                      }
                      style={{
                        minHeight: "120px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer de Ações */}
              <div
                style={{
                  padding: "16px 20px",
                  background: "rgba(0,0,0,0.3)",
                  borderTop: "1px solid var(--border-color)",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowFormModal(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  💾 Salvar no DynamoDB
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL (Visualizador de Códigos) */}
      {showViewModal && activeScript && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
        >
          <div
            className="glass-panel animation-fade-in"
            style={{
              width: "90%",
              maxWidth: "750px",
              height: "80vh",
              boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
              border: "1px solid var(--border-hover)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="panel-header">
              <div>
                <h3 className="panel-title">
                  <span>📖</span> Visualizador: {activeScript.Title}
                </h3>
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: "var(--text-secondary)",
                  }}
                >
                  Chave ID: {activeScript.id}
                </span>
              </div>
              <button
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                }}
                onClick={() => setShowViewModal(false)}
              >
                ✕
              </button>
            </div>

            {/* Menu de Tabs de Códigos */}
            <div
              style={{
                display: "flex",
                gap: "10px",
                background: "rgba(0,0,0,0.2)",
                padding: "10px 20px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              <button
                className={`tab-btn`}
                style={{
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  borderRadius: "4px",
                  background:
                    activeCodeTab === "raw"
                      ? "var(--color-primary)"
                      : "transparent",
                  color:
                    activeCodeTab === "raw" ? "#fff" : "var(--text-secondary)",
                }}
                onClick={() => setActiveCodeTab("raw")}
              >
                Código Bruto (raw)
              </button>
              <button
                className={`tab-btn`}
                style={{
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  borderRadius: "4px",
                  background:
                    activeCodeTab === "compiled"
                      ? "var(--color-primary)"
                      : "transparent",
                  color:
                    activeCodeTab === "compiled"
                      ? "#fff"
                      : "var(--text-secondary)",
                }}
                onClick={() => setActiveCodeTab("compiled")}
              >
                Código Compilado
              </button>
              <button
                className={`tab-btn`}
                style={{
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  borderRadius: "4px",
                  background:
                    activeCodeTab === "automated"
                      ? "var(--color-primary)"
                      : "transparent",
                  color:
                    activeCodeTab === "automated"
                      ? "#fff"
                      : "var(--text-secondary)",
                }}
                onClick={() => setActiveCodeTab("automated")}
              >
                Código IA (automated)
              </button>
            </div>

            {/* Visualizador de Texto de Código */}
            <div
              style={{
                flex: 1,
                padding: "20px",
                overflow: "auto",
                background: "#06090f",
              }}
            >
              {activeCodeTab === "raw" && (
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "#c9d1d9",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {activeScript.rawScript || (
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      Código bruto vazio.
                    </span>
                  )}
                </pre>
              )}
              {activeCodeTab === "compiled" && (
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "#c9d1d9",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {activeScript.compiledScript || (
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      Código compilado vazio.
                    </span>
                  )}
                </pre>
              )}
              {activeCodeTab === "automated" && (
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "#c9d1d9",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {activeScript.automatedScript || (
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      Código IA/Automatizado vazio.
                    </span>
                  )}
                </pre>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border-color)",
                background: "rgba(0,0,0,0.3)",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => {
                  const codeToCopy =
                    activeCodeTab === "raw"
                      ? activeScript.rawScript
                      : activeCodeTab === "compiled"
                        ? activeScript.compiledScript
                        : activeScript.automatedScript;
                  navigator.clipboard.writeText(codeToCopy || "");
                  alert("Código copiado para a área de transferência!");
                }}
                disabled={
                  !(activeCodeTab === "raw"
                    ? activeScript.rawScript
                    : activeCodeTab === "compiled"
                      ? activeScript.compiledScript
                      : activeScript.automatedScript)
                }
              >
                📋 Copiar Código
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
