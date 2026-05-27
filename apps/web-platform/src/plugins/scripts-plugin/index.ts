import { pluginRegistry } from "@pluggable-js/core";
import { DynamoDbScriptsService } from "./service";
import { ScriptsCrudComponent } from "./view";

// Registra o Service Plugin do DynamoDB com a factory correta
pluginRegistry.register({
  id: "scripts-service",
  name: "Scripts Database Service",
  version: "1.0.0",
  type: "service",
  serviceFactory: () => new DynamoDbScriptsService(),
});

// Registra o Feature View Plugin para o CRUD
pluginRegistry.register({
  id: "scripts-crud-plugin",
  name: "Scripts CRUD UI",
  version: "1.0.0",
  type: "feature",
  contributions: {
    "scripts-crud-view": [ScriptsCrudComponent],
  },
});
