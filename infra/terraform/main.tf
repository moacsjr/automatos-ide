# ============================================================
# SQS — Job queue (API Gateway enqueues, RPA Worker consumes)
# ============================================================

resource "aws_sqs_queue" "workflow_queue" {
  name                       = "${var.environment}-rpa-workflow-queue"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600 # 4 days
  delay_seconds              = 0

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.workflow_queue_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "workflow_queue_dlq" {
  name                      = "${var.environment}-rpa-workflow-dlq"
  message_retention_seconds = 1209600 # 14 days
}

# ============================================================
# DynamoDB — Workflow state storage
# ============================================================

resource "aws_dynamodb_table" "workflows" {
  name         = "${var.environment}-rpa-workflows"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "workflowId"

  attribute {
    name = "workflowId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = false
  }

  tags = {
    Name = "${var.environment}-rpa-workflows"
  }
}

# ============================================================
# IAM — Shared role for Lambda + Worker (SQS + DynamoDB access)
# ============================================================

resource "aws_iam_role" "rpa_execution_role" {
  name = "${var.environment}-rpa-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = [
            "lambda.amazonaws.com",
            "ecs-tasks.amazonaws.com"
          ]
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "rpa_execution_policy" {
  name = "${var.environment}-rpa-execution-policy"
  role = aws_iam_role.rpa_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.workflow_queue.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.workflows.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ============================================================
# API Gateway + Lambda
# ============================================================

module "api_gateway" {
  source = "./modules/api-gateway"

  environment         = var.environment
  workflow_table_name = aws_dynamodb_table.workflows.name
  job_queue_url       = aws_sqs_queue.workflow_queue.url
  execution_role_arn  = aws_iam_role.rpa_execution_role.arn
  vpc_id              = var.vpc_id
  subnet_ids          = var.subnet_ids
}

# ============================================================
# RPA Worker (ECS Fargate)
# ============================================================

module "worker" {
  source = "./modules/worker"

  environment        = var.environment
  docker_image_uri   = var.docker_image_uri
  job_queue_url      = aws_sqs_queue.workflow_queue.url
  execution_role_arn = aws_iam_role.rpa_execution_role.arn
  vpc_id             = var.vpc_id
  subnet_ids         = var.subnet_ids
}
