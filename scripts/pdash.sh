#!/usr/bin/env bash
# pdash — Start the CallForge Pipeline Dashboard + cloudflared tunnel
# Usage: pdash [--no-tunnel]

set -euo pipefail

PROJ="/root/general-projects/parallel-callforge"
SERVER_SESSION="pdash-server"
TUNNEL_SESSION="pdash-tunnel"
TUNNEL_NAME="${DASHBOARD_TUNNEL_NAME:-callforge-dashboard}"
TUNNEL_ID="${DASHBOARD_TUNNEL_ID:-630126f7-276e-4912-9235-e7d68b49131f}"
TUNNEL_CREDENTIALS="${DASHBOARD_TUNNEL_CREDENTIALS:-/root/.cloudflared/630126f7-276e-4912-9235-e7d68b49131f.json}"
TUNNEL_HOSTNAME="${DASHBOARD_TUNNEL_HOSTNAME:-pdash.extermanation.com}"
TUNNEL_CONFIG=""

# Load .env file if it exists
if [ -f "$PROJ/.env" ]; then
  echo "[pdash] Loading .env..."
  set -a
  source "$PROJ/.env"
  set +a
fi

PORT="${DASHBOARD_PORT:-3847}"
TUNNEL_CONFIG="/tmp/pdash-cloudflared-${TUNNEL_ID}.yml"

ensure_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[pdash] tmux is required so the dashboard and tunnel stay alive."
    exit 1
  fi
}

replace_tmux_session() {
  local session="$1"

  if tmux has-session -t "$session" 2>/dev/null; then
    echo "[pdash] Replacing existing tmux session '$session'..."
    tmux kill-session -t "$session"
  fi
}

start_server_in_tmux() {
  echo "[pdash] Starting dashboard server in tmux session '$SERVER_SESSION'..."
  replace_tmux_session "$SERVER_SESSION"

  tmux new-session -d -s "$SERVER_SESSION" \
    "cd '$PROJ' && DASHBOARD_PORT='$PORT' npx tsx src/dashboard-server.ts 2>&1"
}

start_tunnel_in_tmux() {
  echo "[pdash] Starting named Cloudflare tunnel '$TUNNEL_NAME' in tmux session '$TUNNEL_SESSION'..."
  replace_tmux_session "$TUNNEL_SESSION"
  cat > "$TUNNEL_CONFIG" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $TUNNEL_CREDENTIALS

ingress:
  - hostname: $TUNNEL_HOSTNAME
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF

  cloudflared tunnel route dns "$TUNNEL_ID" "$TUNNEL_HOSTNAME" >/dev/null 2>&1 || true

  tmux new-session -d -s "$TUNNEL_SESSION" \
    "cloudflared tunnel --config '$TUNNEL_CONFIG' run '$TUNNEL_NAME' 2>&1"
}

wait_for_local_server() {
  local attempts="${1:-20}"
  local delay="${2:-1}"

  for ((i = 1; i <= attempts; i++)); do
    local status
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)"
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

get_tunnel_url() {
  if tmux has-session -t "$TUNNEL_SESSION" 2>/dev/null; then
    printf 'https://%s\n' "$TUNNEL_HOSTNAME"
  fi
}

wait_for_tunnel_url() {
  local attempts="${1:-15}"
  local delay="${2:-1}"
  local url=""

  for ((i = 1; i <= attempts; i++)); do
    url="$(get_tunnel_url)"
    if tunnel_url_is_healthy "$url"; then
      echo "$url"
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

tunnel_url_is_healthy() {
  local url="$1"
  [ -z "$url" ] && return 1

  local status
  status="$(curl -I -s -o /dev/null -w '%{http_code}' "$url" || true)"
  case "$status" in
    200|301|302)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Build frontend
echo "[pdash] Building dashboard frontend..."
cd "$PROJ/dashboard"
npm run build --silent 2>&1 | tail -3

ensure_tmux
cd "$PROJ"
start_server_in_tmux

if ! wait_for_local_server 20 1; then
  echo "[pdash] Dashboard server did not become healthy on port $PORT."
  echo "[pdash] Inspect logs with: tmux attach -t $SERVER_SESSION"
  exit 1
fi

# Start tunnel unless --no-tunnel
if [ "${1:-}" != "--no-tunnel" ]; then
  start_tunnel_in_tmux
  TUNNEL_URL="$(wait_for_tunnel_url 20 1 || true)"
  echo ""
  echo "=================================================="
  echo "  Dashboard ready!"
  echo "  Local:  http://localhost:$PORT"
  echo "  Server logs: tmux attach -t $SERVER_SESSION"
  if tunnel_url_is_healthy "$TUNNEL_URL"; then
    echo "  Public: $TUNNEL_URL"
  else
    echo "  Public: named tunnel not reachable yet"
  fi
  echo "  Tunnel logs: tmux attach -t $TUNNEL_SESSION"
  echo "=================================================="
else
  echo ""
  echo "=================================================="
  echo "  Dashboard ready (no tunnel)"
  echo "  Local:  http://localhost:$PORT"
  echo "  Server logs: tmux attach -t $SERVER_SESSION"
  echo "=================================================="
fi

echo ""
echo "  Stop server: tmux kill-session -t $SERVER_SESSION"
if [ "${1:-}" != "--no-tunnel" ]; then
  echo "  Stop tunnel: tmux kill-session -t $TUNNEL_SESSION"
fi
echo ""
