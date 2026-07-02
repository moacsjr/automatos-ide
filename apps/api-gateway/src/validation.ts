// Validação sem dependências externas — este código roda no Lambda, cujo pacote
// inclui só o JS compilado (sem node_modules; o runtime provê apenas o AWS SDK).
// Por isso NÃO usar zod aqui (ao contrário do automatos-ia, que roda em container).

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID.test(id);
}

export interface WorkflowPayload {
  workflowId: string;
  executionId: string;
  dataSourceFileKey?: string;
  steps: Array<Record<string, unknown>>;
}

export interface ScriptPayload {
  id?: string;
  rawScript?: string;
  compiledScript?: string;
  [key: string]: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateWorkflow(data: unknown): Result<WorkflowPayload> {
  if (!isPlainObject(data))
    return { ok: false, error: "corpo deve ser objeto" };
  if (!isValidId(data.workflowId))
    return { ok: false, error: "workflowId inválido" };
  if (!isValidId(data.executionId))
    return { ok: false, error: "executionId inválido" };
  if (
    data.dataSourceFileKey !== undefined &&
    (typeof data.dataSourceFileKey !== "string" ||
      data.dataSourceFileKey.length > 1024)
  ) {
    return { ok: false, error: "dataSourceFileKey inválido" };
  }
  if (!Array.isArray(data.steps) || data.steps.length > 1000) {
    return { ok: false, error: "steps inválido" };
  }
  if (!data.steps.every(isPlainObject)) {
    return { ok: false, error: "cada step deve ser objeto" };
  }
  return {
    ok: true,
    data: {
      workflowId: data.workflowId,
      executionId: data.executionId,
      dataSourceFileKey: data.dataSourceFileKey as string | undefined,
      steps: data.steps as Array<Record<string, unknown>>,
    },
  };
}

export function validateScript(data: unknown): Result<ScriptPayload> {
  if (!isPlainObject(data))
    return { ok: false, error: "corpo deve ser objeto" };
  if (data.id !== undefined && !isValidId(data.id)) {
    return { ok: false, error: "id inválido" };
  }
  if (
    data.rawScript !== undefined &&
    (typeof data.rawScript !== "string" || data.rawScript.length > 500_000)
  ) {
    return { ok: false, error: "rawScript inválido" };
  }
  if (
    data.compiledScript !== undefined &&
    (typeof data.compiledScript !== "string" ||
      data.compiledScript.length > 500_000)
  ) {
    return { ok: false, error: "compiledScript inválido" };
  }
  // Mantém campos extras (comportamento passthrough do payload original).
  return { ok: true, data: data as ScriptPayload };
}

/**
 * Faz parse de um corpo JSON e valida com o validador informado.
 */
export function parseJson<T>(
  validator: (data: unknown) => Result<T>,
  rawBody: string | undefined,
): Result<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody ?? "{}");
  } catch {
    return { ok: false, error: "JSON inválido no corpo da requisição." };
  }
  return validator(parsed);
}
