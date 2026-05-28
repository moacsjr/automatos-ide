import { chromium, BrowserContext, Page, ElementHandle } from "playwright";

export interface InteractiveElement {
  agentId: string;
  tagName: string;
  type: string;
  text: string;
  role: string;
  resilientSelector: string;
  disabled: boolean;
  checked: boolean;
  value: string;
  href: string;
}

export interface DOMState {
  simplifiedDOM: string;
  elementsMap: Record<string, InteractiveElement>;
}

/**
 * Conecta à instância em execução do Chrome via CDP
 */
export async function connectBrowser(port: number = 9222): Promise<{
  browser: any; // BrowserContext de conexão CDP é retornado direto
  context: BrowserContext;
  page: Page;
}> {
  console.log(`Conectando ao Chrome na porta ${port}...`);
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);

  // Em connectOverCDP, o objeto retornado é o Browser, mas ele já representa a conexão.
  // Pega o primeiro contexto
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error(
      "Nenhum contexto de navegador encontrado. Verifique se o Chrome foi iniciado corretamente.",
    );
  }

  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  return { browser, context, page };
}

/**
 * Lança uma nova instância visível do Chrome (ou Chromium padrão do Playwright)
 */
export async function launchBrowser(): Promise<{
  browser: any;
  context: BrowserContext;
  page: Page;
}> {
  const isHeadless =
    process.env.NODE_ENV === "production" || process.env.HEADLESS === "true";
  console.log(`Lançando navegador Chrome (headless: ${isHeadless})...`);
  let browser;

  // Em ambiente de produção (contêiner), usamos diretamente o Chromium padrão pré-instalado
  const useDefaultChromium = process.env.NODE_ENV === "production";

  if (useDefaultChromium) {
    browser = await chromium.launch({
      headless: isHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--remote-debugging-port=9222",
      ],
    });
  } else {
    try {
      // Tenta usar o canal 'chrome' instalado localmente no sistema do desenvolvedor
      browser = await chromium.launch({
        headless: isHeadless,
        channel: "chrome",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--remote-debugging-port=9222",
        ],
      });
    } catch (err) {
      console.warn(
        "⚠️ Aviso: Falha ao lançar com canal 'chrome'. Tentando com o Chromium padrão do Playwright...",
        err,
      );
      browser = await chromium.launch({
        headless: isHeadless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--remote-debugging-port=9222",
        ],
      });
    }
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  return { browser, context, page };
}

/**
 * Obtém a página ativa (tentando priorizar a aba que o usuário está visualizando/interagindo)
 */
export async function getActivePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length === 0) {
    return await context.newPage();
  }

  // Retorna a primeira página que não seja em branco
  for (const page of pages) {
    if (page.url() !== "about:blank") {
      return page;
    }
  }

  return pages[pages.length - 1];
}

/**
 * Analisa a página atual, mapeia elementos interativos,
 * injeta 'data-agent-id' temporários e retorna o DOM simplificado e o mapa de elementos.
 */
