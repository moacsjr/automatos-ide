Perfeito. Ajustando a premissa para um cenário real de produção, consideraremos que o pacote `@pluggable-js/core` e `@pluggable-js/react` já estão publicados e instalados no repositório como dependências externas de terceiros (via `npm` / `yarn` / `pnpm`).

O foco do agente de IA será estritamente a criação das aplicações da plataforma (API, Worker, Frontend) e da biblioteca de regras de negócio (`automation-core`), utilizando e estendendo o framework plugável para o ecossistema No-Code.

Aqui está a **Especificação Técnica (SPEC) final e consolidada** para o agente de IA criar o monorepo integrado.

---

# 📋 TECHNICAL SPECIFICATION (SPEC): COGNITIVE RPA MONOREPO

* **Autor:** Arquitetura de Sistemas Distribuídos
* **Status:** Pronto para Implementação (Agente AI)
* **Stack Alvo:** Nx Monorepo, TypeScript, Node.js 22, React 19, AWS (Fargate, SQS, DynamoDB, S3), Playwright API.
* **Dependências Inclusas:** `@pluggable-js/core`, `@pluggable-js/react` (Tratadas como libs externas).

---

## 1. OBJETIVO DO AGENTE

Configurar e codificar um monorepo baseado em **Nx** contendo duas aplicações backend (`api-gateway` e `rpa-worker`), uma aplicação frontend corporativa (`web-platform`) e uma biblioteca compartilhada de tipos e interpretador seguro (`automation-core`). O agente deve plugar a interface do cockpit de execução na aplicação web utilizando as diretrizes de concorrência e o barramento do framework `@pluggable-js`.

---

## 2. ARQUITETURA DE DIRETÓRIOS E COMPARTILHAMENTO DE TIPOS

O agente de IA deve criar a árvore de arquivos respeitando o isolamento entre o plano de controle serverless e o ambiente Docker isolado do Playwright.

```
                      [apps/web-platform] (Consome @pluggable-js/react)
                               │
                               ▼
    [apps/api-gateway]  [apps/rpa-worker] (AWS Fargate Task)
            │                  │
            ▼                  ▼
      ┌──────────────────────────────────┐
      │   [libs/automation-core]         │ ◄─── (Contratos da DSL, Validador
      │                                  │       e Interpretador Seguro)
      └──────────────────────────────────┘

```

### Estrutura de Pastas a ser gerada:

```text
├── apps/
│   ├── web-platform/        # SPA React (Vite) - Interface Hospedeira / Dashboards
│   ├── api-gateway/         # Funções AWS Lambda (Orquestração de Sessão e CRUD)
│   └── rpa-worker/          # Imagem Docker Node.js (Ambiente de Execução do Playwright)
├── libs/
│   └── automation-core/     # Biblioteca do Core da Automação (Tipos, Interpretador e Executores)
├── nx.json                  # Estratégia de cache do Grafo do Nx
├── package.json             # Modificado apenas com as dependências do projeto
└── tsconfig.base.json       # Path mappings internos do Nx

```

---

## 3. CONFIGURAÇÃO DE MAPEAMENTO DO MONOREPO

O agente deve mapear as dependências internas para que as aplicações acessem o interpretador e a DSL de automação nativamente.

### 📄 Arquivo: `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "baseUrl": ".",
    "paths": {
      "@rpa/automation-core": ["libs/automation-core/src/index.ts"]
    },
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}

```

---

## 4. CONTRATO DA DSL E O INTERPRETADOR (COMPARTILHADO)

Esta biblioteca contém a inteligência estrita e o motor de execução baseados na API programática do Playwright.

### 📄 Arquivo: `libs/automation-core/src/domain/types.ts`

```typescript
export type ActionType = 'navigate' | 'click' | 'fill' | 'condition';

export interface AutomationStep {
  id: string;
  action: ActionType;
  description: string;
  params?: {
    url?: string;
    selector?: string;
    value?: string;
  };
  conditionConfig?: {
    condition: { type: 'element_visible' | 'text_contains'; selector: string; expectedText?: string };
    thenSteps: AutomationStep[];
    elseSteps?: AutomationStep[];
  };
}

export interface WorkflowJob {
  workflowId: string;
  executionId: string;
  dataSourceFileKey: string; // Caminho do S3 para a planilha do loop
  steps: AutomationStep[];
}

```

### 📄 Arquivo: `libs/automation-core/src/interpreter/safe-runner.ts`

O interpretador lê a DSL estrita e resolve escopos dinâmicos em memória, prevenindo injeções no terminal (RCE).

```typescript
import { Page } from 'playwright';
import { AutomationStep } from '../domain/types';

export class SafeAutomationInterpreter {
  private page: Page;
  private context: Record<string, any> = {};

  constructor(page: Page) {
    this.page = page;
  }

  public setContext(context: Record<string, any>): void {
    this.context = context;
  }

  public async runSteps(steps: AutomationStep[]): Promise<void> {
    for (const step of steps) {
      await this.executeStep(step);
    }
  }

