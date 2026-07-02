variable "environment" {
  type = string
}

variable "ecr_repository_uri" {
  description = "Base ECR URI (image tag is added at runtime)"
  type        = string
}

variable "automatos_ia_ecr_repository_uri" {
  description = "Base ECR URI for automatos-ia (image tag is added at runtime)"
  type        = string
}

variable "job_queue_url" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = ""
}

variable "subnet_ids" {
  type    = list(string)
  default = []
}

variable "image_tag" {
  description = "Docker image tag for task definitions"
  type        = string
  default     = "latest"
}

variable "gemini_secret_arn" {
  description = "ARN do secret (Secrets Manager) com a Gemini API key"
  type        = string
}

variable "openrouter_secret_arn" {
  description = "ARN do secret (Secrets Manager) com a OpenRouter API key"
  type        = string
}

variable "internal_auth_secret_arn" {
  description = "ARN do secret (Secrets Manager) com o segredo x-internal-auth"
  type        = string
}

variable "allowed_origin" {
  description = "Origem permitida para CORS no automatos-ia"
  type        = string
  default     = "*"
}

variable "assign_public_ip" {
  description = "Atribui IP público ao container automatos-ia (false = lockdown)"
  type        = bool
  default     = false
}

