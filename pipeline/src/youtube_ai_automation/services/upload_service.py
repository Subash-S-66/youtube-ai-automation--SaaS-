from pathlib import Path
from youtube_ai_automation.youtube_uploader import upload_video as _upload_video

def upload_video(video_path: Path, title: str, description: str, tags: list[str], client_secret_file: str, token_path: Path, **kwargs):
    return _upload_video(
        video_path=video_path,
        title=title,
        description=description,
        tags=tags,
        client_secret_file=client_secret_file,
        token_path=token_path,
        **kwargs,
    )
