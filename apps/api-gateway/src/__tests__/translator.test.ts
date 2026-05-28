import { describe, it, expect } from "vitest";
import { parsePlaywrightScriptToWorkflowJob } from "../translator.js";

describe("parsePlaywrightScriptToWorkflowJob", () => {
  it("translates simple steps (goto, click, fill)", () => {
    const script = `
      await page.goto("https://google.com");
      await page.click('[name="q"]');
      await page.locator('[name="q"]').fill("Playwright");
    `;
    const { steps, warnings } = parsePlaywrightScriptToWorkflowJob(
      script,
      "script-1",
    );

    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("navigate");
    expect(steps[0].params?.url).toBe("https://google.com");

    expect(steps[1].action).toBe("click");
    expect(steps[1].params?.selector).toBe('[name="q"]');

    expect(steps[2].action).toBe("fill");
    expect(steps[2].params?.selector).toBe('[name="q"]');
    expect(steps[2].params?.value).toBe("Playwright");

    expect(warnings).toHaveLength(0);
  });

  it("resolves variable declarations from compiler", () => {
    const script = `
      const var1 = "https://example.com";
      const var2 = '#submit-button';
      const var3 = 'hello world';
      await page.goto(var1);
      await page.click(var2);
      await page.fill("input", var3);
    `;
    const { steps, warnings } = parsePlaywrightScriptToWorkflowJob(
      script,
      "script-1",
    );

    expect(steps).toHaveLength(3);
    expect(steps[0].params?.url).toBe("https://example.com");
    expect(steps[1].params?.selector).toBe("#submit-button");
    expect(steps[2].params?.value).toBe("hello world");
    expect(warnings).toHaveLength(0);
  });

  it("translates conditional steps (if/else)", () => {
    const script = `
      if (await page.isVisible('.modal')) {
        await page.click('.close');
      } else {
        await page.goto('https://safe.com');
      }
    `;
    const { steps, warnings } = parsePlaywrightScriptToWorkflowJob(
      script,
      "script-1",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe("condition");
    expect(steps[0].conditionConfig?.condition.type).toBe("element_visible");
    expect(steps[0].conditionConfig?.condition.selector).toBe(".modal");

    expect(steps[0].conditionConfig?.thenSteps).toHaveLength(1);
    expect(steps[0].conditionConfig?.thenSteps[0].action).toBe("click");
    expect(steps[0].conditionConfig?.thenSteps[0].params?.selector).toBe(
      ".close",
    );

    expect(steps[0].conditionConfig?.elseSteps).toHaveLength(1);
    expect(steps[0].conditionConfig?.elseSteps?.[0].action).toBe("navigate");
    expect(steps[0].conditionConfig?.elseSteps?.[0].params?.url).toBe(
      "https://safe.com",
    );

    expect(warnings).toHaveLength(0);
  });

  it("generates warnings for unsupported actions", () => {
    const script = `
      await page.goto("https://google.com");
      await page.waitForTimeout(1000);
      expect(page.url()).toBe("https://google.com");
      await page.screenshot({ path: 'screenshot.png' });
    `;
    const { steps, warnings } = parsePlaywrightScriptToWorkflowJob(
      script,
      "script-1",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe("navigate");

    expect(warnings).toContain(
      "Comando 'page.waitForTimeout' não é suportado pelo interpretador e foi ignorado.",
    );
    expect(warnings).toContain(
      "Comandos de asserção 'expect' não são suportados pelo interpretador e foram ignorados.",
    );
    expect(warnings).toContain(
      "Comando 'page.screenshot' não é suportado pelo interpretador e foi ignorado.",
    );
  });
});
