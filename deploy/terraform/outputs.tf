output "app_http_url" {
  description = "HTTP URL for the newly deployed app."
  value       = "http://${var.app_domain}"
}

output "app_internal_port" {
  description = "Internal port used by this app on the server."
  value       = var.app_port
}

output "systemd_service_name" {
  description = "Systemd service name created for this app."
  value       = var.app_name
}

