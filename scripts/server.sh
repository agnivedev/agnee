#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/compose.yml"
ENV_FILE="$PROJECT_DIR/.env"
QR_FILE="${QR_FILE:-/tmp/agnee-whatsapp-qr.png}"
BASE_URL="${BASE_URL:-http://127.0.0.1:4100}"

cd "$PROJECT_DIR"

usage() {
  cat <<'USAGE'
Usage: ./scripts/server.sh <command> [arguments]

Commands:
  init                         Create .env with random app and MCP secrets
  up                           Build and start the app plus MCP
  status                       Show container and WhatsApp status
  qr                           Save the current pairing QR as a PNG
  mcp-test                     Test auth, discovery, tools, and a real read
  send <number> <message...>   Send a test message
  logs                         Follow app and MCP logs
  restart                      Restart the app and MCP
  down                         Stop the adapter
  check                        Validate required server commands and files

Examples:
  ./scripts/server.sh init
  ./scripts/server.sh up
  ./scripts/server.sh qr
  ./scripts/server.sh send 081234567890 "Halo dari Agnee"
USAGE
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

check_requirements() {
  require_command docker
  require_command curl
  require_command openssl
  require_command python3

  docker compose version >/dev/null

  test -f "$COMPOSE_FILE" || {
    echo "Missing compose file: $COMPOSE_FILE" >&2
    exit 1
  }

  echo "Server requirements look good."
}

read_api_key() {
  if [[ -n "${API_KEY:-}" ]]; then
    printf '%s' "$API_KEY"
    return
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing .env. Run: ./scripts/server.sh init" >&2
    exit 1
  fi

  local value
  value="$(sed -n 's/^API_KEY=//p' "$ENV_FILE" | head -n 1)"
  value="${value%\"}"
  value="${value#\"}"

  if [[ -z "$value" || "$value" == "replace-with-a-long-random-secret" ]]; then
    echo "API_KEY is not configured in .env" >&2
    exit 1
  fi

  printf '%s' "$value"
}

read_mcp_token() {
  if [[ -n "${MCP_BEARER_TOKEN:-}" ]]; then
    printf '%s' "$MCP_BEARER_TOKEN"
    return
  fi
  test -f "$ENV_FILE" || { echo "Missing .env" >&2; exit 1; }
  sed -n 's/^MCP_BEARER_TOKEN=//p' "$ENV_FILE" | head -n 1
}

initialize_env() {
  if [[ -e "$ENV_FILE" ]]; then
    echo "$ENV_FILE already exists; leaving it unchanged."
    return
  fi

  umask 077
  cp "$PROJECT_DIR/.env.example" "$ENV_FILE"

  local generated_key generated_session generated_mcp generated_oauth generated_password
  generated_key="$(openssl rand -hex 32)"
  generated_session="$(openssl rand -hex 32)"
  generated_mcp="$(openssl rand -hex 32)"
  generated_oauth="$(openssl rand -hex 32)"
  generated_password="$(openssl rand -hex 12)"

  python3 - "$ENV_FILE" "$generated_key" "$generated_session" "$generated_mcp" "$generated_oauth" "$generated_password" <<'PYTHON'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
replacements = {
    "API_KEY": sys.argv[2],
    "SESSION_SECRET": sys.argv[3],
    "MCP_BEARER_TOKEN": sys.argv[4],
    "MCP_OAUTH_SIGNING_SECRET": sys.argv[5],
    "ADMIN_PASSWORD": sys.argv[6],
}
text = path.read_text()
for name, value in replacements.items():
    text = re.sub(rf"^{name}=.*$", f"{name}={value}", text, flags=re.MULTILINE)
path.write_text(text)
PYTHON

  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with permission 600."
}

test_mcp() {
  local mcp_url="${MCP_URL:-http://127.0.0.1:4200/mcp}"
  local mcp_token
  mcp_token="$(read_mcp_token)"
  MCP_URL="$mcp_url" MCP_BEARER_TOKEN="$mcp_token" node "$PROJECT_DIR/scripts/mcp-smoke.mjs"
}

api_request() {
  local path="$1"
  shift
  local key
  key="$(read_api_key)"

  curl --fail-with-body --silent --show-error \
    -H "x-api-key: $key" \
    "$@" \
    "$BASE_URL$path"
}

show_status() {
  docker compose -f "$COMPOSE_FILE" ps
  echo
  api_request /v1/whatsapp/status
  echo
}

save_qr() {
  api_request /v1/whatsapp/qr | QR_FILE="$QR_FILE" python3 -c '
import base64
import json
import os
import re
import sys

payload = json.load(sys.stdin)
data_url = payload.get("qrDataUrl")
if not data_url:
    raise SystemExit("QR is not available yet")

match = re.fullmatch(r"data:image/png;base64,(.+)", data_url)
if not match:
    raise SystemExit("Unexpected QR data format")

path = os.environ["QR_FILE"]
with open(path, "wb") as output:
    output.write(base64.b64decode(match.group(1), validate=True))
os.chmod(path, 0o600)
print(f"QR saved to {path}")
  '

  cat <<EOF
Copy it to your Mac, then open it:
  scp -i ~/.ssh/id_ed25519_agnive_vps root@agnive.co:$QR_FILE /tmp/agnee-whatsapp-qr.png
  open /tmp/agnee-whatsapp-qr.png
EOF
}

send_message() {
  local recipient="${1:-}"
  shift || true
  local text="$*"

  if [[ -z "$recipient" || -z "$text" ]]; then
    echo "Usage: ./scripts/server.sh send <number> <message...>" >&2
    exit 1
  fi

  local body
  body="$(python3 -c 'import json, sys; print(json.dumps({"to": sys.argv[1], "text": sys.argv[2]}))' "$recipient" "$text")"

  api_request /v1/messages/send \
    -X POST \
    -H 'content-type: application/json' \
    --data "$body"
  echo
}

command_name="${1:-}"
shift || true

case "$command_name" in
  init)
    check_requirements
    initialize_env
    ;;
  up)
    check_requirements
    test -f "$ENV_FILE" || initialize_env
    docker compose -f "$COMPOSE_FILE" up -d --build
    echo "Agnee app and MCP started. Open app.agnee.agnive.co or run: ./scripts/server.sh qr"
    ;;
  status)
    show_status
    ;;
  qr)
    save_qr
    ;;
  mcp-test)
    test_mcp
    ;;
  send)
    send_message "$@"
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 app mcp
    ;;
  restart)
    docker compose -f "$COMPOSE_FILE" restart app mcp
    ;;
  down)
    docker compose -f "$COMPOSE_FILE" down
    ;;
  check)
    check_requirements
    ;;
  help|-h|--help|'')
    usage
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    usage >&2
    exit 1
    ;;
esac
