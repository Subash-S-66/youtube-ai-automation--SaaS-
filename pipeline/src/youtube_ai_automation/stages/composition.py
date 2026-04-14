from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import threading
import time

from youtube_ai_automation.video_creator import create_subtitles_from_script, render_vertical_video
from youtube_ai_automation.utils.logger import StageLogger


@dataclass
class CompositionStageResult:
    video_path: str
    subtitle_path: str
    warnings: list[str]


def _parse_positive_int_env(name: str, fallback: int, minimum: int) -> int:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return fallback
    try:
        parsed = int(float(raw))
    except Exception:
        return fallback
    return max(minimum, parsed)


def compose_scenes(
    *,
    lines: list[str],
    media_paths: list[str],
    audio_path: str,
    output_dir: Path,
    target_duration: float,
    logger: StageLogger,
) -> CompositionStageResult:
    warnings: list[str] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    script = "\n".join([line for line in lines if line.strip()])
    render_started_at = time.time()
    heartbeat_seconds = _parse_positive_int_env("COMPOSITION_HEARTBEAT_SECONDS", 30, 5)
    ffmpeg_timeout_seconds = _parse_positive_int_env("FFMPEG_COMMAND_TIMEOUT_SECONDS", 360, 30)
    logger.info(
        "composition",
        (
            f"starting render media_count={len(media_paths)} "
            f"target_duration={float(target_duration):.2f}s "
            f"ffmpeg_timeout={ffmpeg_timeout_seconds}s"
        ),
    )

    subtitle_path = output_dir / "subtitles.ass"
    try:
        create_subtitles_from_script(
            script=script,
            estimated_duration_seconds=max(1.0, float(target_duration)),
            subtitle_path=subtitle_path,
            line_mode=True,
        )
    except Exception as exc:
        warnings.append(f"subtitle_error:{str(exc)[:140]}")
        logger.warn("composition", f"subtitle generation failed: {str(exc)[:120]}")

    video_path = output_dir / "final_full.mp4"
    stop_heartbeat = threading.Event()

    def _heartbeat() -> None:
        while not stop_heartbeat.wait(heartbeat_seconds):
            elapsed = time.time() - render_started_at
            logger.info(
                "composition",
                f"render in progress elapsed={elapsed:.0f}s media_count={len(media_paths)}",
            )

    heartbeat_thread = threading.Thread(
        target=_heartbeat,
        name="composition-heartbeat",
        daemon=True,
    )

    try:
        heartbeat_thread.start()
        render_vertical_video(
            media_paths=[Path(p) for p in media_paths if p],
            audio_path=Path(audio_path),
            subtitle_path=subtitle_path if subtitle_path.exists() else None,
            output_path=video_path,
            target_duration_seconds=max(1.0, float(target_duration)),
            ffmpeg_timeout_seconds=float(ffmpeg_timeout_seconds),
        )
        elapsed = time.time() - render_started_at
        logger.info("composition", f"render completed output={video_path} elapsed={elapsed:.2f}s")
    except Exception as exc:
        primary_error = str(exc)
        warnings.append(f"render_error:{primary_error[:180]}")
        logger.warn("composition", f"primary render failed, retrying safe fallback: {primary_error[:160]}")

        # Safe fallback: render with generated background only so upload can continue
        # even when downloaded media is corrupted or incompatible.
        fallback_video_path = output_dir / "final_full_fallback.mp4"
        try:
            render_vertical_video(
                media_paths=[],
                audio_path=Path(audio_path),
                subtitle_path=subtitle_path if subtitle_path.exists() else None,
                output_path=fallback_video_path,
                target_duration_seconds=max(1.0, float(target_duration)),
                ffmpeg_timeout_seconds=float(ffmpeg_timeout_seconds),
            )
            warnings.append("render_media_fallback_applied")
            video_path = fallback_video_path
            elapsed = time.time() - render_started_at
            logger.info("composition", f"fallback render completed output={video_path} elapsed={elapsed:.2f}s")
        except Exception as fallback_exc:
            warnings.append(f"render_fallback_error:{str(fallback_exc)[:180]}")
            logger.error("composition", f"render fallback failed: {str(fallback_exc)[:180]}")
            return CompositionStageResult(video_path="", subtitle_path=str(subtitle_path), warnings=warnings)
    finally:
        stop_heartbeat.set()
        if heartbeat_thread.is_alive():
            heartbeat_thread.join(timeout=1.0)

    return CompositionStageResult(video_path=str(video_path), subtitle_path=str(subtitle_path), warnings=warnings)

