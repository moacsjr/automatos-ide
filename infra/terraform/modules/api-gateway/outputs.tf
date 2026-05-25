output "invoke_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "lambda_function_arn" {
  value = aws_lambda_function.api_handler.arn
}
