import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" }),
);

const SCRIPTS_TABLE = process.env.SCRIPTS_TABLE ?? "rpa-scripts";

function extractVariableNameFromSelector(
  selector: string,
  index: number,
): string {
  let cleanSelector = selector;
  if (
    (cleanSelector.startsWith("'") && cleanSelector.endsWith("'")) ||
    (cleanSelector.startsWith('"') && cleanSelector.endsWith('"')) ||
    (cleanSelector.startsWith("`") && cleanSelector.endsWith("`"))
  ) {
    cleanSelector = cleanSelector.substring(1, cleanSelector.length - 1);
  }

  let baseName = "";

  const nameMatch = cleanSelector.match(/\[name=["']?([^\]"']+)["']?\]/);
  if (nameMatch) {
    baseName = nameMatch[1];
  }

  if (!baseName) {
    const idMatch =
      cleanSelector.match(/\[id=["']?([^\]"']+)["']?\]/) ||
      cleanSelector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      baseName = idMatch[1];
    }
  }

  if (!baseName) {
    const placeholderMatch = cleanSelector.match(
      /\[placeholder=["']?([^\]"']+)["']?\]/,
    );
    if (placeholderMatch) {
      baseName = placeholderMatch[1];
    }
  }

  if (!baseName) {
    const ariaLabelMatch = cleanSelector.match(
      /\[aria-label=["']?([^\]"']+)["']?\]/,
    );
    if (ariaLabelMatch) {
      baseName = ariaLabelMatch[1];
    }
  }

  if (!baseName) {
    const titleMatch = cleanSelector.match(/\[title=["']?([^\]"']+)["']?\]/);
    if (titleMatch) {
      baseName = titleMatch[1];
    }
  }

  if (!baseName) {
    const textMatch = cleanSelector.match(/text=["']?([^"']+)["']?/);
    if (textMatch) {
      baseName = textMatch[1];
    }
  }

  if (!baseName) {
    const tagMatch = cleanSelector.match(/^([a-zA-Z0-9]+)/);
    if (tagMatch) {
      baseName = tagMatch[1];
    }
  }

  if (baseName) {
    const words = baseName
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-zA-Z0-9\s_-]/g, "")
      .split(/[\s_-]+/)
      .filter(Boolean);

    if (words.length > 0) {
      baseName =
        words[0].toLowerCase() +
        words
          .slice(1)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join("");
    }
  }

  if (!baseName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(baseName)) {
    baseName = `var_${index}`;
  }

  return baseName;
}

interface VarDecl {
  name: string;
  originalValue: string;
}

function compileScript(rawScript: string): string {
  let varCounter = 1;
  const variables: VarDecl[] = [];
  const nameToValueMap = new Map<string, string>();
  const mappingMap = new Map<string, string>();

  function getOrRegisterVariable(selector: string, valueStr: string): string {
    const mappingKey = `${selector}:${valueStr}`;
    if (mappingMap.has(mappingKey)) {
      return mappingMap.get(mappingKey)!;
    }

    const baseName = extractVariableNameFromSelector(selector, varCounter);

    let uniqueName = baseName;
    let suffix = 2;
    while (
      nameToValueMap.has(uniqueName) &&
      nameToValueMap.get(uniqueName) !== valueStr
    ) {
      uniqueName = `${baseName}${suffix}`;
      suffix++;
    }

    if (!nameToValueMap.has(uniqueName)) {
      nameToValueMap.set(uniqueName, valueStr);
      variables.push({ name: uniqueName, originalValue: valueStr });
    }

    mappingMap.set(mappingKey, uniqueName);
    varCounter++;
    return uniqueName;
  }

  // Regex patterns
  const fillTypeRegex =
    /page\.(fill|type)\(\s*((['"`])(?:[^\\]|\\.)*?\3)\s*,\s*((['"`])(?:[^\\]|\\.)*?\5)\s*\)/g;
  const locatorFillTypeRegex =
    /page\.locator\(\s*((['"`])(?:[^\\]|\\.)*?\2)\s*\)\.(fill|type)\(\s*((['"`])(?:[^\\]|\\.)*?\5)\s*\)/g;

  // Perform replacements
  let compiled = rawScript.replace(
    fillTypeRegex,
    (
      match,
      action,
      selectorWithQuotes,
      selectorQuote,
      valueWithQuotes,
      valueQuote,
    ) => {
      const varName = getOrRegisterVariable(
        selectorWithQuotes,
        valueWithQuotes,
      );
      return `page.${action}(${selectorWithQuotes}, ${varName})`;
    },
  );

  compiled = compiled.replace(
    locatorFillTypeRegex,
    (
      match,
      selectorWithQuotes,
      selectorQuote,
      action,
      valueWithQuotes,
      valueQuote,
    ) => {
      const varName = getOrRegisterVariable(
        selectorWithQuotes,
        valueWithQuotes,
      );
      return `page.locator(${selectorWithQuotes}).${action}(${varName})`;
    },
  );

  // Insert variable declarations
  if (variables.length > 0) {
    const testBlockRegex =
      /(test(?:\.only|\.skip)?\s*\(\s*(['"`]).*?\2\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\s*)/;
    const match = compiled.match(testBlockRegex);
    if (match) {
      const index = match.index! + match[0].length;
      const decls =
        "\n" +
        variables
          .map((v) => `  const ${v.name} = ${v.originalValue};`)
          .join("\n") +
        "\n";
      compiled = compiled.slice(0, index) + decls + compiled.slice(index);
    } else {
      const decls =
        variables
          .map((v) => `const ${v.name} = ${v.originalValue};`)
          .join("\n") + "\n\n";
      compiled = decls + compiled;
    }
  }

  return compiled;
}

export async function handler(event: any): Promise<void> {
  console.log(
    "Compiler Lambda invoked with event:",
    JSON.stringify(event, null, 2),
  );

  const detail = event.detail;
  if (!detail || !detail.id || !detail.rawScript) {
    console.warn("Invalid event payload: missing detail, id, or rawScript");
    return;
  }

  const { id, rawScript } = detail;

  try {
    const compiledScript = compileScript(rawScript);
    console.log(`Successfully compiled script ${id}. Writing to DynamoDB...`);

    // Update only the compiledScript field in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: SCRIPTS_TABLE,
        Key: { id },
        UpdateExpression: "SET compiledScript = :compiledScript",
        ExpressionAttributeValues: {
          ":compiledScript": compiledScript,
        },
      }),
    );

    console.log(`Successfully updated compiledScript for script ${id}`);
  } catch (err) {
    console.error(`Failed to process compilation for script ${id}:`, err);
    throw err;
  }
}
