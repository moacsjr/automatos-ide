# Lambda function — API Gateway handler

data "aws_region" "current" {}

data "archive_file" "api_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../dist/apps/api-gateway"
  output_path = "${path.module}/api-gateway.zip"
}

resource "aws_lambda_function" "api_handler" {
  function_name    = "${var.environment}-rpa-api-handler"
  role             = var.execution_role_arn
  handler          = "src/index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  filename = data.archive_file.api_lambda_zip.output_path
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256

  environment {
    variables = {
      WORKFLOW_TABLE       = var.workflow_table_name
      SCRIPTS_TABLE        = var.scripts_table_name
      JOB_QUEUE_URL        = var.job_queue_url
      ENVIRONMENT          = var.environment
      NODE_ENV             = "production"
      ALLOWED_ORIGIN       = var.allowed_origin
      INTERNAL_AUTH_SECRET = var.internal_auth_secret
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

# API Gateway — HTTP API

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.environment}-rpa-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["Content-Type", "Authorization"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_origins = [var.allowed_origin]
    max_age       = 300
  }
}

# ---- Cognito (identidade) + JWT authorizer ----

resource "aws_cognito_user_pool" "users" {
  name = "${var.environment}-automatos-users"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.environment}-automatos-web"
  user_pool_id = aws_cognito_user_pool.users.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
  generate_secret = false
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.environment}-cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api_handler.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# Authorizer JWT aplicado ao $default → protege todas as rotas, inclusive /ia/*.
# Preflight CORS (OPTIONS) é tratado pelo API Gateway antes do authorizer.
resource "aws_apigatewayv2_route" "default" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Preflight CORS (OPTIONS) sem auth. O $default com JWT captura o OPTIONS antes
# do tratamento automático de CORS do API Gateway e o rejeita com 401 (o browser
# não manda token no preflight). Esta rota explícita deixa o OPTIONS passar; o
# Lambda responde 204 + headers CORS.
resource "aws_apigatewayv2_route" "options_preflight" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "OPTIONS /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "NONE"
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

# Lambda function — Script Compiler
resource "aws_lambda_function" "compiler" {
  function_name    = "${var.environment}-rpa-script-compiler"
  role             = var.execution_role_arn
  handler          = "src/compiler.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  filename         = data.archive_file.api_lambda_zip.output_path
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256

  environment {
    variables = {
      WORKFLOW_TABLE = var.workflow_table_name
      SCRIPTS_TABLE  = var.scripts_table_name
      JOB_QUEUE_URL  = var.job_queue_url
      ENVIRONMENT    = var.environment
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

# EventBridge Rule — script update events
resource "aws_cloudwatch_event_rule" "script_updated" {
  name        = "${var.environment}-script-updated-rule"
  description = "Triggered when a script rawScript is updated"
  event_pattern = jsonencode({
    source      = ["rpa.scripts"]
    detail-type = ["ScriptUpdated"]
  })
}

# EventBridge Target — invoke compiler Lambda
resource "aws_cloudwatch_event_target" "compiler_target" {
  rule      = aws_cloudwatch_event_rule.script_updated.name
  target_id = "compiler-lambda"
  arn       = aws_lambda_function.compiler.arn
}

# Lambda Permission — Allow EventBridge to invoke compiler Lambda
resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.compiler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.script_updated.arn
}

# Lambda function — Script Translator
resource "aws_lambda_function" "translator" {
  function_name    = "${var.environment}-rpa-script-translator"
  role             = var.execution_role_arn
  handler          = "src/translator.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  filename         = data.archive_file.api_lambda_zip.output_path
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256

  environment {
    variables = {
      WORKFLOW_TABLE = var.workflow_table_name
      SCRIPTS_TABLE  = var.scripts_table_name
      JOB_QUEUE_URL  = var.job_queue_url
      ENVIRONMENT    = var.environment
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

# EventBridge Rule — script compiled / updated events
resource "aws_cloudwatch_event_rule" "compiled_script_updated" {
  name        = "${var.environment}-compiled-script-updated-rule"
  description = "Triggered when a script compiledScript is updated"
  event_pattern = jsonencode({
    source      = ["rpa.scripts"]
    detail-type = ["CompiledScriptUpdated"]
  })
}

# EventBridge Target — invoke translator Lambda
resource "aws_cloudwatch_event_target" "translator_target" {
  rule      = aws_cloudwatch_event_rule.compiled_script_updated.name
  target_id = "translator-lambda"
  arn       = aws_lambda_function.translator.arn
}

# Lambda Permission — Allow EventBridge to invoke translator Lambda
resource "aws_lambda_permission" "eventbridge_translator" {
  statement_id  = "AllowEventBridgeInvokeTranslator"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.translator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.compiled_script_updated.arn
}
