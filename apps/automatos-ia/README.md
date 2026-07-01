# Automatos-IA 🤖🌐

**Automatos-IA** é um agente autônomo e co-piloto para navegador web integrado com o Google Chrome que utiliza inteligência artificial (via **OpenRouter**, modelo padrão `deepseek/deepseek-chat`) para navegar e gerar scripts automatizados do **Playwright** baseados nas ações ou objetivos informados.

Para evitar a complexidade de extensões de navegador nativas, o sistema se conecta diretamente a instâncias reais do Google Chrome via **Chrome DevTools Protocol (CDP)**.

---

## 🛠️ Arquitetura do Sistema

O sistema é dividido em três camadas principais:

1. **O Navegador (Chrome):** Rodando localmente com a porta de depuração remota aberta (CDP).
2. **O Executor (Playwright):** Conecta-se à instância aberta do Chrome para ler o estado da aba atual e executar as ações propostas.
3. **O Cérebro (Agente/LLM):** Uma máquina de estados que simplifica o DOM da página atual, solicita decisões à API da LLM via OpenRouter e compila as interações em um script Playwright legível e resiliente.

---

## 🚀 Inicialização Automática do Chrome

Ao iniciar o servidor da API (`npm run start`), o **Automatos-IA** inicia automaticamente uma instância visível (non-headless) do Chrome integrada ao Playwright. Caso o navegador seja fechado manualmente, a próxima tentativa de execução do Agente ou Co-piloto abrirá novamente uma nova janela do Chrome automaticamente.

---

## 📦 Instalação e Inicialização do Servidor

1. Clone o repositório e acesse a pasta.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Crie e configure o arquivo `.env` na raiz do projeto contendo sua chave de API do OpenRouter, o modelo desejado e a porta do servidor:
   ```env
   OPENROUTER_API_KEY=sua_chave_openrouter_aqui
   OPENROUTER_MODEL=deepseek/deepseek-chat
   PORT=3001
   ```
4. Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run start
   ```
   _O servidor e o painel web estarão disponíveis em:_ [http://localhost:3001](http://localhost:3001)

---

## 🕹️ Modos de Operação

O agente suporta dois modos de operação:

### 1. Modo Autônomo (Autonomous)

O usuário define um objetivo textual (ex: _"Faça login com o e-mail teste@exemplo.com e senha 123456"_). O agente interage com o DOM, decide e executa cliques, preenchimentos de formulário, navegações e tempos de espera até que o objetivo seja concluído ou o limite de passos seja alcançado.

### 2. Modo Co-piloto (Copilot)

O usuário navega e realiza as ações manualmente no navegador. O agente escuta os eventos gerados pelas interações no Chrome (cliques, preenchimento de inputs, mudanças de página) e gera automaticamente o script Playwright em tempo real.

---

## 🧭 Resiliência de Seletores

Em vez de gravar seletores frágeis ou IDs dinâmicos temporários (`data-agent-id`), o motor do **Automatos-IA** analisa o DOM e gera seletores robustos e duradouros no script Playwright final, buscando pela seguinte ordem de prioridade:

1. Atributos de teste dedicados: `data-testid`, `data-test`, `data-cy`, `qa`.
2. IDs de elementos que sejam únicos na página.
3. Botões e links baseados em texto exato/parcial via `:has-text()`.
4. Inputs baseados em atributos `name` ou `value`.
5. Fallback estrutural e posicional robusto usando caminhos hierárquicos e `:nth-of-type()`.

---

## 🌐 API de Integração (Endpoints HTTP e SSE)

O servidor disponibiliza uma API REST para que você possa controlar o ciclo de vida do agente de forma programática ou a partir de outras ferramentas.

### ℹ️ 1. Obter Status Atual (`GET /api/status`)

Retorna o estado da conexão com o Chrome e o tipo da sessão ativa.

- **URL:** `/api/status`
- **Método:** `GET`
- **Resposta de Sucesso (200):**
  ```json
  {
    "connected": true,
    "sessionType": "idle", // "idle", "running_agent" ou "recording_copilot"
    "cdpPort": 9222,
    "currentUrl": "https://exemplo.com"
  }
  ```

---

### 🧠 2. Iniciar Agente Autônomo (`POST /api/agent/start`)

Inicia a execução do loop autônomo baseado em um objetivo textual.

- **URL:** `/api/agent/start`
- **Método:** `POST`
- **Headers:** `Content-Type: application/json`
- **Corpo da Requisição:**
  ```json
  {
    "objective": "Buscar 'Playwright' no Google e clicar no primeiro resultado",
    "maxSteps": 15
  }
  ```
- **Resposta de Sucesso (200):**
  ```json
  {
    "success": true,
    "message": "Agente iniciado com sucesso!"
  }
  ```

---

### 🎙️ 3. Iniciar Gravação Co-piloto (`POST /api/copilot/start`)

Coloca o sistema em modo de escuta das interações reais realizadas pelo usuário.

- **URL:** `/api/copilot/start`
- **Método:** `POST`
- **Resposta de Sucesso (200):**
  ```json
  {
    "success": true,
    "message": "Gravação do co-piloto iniciada!"
  }
  ```

---

### 🛑 4. Parar Sessão Ativa (`POST /api/session/stop`)

Encerra a execução do agente ou gravação do co-piloto e retorna o script compilado com a lista de passos executados.

- **URL:** `/api/session/stop`
- **Método:** `POST`
- **Resposta de Sucesso (200):**
  ```json
  {
    "success": true,
    "message": "Sessão finalizada com sucesso!",
    "code": "import { test, expect } from '@playwright/test';\n\ntest('Automated Flow', async ({ page }) => {\n  await page.goto('https://google.com');\n  await page.locator('[name=\"q\"]').fill('Playwright');\n});",
    "steps": [
      {
        "action": "navigate",
        "value": "https://google.com",
        "description": "Navegou para a URL: https://google.com"
      },
      {
        "action": "fill",
        "selector": "[name=\"q\"]",
        "value": "Playwright",
        "description": "Preencheu o campo de busca com 'Playwright'"
      }
    ]
  }
  ```

---

### 📄 5. Obter Script Atual (`GET /api/script`)

Recupera o código e os passos do script Playwright acumulados na sessão atual, sem interromper a execução/gravação.

- **URL:** `/api/script`
- **Método:** `GET`
- **Resposta de Sucesso (200):**
  ```json
  {
    "code": "...",
    "steps": [...]
  }
  ```

---

### 📡 6. Transmissão de Eventos via SSE (`GET /api/events`)

Canal de Server-Sent Events (SSE) para monitorar ações, logs de console e status em tempo real.

- **URL:** `/api/events`
- **Método:** `GET`
- **Headers de Resposta:** `Content-Type: text/event-stream`
- **Tipos de Mensagem transmitidos (`data` formato JSON):**
  - **Mudança de Status:** `{ "type": "status", "status": "running_agent" }`
  - **Logs do Backend:** `{ "type": "log", "message": "🧠 Pensando com a IA (OpenRouter)..." }`
  - **Aviso:** `{ "type": "warn", "message": "⚠️ Elemento não encontrado..." }`
  - **Erros:** `{ "type": "error", "message": "❌ Falha ao obter decisão..." }`
