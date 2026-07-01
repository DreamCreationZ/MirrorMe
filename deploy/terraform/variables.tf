variable "host" {
  description = "Public IP or DNS of the existing EC2 server."
  type        = string
}

variable "ssh_user" {
  description = "SSH username for the server (for example ubuntu, ec2-user)."
  type        = string
}

variable "ssh_private_key_path" {
  description = "Absolute path to the SSH private key that can access the server."
  type        = string
}

variable "ssh_port" {
  description = "SSH port."
  type        = number
  default     = 22
}

variable "app_name" {
  description = "Unique app/service name for systemd and nginx."
  type        = string
  default     = "mirrorme"
}

variable "app_domain" {
  description = "Domain/subdomain to route to this app (for example mirror.example.com)."
  type        = string
}

variable "app_port" {
  description = "Internal app port for this app only. Must be different from the existing app."
  type        = number
  default     = 3001
}

variable "app_root" {
  description = "Directory on server where this app code will live."
  type        = string
  default     = "/srv/mirrorme"
}

variable "repo_url" {
  description = "Git repository URL for this app."
  type        = string
}

variable "repo_branch" {
  description = "Git branch to deploy."
  type        = string
  default     = "main"
}

variable "env_file_local_path" {
  description = "Absolute local path to env file to upload as EnvironmentFile. Leave empty to skip."
  type        = string
  default     = ""
}

variable "sudo_prefix" {
  description = "Command prefix for privileged operations (usually sudo). Use empty string only if running as root."
  type        = string
  default     = "sudo"
}

variable "enable_certbot" {
  description = "When true, requests Let's Encrypt cert for app_domain via nginx plugin."
  type        = bool
  default     = false
}

variable "certbot_email" {
  description = "Email for Let's Encrypt registration when enable_certbot=true."
  type        = string
  default     = ""
}

