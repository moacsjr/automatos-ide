import { chromium } from "playwright";
import { WorkflowJob } from "../domain/types.js";
import { SafeAutomationInterpreter } from "../interpreter/safe-runner.js";

export async function executeWorkflow(job: WorkflowJob): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const interpreter = new SafeAutomationInterpreter(page);
    interpreter.setContext({});
    await interpreter.runSteps(job.steps);
  } finally {
    await browser.close();
  }
}
