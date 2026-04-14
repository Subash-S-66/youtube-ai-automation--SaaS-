from __future__ import annotations

import logging
import os
import time

from youtube_ai_automation.execution_runner import (
    JobContext,
    build_cli_parser,
    emit_output,
    execute_pipeline,
    resolve_count,
    resolve_job_id,
    resolve_mode,
    resolve_payload,
    send_result_webhook,
    validate_env,
    validate_mode_inputs,
    validate_runtime_dependencies,
    _build_safe_output,
)
from youtube_ai_automation.main import _setup_logging

LOGGER = logging.getLogger("run_azure")


def _resolve_pipeline_timeout_seconds() -> int:
    candidates: list[int] = []

    raw_seconds = str(os.getenv("PIPELINE_TIMEOUT_SECONDS", "")).strip()
    if raw_seconds:
        try:
            parsed_seconds = int(float(raw_seconds))
            if parsed_seconds > 0:
                candidates.append(parsed_seconds)
        except Exception:
            pass

    raw_timeout_ms = str(os.getenv("PIPELINE_EXECUTION_TIMEOUT_MS", "")).strip()
    if raw_timeout_ms:
        try:
            parsed_ms = int(float(raw_timeout_ms))
            if parsed_ms > 0:
                candidates.append(max(1, int((parsed_ms + 999) / 1000)))
        except Exception:
            pass

    if not candidates:
        return 480
    return max(30, min(candidates))


def main(argv: list[str] | None = None) -> dict:
    _setup_logging()
    parser = build_cli_parser()
    args = parser.parse_args(argv)

    ctx: JobContext | None = None
    result: dict
    try:
        job_id = resolve_job_id(args)
        mode = resolve_mode(args)
        ctx = JobContext(job_id=job_id, mode=mode, start_time=time.time())

        validate_env(ctx)
        validate_mode_inputs(ctx)
        validate_runtime_dependencies(ctx)

        payload = resolve_payload(args)
        count = resolve_count(args)
        upload = str(os.getenv("UPLOAD", "true")).strip().lower() in {"1", "true", "yes", "on"}
        publish_at = os.getenv("PUBLISH_AT", "").strip() or None
        timeout_seconds = _resolve_pipeline_timeout_seconds()
        LOGGER.info("[%s][RUNNER] effective timeout_seconds=%s", job_id, timeout_seconds)
        use_orchestrator = str(os.getenv("PIPELINE_ORCHESTRATOR_V2", "true")).strip().lower() in {"1", "true", "yes"}

        result = execute_pipeline(
            ctx=ctx,
            payload=payload,
            count=count,
            upload=upload,
            publish_at=publish_at,
            timeout_seconds=timeout_seconds,
            use_orchestrator=use_orchestrator,
        )
    except Exception as exc:
        job_id = ctx.job_id if ctx else str(getattr(args, "job_id", "") or os.getenv("JOB_ID", "") or "unknown")
        mode = ctx.mode if ctx else str(getattr(args, "mode", "") or os.getenv("RUN_MODE", "full") or "full").lower()
        result = _build_safe_output(job_id, mode, status="FAILED", warnings=[f"runner_error:{str(exc)[:200]}"])
        LOGGER.exception("[%s][RUNNER] failed: %s", job_id, exc)

    emit_output(result)
    if ctx:
        send_result_webhook(ctx, result)
    return result


if __name__ == "__main__":
    main()
