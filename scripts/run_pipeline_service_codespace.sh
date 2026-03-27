#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.codespaces/runtime_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.codespaces/runtime_env.sh"
fi

export PIPELINE_SERVICE_PORT="${PIPELINE_SERVICE_PORT:-8090}"
export PIPELINE_SERVICE_HOST="${PIPELINE_SERVICE_HOST:-0.0.0.0}"
export PIPELINE_PYTHON_CMD="${PIPELINE_PYTHON_CMD:-python}"

python pipeline/scripts/run_pipeline_service.py

