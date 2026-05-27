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

output "dynamodb_scripts_table_name" {
  description = "DynamoDB table name for scripts"
  value       = aws_dynamodb_table.scripts.name
}

output "ecr_repository_uri" {
  description = "ECR repository URI for rpa-worker images"
  value       = aws_ecr_repository.rpa_worker.repository_url
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC"
  value       = aws_iam_role.github_actions_role.arn
}

output "secrets_created" {
  description = "GitHub secrets that were created"
  value = {
    AWS_ROLE_ARN                = github_actions_secret.aws_role_arn.secret_name
    AWS_REGION                  = github_actions_secret.aws_region.secret_name
    ECR_REPOSITORY              = github_actions_secret.ecr_repository.secret_name
    ECR_REPOSITORY_AUTOMATOS_IA = github_actions_secret.ecr_repository_automatos_ia.secret_name
  }
}
