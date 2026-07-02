/// <reference types="vite/client" />
import { Script, ScriptSchema } from "./schema";
import { authFetch } from "../../auth/cognito";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "https://8agnfud1gh.execute-api.us-east-1.amazonaws.com";

export class DynamoDbScriptsService {
  async list(): Promise<Script[]> {
    const res = await authFetch(`${API_BASE_URL}/scripts`);
    if (!res.ok) {
      throw new Error(`Erro ao listar scripts: ${res.statusText}`);
    }
    const items = await res.json();
    return items.map((item: any) => ScriptSchema.parse(item));
  }

  async get(id: string): Promise<Script> {
    const res = await authFetch(`${API_BASE_URL}/scripts/${id}`);
    if (!res.ok) {
      throw new Error(`Script com ID ${id} não encontrado.`);
    }
    const item = await res.json();
    return ScriptSchema.parse(item);
  }

  async create(data: Omit<Script, "id">): Promise<Script> {
    const res = await authFetch(`${API_BASE_URL}/scripts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Erro ao criar script: ${res.statusText}`);
    }
    const item = await res.json();
    return ScriptSchema.parse(item);
  }

  async update(id: string, data: Omit<Script, "id">): Promise<Script> {
    const res = await authFetch(`${API_BASE_URL}/scripts/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Erro ao atualizar script: ${res.statusText}`);
    }
    const item = await res.json();
    return ScriptSchema.parse(item);
  }

  async delete(id: string): Promise<void> {
    const res = await authFetch(`${API_BASE_URL}/scripts/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Erro ao excluir script: ${res.statusText}`);
    }
  }

  async runWorkflow(steps: any[]): Promise<any> {
    const workflowId = `wf-${Math.random().toString(36).substring(2, 9)}`;
    const executionId = `exec-${Math.random().toString(36).substring(2, 9)}`;

    const payload = {
      workflowId,
      executionId,
      dataSourceFileKey: "manual",
      steps,
    };

    const payloadStr = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(payloadStr).length;
    if (bytes > 64 * 1024) {
      throw new Error(
        "O tamanho do script excede o limite de 64KB permitido para execução.",
      );
    }

    const res = await authFetch(`${API_BASE_URL}/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payloadStr,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody.error || `Erro ao iniciar execução: ${res.statusText}`,
      );
    }

    return res.json();
  }
}
