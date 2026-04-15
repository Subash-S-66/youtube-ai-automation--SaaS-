from __future__ import annotations

from dataclasses import dataclass
import json
import os
import time
from pathlib import Path
from typing import Any

from youtube_ai_automation.config import (
    CLIPS_DIR,
    OUTPUT_DIR,
    PEXELS_API_KEY,
    PIXABAY_API_KEY,
    TOKEN_PATH,
    YOUTUBE_CLIENT_SECRET_FILE,
    YOUTUBE_SCOPES,
)
from youtube_ai_automation.core.safe_execute import safe_execute
from youtube_ai_automation.services.webhook_service import send_pipeline_complete
from youtube_ai_automation.stages.audio import AudioStageResult, generate_audio
from youtube_ai_automation.stages.composition import CompositionStageResult, compose_scenes
from youtube_ai_automation.stages.media import MediaStageResult, fetch_media
from youtube_ai_automation.stages.script import ScriptStageResult, build_visual_queries, generate_script
from youtube_ai_automation.utils.logger import StageLogger
from youtube_ai_automation.youtube_uploader import upload_video


@dataclass
class PipelineResult:
    payload: dict[str, Any]


def _derive_target_duration(payload: dict[str, Any]) -> int:
    input_data = payload.get("input", {}) if isinstance(payload, dict) else {}
    if isinstance(input_data, dict):
        val = input_data.get("duration")
        if val is not None:
            try:
                return max(15, min(60, int(val)))
            except Exception:
                pass
    cfg = payload.get("videoConfig", {}) if isinstance(payload.get("videoConfig"), dict) else {}
    for key in ("targetDuration", "duration"):
        if key in cfg:
            try:
                return max(15, min(60, int(cfg.get(key))))
            except Exception:
                continue
    return 60


def _resolve_content_type(payload: dict[str, Any]) -> str:
    raw = ""
    if isinstance(payload, dict):
        if isinstance(payload.get("videoConfig"), dict):
            cfg = payload.get("videoConfig", {})
            raw = cfg.get("contentType") or cfg.get("content_type") or ""
            if not raw and isinstance(cfg.get("useImages"), bool):
                raw = "images" if cfg.get("useImages") else "clips"
        if not raw and isinstance(payload.get("input"), dict):
            options = payload.get("input", {}).get("options")
            if isinstance(options, dict):
                raw = options.get("contentType") or options.get("content_type") or ""
        if not raw:
            raw = payload.get("contentType") or payload.get("content_type") or ""
        if not raw:
            settings_env = os.getenv("SETTINGS", "")
            if settings_env:
                try:
                    settings = json.loads(settings_env)
                except Exception:
                    settings = {}
                if isinstance(settings, dict):
                    raw = settings.get("contentType") or settings.get("content_type") or ""

    normalized = str(raw or "clips").strip().lower()
    if normalized in {"clips", "images", "mixed"}:
        return normalized
    return "clips"


def _extract_scenes(payload: dict[str, Any], script_lines: list[str]) -> list[str]:
    raw_scenes: list[str] = []
    # from metadata.searchQueries if present
    meta = payload.get("metadata", []) if isinstance(payload.get("metadata"), list) else []
    if meta and isinstance(meta[0], dict):
        sq = meta[0].get("searchQueries", [])
        if isinstance(sq, list):
            raw_scenes.extend([str(x).strip() for x in sq if str(x).strip()])
    if not raw_scenes:
        raw_scenes = [line for line in script_lines[:10] if line.strip()]
    if not raw_scenes:
        raw_scenes = ["technology"]
    return build_visual_queries(raw_scenes, max_queries=10)


