from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from youtube_ai_automation.config import GEMINI_API_KEY, OUTPUT_DIR
from youtube_ai_automation.core.orchestrator import run_orchestrated_pipeline
from youtube_ai_automation.main import _run_network_preflight, run_full_pipeline, run_prepared_pipeline
from youtube_ai_automation.services.webhook_service import send_pipeline_complete

LOGGER = logging.getLogger("execution_runner")
SUPPORTED_MODES = {"full", "prepared"}


@dataclass(frozen=True)
class JobContext:
    job_id: str
    mode: str
    start_time: float


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run pipeline job")
    parser.add_argument("--jobId", dest="job_id", default="", help="Job id")
    parser.add_argument("--mode", dest="mode", default="", choices=sorted(SUPPORTED_MODES), help="Run mode")
    parser.add_argument("--count", dest="count", type=int, default=None, help="Run count")
    parser.add_argument("--payload", dest="payload", default="", help="Inline JSON payload")
    parser.add_argument("--payload-file", dest="payload_file", default="", help="Path to payload JSON file")
    return parser


def _log(ctx: JobContext, stage: str, message: str, level: str = "info") -> None:
    fn = getattr(LOGGER, level, LOGGER.info)
    fn("[%s][%s] %s", ctx.job_id, stage.upper(), message)


def _build_safe_output(job_id: str, mode: str, *, status: str = "FAILED", warnings: list[str] | None = None) -> dict[str, Any]:
    return {
        "jobId": job_id,
        "status": status,
        "content": {"script": "", "captions": [], "hashtags": []},
        "media": [],
        "audio": {"path": "", "duration": 0.0},
        "metadata": {
            "provider_used": "none",
            "duration": 0.0,
            "warnings": warnings or [],
            "mode": mode,
        },
    }


def ensure_output_contract(output: dict[str, Any] | None, *, job_id: str, mode: str) -> dict[str, Any]:
    safe = _build_safe_output(job_id, mode)
    data = output if isinstance(output, dict) else {}

    safe["jobId"] = str(data.get("jobId") or job_id)
    safe["status"] = "COMPLETED" if str(data.get("status", "")).upper() == "COMPLETED" else "FAILED"

    content = data.get("content") if isinstance(data.get("content"), dict) else {}
    safe["content"] = {
        "script": str(content.get("script", "")),
        "captions": content.get("captions") if isinstance(content.get("captions"), list) else [],
        "hashtags": content.get("hashtags") if isinstance(content.get("hashtags"), list) else [],
    }

    safe["media"] = data.get("media") if isinstance(data.get("media"), list) else []

    audio = data.get("audio") if isinstance(data.get("audio"), dict) else {}
    safe["audio"] = {
        "path": str(audio.get("path", "")),
        "duration": float(audio.get("duration", 0.0) or 0.0),
    }

    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    safe["metadata"] = {
        "provider_used": str(metadata.get("provider_used", "none")),
        "duration": float(metadata.get("duration", 0.0) or 0.0),
        "warnings": metadata.get("warnings") if isinstance(metadata.get("warnings"), list) else [],
        "mode": str(metadata.get("mode", mode)),
    }
    # Preserve metadata extras used by backend completion checks and diagnostics.
    for key in (
        "video_path",
        "subtitle_path",
        "youtube_video_id",
        "video_url",
        "upload_requested",
        "jobContext",
        "publish_at",
    ):
        if key in metadata:
            safe["metadata"][key] = metadata.get(key)

    # Preserve commonly consumed top-level fields for backward compatibility.
    youtube_video_id = str(
        data.get("youtubeVideoId")
        or metadata.get("youtube_video_id", "")
        or ""
    ).strip()
    video_url = str(
        data.get("videoUrl")
        or metadata.get("video_url", "")
        or ""
    ).strip()
    if youtube_video_id:
        safe["youtubeVideoId"] = youtube_video_id
    if video_url:
        safe["videoUrl"] = video_url
    return safe


def resolve_job_id(args: argparse.Namespace) -> str:
    job_id = str(args.job_id or os.getenv("JOB_ID", "")).strip()
    if not job_id:
        raise ValueError("Missing required jobId. Provide --jobId or JOB_ID.")
    return job_id


def resolve_mode(args: argparse.Namespace) -> str:
    mode = str(args.mode or os.getenv("RUN_MODE", "full")).strip().lower()
    if not mode:
        mode = "full"
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported mode '{mode}'. Supported modes: full, prepared.")
    return mode


def resolve_count(args: argparse.Namespace) -> int:
    if args.count is not None:
        return max(1, int(args.count))
    raw = str(os.getenv("RUN_COUNT", "1")).strip()
    try:
        return max(1, int(raw))
    except Exception:
        return 1


