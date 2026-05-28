import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" }),
);

const SCRIPTS_TABLE = process.env.SCRIPTS_TABLE ?? "rpa-scripts";

export interface AutomationStep {
  id: string;
  action: "navigate" | "click" | "fill" | "condition";
  description: string;
  params?: {
    url?: string;
    selector?: string;
    value?: string;
  };
  conditionConfig?: {
    condition: {
      type: "element_visible" | "text_contains";
      selector: string;
      expectedText?: string;
    };
    thenSteps: AutomationStep[];
    elseSteps?: AutomationStep[];
  };
}

export interface WorkflowJob {
  workflowId: string;
  executionId: string;
  dataSourceFileKey: string;
  steps: AutomationStep[];
}

export interface ParseResult {
  steps: AutomationStep[];
  warnings: string[];
}

function findClosingBracket(
  str: string,
  startIndex: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === open) {
      depth++;
    } else if (str[i] === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function scanSkippedTextForWarnings(skipped: string, warnings: string[]): void {
  // Look for any occurrences of "page.<something>"
  const pageCallRegex = /page\.([a-zA-Z0-9_]+)\(/g;
  let match;
  while ((match = pageCallRegex.exec(skipped)) !== null) {
    const method = match[1];
    if (
      method !== "goto" &&
      method !== "click" &&
      method !== "fill" &&
      method !== "type" &&
      method !== "isVisible"
    ) {
      const warningMsg = `Comando 'page.${method}' não é suportado pelo interpretador e foi ignorado.`;
      if (!warnings.includes(warningMsg)) {
        warnings.push(warningMsg);
      }
    }
  }

  // Look for expect assertions
  if (/expect\(/.test(skipped)) {
    const warningMsg =
      "Comandos de asserção 'expect' não são suportados pelo interpretador e foram ignorados.";
    if (!warnings.includes(warningMsg)) {
      warnings.push(warningMsg);
    }
  }
}

export function parsePlaywrightScriptToWorkflowJob(
  script: string,
  workflowId: string,
): ParseResult {
  const steps: AutomationStep[] = [];
  const warnings: string[] = [];

  // Parse variables from the script: const varName = "value";
  const variables: Record<string, string> = {};
  const varRegex =
    /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:(['"`])(.*?)\2|([a-zA-Z0-9_]+|\d+))/g;
  let varMatch;
  while ((varMatch = varRegex.exec(script)) !== null) {
    variables[varMatch[1]] = varMatch[3] ?? varMatch[4];
  }

  const resolve = (val: string): string => {
    if (!val) return "";
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("`") && trimmed.endsWith("`"))
    ) {
      return trimmed.slice(1, -1);
    }
    if (variables[trimmed] !== undefined) {
      const resolved = variables[trimmed];
      if (
        (resolved.startsWith("'") && resolved.endsWith("'")) ||
        (resolved.startsWith('"') && resolved.endsWith('"')) ||
        (resolved.startsWith("`") && resolved.endsWith("`"))
      ) {
        return resolved.slice(1, -1);
      }
      return resolved;
    }
    return trimmed;
  };

  let remaining = script;

  while (remaining.length > 0) {
    const patterns = [
      // 0. If statement
      { type: "if", regex: /if\s*\(\s*/g },
      // 1. page.goto
      {
        type: "navigate",
        regex:
          /page\.goto\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/g,
      },
      // 2. page.click
      {
        type: "click_direct",
        regex:
          /page\.click\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/g,
      },
      // 3. page.locator().click
      {
        type: "click_locator",
        regex:
          /page\.locator\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)\.click\(\)/g,
      },
      // 4. page.fill / page.type
      {
        type: "fill_direct",
        regex:
          /page\.(fill|type)\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*,\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/g,
      },
      // 5. page.locator().fill / page.locator().type
      {
        type: "fill_locator",
        regex:
          /page\.locator\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)\.(fill|type)\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/g,
      },
    ];

    let earliestIndex = Infinity;
    let earliestMatch: any = null;
    let earliestPattern: any = null;

    for (const pat of patterns) {
      pat.regex.lastIndex = 0;
      const m = pat.regex.exec(remaining);
      if (m && m.index < earliestIndex) {
        earliestIndex = m.index;
        earliestMatch = m;
        earliestPattern = pat;
      }
    }

    if (!earliestMatch) {
      // Analyze the rest of the text for warnings before finishing
      scanSkippedTextForWarnings(remaining, warnings);
      break;
    }

    // Analyze skipped text for warnings
    const skipped = remaining.substring(0, earliestIndex);
    scanSkippedTextForWarnings(skipped, warnings);

    // Advance remaining past skipped text
    remaining = remaining.substring(earliestIndex);

    if (earliestPattern.type === "if") {
      const condEndIndex = findClosingBracket(remaining, 4, "(", ")");
      if (condEndIndex === -1) {
        remaining = remaining.substring(4);
        continue;
      }
      const condExpr = remaining.substring(4, condEndIndex);

      let thenBlockStart = remaining.indexOf("{", condEndIndex);
      if (thenBlockStart === -1) {
        remaining = remaining.substring(condEndIndex + 1);
        continue;
      }
      const thenBlockEnd = findClosingBracket(
        remaining,
        thenBlockStart + 1,
        "{",
        "}",
      );
      if (thenBlockEnd === -1) {
        remaining = remaining.substring(thenBlockStart + 1);
        continue;
      }
      const thenContent = remaining.substring(thenBlockStart + 1, thenBlockEnd);

      let elseContent = "";
      let afterThenIndex = thenBlockEnd + 1;
      const remainingSuffix = remaining.substring(afterThenIndex).trim();
      if (remainingSuffix.startsWith("else")) {
        const elseWordIndex = remaining.indexOf("else", afterThenIndex);
        const elseBlockStart = remaining.indexOf("{", elseWordIndex);
        if (elseBlockStart !== -1) {
          const elseBlockEnd = findClosingBracket(
            remaining,
            elseBlockStart + 1,
            "{",
            "}",
          );
          if (elseBlockEnd !== -1) {
            elseContent = remaining.substring(elseBlockStart + 1, elseBlockEnd);
            afterThenIndex = elseBlockEnd + 1;
          }
        }
      }

      remaining = remaining.substring(afterThenIndex);

      let condType: "element_visible" | "text_contains" = "element_visible";
      let condSelector = "";
      let condExpectedText = "";

      const isVisibleRegex =
        /page\.isVisible\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/;
      const isVisibleMatch = isVisibleRegex.exec(condExpr);
      if (isVisibleMatch) {
        condType = "element_visible";
        condSelector = resolve(isVisibleMatch[1]);
      } else {
        const textContainsRegex =
          /\.includes\(\s*((?:['"`](?:[^\\]|\\.)*?['"`])|[a-zA-Z0-9_]+)\s*\)/;
        const textContainsMatch = textContainsRegex.exec(condExpr);
        if (textContainsMatch) {
          condType = "text_contains";
          condSelector = "body";
          condExpectedText = resolve(textContainsMatch[1]);
        } else {
          // If condition is unrecognized, log a warning
          warnings.push(
            `Condição não reconhecida: '${condExpr.trim()}'. Mapeando como element_visible.`,
          );
          condSelector = "body";
        }
      }

      const id = randomUUID();
      const thenRes = parsePlaywrightScriptToWorkflowJob(
        thenContent,
        workflowId,
      );
      const elseRes = elseContent
        ? parsePlaywrightScriptToWorkflowJob(elseContent, workflowId)
        : null;

      // Accumulate warnings from sub-branches
      warnings.push(...thenRes.warnings);
      if (elseRes) {
        warnings.push(...elseRes.warnings);
      }

      const step: AutomationStep = {
        id,
        action: "condition",
        description: `Verify condition: ${condExpr.trim()}`,
        conditionConfig: {
          condition: {
            type: condType,
            selector: condSelector,
            expectedText: condExpectedText || undefined,
          },
          thenSteps: thenRes.steps,
          elseSteps: elseRes?.steps ?? undefined,
        },
      };
      steps.push(step);
    } else {
      const id = randomUUID();
      let step: AutomationStep | null = null;

      if (earliestPattern.type === "navigate") {
        const url = resolve(earliestMatch[1]);
        step = {
          id,
          action: "navigate",
          description: `Navigate to ${url}`,
          params: { url },
        };
      } else if (
        earliestPattern.type === "click_direct" ||
        earliestPattern.type === "click_locator"
      ) {
        const selector = resolve(earliestMatch[1]);
        step = {
          id,
          action: "click",
          description: `Click element ${selector}`,
          params: { selector },
        };
      } else if (
        earliestPattern.type === "fill_direct" ||
        earliestPattern.type === "fill_locator"
      ) {
        let selector = "";
        let value = "";
        if (earliestPattern.type === "fill_direct") {
          selector = resolve(earliestMatch[2]);
          value = resolve(earliestMatch[3]);
        } else {
          selector = resolve(earliestMatch[1]);
          value = resolve(earliestMatch[3]);
        }
        step = {
          id,
          action: "fill",
          description: `Fill ${selector} with ${value}`,
          params: { selector, value },
        };
      }

      if (step) {
        steps.push(step);
      }

      remaining = remaining.substring(earliestMatch[0].length);
    }
  }

  return { steps, warnings };
}

export async function handler(event: any): Promise<void> {
  console.log(
    "Translator Lambda invoked with event:",
    JSON.stringify(event, null, 2),
  );

  const detail = event.detail;
  if (!detail || !detail.id || !detail.compiledScript) {
    console.warn(
      "Invalid event payload: missing detail, id, or compiledScript",
    );
    return;
  }

  const { id, compiledScript } = detail;

  try {
    const { steps, warnings } = parsePlaywrightScriptToWorkflowJob(
      compiledScript,
      id,
    );

    const workflowJob: WorkflowJob = {
      workflowId: id,
      executionId: "",
      dataSourceFileKey: "",
      steps,
    };

    console.log(
      `Successfully translated script ${id}. Steps: ${steps.length}, Warnings: ${warnings.length}. Writing to DynamoDB...`,
    );

    await docClient.send(
      new UpdateCommand({
        TableName: SCRIPTS_TABLE,
        Key: { id },
        UpdateExpression:
          "SET automationScript = :automationScript, automatedScript = :automatedScript, warnings = :warnings",
        ExpressionAttributeValues: {
          ":automationScript": workflowJob,
          ":automatedScript": JSON.stringify(workflowJob),
          ":warnings": warnings,
        },
      }),
    );

    console.log(
      `Successfully updated automationScript and warnings for script ${id}`,
    );
  } catch (err) {
    console.error(`Failed to translate and save script ${id}:`, err);
    throw err;
  }
}
