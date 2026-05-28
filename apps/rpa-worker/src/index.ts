import http from "http";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { executeWorkflow } from "@rpa/automation-core";
import type { WorkflowJob } from "@rpa/automation-core";

const QUEUE_URL = process.env.JOB_QUEUE_URL ?? "";
const sqs = new SQSClient();

async function pollQueue(): Promise<void> {
  console.log("[worker] polling SQS...");
  const res = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    }),
  );

  if (!res.Messages || res.Messages.length === 0) {
    return;
  }

  for (const msg of res.Messages) {
    try {
      const job: WorkflowJob = JSON.parse(msg.Body ?? "{}");
      console.log(
        `[worker] executing workflow ${job.workflowId} / ${job.executionId}`,
      );
      await executeWorkflow(job);
      console.log("[worker] workflow complete");

      // Delete the message after successful processing
      if (msg.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: msg.ReceiptHandle,
          }),
        );
      }
    } catch (err) {
      console.error("[worker] execution failed:", (err as Error).message);
      // Don't delete — message becomes visible again after visibility timeout
    }
  }
}

async function main() {
  const HEALTH_PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HEALTH_PORT, () => {
    console.log(
      `[worker] health check server listening on port ${HEALTH_PORT}`,
    );
  });

  console.log("[worker] starting RPA worker loop");
  while (true) {
    await pollQueue();
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
