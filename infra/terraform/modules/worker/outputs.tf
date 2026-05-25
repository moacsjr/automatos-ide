output "ecs_cluster_name" {
  value = aws_ecs_cluster.worker.name
}

output "ecs_service_name" {
  value = aws_ecs_service.worker.name
}
