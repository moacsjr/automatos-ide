import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} from "@aws-sdk/client-ec2";
import { randomUUID } from "crypto";
import type { APIGatewayProxyResult } from "aws-lambda";

const sqs = new SQSClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" }),
);
const ecs = new ECSClient({ region: "us-east-1" });
const ec2 = new EC2Client({ region: "us-east-1" });

const WORKFLOW_TABLE = process.env.WORKFLOW_TABLE ?? "rpa-workflows";
const SCRIPTS_TABLE = process.env.SCRIPTS_TABLE ?? "rpa-scripts";
const JOB_QUEUE_URL = process.env.JOB_QUEUE_URL;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*",
};

async function getIaContainerIps(): Promise<{
  privateIp: string;
  publicIp: string;
}> {
  const env = process.env.ENVIRONMENT ?? "staging";
  const cluster = `${env}-rpa-worker-cluster`;
  const service = `${env}-automatos-ia-service`;

  try {
    const listRes = await ecs.send(
      new ListTasksCommand({ cluster, serviceName: service }),
    );
    if (!listRes.taskArns || listRes.taskArns.length === 0) {
      throw new Error(
        `No tasks found for cluster ${cluster} and service ${service}`,
      );
    }

    const descRes = await ecs.send(
      new DescribeTasksCommand({ cluster, tasks: [listRes.taskArns[0]] }),
    );
    const task = descRes.tasks?.[0];
    if (!task) {
      throw new Error("Task description not found");
    }

    const attachment = task.attachments?.find(
      (a) => a.type === "ElasticNetworkInterface",
    );
    if (!attachment) {
      throw new Error(
        "ElasticNetworkInterface attachment not found in task description",
      );
    }

    const privateIpDetail = attachment.details?.find(
      (d) => d.name === "privateIPv4Address",
    );
    const eniDetail = attachment.details?.find(
      (d) => d.name === "networkInterfaceId",
    );

    const privateIp = privateIpDetail?.value;
    const eniId = eniDetail?.value;

    if (!privateIp) {
      throw new Error("Private IP not found in ENI attachment");
    }

    let publicIp = privateIp;

    if (eniId) {
      try {
        const ec2Res = await ec2.send(
          new DescribeNetworkInterfacesCommand({
            NetworkInterfaceIds: [eniId],
          }),
        );
        publicIp =
          ec2Res.NetworkInterfaces?.[0]?.Association?.PublicIp ?? privateIp;
      } catch (err) {
        console.error(
          "Failed to describe network interface for ENI:",
          eniId,
          err,
        );
      }
    }

    return { privateIp, publicIp };
  } catch (err) {
    console.warn(
      "Failed to get Fargate IP, falling back to localhost:",
      (err as Error).message,
    );
    return { privateIp: "127.0.0.1", publicIp: "127.0.0.1" };
  }
}

