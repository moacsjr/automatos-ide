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

variable "gemini_api_key" {
  description = "Gemini API key for automatos-ia"
  type        = string
  sensitive   = true
}

variable "openrouter_api_key" {
  description = "OpenRouter API key for automatos-ia"
  type        = string
  sensitive   = true
}

