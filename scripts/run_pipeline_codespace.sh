#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.codespaces/runtime_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.codespaces/runtime_env.sh"
fi

JOB_ID_ARG="${1:-${JOB_ID:-}}"
RUN_MODE_ARG="${2:-${RUN_MODE:-full}}"

if [[ -z "$JOB_ID_ARG" ]]; then
  echo "Missing job id. Usage: scripts/run_pipeline_codespace.sh <jobId> [mode]" >&2
  exit 1
fi

export PYTHONPATH="${PYTHONPATH:-$ROOT_DIR/pipeline/src}"
export RUN_MODE="$RUN_MODE_ARG"
export RUN_COUNT="${RUN_COUNT:-1}"

python -m youtube_ai_automation.azure_job_runner \
  --jobId="$JOB_ID_ARG" \
  --mode="$RUN_MODE_ARG"
