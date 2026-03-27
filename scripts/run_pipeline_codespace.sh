#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.codespaces/runtime_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.codespaces/runtime_env.sh"
fi

export PYTHONPATH="${PYTHONPATH:-$ROOT_DIR/pipeline/src}"
export RUN_MODE="${RUN_MODE:-prepared}"
export RUN_COUNT="${RUN_COUNT:-1}"

python -m youtube_ai_automation.azure_job_runner
