#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.codespaces/pids"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found at $PID_FILE"
  exit 0
fi

# shellcheck disable=SC1090
source "$PID_FILE"

for pid in "${BACKEND_PID:-}" "${WORKER_PID:-}"; do
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" || true
  fi
done

rm -f "$PID_FILE"
echo "Stopped backend/worker and removed PID file."

