#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.codespaces/runtime_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.codespaces/runtime_env.sh"
fi

mkdir -p "$ROOT_DIR/.codespaces/logs"

BACKEND_LOG="$ROOT_DIR/.codespaces/logs/backend.log"
WORKER_LOG="$ROOT_DIR/.codespaces/logs/worker.log"
PID_FILE="$ROOT_DIR/.codespaces/pids"

if [[ -f "$PID_FILE" ]]; then
  echo "Found existing PID file at $PID_FILE. Stop old processes first or remove the file."
  exit 1
fi

(
  cd backend
  npm run dev
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

(
  cd backend
  npm run worker
) >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

cat > "$PID_FILE" <<EOF
BACKEND_PID=$BACKEND_PID
WORKER_PID=$WORKER_PID
EOF

echo "Started backend (PID $BACKEND_PID) and worker (PID $WORKER_PID)."
echo "Logs:"
echo "  tail -f $BACKEND_LOG"
echo "  tail -f $WORKER_LOG"
echo "Stop:"
echo "  bash scripts/stop_codespace_stack.sh"

