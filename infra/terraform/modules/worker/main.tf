# ECS Cluster + Fargate Task for RPA Worker

data "aws_vpc" "default" {
  count = length(var.subnet_ids) > 0 ? 0 : 1
  default = true
}

data "aws_subnets" "default" {
  count = length(var.subnet_ids) > 0 ? 0 : 1
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
}

resource "aws_ecs_cluster" "worker" {
  name = "${var.environment}-rpa-worker-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.environment}-rpa-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "3072"

  execution_role_arn = var.execution_role_arn
  task_role_arn      = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name  = "rpa-worker"
      image = "${var.ecr_repository_uri}:${var.image_tag}"
      environment = [
        { name = "NODE_ENV",      value = "production" },
        { name = "JOB_QUEUE_URL", value = var.job_queue_url },
        { name = "AWS_REGION",    value = "us-east-1" }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "rpa-worker"
        }
      }
    }
  ])
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.environment}-rpa-worker"
  retention_in_days = 30
}

# ECS Service — runs the worker as a long-lived Fargate task

resource "aws_ecs_service" "worker" {
  name            = "${var.environment}-rpa-worker-service"
  cluster         = aws_ecs_cluster.worker.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.default[0].ids
    assign_public_ip = true
  }
}

# Auto-scaling for the worker based on SQS queue depth

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 10
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.worker.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "scale_up" {
  name               = "${var.environment}-rpa-worker-scale-up"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value     = 10.0 # scale up when queue has >10 messages per task
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ============================================================
# ECS Task & Service for Automatos-IA
# ============================================================

resource "aws_ecs_task_definition" "automatos_ia" {
  family                   = "${var.environment}-automatos-ia"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "3072"

  execution_role_arn = var.execution_role_arn
  task_role_arn      = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name  = "automatos-ia"
      image = "${var.automatos_ia_ecr_repository_uri}:${var.image_tag}"
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT",     value = "3001" },
        { name = "ALLOWED_ORIGIN", value = var.allowed_origin }
      ]
      secrets = [
        { name = "GEMINI_API_KEY",      valueFrom = var.gemini_secret_arn },
        { name = "OPENROUTER_API_KEY",  valueFrom = var.openrouter_secret_arn },
        { name = "INTERNAL_AUTH_SECRET", valueFrom = var.internal_auth_secret_arn }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.automatos_ia.name
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "automatos-ia"
        }
      }
    }
  ])
}

resource "aws_cloudwatch_log_group" "automatos_ia" {
  name              = "/ecs/${var.environment}-automatos-ia"
  retention_in_days = 30
}

resource "aws_ecs_service" "automatos_ia" {
  name            = "${var.environment}-automatos-ia-service"
  cluster         = aws_ecs_cluster.worker.id
  task_definition = aws_ecs_task_definition.automatos_ia.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.default[0].ids
    assign_public_ip = var.assign_public_ip
    security_groups  = [aws_security_group.automatos_ia_sg.id]
  }
}

# CIDR da VPC em uso — usado para restringir o ingress da porta 3001 ao tráfego
# interno da VPC (o Lambda proxy precisa estar anexado à VPC).
data "aws_vpc" "selected" {
  id = length(var.subnet_ids) > 0 ? var.vpc_id : data.aws_vpc.default[0].id
}

resource "aws_security_group" "automatos_ia_sg" {
  name   = "${var.environment}-automatos-ia-sg"
  vpc_id = length(var.subnet_ids) > 0 ? var.vpc_id : data.aws_vpc.default[0].id

  # Porta 3001 acessível apenas de dentro da VPC (não mais 0.0.0.0/0).
  # Defense-in-depth adicional: o app exige o header x-internal-auth.
  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
