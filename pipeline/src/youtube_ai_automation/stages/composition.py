from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
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


def _render_emergency_video(
    *,
    audio_path: Path,
    output_path: Path,
    target_duration: float,
    timeout_seconds: int,
) -> None:
    duration = max(1.0, float(target_duration))
    timeout = max(20, int(timeout_seconds))

    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x0B1020:s=1080x1920:r=30",
    ]

    has_audio = audio_path.exists() and audio_path.is_file()
    if has_audio:
        command.extend([
            "-stream_loop",
            "-1",
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
        ])
    else:
        command.extend([
            "-map",
            "0:v:0",
        ])

    command.extend([
        "-t",
        f"{duration:.2f}",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
    ])

    if has_audio:
        command.extend(["-c:a", "aac", "-shortest"])

    command.append(str(output_path))

    proc = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        stderr_text = (proc.stderr or "").strip()
        if len(stderr_text) > 300:
            stderr_text = f"{stderr_text[:150]} ... {stderr_text[-150:]}"
        raise RuntimeError(
            f"emergency render failed (exit={proc.returncode}) {stderr_text or '<no stderr>'}"
        )


def compose_scenes(
    *,
    lines: list[str],
    media_paths: list[str],
    audio_path: str,
    output_dir: Path,
    target_duration: float,
    logger: StageLogger,
    max_render_budget_seconds: float | None = None,
) -> CompositionStageResult:
    warnings: list[str] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    script = "\n".join([line for line in lines if line.strip()])
    render_started_at = time.time()
    heartbeat_seconds = _parse_positive_int_env("COMPOSITION_HEARTBEAT_SECONDS", 30, 5)
    ffmpeg_timeout_seconds = _parse_positive_int_env("FFMPEG_COMMAND_TIMEOUT_SECONDS", 360, 30)
    render_budget_seconds = None
    if max_render_budget_seconds is not None:
        try:
            render_budget_seconds = max(12, int(float(max_render_budget_seconds)))
        except Exception:
            render_budget_seconds = None
    if render_budget_seconds is not None:
        ffmpeg_timeout_seconds = max(12, min(ffmpeg_timeout_seconds, render_budget_seconds))
    logger.info(
        "composition",
        (
            f"starting render media_count={len(media_paths)} "
            f"target_duration={float(target_duration):.2f}s "
            f"ffmpeg_timeout={ffmpeg_timeout_seconds}s"
            f" budget={render_budget_seconds if render_budget_seconds is not None else 'none'}s"
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
            if render_budget_seconds is not None and elapsed >= render_budget_seconds:
                logger.warn(
                    "composition",
                    f"render budget reached elapsed={elapsed:.0f}s budget={render_budget_seconds}s",
                )
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
        fallback_ffmpeg_timeout_seconds = max(30, min(ffmpeg_timeout_seconds, 90))
        if render_budget_seconds is not None:
            remaining_budget = max(12, render_budget_seconds - int(time.time() - render_started_at) - 5)
            fallback_ffmpeg_timeout_seconds = min(fallback_ffmpeg_timeout_seconds, remaining_budget)
        try:
            render_vertical_video(
                media_paths=[],
                audio_path=Path(audio_path),
                subtitle_path=None,
                output_path=fallback_video_path,
                target_duration_seconds=max(1.0, float(target_duration)),
                ffmpeg_timeout_seconds=float(fallback_ffmpeg_timeout_seconds),
            )
            warnings.append("render_media_fallback_applied")
            warnings.append("render_fallback_without_subtitles")
            video_path = fallback_video_path
            elapsed = time.time() - render_started_at
            logger.info("composition", f"fallback render completed output={video_path} elapsed={elapsed:.2f}s")
        except Exception as fallback_exc:
            warnings.append(f"render_fallback_error:{str(fallback_exc)[:180]}")
            logger.error("composition", f"render fallback failed: {str(fallback_exc)[:180]}")

            emergency_video_path = output_dir / "final_full_emergency.mp4"
            emergency_timeout_seconds = max(30, min(fallback_ffmpeg_timeout_seconds, 60))
            if render_budget_seconds is not None:
                remaining_budget = max(12, render_budget_seconds - int(time.time() - render_started_at) - 2)
                emergency_timeout_seconds = min(emergency_timeout_seconds, remaining_budget)
            try:
                _render_emergency_video(
                    audio_path=Path(audio_path),
                    output_path=emergency_video_path,
                    target_duration=max(1.0, float(target_duration)),
                    timeout_seconds=emergency_timeout_seconds,
                )
                warnings.append("render_emergency_output_applied")
                warnings.append("render_emergency_without_subtitles")
                video_path = emergency_video_path
                elapsed = time.time() - render_started_at
                logger.warn(
                    "composition",
                    f"emergency render completed output={video_path} elapsed={elapsed:.2f}s",
                )
            except Exception as emergency_exc:
                warnings.append(f"render_emergency_error:{str(emergency_exc)[:180]}")
                logger.error("composition", f"emergency render failed: {str(emergency_exc)[:180]}")
                return CompositionStageResult(video_path="", subtitle_path=str(subtitle_path), warnings=warnings)
    finally:
        stop_heartbeat.set()
        if heartbeat_thread.is_alive():
            heartbeat_thread.join(timeout=1.0)

    return CompositionStageResult(video_path=str(video_path), subtitle_path=str(subtitle_path), warnings=warnings)

