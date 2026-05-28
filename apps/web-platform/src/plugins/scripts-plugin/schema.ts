import { z } from "zod";

export const ScriptSchema = z.object({
  id: z.string().min(1, "O ID é obrigatório"),
  Name: z.string().min(1, "O nome do script é obrigatório"),
  Title: z.string().min(1, "O título do script é obrigatório"),
  Description: z.string().optional().default(""),
  rawScript: z.string().optional().default(""),
  compiledScript: z.string().optional().default(""),
  automatedScript: z.string().optional().default(""),
  automationScript: z.any().optional(),
  warnings: z.array(z.string()).optional().default([]),
});

export type Script = z.infer<typeof ScriptSchema>;