export async function handler(event: any): Promise<APIGatewayProxyResult> {
  try {
    const rawPath = event.rawPath || event.path || "";
    const httpMethod =
      event.requestContext?.http?.method || event.httpMethod || "GET";
    const body = event.body;

    // Handle OPTIONS preflight if API GW didn't catch it
    if (httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: CORS_HEADERS,
        body: "",
      };
    }

    // GET /ia-host
    if (httpMethod === "GET" && rawPath === "/ia-host") {
      const ips = await getIaContainerIps();
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicIp: ips.publicIp }),
      };
    }

    // Route /ia/* proxy to Fargate
    if (rawPath.startsWith("/ia") && rawPath !== "/ia-host") {
      let subPath = rawPath.substring(3);
      if (!subPath.startsWith("/")) {
        subPath = "/" + subPath;
      }

      const { privateIp } = await getIaContainerIps();

      let queryString = "";
      if (event.rawQueryString) {
        queryString = "?" + event.rawQueryString;
      } else if (event.queryStringParameters) {
        queryString =
          "?" +
          Object.entries(event.queryStringParameters)
            .map(
              ([k, v]) =>
                `${encodeURIComponent(k)}=${encodeURIComponent((v as string) ?? "")}`,
            )
            .join("&");
      }

      const targetUrl = `http://${privateIp}:3001${subPath}${queryString}`;

      const headers: Record<string, string> = {};
      if (event.headers) {
        for (const [key, val] of Object.entries(event.headers)) {
          if (
            val &&
            key.toLowerCase() !== "host" &&
            key.toLowerCase() !== "connection"
          ) {
            headers[key] = String(val);
          }
        }
      }

      let bodyBuffer: Buffer | undefined;
      if (body) {
        bodyBuffer = event.isBase64Encoded
          ? Buffer.from(body, "base64")
          : Buffer.from(body);
      }

      const response = await fetch(targetUrl, {
        method: httpMethod,
        headers,
        body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
      });

      const responseBody = await response.arrayBuffer();
      const base64Body = Buffer.from(responseBody).toString("base64");

      const responseHeaders: Record<string, string> = {
        ...CORS_HEADERS,
      };
      for (const [k, v] of response.headers.entries()) {
        if (
          k.toLowerCase() !== "transfer-encoding" &&
          k.toLowerCase() !== "content-encoding"
        ) {
          responseHeaders[k] = v;
        }
      }

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: base64Body,
        isBase64Encoded: true,
      };
    }

    // POST /workflows — create workflow + enqueue job
    if (httpMethod === "POST" && rawPath === "/workflows") {
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

      return {
        statusCode: 201,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ executionId }),
      };
    }

    // GET /workflows/:id — read workflow status
    if (httpMethod === "GET" && rawPath.startsWith("/workflows/")) {
      const workflowId = rawPath.split("/").pop();
      const result = await docClient.send(
        new GetCommand({ TableName: WORKFLOW_TABLE, Key: { workflowId } }),
      );
      if (result.Item) {
        return {
          statusCode: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(result.Item),
        };
      }
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "Not found",
      };
    }

    // GET /scripts — list scripts
    if (
      httpMethod === "GET" &&
      (rawPath === "/scripts" || rawPath === "/scripts/")
    ) {
      const result = await docClient.send(
        new ScanCommand({ TableName: SCRIPTS_TABLE }),
      );
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(result.Items ?? []),
      };
    }

    // GET /scripts/:id — read script
    if (httpMethod === "GET" && rawPath.startsWith("/scripts/")) {
      const id = rawPath.split("/").pop();
      const result = await docClient.send(
        new GetCommand({ TableName: SCRIPTS_TABLE, Key: { id } }),
      );
      if (result.Item) {
        return {
          statusCode: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(result.Item),
        };
      }
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "Not found",
      };
    }

    // POST /scripts — create script
    if (
      httpMethod === "POST" &&
      (rawPath === "/scripts" || rawPath === "/scripts/")
    ) {
      const payload = JSON.parse(body ?? "{}");
      const id = payload.id || randomUUID();
      const item = { ...payload, id };

      await docClient.send(
        new PutCommand({
          TableName: SCRIPTS_TABLE,
          Item: item,
        }),
      );

      return {
        statusCode: 201,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(item),
      };
    }

    // PUT /scripts/:id — update script
    if (httpMethod === "PUT" && rawPath.startsWith("/scripts/")) {
      const id = rawPath.split("/").pop();
      const payload = JSON.parse(body ?? "{}");
      const item = { ...payload, id };

      await docClient.send(
        new PutCommand({
          TableName: SCRIPTS_TABLE,
          Item: item,
        }),
      );

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(item),
      };
    }

    // DELETE /scripts/:id — delete script
    if (httpMethod === "DELETE" && rawPath.startsWith("/scripts/")) {
      const id = rawPath.split("/").pop();
      await docClient.send(
        new DeleteCommand({
          TableName: SCRIPTS_TABLE,
          Key: { id },
        }),
      );

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ success: true }),
      };
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: "Method not allowed",
    };
  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: (err as Error).message }),
    };
  }
}
