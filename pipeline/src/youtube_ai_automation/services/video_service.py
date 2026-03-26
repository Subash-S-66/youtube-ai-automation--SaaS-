from pathlib import Path
from youtube_ai_automation.video_creator import create_scene_based_video, create_vertical_video

def create_video(media_files: list[Path], audio_path: Path, subtitle_path: Path, output_path: Path, use_images: bool = False, **kwargs) -> Path:
    if use_images:
        return create_vertical_video(media_files, audio_path, subtitle_path, output_path, **kwargs)
    return create_scene_based_video(media_files, audio_path, subtitle_path, output_path, **kwargs)