def run_orchestrated_pipeline(
    *,
    payload: dict[str, Any],
    upload: bool,
    mode: str,
    publish_at: str | None = None,
    timeout_seconds: int = 480,
) -> PipelineResult:
    start = time.time()
    job_id = str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip() or "unknown"
    debug = str(os.getenv("DEBUG", "false")).strip().lower() in {"1", "true", "yes"}
    logger = StageLogger(job_id=job_id, debug=debug)
    warnings: list[str] = []

    if debug:
        logger.debug_log("orchestrator", f"payload={json.dumps(payload, ensure_ascii=False)[:4000]}")

    target_duration = _derive_target_duration(payload)
    content_type = _resolve_content_type(payload)
    output_dir = OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    def timeout_guard() -> bool:
        return (time.time() - start) > max(60, int(timeout_seconds))

    def run_stage(stage_name: str, runner, fallback):
        stage_started = time.time()
        result = safe_execute(stage_name, runner, fallback, logger)
        elapsed = time.time() - stage_started
        logger.info(stage_name, f"stage completed in {elapsed:.2f}s")
        return result

    script_result = run_stage(
        "script",
        lambda: generate_script(payload, logger),
        lambda exc: ScriptStageResult(lines=[], provider_used="none", warnings=[f"script_stage_exception:{str(exc)[:140]}"], hard_failed=True),
    )
    warnings.extend(script_result.warnings)
    if script_result.hard_failed or not script_result.lines:
        result = {
            "jobId": job_id,
            "status": "FAILED",
            "content": {"script": "", "captions": [], "hashtags": []},
            "media": [],
            "audio": {"path": "", "duration": 0},
            "metadata": {
                "provider_used": script_result.provider_used,
                "duration": 0,
                "warnings": warnings + ["script_generation_complete_failure"],
            },
        }
        print(f"PIPELINE_OUTPUT_JSON:{json.dumps(result, ensure_ascii=False)}")
        return PipelineResult(payload=result)

    if timeout_guard():
        warnings.append("timeout_guard_triggered_after_script")

    audio_result = run_stage(
        "audio",
        lambda: generate_audio(script_result.lines, output_dir, target_duration, logger),
        lambda exc: AudioStageResult(path="", duration=0.0, warnings=[f"audio_stage_exception:{str(exc)[:140]}"]),
    )
    warnings.extend(audio_result.warnings)
    if timeout_guard():
        warnings.append("timeout_guard_triggered_after_audio")

    scenes = _extract_scenes(payload, script_result.lines)
    logger.info("media", f"content_type={content_type}")
    if timeout_guard():
        media_result = MediaStageResult(media_paths=[], warnings=["timeout_guard_skipped_media"])
    else:
        media_result = run_stage(
            "media",
            lambda: fetch_media(
                job_id=job_id,
                scenes=scenes,
                output_dir=CLIPS_DIR / "orchestrated",
                pexels_key=PEXELS_API_KEY or "",
                pixabay_key=PIXABAY_API_KEY or "",
                target_duration=float(target_duration),
                logger=logger,
                content_type=content_type,
            ),
            lambda exc: MediaStageResult(media_paths=[], warnings=[f"media_stage_exception:{str(exc)[:140]}"]),
        )
    warnings.extend(media_result.warnings)

    composition_result = CompositionStageResult(video_path="", subtitle_path="", warnings=[])
    if str(mode).lower() == "full" and not timeout_guard():
        elapsed_before_composition = time.time() - start
        timeout_window_seconds = max(60, int(timeout_seconds))
        remaining_budget_seconds = max(0.0, timeout_window_seconds - elapsed_before_composition)
        composition_budget_seconds = max(12.0, remaining_budget_seconds - 8.0)
        logger.info(
            "composition",
            f"pipeline timeout window={timeout_window_seconds}s elapsed={elapsed_before_composition:.2f}s remaining={remaining_budget_seconds:.2f}s budget={composition_budget_seconds:.2f}s",
        )

        composition_result = run_stage(
            "composition",
            lambda: compose_scenes(
                lines=script_result.lines,
                media_paths=media_result.media_paths,
                audio_path=audio_result.path,
                output_dir=output_dir,
                target_duration=float(target_duration),
                logger=logger,
                max_render_budget_seconds=composition_budget_seconds,
            ),
            lambda exc: CompositionStageResult(video_path="", subtitle_path="", warnings=[f"composition_stage_exception:{str(exc)[:140]}"]),
        )
        warnings.extend(composition_result.warnings)
    elif str(mode).lower() == "full":
        warnings.append("timeout_guard_skipped_composition")

    youtube_video_id = ""
    video_url = ""
    if bool(upload) and str(mode).lower() == "full" and composition_result.video_path:
        try:
            youtube_cfg = payload.get("youtube", {}) if isinstance(payload.get("youtube"), dict) else {}
            logger.info("upload", "starting upload")
            upload_result = upload_video(
                video_path=Path(composition_result.video_path),
                title=str(youtube_cfg.get("title", "Untitled Short")).strip()[:100] or "Untitled Short",
                description=str(youtube_cfg.get("description", "")).strip(),
                tags=[str(x).strip() for x in (youtube_cfg.get("hashtags") or []) if str(x).strip()],
                privacy_status="public",
                client_secret_file=str(YOUTUBE_CLIENT_SECRET_FILE),
                scopes=YOUTUBE_SCOPES,
                token_path=TOKEN_PATH,
                publish_at=publish_at,
                validate_shorts=False,
                strict_shorts_validation=False,
            )
            youtube_video_id = str(upload_result.get("id", "")).strip()
            if youtube_video_id:
                video_url = f"https://www.youtube.com/watch?v={youtube_video_id}"
            logger.info("upload", f"upload completed video_id={youtube_video_id or 'none'}")
        except Exception as exc:
            warnings.append(f"upload_error:{str(exc)[:180]}")
            logger.warn("upload", f"upload failed: {str(exc)[:160]}")

    mode_full = str(mode).lower() == "full"
    composition_failed = mode_full and not bool(composition_result.video_path)
    if composition_failed:
        warnings.append("composition_missing_video_output")
        logger.error("composition", "full mode completed without a rendered video output")

    elapsed = round(time.time() - start, 2)
    logger.info("pipeline", f"orchestrated pipeline finished status={'FAILED' if composition_failed else 'COMPLETED'} duration={elapsed:.2f}s")
    result = {
        "jobId": job_id,
        "status": "FAILED" if composition_failed else "COMPLETED",
        "content": {
            "script": "\n".join(script_result.lines),
            "captions": [{"text": line} for line in script_result.lines],
            "hashtags": payload.get("youtube", {}).get("hashtags", []) if isinstance(payload.get("youtube"), dict) else [],
        },
        "media": media_result.media_paths,
        "audio": {
            "path": audio_result.path,
            "duration": audio_result.duration,
        },
        "metadata": {
            "provider_used": script_result.provider_used,
            "duration": elapsed,
            "warnings": warnings,
            "mode": mode,
            "publish_at": publish_at or "",
            "upload_requested": bool(upload),
            "video_path": composition_result.video_path,
            "subtitle_path": composition_result.subtitle_path,
            "youtube_video_id": youtube_video_id,
            "video_url": video_url,
        },
        "youtubeVideoId": youtube_video_id,
        "videoUrl": video_url,
    }

    print(f"PIPELINE_OUTPUT_JSON:{json.dumps(result, ensure_ascii=False)}")
    try:
        send_pipeline_complete({"jobId": job_id, "status": result.get("status", "FAILED"), "result": result})
    except Exception as exc:
        logger.warn("webhook", f"pipeline-complete webhook failed: {str(exc)[:180]}")
    return PipelineResult(payload=result)
