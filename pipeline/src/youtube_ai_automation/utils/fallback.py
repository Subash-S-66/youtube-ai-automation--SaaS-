from __future__ import annotations

from pathlib import Path
import subprocess


def minimal_safe_script(topic: str, duration: int = 60) -> list[str]:
    safe_topic = (topic or "technology").strip() or "technology"
    return [
        f"{safe_topic.capitalize()} is reshaping the way we live and work.",
        "What feels like a small shift today becomes a massive advantage tomorrow.",
        "The real opportunity is understanding the pattern before everyone else does.",
        "This is where practical decisions start to compound in your favor.",
        "Save this and revisit it when the next wave arrives.",
    ]


def create_placeholder_video(path: Path, duration_seconds: float = 3.0) -> Path | None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s=1080x1920:d={max(1.0, float(duration_seconds)):.2f}",
            "-vf",
            "format=yuv420p",
            "-c:v",
            "libx264",
            "-an",
            str(path),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode == 0 and path.exists() and path.stat().st_size > 0:
            return path
    except Exception:
        pass
    return None


def create_silent_audio(path: Path, duration_seconds: float) -> Path | None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=24000:cl=mono",
            "-t",
            f"{max(1.0, float(duration_seconds)):.2f}",
            "-acodec",
            "pcm_s16le",
            str(path),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode == 0 and path.exists() and path.stat().st_size > 0:
            return path
    except Exception:
        pass
    return None

