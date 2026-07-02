variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (staging, prod)"
  type        = string
  default     = "staging"
}

variable "github_owner" {
  description = "GitHub username or org"
  type        = string
  default     = "moacsjr"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "automatos-ide"
}

variable "vpc_id" {
  description = "VPC ID for Lambda and Fargate"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for Lambda and Fargate"
  type        = list(string)
  default     = []
}

variable "image_tag" {
  description = "Docker image tag for ECS deployment"
  type        = string
  default     = "latest"
}

variable "gemini_api_key" {
  description = "Gemini API key for automatos-ia"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openrouter_api_key" {
  description = "OpenRouter API key for automatos-ia (usada só para semear o Secrets Manager)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "allowed_origin" {
  description = "Origem permitida para CORS (domínio do web-platform). '*' só para dev."
  type        = string
  default     = "*"
}

variable "assign_public_ip" {
  description = <<-EOT
    Atribui IP público ao container automatos-ia. Deve ser false em produção
    (lockdown). PRÉ-REQUISITO p/ false: subnets privadas com NAT/VPC endpoints
    para pull de imagem + egress LLM, e o Lambda do API Gateway anexado à VPC
    (subnet_ids setado) para conseguir alcançar o container pela rede interna.
  EOT
  type        = bool
  default     = false
}

