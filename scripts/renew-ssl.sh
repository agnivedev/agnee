#!/usr/bin/env bash
# SSL certificate renewal for agnee.agnive.co
# Run as root via cron: 0 3 * * * /path/to/renew-ssl.sh >> /var/log/agnee-ssl-renew.log 2>&1
set -euo pipefail

DOMAIN="agnee.agnive.co"
WEBROOT="/var/www/letsencrypt"

certbot renew \
  --webroot \
  --webroot-path "$WEBROOT" \
  --cert-name "$DOMAIN" \
  --non-interactive \
  --quiet \
  --post-hook "nginx -s reload"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SSL renewal check complete"
