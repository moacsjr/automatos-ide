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

variable "docker_image_uri" {
  description = "ECR URI for the rpa-worker Docker image"
  type        = string
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
