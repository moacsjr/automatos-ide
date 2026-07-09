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

variable "web_platform_domain" {
  description = "Domínio custom do web-platform servido via CloudFront (alias + cert)."
  type        = string
  default     = "automatos.astratech.net.br"
}

variable "assign_public_ip" {
  description = <<-EOT
    Atribui IP público ao container automatos-ia. true por ora: o Lambda proxy
    roda fora da VPC e alcança o container pelo IP público; o controle de acesso
    é via header x-internal-auth (a porta fica aberta mas /api/* exige o segredo).
    Lockdown completo (false) é Fase 2: exige subnets privadas com NAT/VPC
    endpoints e o Lambda anexado à VPC para alcançar o container internamente.
  EOT
  type        = bool
  default     = true
}

