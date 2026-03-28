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
    except Exception as exc:
        warnings.append(f"render_error:{str(exc)[:180]}")
        logger.error("composition", f"render failed: {str(exc)[:180]}")
        return CompositionStageResult(video_path="", subtitle_path=str(subtitle_path), warnings=warnings)

    return CompositionStageResult(video_path=str(video_path), subtitle_path=str(subtitle_path), warnings=warnings)

