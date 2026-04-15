from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from youtube_ai_automation.config import PEXELS_API_KEYS, PIXABAY_API_KEYS
from youtube_ai_automation.image_fetcher import fetch_images
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
    content_type: str = "clips",
) -> MediaStageResult:
    warnings: list[str] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    scene_queries = [s.strip() for s in scenes if str(s).strip()]
    if not scene_queries:
        scene_queries = ["technology cinematic b-roll"]

    normalized_type = str(content_type or "clips").strip().lower()
    scene_duration = max(2.0, float(target_duration) / max(1, len(scene_queries)))
    video_dir = output_dir / "clips"
    image_dir = output_dir / "images"

    image_pexels_key = pexels_key or (PEXELS_API_KEYS[0] if PEXELS_API_KEYS else "")
    image_pixabay_key = pixabay_key or (PIXABAY_API_KEYS[0] if PIXABAY_API_KEYS else "")

    def _download_videos(queries: list[str]) -> list[Path]:
        return download_scene_videos(
            scenes=queries,
            output_dir=video_dir,
            pexels_key=pexels_key or "",
            pexels_keys=PEXELS_API_KEYS,
            pixabay_key=pixabay_key or "",
            pixabay_keys=PIXABAY_API_KEYS,
            scene_duration=scene_duration,
            min_resolution=360,
            clips_per_scene_min=1,
            clips_per_scene_max=1,
            job_id=job_id,
        )

    def _download_images(queries: list[str]) -> list[Path]:
        images: list[Path] = []
        seen_paths: set[str] = set()
        for idx, query in enumerate(queries, start=1):
            scene_dir = image_dir / f"scene_{idx:03d}"
            try:
                fetched = fetch_images(
                    query=query,
                    output_dir=scene_dir,
                    count=1,
                    pexels_key=image_pexels_key,
                    pixabay_key=image_pixabay_key,
                )
                for item in fetched:
                    key = str(item)
                    if key in seen_paths:
                        continue
                    seen_paths.add(key)
                    images.append(item)
                if fetched:
                    continue
            except Exception as exc:
                warnings.append(f"media_image_error:{str(exc)[:180]}")
                logger.warn("media", f"image fetch failed for '{query}': {str(exc)[:120]}")

            placeholder = create_placeholder_video(scene_dir / f"image_fallback_{idx:03d}.mp4", duration_seconds=3.0)
            if placeholder:
                images.append(placeholder)
        return images

    def _download_mixed(queries: list[str]) -> list[Path]:
        mixed: list[Path] = []
        seen_paths: set[str] = set()
        for idx, query in enumerate(queries, start=1):
            clip_items: list[Path] = []
            image_items: list[Path] = []
            try:
                clip_items = _download_videos([query])
            except Exception as exc:
                warnings.append(f"media_clip_error:{str(exc)[:180]}")
                logger.warn("media", f"mixed clip fetch failed for '{query}': {str(exc)[:120]}")
            scene_dir = image_dir / f"scene_{idx:03d}"
            try:
                image_items = fetch_images(
                    query=query,
                    output_dir=scene_dir,
                    count=1,
                    pexels_key=image_pexels_key,
                    pixabay_key=image_pixabay_key,
                )
            except Exception as exc:
                warnings.append(f"media_image_error:{str(exc)[:180]}")
                logger.warn("media", f"mixed image fetch failed for '{query}': {str(exc)[:120]}")

            for item in clip_items + image_items:
                key = str(item)
                if key in seen_paths:
                    continue
                seen_paths.add(key)
                mixed.append(item)

            if not clip_items and not image_items:
                placeholder = create_placeholder_video(output_dir / f"mixed_fallback_{idx:03d}.mp4", duration_seconds=3.0)
                if placeholder:
                    mixed.append(placeholder)
        return mixed

    media_paths: list[Path] = []
    try:
        if normalized_type == "clips":
            media_paths = retry_with_backoff(lambda: _download_videos(scene_queries), attempts=3, base_delay=1.0)
        elif normalized_type == "images":
            media_paths = _download_images(scene_queries)
        elif normalized_type == "mixed":
            media_paths = _download_mixed(scene_queries)
        else:
            warnings.append(f"media_unknown_content_type:{normalized_type}")
            media_paths = _download_mixed(scene_queries)
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

