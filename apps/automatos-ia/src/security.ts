import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

/**
 * Segredo compartilhado injetado pelo Lambda proxy (header x-internal-auth).
 * Garante que só chamadas vindas do API Gateway/proxy cheguem aos endpoints,
 * mesmo que a rede seja alcançada diretamente. Vem do Secrets Manager em prod.
 */
const INTERNAL_AUTH_SECRET = process.env.INTERNAL_AUTH_SECRET || "";

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware que exige o header x-internal-auth em todas as rotas /api/*.
 * - /health é liberado (usado pelo health check do ECS).
 * - Se INTERNAL_AUTH_SECRET não estiver setado (dev local), não força (log warn).
 */
export function internalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/health") return next();

  if (!INTERNAL_AUTH_SECRET) {
    // Dev local sem segredo configurado — não bloqueia, mas avisa.
    return next();
  }

  const provided = req.header("x-internal-auth") || "";
  if (!provided || !timingSafeEqual(provided, INTERNAL_AUTH_SECRET)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/** Valida que uma URL usa apenas http/https (bloqueia file://, javascript://, etc). */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---- Schemas de validação de payload (zod) ----

export const agentStartSchema = z.object({
  objective: z.string().trim().min(1).max(2000),
  maxSteps: z.coerce.number().int().min(1).max(100).optional(),
});

export const interactionSchema = z
  .object({
    action: z.enum(["click", "navigate", "fill", "press"]),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    value: z.string().max(10000).optional(),
    url: z.string().max(2048).optional(),
  })
  .refine((data) => data.action !== "navigate" || !!data.url, {
    message: "url é obrigatória para navigate",
    path: ["url"],
  })
  .refine((data) => !data.url || isSafeHttpUrl(data.url), {
    message: "url deve ser http(s) válida",
    path: ["url"],
  });

export const connectSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

export const testCodeSchema = z.object({
  code: z.string().min(1).max(100_000),
});

/**
 * Checagem best-effort de padrões perigosos no código de teste enviado a
 * /api/session/test antes de gravá-lo e rodá-lo. NÃO é sandbox — apenas reduz
 * a superfície do RCE. Isolamento real (container efêmero) fica pra Fase 2.
 */
const FORBIDDEN_CODE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /require\s*\(/, label: "require(" },
  { re: /\bimport\s*\(/, label: "import(" },
  {
    re: /\bimport\b[^;\n]*\bfrom\b\s*['"](?!@playwright\/test['"])/,
    label: "import de módulo não permitido",
  },
  { re: /child_process/, label: "child_process" },
  { re: /\bprocess\s*\./, label: "process." },
  { re: /\beval\s*\(/, label: "eval(" },
  { re: /\bFunction\s*\(/, label: "Function(" },
  { re: /globalThis/, label: "globalThis" },
  { re: /__dirname|__filename/, label: "__dirname/__filename" },
];

export function findForbiddenCodePattern(code: string): string | null {
  for (const { re, label } of FORBIDDEN_CODE_PATTERNS) {
    if (re.test(code)) return label;
  }
  return null;
}

/**
 * Helper: valida req.body com um schema zod. Em caso de erro, responde 400 com
 * mensagem genérica (sem vazar internals) e retorna null.
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    res.status(400).json({
      error: `Payload inválido: ${issue?.path.join(".")} ${issue?.message}`,
    });
    return null;
  }
  return result.data;
}
