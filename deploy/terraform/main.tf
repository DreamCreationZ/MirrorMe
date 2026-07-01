locals {
  sudo = trimspace(var.sudo_prefix) == "" ? "" : "${trimspace(var.sudo_prefix)} "

  service_content = templatefile("${path.module}/templates/app.service.tftpl", {
    app_name = var.app_name
    app_root = var.app_root
    app_port = var.app_port
    app_user = var.ssh_user
  })

  nginx_content = templatefile("${path.module}/templates/nginx.conf.tftpl", {
    app_domain = var.app_domain
    app_port   = var.app_port
  })

  env_content = var.env_file_local_path == "" ? "" : try(file(var.env_file_local_path), "")
}

resource "local_file" "rendered_service" {
  content  = local.service_content
  filename = "${path.module}/${var.app_name}.service.generated"
}

resource "local_file" "rendered_nginx" {
  content  = local.nginx_content
  filename = "${path.module}/${var.app_name}.nginx.generated"
}

resource "local_file" "rendered_env" {
  content         = local.env_content
  filename        = "${path.module}/${var.app_name}.env.generated"
  file_permission = "0600"
}

resource "null_resource" "deploy_app" {
  triggers = {
    host            = var.host
    app_name        = var.app_name
    app_domain      = var.app_domain
    app_port        = tostring(var.app_port)
    app_root        = var.app_root
    repo_url        = var.repo_url
    repo_branch     = var.repo_branch
    service_content = sha256(local.service_content)
    nginx_content   = sha256(local.nginx_content)
    env_file_path   = var.env_file_local_path
    env_file_hash   = sha256(local.env_content)
  }

  connection {
    type        = "ssh"
    host        = var.host
    port        = var.ssh_port
    user        = var.ssh_user
    private_key = file(var.ssh_private_key_path)
    timeout     = "5m"
  }

  provisioner "file" {
    source      = local_file.rendered_service.filename
    destination = "/tmp/${var.app_name}.service"
  }

  provisioner "file" {
    source      = local_file.rendered_nginx.filename
    destination = "/tmp/${var.app_name}.conf"
  }

  provisioner "file" {
    source      = local_file.rendered_env.filename
    destination = "/tmp/${var.app_name}.env"
  }

  provisioner "remote-exec" {
    inline = [
      "set -euo pipefail",
      "install_pkg(){ if command -v apt-get >/dev/null 2>&1; then ${local.sudo}apt-get update -y && ${local.sudo}apt-get install -y \"$@\"; elif command -v dnf >/dev/null 2>&1; then ${local.sudo}dnf install -y \"$@\"; elif command -v yum >/dev/null 2>&1; then ${local.sudo}yum install -y \"$@\"; else echo 'No supported package manager found.'; exit 1; fi; }",
      "if ! command -v git >/dev/null 2>&1; then install_pkg git; fi",
      "if ! command -v nginx >/dev/null 2>&1; then install_pkg nginx; fi",
      "if ! command -v npm >/dev/null 2>&1; then echo 'npm is not installed on server. Install Node.js first.' && exit 1; fi",
      "${local.sudo}mkdir -p \"${var.app_root}\"",
      "${local.sudo}chown -R ${var.ssh_user}:${var.ssh_user} \"${var.app_root}\"",
      "if [ -d \"${var.app_root}/.git\" ]; then cd \"${var.app_root}\" && git fetch --all && git checkout ${var.repo_branch} && git pull --ff-only origin ${var.repo_branch}; else if [ -n \"$(ls -A \"${var.app_root}\" 2>/dev/null)\" ]; then echo '${var.app_root} is not empty and is not a git repo. Refusing to overwrite.' && exit 1; fi; git clone --branch ${var.repo_branch} --single-branch ${var.repo_url} \"${var.app_root}\"; fi",
      "cd \"${var.app_root}\" && npm ci && npm run build",
      "${local.sudo}mv /tmp/${var.app_name}.service /etc/systemd/system/${var.app_name}.service",
      "${local.sudo}chmod 0644 /etc/systemd/system/${var.app_name}.service",
      "${local.sudo}mv /tmp/${var.app_name}.env /etc/${var.app_name}.env",
      "${local.sudo}chown root:${var.ssh_user} /etc/${var.app_name}.env",
      "${local.sudo}chmod 0640 /etc/${var.app_name}.env",
      "if [ -d /etc/nginx/sites-available ]; then ${local.sudo}mv /tmp/${var.app_name}.conf /etc/nginx/sites-available/${var.app_name}.conf && ${local.sudo}ln -sfn /etc/nginx/sites-available/${var.app_name}.conf /etc/nginx/sites-enabled/${var.app_name}.conf; else ${local.sudo}mv /tmp/${var.app_name}.conf /etc/nginx/conf.d/${var.app_name}.conf; fi",
      "${local.sudo}nginx -t",
      "${local.sudo}systemctl daemon-reload",
      "${local.sudo}systemctl enable ${var.app_name}",
      "${local.sudo}systemctl restart ${var.app_name}",
      "${local.sudo}systemctl reload nginx",
    ]
  }
}

resource "null_resource" "setup_tls" {
  count = var.enable_certbot ? 1 : 0

  triggers = {
    host          = var.host
    app_domain    = var.app_domain
    certbot_email = var.certbot_email
  }

  depends_on = [null_resource.deploy_app]

  connection {
    type        = "ssh"
    host        = var.host
    port        = var.ssh_port
    user        = var.ssh_user
    private_key = file(var.ssh_private_key_path)
    timeout     = "5m"
  }

  provisioner "remote-exec" {
    inline = [
      "set -euo pipefail",
      "if [ -z \"${var.certbot_email}\" ]; then echo 'certbot_email is required when enable_certbot=true' && exit 1; fi",
      "if ! command -v certbot >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then ${local.sudo}apt-get update -y && ${local.sudo}apt-get install -y certbot python3-certbot-nginx; elif command -v dnf >/dev/null 2>&1; then ${local.sudo}dnf install -y certbot python3-certbot-nginx; elif command -v yum >/dev/null 2>&1; then ${local.sudo}yum install -y certbot python3-certbot-nginx; else echo 'No supported package manager found for certbot.' && exit 1; fi; fi",
      "${local.sudo}certbot --nginx -d ${var.app_domain} --non-interactive --agree-tos -m ${var.certbot_email} --redirect",
      "${local.sudo}nginx -t",
      "${local.sudo}systemctl reload nginx"
    ]
  }
}
