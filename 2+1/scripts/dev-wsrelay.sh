#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RELAY_PORT="${RELAY_PORT:-8787}"
export PORT="${PORT:-$RELAY_PORT}"
export VITE_NETWORK_TRANSPORT="${VITE_NETWORK_TRANSPORT:-wsrelay}"
export VITE_WS_RELAY_URL="${VITE_WS_RELAY_URL:-ws://localhost:${PORT}}"

cleanup() {
  if [ -n "${RELAY_PID:-}" ] && kill -0 "$RELAY_PID" >/dev/null 2>&1; then
    kill "$RELAY_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "$APP_DIR"

if [ ! -d "relay-server/node_modules/ws" ]; then
  echo "[dev:wsrelay] installing relay dependencies"
  npm --prefix relay-server install
fi

echo "[dev:wsrelay] starting relay on port ${PORT}"
pnpm relay:dev &
RELAY_PID=$!

sleep 1

echo "[dev:wsrelay] app env: VITE_NETWORK_TRANSPORT=${VITE_NETWORK_TRANSPORT}"
echo "[dev:wsrelay] app env: VITE_WS_RELAY_URL=${VITE_WS_RELAY_URL}"

echo "[dev:wsrelay] starting Vite dev server"
pnpm dev
