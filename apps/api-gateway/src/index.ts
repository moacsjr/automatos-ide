import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const sqs = new SQSClient();
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient());

const WORKFLOW_TABLE = process.env.WORKFLOW_TABLE ?? "rpa-workflows";
const JOB_QUEUE_URL = process.env.JOB_QUEUE_URL;

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const { httpMethod, path, body } = event;

    // POST /workflows — create workflow + enqueue job
    if (httpMethod === "POST" && path === "/workflows") {
      const payload = JSON.parse(body ?? "{}");
      const { workflowId, executionId, dataSourceFileKey, steps } = payload;

      await docClient.send(
        new PutCommand({
          TableName: WORKFLOW_TABLE,
          Item: {
            workflowId,
            executionId,
            dataSourceFileKey,
            steps,
            createdAt: new Date().toISOString(),
          },
        }),
      );

      if (JOB_QUEUE_URL) {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: JOB_QUEUE_URL,
            MessageBody: JSON.stringify({ workflowId, executionId }),
          }),
        );
      }

      return { statusCode: 201, body: JSON.stringify({ executionId }) };
    }

    // GET /workflows/:id — read workflow status
    if (httpMethod === "GET" && path?.startsWith("/workflows/")) {
      const workflowId = path.split("/").pop();
      const result = await docClient.send(
        new GetCommand({ TableName: WORKFLOW_TABLE, Key: { workflowId } }),
      );
      if (result.Item) {
        return { statusCode: 200, body: JSON.stringify(result.Item) };
      }
      return { statusCode: 404, body: "Not found" };
    }

    return { statusCode: 405, body: "Method not allowed" };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (err as Error).message }),
    };
  }
}
