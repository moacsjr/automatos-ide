terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket         = "rpa-terraform-state-3778"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "cognitive-rpa"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}

# ============================================================
# Secrets Manager — LLM keys + internal-auth shared secret
# ============================================================
# Segredos injetados nos containers via `secrets` (valueFrom) do task def, em vez
# de env var plaintext. Não aparecem no task definition nem no CloudWatch.
#
# NOTA: os valores das chaves de LLM ainda são semeados via var (que vem do
# GitHub Secret no CI) e ficam no state (S3 criptografado). O ganho é remover do
# task def/console/logs. Zero-exposição-no-state fica pra Fase 2 (gerir o valor
# fora do Terraform). O secret_string tem ignore_changes p/ permitir rotação
# manual no console sem ser sobrescrito.

resource "random_password" "internal_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "openrouter" {
  name                    = "${var.environment}/automatos/openrouter-api-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "openrouter" {
  secret_id = aws_secretsmanager_secret.openrouter.id
  # coalesce evita erro quando o var vem vazio (PutSecretValue rejeita string
  # vazia). Valor real é semeado no CI; "unset" é só placeholder.
  secret_string = coalesce(var.openrouter_api_key, "unset")
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "gemini" {
  name                    = "${var.environment}/automatos/gemini-api-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "gemini" {
  secret_id     = aws_secretsmanager_secret.gemini.id
  secret_string = coalesce(var.gemini_api_key, "unset")
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "internal_auth" {
  name                    = "${var.environment}/automatos/internal-auth-secret"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "internal_auth" {
  secret_id     = aws_secretsmanager_secret.internal_auth.id
  secret_string = random_password.internal_auth.result
}

# ============================================================
# ECR — Docker image registry for rpa-worker
# ============================================================

resource "aws_ecr_repository" "rpa_worker" {
  name                 = "rpa-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "rpa_worker" {
  repository = aws_ecr_repository.rpa_worker.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images, expire older"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ============================================================
# ECR — Docker image registry for automatos-ia
# ============================================================

resource "aws_ecr_repository" "automatos_ia" {
  name                 = "automatos-ia"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "automatos_ia" {
  repository = aws_ecr_repository.automatos_ia.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images, expire older"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ============================================================
# SQS — Job queue (API Gateway enqueues, RPA Worker consumes)
# ============================================================

resource "aws_sqs_queue" "workflow_queue" {
  name                       = "${var.environment}-rpa-workflow-queue"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600 # 4 days

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
}

# ============================================================
# DynamoDB — Scripts storage
# ============================================================

resource "aws_dynamodb_table" "scripts" {
  name         = "${var.environment}-rpa-scripts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ============================================================
# GitHub OIDC — Trust relationship for GitHub Actions
# ============================================================

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = [
    "6938fd4d9ebab03ace7620e26c1b5457b960b442"
  ]
}

# ============================================================
# IAM — Role for GitHub Actions (assume via OIDC)
# ============================================================

resource "aws_iam_role" "github_actions_role" {
  name = "${var.environment}-github-actions-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_owner}/${var.github_repo}:*"
          }
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_actions_policy" {
  name = "${var.environment}-github-actions-policy"
  role = aws_iam_role.github_actions_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:*"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:*"
        ]
        Resource = [
          aws_sqs_queue.workflow_queue.arn,
          aws_sqs_queue.workflow_queue_dlq.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:*"
        ]
        Resource = [
          aws_dynamodb_table.workflows.arn,
          aws_dynamodb_table.scripts.arn,
          "arn:aws:dynamodb:us-east-1:${local.account_id}:table/terraform-locks"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:*"
        ]
        Resource = "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.environment}-rpa-*"
      },
      {
        Effect = "Allow"
        Action = [
          "apigateway:*"
        ]
        Resource = "arn:aws:apigateway:${local.region}::/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:*",
          "application-autoscaling:*"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:*"
        ]
        Resource = [
          "arn:aws:iam::${local.account_id}:role/${var.environment}-*",
          "arn:aws:iam::${local.account_id}:role/*github-actions*",
          "arn:aws:iam::${local.account_id}:policy/*",
          "arn:aws:iam::${local.account_id}:oidc-provider/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:*"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:*"
        ]
        Resource = [
          "arn:aws:s3:::rpa-terraform-state-3778",
          "arn:aws:s3:::rpa-terraform-state-3778/*",
          "arn:aws:s3:::${var.environment}-automatos-web-platform-${local.account_id}",
          "arn:aws:s3:::${var.environment}-automatos-web-platform-${local.account_id}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:*"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "events:*"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecret",
          "secretsmanager:TagResource",
          "secretsmanager:GetResourcePolicy",
          "secretsmanager:ListSecretVersionIds"
        ]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${var.environment}/automatos/*"
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:*"
        ]
        Resource = "*"
      }
    ]
  })
}

# ============================================================
# IAM — Execution role for Lambda + Fargate (runtime)
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
        Resource = [
          aws_dynamodb_table.workflows.arn,
          aws_dynamodb_table.scripts.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = [
          aws_ecr_repository.rpa_worker.arn,
          aws_ecr_repository.automatos_ia.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:ListTasks",
          "ecs:DescribeTasks",
          "ec2:DescribeNetworkInterfaces"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "events:PutEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.openrouter.arn,
          aws_secretsmanager_secret.gemini.arn,
          aws_secretsmanager_secret.internal_auth.arn
        ]
      }
    ]
  })
}

# ============================================================
# API Gateway + Lambda
# ============================================================

module "api_gateway" {
  source = "./modules/api-gateway"

  environment          = var.environment
  workflow_table_name  = aws_dynamodb_table.workflows.name
  scripts_table_name   = aws_dynamodb_table.scripts.name
  job_queue_url        = aws_sqs_queue.workflow_queue.url
  execution_role_arn   = aws_iam_role.rpa_execution_role.arn
  vpc_id               = var.vpc_id
  subnet_ids           = var.subnet_ids
  allowed_origin       = var.allowed_origin
  internal_auth_secret = random_password.internal_auth.result
}

# ============================================================
# RPA Worker (ECS Fargate)
# ============================================================

module "worker" {
  source = "./modules/worker"

  environment                     = var.environment
  ecr_repository_uri              = aws_ecr_repository.rpa_worker.repository_url
  automatos_ia_ecr_repository_uri = aws_ecr_repository.automatos_ia.repository_url
  job_queue_url                   = aws_sqs_queue.workflow_queue.url
  execution_role_arn              = aws_iam_role.rpa_execution_role.arn
  vpc_id                          = var.vpc_id
  subnet_ids                      = var.subnet_ids
  image_tag                       = var.image_tag
  allowed_origin                  = var.allowed_origin
  assign_public_ip                = var.assign_public_ip
  gemini_secret_arn               = aws_secretsmanager_secret.gemini.arn
  openrouter_secret_arn           = aws_secretsmanager_secret.openrouter.arn
  internal_auth_secret_arn        = aws_secretsmanager_secret.internal_auth.arn
}

# ============================================================
# S3 — Static Website Hosting for web-platform
# ============================================================

resource "aws_s3_bucket" "web_platform" {
  bucket        = "${var.environment}-automatos-web-platform-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "web_platform" {
  bucket = aws_s3_bucket.web_platform.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "web_platform" {
  bucket = aws_s3_bucket.web_platform.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "web_platform" {
  bucket = aws_s3_bucket.web_platform.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web_platform.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.web_platform]
}

# ============================================================
# GitHub Secrets — created automatically on terraform apply
# ============================================================

provider "github" {
  owner = var.github_owner
  # Token via GITHUB_TOKEN env var
}

resource "github_repository_environment" "staging" {
  repository  = var.github_repo
  environment = "staging"
}

resource "github_actions_secret" "aws_role_arn" {
  repository      = var.github_repo
  secret_name     = "AWS_ROLE_ARN"
  plaintext_value = aws_iam_role.github_actions_role.arn
}

resource "github_actions_secret" "aws_region" {
  repository      = var.github_repo
  secret_name     = "AWS_REGION"
  plaintext_value = var.aws_region
}

resource "github_actions_secret" "ecr_repository" {
  repository      = var.github_repo
  secret_name     = "ECR_REPOSITORY"
  plaintext_value = aws_ecr_repository.rpa_worker.name
}

resource "github_actions_secret" "ecr_repository_automatos_ia" {
  repository      = var.github_repo
  secret_name     = "ECR_REPOSITORY_AUTOMATOS_IA"
  plaintext_value = aws_ecr_repository.automatos_ia.name
}

resource "github_actions_secret" "web_platform_bucket" {
  repository      = var.github_repo
  secret_name     = "WEB_PLATFORM_BUCKET"
  plaintext_value = aws_s3_bucket.web_platform.id
}

resource "github_actions_environment_secret" "aws_role_arn_env" {
  repository      = var.github_repo
  environment     = github_repository_environment.staging.environment
  secret_name     = "AWS_ROLE_ARN"
  plaintext_value = aws_iam_role.github_actions_role.arn
}
