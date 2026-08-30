#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SSH_HOST="${SSH_HOST:-root@94.237.73.190}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_agnive_vps_new}"
REMOTE_DIR="${REMOTE_DIR:-/opt/agnee}"
SSH_ARGS=(-i "$SSH_KEY" -o BatchMode=yes)

command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }
test -f "$SSH_KEY" || { echo "SSH key not found: $SSH_KEY" >&2; exit 1; }

rsync -az --delete \
  --exclude '.env' --exclude 'node_modules' --exclude 'data' --exclude '.git' \
  -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$PROJECT_DIR/" "$SSH_HOST:$REMOTE_DIR/"

ssh "${SSH_ARGS[@]}" "$SSH_HOST" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -Eeuo pipefail
cd "$REMOTE_DIR"
chmod +x scripts/server.sh scripts/deploy-radmond.sh
./scripts/server.sh init
docker compose up -d --build

install -d -m 755 /var/www/letsencrypt
install -m 644 deploy/nginx/agnee-bootstrap.conf /etc/nginx/sites-available/agnee
ln -sfn /etc/nginx/sites-available/agnee /etc/nginx/sites-enabled/agnee
nginx -t
systemctl reload nginx

if [[ ! -f /etc/letsencrypt/live/agnee.agnive.co/fullchain.pem ]]; then
  certbot certonly --webroot -w /var/www/letsencrypt --non-interactive --agree-tos \
    --cert-name agnee.agnive.co \
    -d agnee.agnive.co -d app.agnee.agnive.co -d mcp.agnee.agnive.co
fi

install -m 644 deploy/nginx/agnee.conf /etc/nginx/sites-available/agnee
nginx -t
systemctl reload nginx
docker compose ps
REMOTE

echo "Deployment complete: https://app.agnee.agnive.co and https://mcp.agnee.agnive.co/mcp"
