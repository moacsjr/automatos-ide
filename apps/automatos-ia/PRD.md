Criar um agente autônomo que se integra ao Chrome para gerar scripts do Playwright é um excelente desafio de design de sistemas. Para evitar a complexidade desnecessária de criar uma extensão nativa para o Chrome do zero, a abordagem arquitetural mais robusta e controlável é utilizar o **Chrome DevTools Protocol (CDP)**.

Isso permite que você mantenha o agente rodando em um processo backend (usando TypeScript e orquestradores de fluxo como LangGraph), enquanto o Playwright se "anexa" a uma instância real do Chrome que o usuário já está navegando.

Aqui está o mapa de arquitetura e o passo a passo de como implementar esse sistema.

---

### 1. A Arquitetura do Sistema

O sistema é dividido em três camadas principais:

1. **O Navegador (Chrome):** Rodando com a porta de depuração remota aberta.
2. **O Executor (Playwright):** Conecta-se ao Chrome via CDP para ler o DOM e executar ações.
3. **O Cérebro (Agente):** Uma máquina de estados que avalia a página atual, decide a próxima ação baseada no objetivo do usuário e gera o log do script Playwright.

### 2. Passo a Passo da Implementação

#### Passo 1: Iniciando o Chrome com CDP

Para que o Playwright consiga enxergar a aba ativa do usuário, o Chrome precisa ser iniciado com o remote debugging ativado.

No terminal (exemplo no macOS/Linux):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

```

#### Passo 2: Conectando o Playwright via TypeScript

No seu backend TypeScript, você usará o método `connectOverCDP` em vez de iniciar uma nova instância do navegador.

```typescript
import { chromium, BrowserContext, Page } from "playwright";

async function attachToChrome(): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  // Conecta à instância do Chrome rodando na porta 9222
  const browser = await chromium.connectOverCDP("http://localhost:9222");

  // Pega o contexto padrão e a aba atual ativa
  const defaultContext = browser.contexts()[0];
  const page = defaultContext.pages()[0];

  return { context: defaultContext, page };
}
```

#### Passo 3: Traduzindo o DOM para o LLM (O maior gargalo)

LLMs não lidam bem com o DOM bruto (é muito grande e cheio de ruído como tags `<svg>`, classes utilitárias, etc.). Você precisa extrair a **Árvore de Acessibilidade (Accessibility Tree)** ou simplificar o HTML.

Você pode injetar um script na página para mapear elementos interativos e atribuir IDs únicos a eles:

```typescript
async function getSimplifiedDOM(page: Page) {
  return await page.evaluate(() => {
    const interactables = document.querySelectorAll("button, input, a, select");
    let simplifiedTree = "";

    interactables.forEach((el, index) => {
      // Atribui um ID customizado para o agente referenciar
      el.setAttribute("data-agent-id", index.toString());
      const type = el.tagName.toLowerCase();
      const text =
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        el.getAttribute("aria-label") ||
        "";

      simplifiedTree += `[ID: ${index}] Tipo: ${type} | Texto/Valor: ${text.trim()}\n`;
    });

    return simplifiedTree;
  });
}
```

#### Passo 4: O Ciclo de Vida do Agente

Você pode modelar o agente usando nós em um grafo de estados. O ciclo principal seria:

1. **Nó de Observação:** Usa o Playwright para capturar o DOM simplificado e um screenshot atual.
2. **Nó de Planejamento:** O LLM recebe o objetivo (ex: "Fazer login") e a visão atual da página. Ele decide a ação (ex: `click(ID: 4)`, `fill(ID: 2, "user@email.com")`).
3. **Nó de Execução e Geração:** Traduz a decisão do LLM em código Playwright válido, executa a ação no navegador via CDP, e concatena o comando em um arquivo `.ts` (seu script final).

```typescript
// Exemplo conceitual da lógica do nó de execução
async function executeAgentAction(
  page: Page,
  agentDecision: any,
  scriptLog: string[],
) {
  if (agentDecision.action === "click") {
    const selector = `[data-agent-id="${agentDecision.targetId}"]`;
    await page.click(selector);
    scriptLog.push(`await page.click('${selector}');`);
  }

  if (agentDecision.action === "fill") {
    const selector = `[data-agent-id="${agentDecision.targetId}"]`;
    await page.fill(selector, agentDecision.value);
    scriptLog.push(`await page.fill('${selector}', '${agentDecision.value}');`);
  }

  return scriptLog;
}
```

### 3. Considerações de Design do Sistema

- **Gerenciamento de Estado do Grafo:** Ferramentas de orquestração ajudarão muito a manter o controle sobre o histórico de navegação do agente, permitindo que ele faça _backtracking_ se clicar em um link errado e a página mudar inesperadamente.
- **Seletores Resilientes:** O `data-agent-id` é ótimo para o agente navegar no momento, mas para o _script final_ gerado, o ideal é que o agente deduza o seletor real (como um `data-testid`, texto visível, ou seletor CSS específico), caso contrário o script gerado só funcionará naquela sessão específica.

---

### 4. Modos de Operação do Agente

O Agente deve ter dois modos de operação:

1. **Modo Autônomo:** O agente decide as ações que deseja realizar sem intervenção humana.

2. **Modo Co-piloto:** O usuário faz as ações na tela e o agente escuta os eventos e compila o código TypeScript final estruturado.
