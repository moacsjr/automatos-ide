import { z } from "zod";

/** IDs seguros: alfanumérico, hífen, underscore (cobre UUID e slugs). */
const safeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "id contém caracteres inválidos");

export function isValidId(id: unknown): id is string {
  return safeId.safeParse(id).success;
}

export const workflowSchema = z.object({
  workflowId: safeId,
  executionId: safeId,
  dataSourceFileKey: z.string().max(1024).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).max(1000),
});

export const scriptSchema = z
  .object({
    id: safeId.optional(),
    rawScript: z.string().max(500_000).optional(),
    compiledScript: z.string().max(500_000).optional(),
  })
  .passthrough();

export type WorkflowPayload = z.infer<typeof workflowSchema>;
export type ScriptPayload = z.infer<typeof scriptSchema>;

/**
 * Faz parse de um corpo JSON com um schema zod.
 * Retorna { ok: true, data } ou { ok: false, error } (mensagem curta e segura).
 */
export function parseJson<T>(
  schema: z.ZodType<T>,
  rawBody: string | undefined,
): { ok: true; data: T } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody ?? "{}");
  } catch {
    return { ok: false, error: "JSON inválido no corpo da requisição." };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error:
        `Payload inválido: ${issue?.path.join(".")} ${issue?.message}`.trim(),
    };
  }
  return { ok: true, data: result.data };
}
