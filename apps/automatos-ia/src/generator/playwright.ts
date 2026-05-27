import fs from "fs";
import path from "path";
import { agentEvents } from "../utils/logger.js";

export interface RecordedStep {
  action: "click" | "fill" | "navigate" | "wait";
  selector?: string;
  value?: string;
  description?: string;
}

/**
 * Classe responsável por gerenciar os passos registrados e compilar
 * o script de teste final do Playwright.
 */
export class PlaywrightGenerator {
  private steps: RecordedStep[] = [];

  /**
   * Adiciona um novo passo ao script
   */
  addStep(step: RecordedStep) {
    this.steps.push(step);
    // Notifica via SSE que um passo foi registrado
    agentEvents.step(step);
  }

  /**
   * Retorna os passos atuais
   */
  getSteps(): RecordedStep[] {
    return this.steps;
  }

  /**
   * Compila os passos acumulados em código TypeScript válido do Playwright
   */
  generateCode(testName: string = "Teste Autogerado"): string {
    const lines: string[] = [];

    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push(``);
    lines.push(`test('${testName}', async ({ page }) => {`);
    lines.push(
      `  // Configura um viewport padrão de desktop para garantir visibilidade dos elementos`,
    );
    lines.push(`  await page.setViewportSize({ width: 1280, height: 800 });`);
    lines.push(``);

    for (const step of this.steps) {
      if (step.description) {
        const descLines = step.description.split(/\r?\n/);
        for (const descLine of descLines) {
          lines.push(`  // ${descLine}`);
        }
      }

      switch (step.action) {
        case "navigate":
          lines.push(`  await page.goto('${step.value}');`);
          break;

        case "click":
          if (!step.selector) {
            lines.push(
              `  // ERRO: Tentativa de clique sem seletor válido definido`,
            );
            break;
          }
          const clickSelector = step.selector.includes(">> visible=")
            ? step.selector
            : `${step.selector} >> visible=true`;
          lines.push(`  await page.click('${clickSelector}');`);
          break;

        case "fill":
          if (!step.selector) {
            lines.push(
              `  // ERRO: Tentativa de preenchimento sem seletor válido definido`,
            );
            break;
          }
          const fillSelector = step.selector.includes(">> visible=")
            ? step.selector
            : `${step.selector} >> visible=true`;
          const escapedValue = (step.value || "").replace(/'/g, "\\'");
          lines.push(
            `  await page.fill('${fillSelector}', '${escapedValue}');`,
          );
          break;

        case "wait":
          const ms = step.value ? parseInt(step.value, 10) : 1000;
          lines.push(`  await page.waitForTimeout(${ms});`);
          break;
      }
      lines.push(``);
    }

    lines.push(`});`);

    return lines.join("\n");
  }

  /**
   * Salva o código gerado em um arquivo físico especificado
   */
  saveToFile(filePath: string, testName?: string): void {
    const code = this.generateCode(testName);
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, code, "utf-8");
    agentEvents.log(
      `\n[PlaywrightGenerator] Código salvo com sucesso em: ${absolutePath}`,
    );
  }
}
