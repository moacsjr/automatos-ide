variable "environment" {
  type = string
}

variable "docker_image_uri" {
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
