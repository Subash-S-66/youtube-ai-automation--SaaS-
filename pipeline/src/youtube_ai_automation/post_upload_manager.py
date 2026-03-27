"""
Post-upload operations:
- download uploaded YouTube video
- cleanup generated local artifacts
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
import subprocess


LOGGER = logging.getLogger(__name__)


def _remove_file(path: Path) -> None:
    try:
        if path.exists() and path.is_file():
            path.unlink()
    except Exception as exc:
        LOGGER.warning("Failed deleting file %s: %s", path, exc)


def _remove_dir(path: Path) -> None:
    try:
        if path.exists() and path.is_dir():
            shutil.rmtree(path)
    except Exception as exc:
        LOGGER.warning("Failed deleting dir %s: %s", path, exc)


def _download_with_yt_dlp_module(video_id: str, output_dir: Path) -> Path | None:
    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except Exception:
        return None

    output_dir.mkdir(parents=True, exist_ok=True)
    out_tmpl = str((output_dir / f"{video_id}.%(ext)s").resolve())
    url = f"https://www.youtube.com/watch?v={video_id}"
    options = {
        "format": "best[height<=1920]/best",
        "outtmpl": out_tmpl,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with YoutubeDL(options) as ydl:
            ydl.download([url])
    except Exception:
        return None

    mp4_file = output_dir / f"{video_id}.mp4"
    if mp4_file.exists():
        return mp4_file
    alternatives = sorted(output_dir.glob(f"{video_id}.*"))
    return alternatives[0] if alternatives else None


def _download_with_yt_dlp_cli(video_id: str, output_dir: Path) -> Path | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    out_tmpl = str((output_dir / f"{video_id}.%(ext)s").resolve())
    url = f"https://www.youtube.com/watch?v={video_id}"
    cmd = [
        "yt-dlp",
        "-f",
        "best[height<=1920]/best",
        "-o",
        out_tmpl,
        url,
    ]
    try:
        subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
    except Exception:
        return None

    mp4_file = output_dir / f"{video_id}.mp4"
    if mp4_file.exists():
        return mp4_file
    alternatives = sorted(output_dir.glob(f"{video_id}.*"))
    return alternatives[0] if alternatives else None


def download_uploaded_video(video_id: str, output_dir: Path) -> Path | None:
    """
    Download uploaded video back from YouTube using yt-dlp (module or CLI).
    """
    if not video_id:
        return None
    downloaded = _download_with_yt_dlp_module(video_id=video_id, output_dir=output_dir)
    if downloaded:
        return downloaded
    return _download_with_yt_dlp_cli(video_id=video_id, output_dir=output_dir)


def cleanup_generated_files(
    output_dir: Path,
    clips_dir: Path,
    audio_path: Path,
    subtitle_path: Path,
    video_path: Path,
    keep: set[Path] | None = None,
) -> None:
    """
    Delete generated local files from recent and older runs.
    """
    keep_set = {(path.resolve() if path.exists() else path) for path in (keep or set())}

    files_to_remove = {
        video_path,
        output_dir / "short_with_audio.mp4",
        output_dir / "scenes_track.mp4",
        output_dir / "scenes_concat.txt",
        output_dir / "videos_concat.txt",
        output_dir / "images_concat.txt",
        output_dir / "subtitles.srt",
        audio_path,
        subtitle_path,
    }

    for file_path in files_to_remove:
        if file_path in keep_set:
            continue
        _remove_file(file_path)

    tmp_scene_dir = output_dir / "tmp_scenes"
    if tmp_scene_dir not in keep_set:
        _remove_dir(tmp_scene_dir)

    if clips_dir.exists():
        for clip in clips_dir.glob("*.mp4"):
            if clip in keep_set:
                continue
            _remove_file(clip)


def handle_post_upload(
    video_id: str,
    output_dir: Path,
    clips_dir: Path,
    audio_path: Path,
    subtitle_path: Path,
    video_path: Path,
    downloaded_output_dir: Path,
    download_uploaded_video_enabled: bool = True,
    cleanup_local_files_enabled: bool = True,
) -> Path | None:
    """
    Download uploaded video copy and cleanup local generated files.
    """
    downloaded_file: Path | None = None
    if download_uploaded_video_enabled:
        downloaded_file = download_uploaded_video(video_id=video_id, output_dir=downloaded_output_dir)
        if downloaded_file:
            LOGGER.info("Downloaded uploaded video copy: %s", downloaded_file)
        else:
            LOGGER.warning("Could not download uploaded video copy for id %s", video_id)

    if cleanup_local_files_enabled:
        keep_set: set[Path] = set()
        if downloaded_file:
            keep_set.add(downloaded_file)
        cleanup_generated_files(
            output_dir=output_dir,
            clips_dir=clips_dir,
            audio_path=audio_path,
            subtitle_path=subtitle_path,
            video_path=video_path,
            keep=keep_set,
        )
        LOGGER.info("Deleted local generated video/temp files after upload")

    return downloaded_file


