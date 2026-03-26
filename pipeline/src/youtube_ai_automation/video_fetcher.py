"""
Download stock video clips from Pexels or Pixabay with scene-aware search.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path
import random
import shutil
import subprocess
from typing import Any

import requests

from youtube_ai_automation.clip_manager import choose_candidates, filter_candidates, mark_clip_as_used

LOGGER = logging.getLogger(__name__)


@dataclass
class DownloadedClip:
    path: Path
    source: str
    query: str
    url: str
    duration_seconds: float | None = None


def _download_file(url: str, out_file: Path) -> None:
    response = requests.get(url, timeout=45, stream=True)
    response.raise_for_status()
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def _generate_placeholder_clip(out_file: Path, duration_seconds: float) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    color_choices = ["0x111827", "0x1f2937", "0x0f172a", "0x1e293b", "0x172554"]
    color = random.choice(color_choices)
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s=1080x1920:r=30",
        "-t",
        f"{duration_seconds:.2f}",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(out_file),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def _build_fallback_scene_clips(
    scenes: list[str],
    output_dir: Path,
    scene_duration: float,
) -> list[Path]:
    local_pool = sorted(
        [
            path
            for path in output_dir.glob("*.mp4")
            if path.is_file() and "placeholder" not in path.stem.lower()
        ]
    )
    needed = max(1, len(scenes))
    if local_pool:
        reused: list[Path] = []
        for idx in range(min(needed, len(local_pool))):
            src = local_pool[idx]
            dst = output_dir / f"fallback_scene{idx + 1}.mp4"
            if src.resolve() == dst.resolve():
                reused.append(src)
                continue
            shutil.copy2(src, dst)
            reused.append(dst)

        remaining = needed - len(reused)
        if remaining > 0:
            for idx in range(remaining):
                out_path = output_dir / f"fallback_scene{len(reused) + idx + 1}_placeholder.mp4"
                _generate_placeholder_clip(out_file=out_path, duration_seconds=max(2.8, scene_duration))
                reused.append(out_path)

        LOGGER.info("Using %s fallback clips from %s", len(reused), output_dir)
        return reused

    generated: list[Path] = []
    for idx in range(needed):
        out_path = output_dir / f"scene{idx + 1}_placeholder.mp4"
        _generate_placeholder_clip(out_file=out_path, duration_seconds=max(2.8, scene_duration))
        generated.append(out_path)
    LOGGER.info("Generated %s placeholder clips in %s", len(generated), output_dir)
    return generated


def _url_key(url: str) -> str:
    return str(url).split("?", 1)[0].strip().lower()


def _merge_candidates(*candidate_lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for candidate_list in candidate_lists:
        for item in candidate_list:
            key = _url_key(str(item.get("url", "")))
            if not key:
                continue
            existing = merged.get(key)
            if not existing or float(item.get("score", 0.0)) > float(existing.get("score", 0.0)):
                merged[key] = item
    return sorted(merged.values(), key=lambda row: float(row.get("score", 0.0)), reverse=True)


def _score_option(
    width: int,
    height: int,
    duration: float,
    min_resolution: int,
    min_duration: float,
    max_duration: float,
) -> float:
    if width < min_resolution and height < min_resolution:
        return -1.0
    orientation_bonus = 18.0 if height >= width else 6.0
    resolution_score = min(55.0, (min(width, height) / max(1, min_resolution)) * 35.0)
    duration_center = (min_duration + max_duration) / 2.0
    duration_score = max(0.0, 25.0 - abs(duration - duration_center) * 6.5)
    return orientation_bonus + resolution_score + duration_score


def _best_pexels_file(video_files: list[dict[str, Any]], min_resolution: int) -> tuple[str, int, int, float] | None:
    best_url = ""
    best_width = 0
    best_height = 0
    best_score = -1.0
    for item in video_files:
        url = str(item.get("link", "")).strip()
        width = int(item.get("width", 0) or 0)
        height = int(item.get("height", 0) or 0)
        if not url:
            continue
        if width < min_resolution and height < min_resolution:
            continue
        score = (12.0 if height >= width else 4.0) + min(width, height) / 110.0
        if score > best_score:
            best_score = score
            best_url = url
            best_width = width
            best_height = height
    if not best_url:
        return None
    return best_url, best_width, best_height, best_score


from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
def _search_pexels_candidates(
    query: str,
    api_key: str,
    min_resolution: int,
    min_duration: float,
    max_duration: float,
) -> list[dict[str, Any]]:
    endpoint = "https://api.pexels.com/videos/search"
    headers = {"Authorization": api_key}
    params = {
        "query": query,
        "per_page": 40,
        "orientation": "portrait",
    }
    response = requests.get(endpoint, headers=headers, params=params, timeout=40)
    response.raise_for_status()
    payload = response.json()
    videos = payload.get("videos", [])

    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for video in videos:
        duration = float(video.get("duration", 0) or 0)
        if duration and (duration < min_duration or duration > max(12.0, max_duration * 2)):
            continue
        selected = _best_pexels_file(video.get("video_files", []), min_resolution=min_resolution)
        if not selected:
            continue
        url, width, height, _ = selected
        key = _url_key(url)
        if key in seen_urls:
            continue
        seen_urls.add(key)
        score = _score_option(
            width=width,
            height=height,
            duration=duration,
            min_resolution=min_resolution,
            min_duration=min_duration,
            max_duration=max_duration,
        )
        if score < 0:
            continue
        out.append(
            {
                "url": url,
                "source": "pexels",
                "query": query,
                "duration": duration or None,
                "width": width,
                "height": height,
                "score": score,
            }
        )
    out.sort(key=lambda row: float(row.get("score", 0.0)), reverse=True)
    return out


def _best_pixabay_file(video_obj: dict[str, Any], min_resolution: int) -> tuple[str, int, int] | None:
    sources = video_obj.get("videos", {})
    ranked_keys = ["large", "medium", "small", "tiny"]
    for key in ranked_keys:
        src = sources.get(key, {})
        width = int(src.get("width", 0) or 0)
        height = int(src.get("height", 0) or 0)
        url = src.get("url")
        if not url:
            continue
        if width < min_resolution and height < min_resolution:
            continue
        return str(url), width, height
    return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
def _search_pixabay_candidates(
    query: str,
    api_key: str,
    min_resolution: int,
    min_duration: float,
    max_duration: float,
) -> list[dict[str, Any]]:
    endpoint = "https://pixabay.com/api/videos/"
    params = {
        "key": api_key,
        "q": query,
        "per_page": 40,
        "order": "popular",
    }
    response = requests.get(endpoint, params=params, timeout=40)
    response.raise_for_status()
    payload = response.json()
    hits = payload.get("hits", [])

    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in hits:
        duration = float(item.get("duration", 0) or 0)
        if duration and (duration < min_duration or duration > max(12.0, max_duration * 2)):
            continue
        best = _best_pixabay_file(item, min_resolution=min_resolution)
        if not best:
            continue
        video_url, width, height = best
        key = _url_key(video_url)
        if key in seen_urls:
            continue
        seen_urls.add(key)
        score = _score_option(
            width=width,
            height=height,
            duration=duration,
            min_resolution=min_resolution,
            min_duration=min_duration,
            max_duration=max_duration,
        )
        if score < 0:
            continue
        out.append(
            {
                "url": video_url,
                "source": "pixabay",
                "query": query,
                "duration": duration or None,
                "width": width,
                "height": height,
                "score": score,
            }
        )
    out.sort(key=lambda row: float(row.get("score", 0.0)), reverse=True)
    return out


def download_scene_videos(
    scenes: list[str],
    output_dir: Path,
    pexels_key: str = "",
    pixabay_key: str = "",
    scene_duration: float = 4.0,
    min_resolution: int = 720,
    used_clips_file: Path | None = None,
    clips_per_scene_min: int = 1,
    clips_per_scene_max: int = 2,
) -> list[Path]:
    """
    Download one clip per scene based on scene descriptions.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    used_file = used_clips_file or (output_dir.parent / "used_clips.json")
    all_paths: list[Path] = []
    selected_urls: set[str] = set()
    min_duration = max(2.0, scene_duration - 1.0)
    max_duration = max(6.0, scene_duration + 3.0)
    effective_min_resolution = max(720, int(min_resolution))
    min_per_scene = max(1, int(clips_per_scene_min))
    max_per_scene = max(min_per_scene, int(clips_per_scene_max))

    import os
    from youtube_ai_automation.clip_tracker import ClipTracker
    clip_tracker = ClipTracker(os.getenv("MONGO_URI"))
    mongo_used_clips = clip_tracker.get_used_clips()

    from concurrent.futures import ThreadPoolExecutor

    # Need a lock for thread-safe operations on shared collections
    import threading
    lock = threading.Lock()

    def process_scene(idx: int, scene: str) -> list[Path]:
        local_paths = []
        query = " ".join(scene.split())[:90]
        pexels_candidates: list[dict[str, Any]] = []
        pixabay_candidates: list[dict[str, Any]] = []

        if pexels_key:
            try:
                pexels_candidates.extend(
                    _search_pexels_candidates(
                        query=query,
                        api_key=pexels_key,
                        min_resolution=effective_min_resolution,
                        min_duration=min_duration,
                        max_duration=max_duration,
                    )
                )
            except Exception as exc:
                LOGGER.debug("Pexels source unavailable for scene %s: %s", idx, exc)

        if pixabay_key:
            try:
                pixabay_candidates.extend(
                    _search_pixabay_candidates(
                        query=query,
                        api_key=pixabay_key,
                        min_resolution=effective_min_resolution,
                        min_duration=min_duration,
                        max_duration=max_duration,
                    )
                )
            except Exception as exc:
                LOGGER.debug("Pixabay source unavailable for scene %s: %s", idx, exc)

        combined_candidates = _merge_candidates(pexels_candidates, pixabay_candidates)

        with lock:
            exclude_all = selected_urls.union(mongo_used_clips)

        available_candidates = filter_candidates(
            candidates=combined_candidates,
            used_clips_file=used_file,
            exclude_urls=exclude_all,
            min_resolution=effective_min_resolution,
        )
        if not available_candidates:
            return local_paths

        target_clip_count = random.randint(min_per_scene, max_per_scene)

        with lock:
            selected_batch = choose_candidates(
                candidates=available_candidates,
                used_clips_file=used_file,
                count=target_clip_count,
                exclude_urls=selected_urls,
                top_k=12,
                min_resolution=effective_min_resolution,
                allow_used_fallback=False,
            )

            # Immediately reserve URLs to prevent other threads from grabbing them
            if selected_batch:
                 for s in selected_batch:
                     selected_urls.add(_url_key(str(s.get("url", ""))))

        if not selected_batch:
            return local_paths

        for clip_idx, selected in enumerate(selected_batch, start=1):
            out_path = output_dir / f"scene{idx:03d}_clip{clip_idx}.mp4"
            try:
                clip_url = str(selected.get("url", ""))
                _download_file(clip_url, out_path)

                with lock:
                    clip_tracker.mark_clip_used(_url_key(clip_url))
                    mark_clip_as_used(
                        url=clip_url,
                        source=str(selected.get("source", "")),
                        query=query,
                        path=used_file,
                        local_path=str(out_path),
                    )
                local_paths.append(out_path)
            except Exception as exc:
                LOGGER.debug("Clip download skipped for scene %s (%s): %s", idx, selected.get("source", ""), exc)
                with lock:
                    # Unreserve it if it failed
                    try:
                        selected_urls.remove(_url_key(str(selected.get("url", ""))))
                    except KeyError:
                        pass

        return local_paths

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(process_scene, idx, scene) for idx, scene in enumerate(scenes, start=1)]
        for future in futures:
            all_paths.extend(future.result())

    # Sort the paths to ensure sequential scene ordering is preserved (since futures complete out of order).
    # Since filenames are zero-padded (e.g. scene001_clip1.mp4), lexicographical sort will be correct.
    all_paths.sort()

    if not all_paths:
        return _build_fallback_scene_clips(
            scenes=scenes,
            output_dir=output_dir,
            scene_duration=scene_duration,
        )
    return all_paths


def fetch_videos(
    query: str,
    output_dir: Path,
    count: int = 6,
    pexels_key: str | None = None,
    pixabay_key: str | None = None,
) -> list[Path]:
    """
    Backward-compatible topic-based video download.
    """
    scene_prompts = [f"{query} cinematic b-roll scene {idx}" for idx in range(1, count + 1)]
    return download_scene_videos(
        scenes=scene_prompts,
        output_dir=output_dir,
        pexels_key=pexels_key or "",
        pixabay_key=pixabay_key or "",
        scene_duration=4.0,
        min_resolution=720,
        used_clips_file=output_dir.parent / "used_clips.json",
        clips_per_scene_min=1,
        clips_per_scene_max=1,
    )

