# ECS Cluster + Fargate Task for RPA Worker

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
      image = "${var.ecr_repository_uri}:latest"
      environment = [
        { name = "NODE_ENV",      value = "production" },
        { name = "JOB_QUEUE_URL", value = var.job_queue_url },
        { name = "AWS_REGION",    value = "us-east-1" }
      ]
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
    subnets         = var.subnet_ids
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
