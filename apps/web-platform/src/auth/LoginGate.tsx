import React, { useEffect, useState } from "react";
import { isAuthConfigured, signIn, getIdToken } from "./cognito";

const APP_VERSION = (import.meta.env.VITE_APP_VERSION || "dev").substring(0, 8);

/** Marca Automatos: nós de um fluxo conectados — motivo de automação. */
function AutomatosMark() {
  return (
    <svg
      className="auth-mark"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.25"
        y="1.25"
        width="37.5"
        height="37.5"
        rx="10"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
      />
      <path
        d="M11 27c4.2 0 5.4-14 9-14s4.8 14 9 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="27" r="3" fill="currentColor" />
      <circle cx="29" cy="27" r="3" fill="currentColor" />
      <circle cx="20" cy="13" r="2.2" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 8v5m0 3h.01M12 3l9 16H3l9-16Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Gate de autenticação. Se o Cognito estiver configurado, exige login antes de
 * renderizar a app. Sem Cognito (dev local), passa direto.
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthConfigured()) {
      setAuthed(true);
      setChecking(false);
      return;
    }
    getIdToken().then((token) => {
      setAuthed(!!token);
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username, password);
      setAuthed(true);
    } catch (err: any) {
      setError(err?.message || "Não foi possível entrar. Verifique os dados.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" aria-hidden="true" />
        <span>Verificando sessão…</span>
      </div>
    );
  }

  if (authed) {
    return <>{children}</>;
  }

  return (
    <div className="auth-screen">
      <form className="auth-panel" onSubmit={handleSubmit} noValidate>
        <div className="auth-brand">
          <AutomatosMark />
          <div>
            <div className="auth-wordmark">Automatos</div>
            <div className="auth-tagline">Plataforma Cognitiva de RPA</div>
          </div>
        </div>

        <h1 className="auth-heading">Acesse o console</h1>
        <p className="auth-sub">Entre com suas credenciais para continuar.</p>

        {error && (
          <div className="auth-error" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-username">
            Usuário
          </label>
          <input
            id="auth-username"
            className="auth-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="seu.usuario"
            autoComplete="username"
            autoFocus
            aria-invalid={!!error}
            required
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-password">
            Senha
          </label>
          <input
            id="auth-password"
            className="auth-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            aria-invalid={!!error}
            required
          />
        </div>

        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              Entrando…
            </>
          ) : (
            "Entrar"
          )}
        </button>

        <div className="auth-footer">
          <span>por Astratech</span>
          <code>v{APP_VERSION}</code>
        </div>
      </form>
    </div>
  );
}