def resolve_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload_raw = ""
    if args.payload_file:
        payload_raw = Path(args.payload_file).read_text(encoding="utf-8")
    elif args.payload:
        payload_raw = args.payload
    else:
        payload_raw = str(os.getenv("PIPELINE_PAYLOAD", "")).strip()

    if not payload_raw:
        raise ValueError("Missing required input payload. Provide --payload/--payload-file or PIPELINE_PAYLOAD.")

    try:
        payload = json.loads(payload_raw)
    except Exception as exc:
        raise ValueError(f"Invalid payload JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object.")

    if not isinstance(payload.get("input"), dict):
        topic = str(payload.get("topic", "")).strip()
        style = str(payload.get("style", "")).strip()
        duration_raw = (
            payload.get("targetDuration")
            or (payload.get("videoConfig", {}).get("targetDuration") if isinstance(payload.get("videoConfig"), dict) else None)
            or payload.get("duration")
        )
        duration = None
        try:
            if duration_raw is not None:
                duration = int(duration_raw)
        except Exception:
            duration = None

        # Backward-compatible normalization for legacy worker payloads.
        if topic or style or duration is not None:
            payload["input"] = {
                "topic": topic,
                "style": style,
                "duration": duration if duration is not None else 60,
                "options": payload.get("options") if isinstance(payload.get("options"), dict) else {},
            }

    if not isinstance(payload.get("input"), dict):
        raise ValueError("Payload must include input object: {\"input\": {...}}")
    return payload


def validate_env(ctx: JobContext) -> None:
    if not GEMINI_API_KEY:
        _log(ctx, "env", "GEMINI_API_KEY is missing", "error")
        raise ValueError("GEMINI_API_KEY is required.")
    if not os.getenv("PEXELS_API_KEY", "").strip():
        _log(ctx, "env", "PEXELS_API_KEY not set (optional); media fallback may be used", "warning")


def validate_mode_inputs(ctx: JobContext) -> None:
    if ctx.mode != "prepared":
        return
    prepared_path = Path(os.getenv("PREPARED_RESULT_PATH", str(OUTPUT_DIR / "prepared_result.json")))
    if not prepared_path.exists():
        raise FileNotFoundError(
            f"RUN_MODE=prepared requires prepared payload file at '{prepared_path}'."
        )


def execute_pipeline(
    *,
    ctx: JobContext,
    payload: dict[str, Any],
    count: int,
    upload: bool,
    publish_at: str | None,
    timeout_seconds: int,
    use_orchestrator: bool,
) -> dict[str, Any]:
    start = time.time()
    payload = dict(payload)
    payload["jobId"] = ctx.job_id

    _log(ctx, "startup", f"mode={ctx.mode} count={count} upload={upload}")
    _run_network_preflight(check_trend_sources=False, upload=upload)

    result: dict[str, Any] | None = None

    if use_orchestrator:
        _log(ctx, "pipeline", "dispatching orchestrated pipeline")
        result = run_orchestrated_pipeline(
            payload=payload,
            upload=upload,
            mode=ctx.mode,
            publish_at=publish_at,
            timeout_seconds=timeout_seconds,
        ).payload
    else:
        _log(ctx, "pipeline", "dispatching legacy pipeline")
        if ctx.mode == "full":
            run_full_pipeline(payload=payload, upload=upload, publish_at=publish_at, count=count)
        else:
            run_prepared_pipeline(payload=payload, upload=upload, publish_at=publish_at, count=count)
        elapsed = round(time.time() - start, 2)
        result = _build_safe_output(
            ctx.job_id,
            ctx.mode,
            status="COMPLETED",
            warnings=["legacy_pipeline_no_structured_result"],
        )
        result["metadata"]["duration"] = elapsed

    safe = ensure_output_contract(result, job_id=ctx.job_id, mode=ctx.mode)
    safe.setdefault("metadata", {})["jobContext"] = {
        "jobId": ctx.job_id,
        "mode": ctx.mode,
        "startTime": ctx.start_time,
    }
    return safe


def send_result_webhook(ctx: JobContext, result: dict[str, Any]) -> None:
    try:
        _log(ctx, "webhook", "sending completion webhook")
        send_pipeline_complete({"jobId": ctx.job_id, "status": result.get("status", "FAILED"), "result": result})
    except Exception as exc:
        _log(ctx, "webhook", f"failed: {exc}", "warning")


def emit_output(result: dict[str, Any]) -> None:
    print(f"PIPELINE_OUTPUT_JSON:{json.dumps(result, ensure_ascii=False)}")
