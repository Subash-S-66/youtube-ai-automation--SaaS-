from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from youtube_ai_automation.video_creator import create_subtitles_from_script, render_vertical_video
from youtube_ai_automation.utils.logger import StageLogger


@dataclass
class CompositionStageResult:
    video_path: str
    subtitle_path: str
    warnings: list[str]


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
    logger.info(
        "composition",
        f"starting render media_count={len(media_paths)} target_duration={float(target_duration):.2f}s",
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
    try:
        render_vertical_video(
            media_paths=[Path(p) for p in media_paths if p],
            audio_path=Path(audio_path),
            subtitle_path=subtitle_path if subtitle_path.exists() else None,
            output_path=video_path,
            target_duration_seconds=max(1.0, float(target_duration)),
        )
        logger.info("composition", f"render completed output={video_path}")
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
            )
            warnings.append("render_media_fallback_applied")
            video_path = fallback_video_path
            logger.info("composition", f"fallback render completed output={video_path}")
        except Exception as fallback_exc:
            warnings.append(f"render_fallback_error:{str(fallback_exc)[:180]}")
            logger.error("composition", f"render fallback failed: {str(fallback_exc)[:180]}")
            return CompositionStageResult(video_path="", subtitle_path=str(subtitle_path), warnings=warnings)

    return CompositionStageResult(video_path=str(video_path), subtitle_path=str(subtitle_path), warnings=warnings)

