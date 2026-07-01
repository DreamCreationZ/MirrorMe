# MirrorMe On Existing AWS Server (Terraform)

This Terraform config deploys MirrorMe on an already-running server without interfering with another app:
- Uses a separate app port (default `3001`)
- Creates a separate `systemd` service (`mirrorme`)
- Creates a separate Nginx vhost (`/etc/nginx/sites-available/mirrorme.conf`)
- Optionally configures HTTPS via certbot

## 1. Prepare values

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
- `host`, `ssh_user`, `ssh_private_key_path`
- `app_domain` (new domain/subdomain)
- `repo_url`
- `env_file_local_path` (point to your local env file)

Important:
- Keep `app_port` different from your existing app port.
- Keep `app_name` unique to avoid touching any existing service.

## 2. Deploy

```bash
terraform init
terraform plan
terraform apply
```

## 3. Verify on server

```bash
sudo systemctl status mirrorme
sudo nginx -t
curl -I http://<your-app-domain>
```

## Notes

- This setup expects Node.js and npm to already exist on the server.
- It installs `git` and `nginx` only if missing.
- It refuses to deploy if `app_root` is non-empty and not a git repo (safety guard).
- Existing app configs are not removed or overwritten.

