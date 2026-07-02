variable "environment" {
  type = string
}

variable "workflow_table_name" {
  type = string
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

variable "scripts_table_name" {
  type = string
}

variable "allowed_origin" {
  description = "Origem permitida para CORS no API Gateway"
  type        = string
  default     = "*"
}

variable "internal_auth_secret" {
  description = "Segredo x-internal-auth injetado pelo proxy ao chamar o container"
  type        = string
  sensitive   = true
}
