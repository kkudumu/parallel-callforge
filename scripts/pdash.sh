#!/usr/bin/env bash
# pdash — Start the CallForge Pipeline Dashboard + cloudflared tunnel
# Usage: pdash [--no-tunnel]

set -e

PROJ="/root/general-projects/parallel-callforge"
PORT="${DASHBOARD_PORT:-3847}"
SERVER_PID=""
TUNNEL_SESSION="pdash-tunnel"

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
  wait 2>/dev/null
  echo "[pdash] Done."
}
trap cleanup EXIT INT TERM

start_tunnel_in_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[pdash] tmux is required to run the tunnel persistently."
    exit 1
  fi

  echo "[pdash] Starting cloudflared tunnel in tmux session '$TUNNEL_SESSION'..."

  if tmux has-session -t "$TUNNEL_SESSION" 2>/dev/null; then
    echo "[pdash] Replacing existing tmux session '$TUNNEL_SESSION'..."
    tmux kill-session -t "$TUNNEL_SESSION"
  fi

  tmux new-session -d -s "$TUNNEL_SESSION" \
    "cloudflared tunnel --url 'http://localhost:$PORT' 2>&1"
}

get_tunnel_url() {
  tmux capture-pane -pJ -t "$TUNNEL_SESSION" -S -200 2>/dev/null \
    | grep -Eo 'https://[-[:alnum:]].*\.trycloudflare\.com' \
    | tail -1
}

wait_for_tunnel_url() {
  local attempts="${1:-15}"
  local delay="${2:-1}"
  local url=""

  for ((i = 1; i <= attempts; i++)); do
    url="$(get_tunnel_url)"
    if [ -n "$url" ]; then
      echo "$url"
      return 0
    fi
    sleep "$delay"
  done

  return 1
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
  if [ -n "$TUNNEL_URL" ]; then
    echo "  Public: $TUNNEL_URL"
  else
    echo "  Public: tunnel URL not detected yet"
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