export async function captureDOMState(page: Page): Promise<DOMState> {
  const script = `(() => {
    const isVisible = (el) => {
      if (!el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      return true;
    };

    const getElementText = (el) => {
      let rawText = "";
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        rawText = el.value || el.getAttribute("placeholder") || "";
      } else if (el.tagName === "SELECT") {
        rawText = el.options[el.selectedIndex]?.text || "";
      } else {
        rawText = el.innerText?.trim() || el.getAttribute("aria-label")?.trim() || el.getAttribute("title")?.trim() || "";
      }
      return rawText.replace(/\s+/g, " ").trim();
    };

    const getRole = (el) => {
      const roleAttr = el.getAttribute("role");
      if (roleAttr) return roleAttr;
      
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a") return "link";
      if (tag === "input") {
        const type = el.getAttribute("type") || "text";
        if (["checkbox", "radio"].includes(type)) return type;
        return "textbox";
      }
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      
      return "generic";
    };

    const computeResilientSelector = (el) => {
      const testAttrs = ["data-testid", "data-test", "data-cy", "qa"];
      for (const attr of testAttrs) {
        const val = el.getAttribute(attr);
        if (val) return "[" + attr + '="' + val + '"]';
      }

      if (el.id) {
        try {
          if (document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
            return "#" + el.id;
          }
        } catch (e) {}
      }

      const tag = el.tagName.toLowerCase();

      if (tag === "input" && ["submit", "button"].includes(el.type) && el.value) {
        const val = el.value.replace(/"/g, '\\"');
        const selector = 'input[value="' + val + '"]';
        try {
          if (Array.from(document.querySelectorAll(selector)).filter(isVisible).length === 1) {
            return selector;
          }
        } catch (e) {}
      }

      const name = el.getAttribute("name");
      if (name && ["input", "textarea", "select"].includes(tag)) {
        try {
          if (Array.from(document.querySelectorAll(tag + '[name="' + CSS.escape(name) + '"]')).filter(isVisible).length === 1) {
            return tag + '[name="' + name + '"]';
          }
        } catch (e) {}
      }

      // Check title attribute
      const title = el.getAttribute("title");
      if (title && ["a", "button", "input", "img"].includes(tag)) {
        const cleanTitle = title.replace(/"/g, '\\"').trim();
        const selector = tag + '[title="' + cleanTitle + '"]';
        try {
          if (Array.from(document.querySelectorAll(selector)).filter(isVisible).length === 1) {
            return selector;
          }
        } catch (e) {}
      }

      // Check aria-label attribute
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel && ["a", "button", "input", "select", "textarea"].includes(tag)) {
        const cleanLabel = ariaLabel.replace(/"/g, '\\"').trim();
        const selector = tag + '[aria-label="' + cleanLabel + '"]';
        try {
          if (Array.from(document.querySelectorAll(selector)).filter(isVisible).length === 1) {
            return selector;
          }
        } catch (e) {}
      }

      const innerTextOnly = el.innerText?.trim() || "";
      const text = innerTextOnly.replace(/\s+/g, " ").trim();
      if (text && text.length > 0 && text.length < 100 && ["button", "a"].includes(tag)) {
        const cleanText = text.replace(/[\\n\\r\\t]/g, " ").replace(/["\\\\]/g, "\\$&").trim();
        const elements = Array.from(document.querySelectorAll(tag)).filter(isVisible);
        const matchingElements = elements.filter(item => {
          const itemText = getElementText(item).replace(/[\\n\\r\\t]/g, " ").trim();
          return itemText.includes(cleanText);
        });
        
        if (matchingElements.length === 1) {
          return tag + ':has-text("' + cleanText + '")';
        } else if (matchingElements.length > 1) {
          const parent = el.parentElement;
          if (parent) {
            const parentTag = parent.tagName.toLowerCase();
            const parentClass = parent.className ? "." + Array.from(parent.classList)[0] : "";
            const nestedSelector = parentTag + parentClass + " > " + tag + ':has-text("' + cleanText + '")';
            const parentElements = Array.from(document.querySelectorAll(parentTag + parentClass + " > " + tag)).filter(isVisible);
            const parentMatching = parentElements.filter(item => {
              const itemText = getElementText(item).replace(/[\\n\\r\\t]/g, " ").trim();
              return itemText.includes(cleanText);
            });
            if (parentMatching.length === 1) {
              return nestedSelector;
            }
          }
        }
      }

      return getPathSelector(el);
    };

    const getPathSelector = (el) => {
      const parts = [];
      let current = el;
      
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let selector = current.tagName.toLowerCase();
        
        if (current.id) {
          selector += "#" + CSS.escape(current.id);
          parts.unshift(selector);
          break;
        } else {
          const classes = Array.from(current.classList)
            .filter(c => !c.startsWith("data-agent") && !c.includes("hover") && !c.includes("focus"))
            .map(c => "." + CSS.escape(c))
            .join("");
          selector += classes;
          
          let sib = current.previousElementSibling;
          let nth = 1;
          while (sib) {
            if (sib.tagName === current.tagName) nth++;
            sib = sib.previousElementSibling;
          }
          selector += ":nth-of-type(" + nth + ")";
        }
        
        parts.unshift(selector);
        current = current.parentElement;
      }
      
      return parts.join(" > ");
    };

    // Limpa data-agent-id remanescentes de análises anteriores
    document.querySelectorAll("[data-agent-id]").forEach(el => {
      el.removeAttribute("data-agent-id");
    });

    const interactables = Array.from(
      document.querySelectorAll("button, input, a, select, textarea, [role], [onclick]")
    ).filter(el => {
      if (!isVisible(el)) return false;
      
      const tag = el.tagName.toLowerCase();
      if (tag === "a" && !el.getAttribute("href") && !el.getAttribute("onclick") && !el.getAttribute("role")) {
        return false;
      }
      
      return true;
    });

    const elementsMap = {};
    let simplifiedDOM = "";

    interactables.forEach((el, index) => {
      const agentId = index.toString();
      el.setAttribute("data-agent-id", agentId);

      const tagName = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "";
      const text = getElementText(el);
      const role = getRole(el);
      const resilientSelector = computeResilientSelector(el);
      const disabled = el.hasAttribute("disabled") || el.disabled === true;
      const checked = el.checked || false;
      const value = el.value || "";
      const href = el.getAttribute("href") || "";

      elementsMap[agentId] = {
        agentId,
        tagName,
        type,
        text,
        role,
        resilientSelector,
        disabled,
        checked,
        value,
        href
      };

      let details = "[ID: " + agentId + "] Tipo: " + tagName;
      if (type) details += "(" + type + ")";
      if (text) details += ' | Texto/Label: "' + text + '"';
      if (role && role !== "generic") details += " | Role: " + role;
      if (value && tagName !== "button") details += ' | Valor: "' + value + '"';
      if (checked) details += " | [Marcado]";
      if (disabled) details += " | [Desabilitado]";
      if (href) details += ' | Link: "' + href + '"';
      
      simplifiedDOM += details + "\\n";
    });

    return {
      simplifiedDOM,
      elementsMap
    };
  })()`;

  const result = await page.evaluate(script);
  return result as DOMState;
}
