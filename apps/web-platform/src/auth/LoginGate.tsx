import React, { useEffect, useState } from "react";
import { isAuthConfigured, signIn, getIdToken } from "./cognito";

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
      setError(err?.message || "Falha no login.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">
        Carregando...
      </div>
    );
  }

  if (authed) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4"
      >
        <h1 className="text-xl font-bold">Cognitive RPA Engine</h1>
        <p className="text-sm text-slate-400">Entre para continuar.</p>
        <input
          type="text"
          placeholder="Usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700"
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700"
          autoComplete="current-password"
          required
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-medium"
        >
          {submitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
