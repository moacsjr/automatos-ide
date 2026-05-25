output "api_gateway_url" {
  description = "API Gateway endpoint URL"
  value       = module.api_gateway.invoke_url
}

output "sqs_queue_url" {
  description = "SQS queue URL for workflow jobs"
  value       = aws_sqs_queue.workflow_queue.url
}

output "dynamodb_table_name" {
  description = "DynamoDB table name for workflows"
  value       = aws_dynamodb_table.workflows.name
}
