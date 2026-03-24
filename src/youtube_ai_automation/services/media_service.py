from pathlib import Path
from youtube_ai_automation.video_fetcher import fetch_videos, download_scene_videos
from youtube_ai_automation.image_fetcher import download_images

def fetch_media(scenes: list[str], output_dir: Path, pexels_key: str, pixabay_key: str, use_images: bool = False) -> list[Path]:
    if use_images:
        return download_images(scenes, output_dir, pexels_key)
    return download_scene_videos(scenes, output_dir, pexels_key=pexels_key, pixabay_key=pixabay_key)
