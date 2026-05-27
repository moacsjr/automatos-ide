/**
 * Script de escuta que será injetado no navegador do usuário.
 * Ele escuta eventos de clique e modificações de formulário, gerando seletores resilientes.
 */
export const listenerScript = `
(function() {
  if (window.__automatos_listener_active) return;
  window.__automatos_listener_active = true;

  console.log("🤖 [Automatos-IA] Script do Co-piloto ativado.");

  // Helper para obter texto amigável do elemento
  function getElementDesc(el) {
    let rawText = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      rawText = el.placeholder || el.getAttribute('aria-label') || el.name || 'campo de entrada';
    } else if (el.tagName === 'SELECT') {
      rawText = el.name || 'caixa de seleção';
    } else {
      rawText = el.innerText?.trim() || el.getAttribute('aria-label')?.trim() || el.tagName.toLowerCase();
    }
    return rawText.replace(/\s+/g, ' ').trim();
  }

  // Helper para gerar um seletor resiliente
  function computeSelector(el) {
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
      const val = el.value.replace(/"/g, '\\\\"');
      const selector = 'input[value="' + val + '"]';
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (e) {}
    }

    const name = el.getAttribute("name");
    if (name && ["input", "textarea", "select"].includes(tag)) {
      try {
        if (document.querySelectorAll(tag + '[name="' + CSS.escape(name) + '"]').length === 1) {
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
        if (document.querySelectorAll(selector).length === 1) {
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
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (e) {}
    }

    const innerTextOnly = el.innerText?.trim() || "";
    const text = innerTextOnly.replace(/\s+/g, " ").trim();
    if (text && text.length > 0 && text.length < 100 && ["button", "a"].includes(tag)) {
      const normalizedText = text.replace(/[\\n\\r\\t]/g, " ").trim();
      const elements = Array.from(document.querySelectorAll(tag));
      const matchingElements = elements.filter(item => {
        const itemText = getElementDesc(item).replace(/[\\n\\r\\t]/g, " ").trim();
        return itemText.includes(normalizedText);
      });
      
      const escapedText = normalizedText.replace(/["\\\\]/g, "\\\\\\\\$&");
      
      if (matchingElements.length === 1) {
        return tag + ':has-text("' + escapedText + '")';
      } else if (matchingElements.length > 1) {
        const parent = el.parentElement;
        if (parent) {
          const parentTag = parent.tagName.toLowerCase();
          const parentClass = parent.className ? "." + Array.from(parent.classList)[0] : "";
          const nestedSelector = parentTag + parentClass + " > " + tag + ':has-text("' + escapedText + '")';
          const parentElements = Array.from(document.querySelectorAll(parentTag + parentClass + " > " + tag));
          const parentMatching = parentElements.filter(item => {
            const itemText = getElementDesc(item).replace(/[\\n\\r\\t]/g, " ").trim();
            return itemText.includes(normalizedText);
          });
          if (parentMatching.length === 1) {
            return nestedSelector;
          }
        }
      }
    }

    // Path CSS simplificado
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += \`#\${CSS.escape(current.id)}\`;
        parts.unshift(selector);
        break;
      } else {
        const classes = Array.from(current.classList)
          .filter(c => !c.startsWith("data-agent") && !c.includes("hover") && !c.includes("focus"))
          .map(c => \`.\${CSS.escape(c)}\`)
          .join("");
        selector += classes;
        
        let sib = current.previousElementSibling;
        let nth = 1;
        while (sib) {
          if (sib.tagName === current.tagName) nth++;
          sib = sib.previousElementSibling;
        }
        selector += \`:nth-of-type(\${nth})\`;
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  // Encontra o parente interativo mais próximo ou usa cursor pointer
  function findInteractiveParent(el) {
    let current = el;
    while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
      const tag = current.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || 
          tag === 'TEXTAREA' || current.getAttribute('role') || current.getAttribute('onclick')) {
        return current;
      }
      try {
        const style = window.getComputedStyle(current);
        if (style && style.cursor === 'pointer') {
          return current;
        }
      } catch (e) {}
      current = current.parentElement;
    }
    return null;
  }

  // Escuta cliques
  document.addEventListener('click', function(e) {
    console.log("🖱️ [Automatos-IA] Clique capturado no elemento:", e.target?.tagName, "ID:", e.target?.id, "Classes:", e.target?.className);
    
    let target = findInteractiveParent(e.target);
    if (!target) {
      console.log("⚠️ [Automatos-IA] Nenhum parente interativo detectado para:", e.target?.tagName + ". Usando fallback para o próprio elemento.");
      if (e.target && e.target.tagName !== 'BODY' && e.target.tagName !== 'HTML') {
        target = e.target;
      } else {
        return;
      }
    }

    // Ignora inputs de texto no clique (serão gravados pelo blur/change)
    if (target.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio'].includes(target.type)) {
      console.log("ℹ️ [Automatos-IA] Ignorando clique em campo de texto (será gravado no preenchimento).");
      return;
    }

    const selector = computeSelector(target);
    const desc = getElementDesc(target);
    
    let description = 'Clicou em: ' + desc;
    if (target.tagName === 'A') description = 'Clicou no link "' + desc + '"';
    if (target.tagName === 'BUTTON') description = 'Clicou no botão "' + desc + '"';

    console.log("📤 [Automatos-IA] Registrando clique manual:", description, "Seletor:", selector);

    if (window.onUserAction) {
      window.onUserAction({
        action: 'click',
        selector: selector,
        description: description
      });
    } else {
      console.error("❌ [Automatos-IA] window.onUserAction não está definida no contexto!");
    }
  }, true);

  // Escuta focos para monitorar alterações de valores
  let initialValue = '';
  document.addEventListener('focusin', function(e) {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      initialValue = target.value;
    }
  }, true);

  // Escuta blur para registrar preenchimento de inputs
  document.addEventListener('focusout', function(e) {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      // Ignora botões/checkboxes/radios no blur (clicks são melhores para eles)
      if (target.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio'].includes(target.type)) {
        return;
      }

      if (target.value !== initialValue) {
        const selector = computeSelector(target);
        const desc = getElementDesc(target);
        const description = 'Preencheu o campo "' + desc + '" com o valor: "' + target.value + '"';
        
        console.log("📤 [Automatos-IA] Registrando entrada de texto manual:", description, "Seletor:", selector);

        if (window.onUserAction) {
          window.onUserAction({
            action: 'fill',
            selector: selector,
            value: target.value,
            description: description
          });
        } else {
          console.error("❌ [Automatos-IA] window.onUserAction não está definida no contexto!");
        }
      }
    }
  }, true);
})();
`;
