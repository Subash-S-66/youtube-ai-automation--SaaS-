from pathlib import Path
from youtube_ai_automation.youtube_uploader import upload_to_youtube

def upload_video(video_path: Path, title: str, description: str, tags: list[str], client_secret_file: str, token_path: Path, **kwargs):
    return upload_to_youtube(video_path, title, description, tags, client_secret_file, token_path, **kwargs)