  private async executeStep(step: AutomationStep): Promise<void> {
    const { action, params, conditionConfig } = step;

    switch (action) {
      case 'navigate':
        await this.page.goto(this.resolveValue(params!.url!), { waitUntil: 'networkidle' });
        break;

      case 'click':
        await this.page.click(this.resolveValue(params!.selector!));
        break;

      case 'fill':
        await this.page.fill(this.resolveValue(params!.selector!), this.resolveValue(params!.value!));
        break;

      case 'condition':
        if (!conditionConfig) throw new Error('Configuração condicional ausente.');
        const isTrue = await this.evaluateCondition(conditionConfig.condition);
        const nextSteps = isTrue ? conditionConfig.thenSteps : (conditionConfig.elseSteps || []);
        await this.runSteps(nextSteps);
        break;

      default:
        throw new Error(`Ação [${action}] não homologada no interpretador seguro.`);
    }
  }

  private async evaluateCondition(cond: any): Promise<boolean> {
    const selector = this.resolveValue(cond.selector);
    if (cond.type === 'element_visible') {
      return await this.page.isVisible(selector).catch(() => false);
    }
    if (cond.type === 'text_contains') {
      const bodyText = await this.page.innerText('body');
      return bodyText.includes(this.resolveValue(cond.expectedText || ''));
    }
    return false;
  }

  private resolveValue(val: string): string {
    if (!val || !val.startsWith('{{') || !val.endsWith('}}')) return val;
    const path = val.replace('{{', '').replace('}}', '').trim();
    const [variable, key] = path.split('.');
    return this.context[variable]?.[key] ?? '';
  }
}

```

---

## 5. FRONTEND: IMPLEMENTAÇÃO DO COCKPIT USANDO O PLUGGABLE-JS (EXTERNAL)

O frontend consome as apis de `@pluggable-js/core` e `@pluggable-js/react` instaladas no monorepo para injetar o workspace de telemetria na aplicação hospedeira.

### 📄 Arquivo: `apps/web-platform/src/plugins/rpa-cockpit.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { pluginRegistry } from '@pluggable-js/core';
import { uiRegistry } from '@pluggable-js/react';

// Componente de Telemetria de Loops / Monitoramento Real-time
export function RpaCockpitComponent({ passProps }: { passProps?: { websocketUrl: string } }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const ws = new WebSocket(passProps?.websocketUrl || 'ws://localhost:8080');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'LOG') setLogs((prev) => [...prev, data.message]);
      if (data.type === 'PROGRESS') setProgress(data.percentage);
    };
    return () => ws.close();
  }, [passProps]);

  return (
    <div className="p-6 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold tracking-wide">RPA Cockpit - Monitor de Execução</h3>
        <span className="text-xs font-mono bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/20">Active Task</span>
      </div>
      <div className="w-full bg-slate-800 h-2.5 rounded-full mb-4 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <div className="bg-slate-950 p-4 rounded-lg h-60 overflow-y-auto font-mono text-xs text-emerald-400 border border-slate-900 leading-relaxed">
        {logs.map((log, index) => <div key={index} className="border-b border-slate-900/50 pb-1 mb-1">➔ {log}</div>)}
      </div>
    </div>
  );
}

// Registro no Adaptador de Componentes do Framework Pluggable
uiRegistry.registerComponent('rpa-workspace-view', RpaCockpitComponent);

// Inicialização do Plugin no barramento central de Governança
pluginRegistry.register({
  id: 'rpa-execution-plugin',
  name: 'Pluggable Engine Execution Monitor',
  version: '1.0.0',
  type: 'feature',
  role: 'rpa-workspace-view' // Ocupa a role exclusiva no barramento
});

```

### 📄 Arquivo: `apps/web-platform/src/main.tsx`

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ActiveWorkspaceView } from '@pluggable-js/react'; // Importado da dependência instalada
import './plugins/rpa-cockpit'; // Carrega e registra o plugin automaticamente

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
      <header className="mb-8 border-b border-slate-900 pb-4">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Cognitive RPA Engine</h1>
      </header>
      <main className="max-w-4xl mx-auto">
        {/* Renderiza dinamicamente o plugin que assinou a role exclusiva */}
        <ActiveWorkspaceView role="rpa-workspace-view" passProps={{ websocketUrl: 'wss://api.rpa-saas.com/stream' }} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

```

---

## 6. PIPELINE DE CONVALIDAÇÃO E CRITÉRIOS DE ACEITAÇÃO

O agente de IA deverá rodar a validação do monorepo Nx em duas etapas estritas para garantir o sucesso da entrega:

1. **Validação de Testes de Escopo do Interpretador:**

```bash
npx nx test automation-core

```

2. **Validação de Compilação Cruzada (Build):**

```bash
npx nx run-many -t build --projects=api-gateway,rpa-worker,web-platform

```

Se o compilador TypeScript acusar qualquer quebra de tipo ou importação inválida entre as aplicações e a `automation-core`, o agente deve reavaliar os mapeamentos do `paths` no `tsconfig.base.json` e corrigir antes de finalizar o ciclo.
