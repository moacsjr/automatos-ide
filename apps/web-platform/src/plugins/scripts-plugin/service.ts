/// <reference types="vite/client" />
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Script, ScriptSchema } from "./schema";

const region = import.meta.env.VITE_AWS_REGION || "us-east-2";
const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID || "";
const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || "";
const tableName = import.meta.env.VITE_SCRIPTS_TABLE || "rpa-scripts";

let docClient: DynamoDBDocumentClient | null = null;

if (accessKeyId && secretAccessKey) {
  const client = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  docClient = DynamoDBDocumentClient.from(client);
}

export class DynamoDbScriptsService {
  private getClient(): DynamoDBDocumentClient {
    if (!docClient) {
      throw new Error(
        "AWS Credentials are not configured. Please define VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY in your web-platform/.env file.",
      );
    }
    return docClient;
  }

  async list(): Promise<Script[]> {
    const client = this.getClient();
    const command = new ScanCommand({ TableName: tableName });
    const response = await client.send(command);
    const items = response.Items || [];
    return items.map((item) => ScriptSchema.parse(item));
  }

  async get(id: string): Promise<Script> {
    const client = this.getClient();
    const command = new GetCommand({ TableName: tableName, Key: { id } });
    const response = await client.send(command);
    if (!response.Item) {
      throw new Error(`Script com ID ${id} não encontrado.`);
    }
    return ScriptSchema.parse(response.Item);
  }

  async create(data: Omit<Script, "id">): Promise<Script> {
    const client = this.getClient();
    const id = self.crypto.randomUUID();
    const script: Script = ScriptSchema.parse({ ...data, id });
    const command = new PutCommand({ TableName: tableName, Item: script });
    await client.send(command);
    return script;
  }

  async update(id: string, data: Omit<Script, "id">): Promise<Script> {
    const client = this.getClient();
    const script: Script = ScriptSchema.parse({ ...data, id });
    const command = new PutCommand({ TableName: tableName, Item: script });
    await client.send(command);
    return script;
  }

  async delete(id: string): Promise<void> {
    const client = this.getClient();
    const command = new DeleteCommand({ TableName: tableName, Key: { id } });
    await client.send(command);
  }
}
