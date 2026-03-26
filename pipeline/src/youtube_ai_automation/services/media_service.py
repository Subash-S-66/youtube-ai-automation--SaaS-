from pathlib import Path
from youtube_ai_automation.video_fetcher import download_scene_videos
from youtube_ai_automation.image_fetcher import fetch_images

def fetch_media(scenes: list[str], output_dir: Path, pexels_key: str, pixabay_key: str, use_images: bool = False) -> list[Path]:
    if use_images:
        files: list[Path] = []
        for query in scenes:
            files.extend(
                fetch_images(
                    query=query,
                    output_dir=output_dir,
                    count=1,
                    pexels_key=pexels_key,
                    pixabay_key=pixabay_key,
                )
            )
        return files
    return download_scene_videos(scenes, output_dir, pexels_key=pexels_key, pixabay_key=pixabay_key)
