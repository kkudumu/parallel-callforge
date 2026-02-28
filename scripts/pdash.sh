#!/usr/bin/env bash
# pdash — Start the CallForge Pipeline Dashboard + cloudflared tunnel
# Usage: pdash [--no-tunnel]

set -e

PROJ="/root/general-projects/parallel-callforge"
PORT="${DASHBOARD_PORT:-3847}"
TUNNEL_PID=""
SERVER_PID=""

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
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  wait 2>/dev/null
  echo "[pdash] Done."
}
trap cleanup EXIT INT TERM

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
  echo "[pdash] Starting cloudflared tunnel..."
  cloudflared tunnel --url "http://localhost:$PORT" 2>&1 &
  TUNNEL_PID=$!

  # Wait for tunnel URL to appear
  sleep 3
  echo ""
  echo "=================================================="
  echo "  Dashboard ready! Check above for tunnel URL."
  echo "  Local:  http://localhost:$PORT"
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
