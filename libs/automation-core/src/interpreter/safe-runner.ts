import { Page } from 'playwright';
import { AutomationStep } from '../domain/types.js';

export class SafeAutomationInterpreter {
  private page: Page;
  private context: Record<string, Record<string, string>> = {};
  private logs: string[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  public setContext(context: Record<string, Record<string, string>>): void {
    this.context = context;
  }

  public getLogs(): string[] {
    return this.logs;
  }

  public async runSteps(steps: AutomationStep[]): Promise<void> {
    for (const step of steps) {
      this.logs.push(`[RUN] ${step.description}`);
      await this.executeStep(step);
      this.logs.push(`[DONE] ${step.description}`);
    }
  }

  private async executeStep(step: AutomationStep): Promise<void> {
    const { action, params, conditionConfig } = step;

    switch (action) {
      case 'navigate':
        if (!params?.url) throw new Error(`Step ${step.id}: navigate requires a url param.`);
        await this.page.goto(this.resolveValue(params.url), { waitUntil: 'networkidle' });
        break;

      case 'click':
        if (!params?.selector) throw new Error(`Step ${step.id}: click requires a selector param.`);
        await this.page.click(this.resolveValue(params.selector));
        break;

      case 'fill':
        if (!params?.selector || !params?.value)
          throw new Error(`Step ${step.id}: fill requires selector and value params.`);
        await this.page.fill(this.resolveValue(params.selector), this.resolveValue(params.value));
        break;

      case 'condition':
        if (!conditionConfig) throw new Error(`Step ${step.id}: condition config is missing.`);
        const isTrue = await this.evaluateCondition(conditionConfig.condition);
        const nextSteps = isTrue ? conditionConfig.thenSteps : (conditionConfig.elseSteps ?? []);
        await this.runSteps(nextSteps);
        break;

      default: {
        const never: never = action;
        throw new Error(`Action [${never}] is not supported by the interpreter.`);
      }
    }
  }

  private async evaluateCondition(cond: {
    type: 'element_visible' | 'text_contains';
    selector: string;
    expectedText?: string;
  }): Promise<boolean> {
    const selector = this.resolveValue(cond.selector);
    switch (cond.type) {
      case 'element_visible':
        return await this.page.isVisible(selector).catch(() => false);
      case 'text_contains': {
        const bodyText = await this.page.innerText('body');
        return bodyText.includes(this.resolveValue(cond.expectedText ?? ''));
      }
    }
  }

  private resolveValue(val: string): string {
    if (!val || !val.startsWith('{{') || !val.endsWith('}}')) return val;
    const path = val.slice(2, -2).trim();
    const [variable, key] = path.split('.');
    return this.context[variable]?.[key] ?? '';
  }
}
