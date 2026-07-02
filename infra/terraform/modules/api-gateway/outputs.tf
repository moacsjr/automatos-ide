output "invoke_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "lambda_function_arn" {
  value = aws_lambda_function.api_handler.arn
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
