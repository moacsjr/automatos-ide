# Lambda function — API Gateway handler

data "archive_file" "api_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../dist/apps/api-gateway"
  output_path = "${path.module}/api-gateway.zip"
}

resource "aws_lambda_function" "api_handler" {
  function_name    = "${var.environment}-rpa-api-handler"
  role             = var.execution_role_arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  filename = data.archive_file.api_lambda_zip.output_path
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256

  environment {
    variables = {
      WORKFLOW_TABLE = var.workflow_table_name
      JOB_QUEUE_URL  = var.job_queue_url
      NODE_ENV       = "production"
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.subnet_ids
      security_group_ids = [aws_security_group.lambda_sg[0].id]
    }
  }
}

resource "aws_security_group" "lambda_sg" {
  count   = length(var.subnet_ids) > 0 ? 1 : 0
  name    = "${var.environment}-rpa-api-sg"
  vpc_id  = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# API Gateway — REST API

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.environment}-rpa-api"
  protocol_type = "REST"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api_handler.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_workflows" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /workflows"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "get_workflow" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /workflows/{workflowId}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
