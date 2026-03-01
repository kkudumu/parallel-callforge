#!/usr/bin/env bash
# pdash — Start the CallForge Pipeline Dashboard + cloudflared tunnel
# Usage: pdash [--no-tunnel]

set -e

PROJ="/root/general-projects/parallel-callforge"
PORT="${DASHBOARD_PORT:-3847}"
SERVER_PID=""
TUNNEL_SESSION="pdash-tunnel"
TUNNEL_CONFIG=""
TUNNEL_NAME="${DASHBOARD_TUNNEL_NAME:-callforge-dashboard}"
TUNNEL_ID="${DASHBOARD_TUNNEL_ID:-630126f7-276e-4912-9235-e7d68b49131f}"
TUNNEL_CREDENTIALS="${DASHBOARD_TUNNEL_CREDENTIALS:-/root/.cloudflared/630126f7-276e-4912-9235-e7d68b49131f.json}"
TUNNEL_HOSTNAME="${DASHBOARD_TUNNEL_HOSTNAME:-pdash.extermanation.com}"

# Load .env file if it exists
if [ -f "$PROJ/.env" ]; then
  echo "[pdash] Loading .env..."
  set -a
  source "$PROJ/.env"
  set +a
fi

cleanup() {
  echo ""
  echo "[pdash] Shutting down..."
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$TUNNEL_CONFIG" ] && rm -f "$TUNNEL_CONFIG" 2>/dev/null
  wait 2>/dev/null
  echo "[pdash] Done."
}
trap cleanup EXIT INT TERM

start_tunnel_in_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[pdash] tmux is required to run the tunnel persistently."
    exit 1
  fi

  echo "[pdash] Starting named Cloudflare tunnel '$TUNNEL_NAME' in tmux session '$TUNNEL_SESSION'..."

  if tmux has-session -t "$TUNNEL_SESSION" 2>/dev/null; then
    echo "[pdash] Replacing existing tmux session '$TUNNEL_SESSION'..."
    tmux kill-session -t "$TUNNEL_SESSION"
  fi

  TUNNEL_CONFIG="$(mktemp /tmp/pdash-cloudflared-XXXXXX.yml)"
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

# Start dashboard server
echo "[pdash] Starting server on port $PORT..."
cd "$PROJ"
npx tsx src/dashboard-server.ts &
SERVER_PID=$!
sleep 1

# Start tunnel unless --no-tunnel
if [ "$1" != "--no-tunnel" ]; then
  start_tunnel_in_tmux
  TUNNEL_URL="$(wait_for_tunnel_url 20 1 || true)"
  echo ""
  echo "=================================================="
  echo "  Dashboard ready! Tunnel logs: tmux attach -t $TUNNEL_SESSION"
  echo "  Local:  http://localhost:$PORT"
  if tunnel_url_is_healthy "$TUNNEL_URL"; then
    echo "  Public: $TUNNEL_URL"
  else
    echo "  Public: named tunnel not reachable yet"
  fi
  echo "=================================================="
else
  echo ""
  echo "=================================================="
  echo "  Dashboard ready (no tunnel)"
  echo "  Local:  http://localhost:$PORT"
  echo "=================================================="
fi

echo ""
echo "  Press Ctrl+C to stop."
echo ""

# Wait for server process
wait "$SERVER_PID"
