from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from youtube_ai_automation.video_fetcher import download_scene_videos
from youtube_ai_automation.utils.fallback import create_placeholder_video
from youtube_ai_automation.utils.logger import StageLogger
from youtube_ai_automation.utils.retry import retry_with_backoff


@dataclass
class MediaStageResult:
    media_paths: list[str]
    warnings: list[str]


def fetch_media(
    *,
    job_id: str,
    scenes: list[str],
    output_dir: Path,
    pexels_key: str,
    pixabay_key: str,
    target_duration: float,
    logger: StageLogger,
) -> MediaStageResult:
    warnings: list[str] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    scene_queries = [s.strip() for s in scenes if str(s).strip()]
    if not scene_queries:
        scene_queries = ["technology cinematic b-roll"]

    def _download() -> list[Path]:
        return download_scene_videos(
            scenes=scene_queries,
            output_dir=output_dir,
            pexels_key=pexels_key or "",
            pixabay_key=pixabay_key or "",
            scene_duration=max(2.0, float(target_duration) / max(1, len(scene_queries))),
            min_resolution=360,
            clips_per_scene_min=1,
            clips_per_scene_max=1,
            job_id=job_id,
        )

    media_paths: list[Path] = []
    try:
        media_paths = retry_with_backoff(_download, attempts=3, base_delay=1.0)
    except Exception as exc:
        warnings.append(f"media_provider_error:{str(exc)[:180]}")
        logger.warn("media", f"provider fetch failed after retries; using fallback ({str(exc)[:120]})")

    if not media_paths:
        placeholder = create_placeholder_video(output_dir / "fallback_scene.mp4", duration_seconds=3.0)
        if placeholder:
            media_paths = [placeholder]
            warnings.append("media_placeholder_fallback")
        else:
            warnings.append("media_empty_after_fallback")

    return MediaStageResult(media_paths=[str(p) for p in media_paths], warnings=warnings)

