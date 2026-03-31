"""
Download stock video clips from Pexels or Pixabay with scene-aware search.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import os
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any

import requests

from youtube_ai_automation.clip_manager import choose_candidates, filter_candidates, mark_clip_as_used

LOGGER = logging.getLogger(__name__)


def _resolve_used_clips_file(output_dir: Path, explicit: Path | None = None) -> Path:
    if explicit is not None:
        return explicit
    user_id = str(os.getenv("USER_ID", "")).strip()
    if user_id:
        return output_dir.parent / "users" / user_id / "used_clips.json"
    return output_dir.parent / "used_clips.json"


@dataclass
class DownloadedClip:
    path: Path
    source: str
    query: str
    url: str
    duration_seconds: float | None = None


def _download_file(url: str, out_file: Path) -> None:
    response = requests.get(url, timeout=20, stream=True)  # FIXED: Bound clip download request timeout to 20s.
    response.raise_for_status()
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def _probe_video_duration_seconds(path: Path) -> float:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            return 0.0
        return float((proc.stdout or "").strip() or 0.0)
    except Exception:
        return 0.0


def _build_fallback_scene_clips(
    scenes: list[str],
    output_dir: Path,
    scene_duration: float,
    min_duration: float = 2.0,
    max_duration: float = 7.0,  # FIXED: Keep fallback clip reuse aligned with strict 2-7 second clip policy.
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
            duration = _probe_video_duration_seconds(src)
            if duration > 0 and (duration < min_duration or duration > max_duration):
                continue
            dst = output_dir / f"fallback_scene{idx + 1}.mp4"
            if src.resolve() == dst.resolve():
                reused.append(src)
                continue
            shutil.copy2(src, dst)
            reused.append(dst)

        LOGGER.info("Using %s fallback clips from %s", len(reused), output_dir)
        return reused
    return []


def _create_placeholder_video(output_dir: Path, name: str, duration_seconds: float = 3.0) -> Path | None:
    placeholder = output_dir / f"{name}.mp4"
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s=720x1280:d={max(1.0, float(duration_seconds)):.2f}",
            "-vf",
            "format=yuv420p",
            "-c:v",
            "libx264",
            "-an",
            str(placeholder),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode == 0 and placeholder.exists() and placeholder.stat().st_size > 0:
            return placeholder
        LOGGER.warning("[MEDIA] placeholder video generation failed for %s: %s", placeholder, (proc.stderr or "")[-200:])
    except Exception as exc:
        LOGGER.warning("[MEDIA] placeholder video generation exception for %s: %s", placeholder, str(exc)[:200])
    return None


def fallback_media(scene: str, output_dir: Path, scene_idx: int) -> list[Path]:
    # 1) Reuse local clips if possible.
    local = _build_fallback_scene_clips([scene], output_dir=output_dir, scene_duration=3.0, min_duration=2.0, max_duration=7.0)  # FIXED: Enforce 2-7 second clip bounds for fallback media.
    if local:
        return local[:1]
    # 2) Create a deterministic placeholder video.
    placeholder = _create_placeholder_video(output_dir, name=f"placeholder_scene{scene_idx:03d}", duration_seconds=3.0)
    if placeholder:
        return [placeholder]
    # 3) Return empty (scene skipped, pipeline continues).
    return []


def get_media_for_scene(
    *,
    scene: str,
    scene_idx: int,
    output_dir: Path,
    pexels_candidates: list[dict[str, Any]],
    pixabay_candidates: list[dict[str, Any]],
    used_file: Path,
    exclude_urls: set[str],
    min_resolution: int,
    min_duration: float,
    max_duration: float,
    target_clip_count: int,
) -> list[dict[str, Any]] | list[Path]:
    combined_candidates = _merge_candidates(pexels_candidates, pixabay_candidates)
    available_candidates = filter_candidates(
        candidates=combined_candidates,
        used_clips_file=used_file,
        exclude_urls=exclude_urls,
        min_resolution=min_resolution,
    )
    if not available_candidates and combined_candidates:
        available_candidates = filter_candidates(
            candidates=combined_candidates,
            used_clips_file=used_file,
            exclude_urls=set(),
            min_resolution=max(240, min_resolution // 2),
        )
    if not available_candidates:
        return fallback_media(scene, output_dir, scene_idx)
    return choose_candidates(
        candidates=available_candidates,
        used_clips_file=used_file,
        count=max(1, int(target_clip_count)),
        exclude_urls=exclude_urls,
        top_k=12,
        min_resolution=min_resolution,
        allow_used_fallback=True,
    )


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
    response = requests.get(endpoint, headers=headers, params=params, timeout=20)  # FIXED: Use 20s timeout per Pexels API request.
    response.raise_for_status()
    payload = response.json()
    videos = payload.get("videos", [])

    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for video in videos:
        duration = float(video.get("duration", 0) or 0)
        # Enforce source-side duration policy strictly; do not download long clips for trimming.
        if duration < 2.0 or duration > 7.0:  # FIXED: Hard filter Pexels candidates outside 2-7 second range.
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
    response = requests.get(endpoint, params=params, timeout=20)  # FIXED: Use 20s timeout per Pixabay API request.
    response.raise_for_status()
    payload = response.json()
    hits = payload.get("hits", [])

    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in hits:
        duration = float(item.get("duration", 0) or 0)
        # Enforce source-side duration policy strictly; do not download long clips for trimming.
        if duration < 2.0 or duration > 7.0:  # FIXED: Hard filter Pixabay candidates outside 2-7 second range.
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
    pexels_keys: list[str] | None = None,
    pixabay_key: str = "",
    pixabay_keys: list[str] | None = None,
    scene_duration: float = 4.0,
    min_resolution: int = 720,
    used_clips_file: Path | None = None,
    clips_per_scene_min: int = 1,
    clips_per_scene_max: int = 2,
    job_id: str = "",
) -> list[Path]:
    """
    Download one clip per scene based on scene descriptions.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    batch_tag = str(int(time.time() * 1000))
    used_file = _resolve_used_clips_file(output_dir=output_dir, explicit=used_clips_file)
    all_paths: list[Path] = []
    selected_urls: set[str] = set()
    # Hard policy: only download short b-roll clips (2s to 7s). # FIXED: Align runtime policy with requested clip duration window.
    min_duration = 2.0  # FIXED: Minimum stock clip duration.
    max_duration = 7.0  # FIXED: Maximum stock clip duration.
    effective_min_resolution = max(720, int(min_resolution))
    min_per_scene = max(1, int(clips_per_scene_min))
    max_per_scene = max(min_per_scene, int(clips_per_scene_max))
    normalized_pexels_keys = [k.strip() for k in (pexels_keys or []) if str(k).strip()]
    normalized_pixabay_keys = [k.strip() for k in (pixabay_keys or []) if str(k).strip()]
    if pexels_key and pexels_key.strip() not in normalized_pexels_keys:
        normalized_pexels_keys.append(pexels_key.strip())
    if pixabay_key and pixabay_key.strip() not in normalized_pixabay_keys:
        normalized_pixabay_keys.append(pixabay_key.strip())

    from youtube_ai_automation.clip_tracker import ClipTracker
    clip_tracker = ClipTracker()
    mongo_used_clips = clip_tracker.get_used_clips()

    from concurrent.futures import ThreadPoolExecutor

    # Need a lock for thread-safe operations on shared collections
    import threading
    lock = threading.Lock()
    log_prefix = f"[JOB:{job_id}][MEDIA] " if job_id else "[MEDIA] "

    def process_scene(idx: int, scene: str) -> list[Path]:
        local_paths = []
        query = " ".join(scene.split())[:90]
        pexels_candidates: list[dict[str, Any]] = []
        pixabay_candidates: list[dict[str, Any]] = []

        if normalized_pexels_keys:
            start_idx = (idx - 1) % len(normalized_pexels_keys)
            ordered_keys = normalized_pexels_keys[start_idx:] + normalized_pexels_keys[:start_idx]
            for key in ordered_keys:
                try:
                    pexels_candidates.extend(
                        _search_pexels_candidates(
                            query=query,
                            api_key=key,
                            min_resolution=effective_min_resolution,
                            min_duration=min_duration,
                            max_duration=max_duration,
                        )
                    )
                    if pexels_candidates:
                        break
                except Exception as exc:
                    LOGGER.warning("%sPexels source unavailable for scene %s (%s): %s", log_prefix, idx, query, exc)

        if normalized_pixabay_keys:
            start_idx = (idx - 1) % len(normalized_pixabay_keys)
            ordered_keys = normalized_pixabay_keys[start_idx:] + normalized_pixabay_keys[:start_idx]
            for key in ordered_keys:
                try:
                    pixabay_candidates.extend(
                        _search_pixabay_candidates(
                            query=query,
                            api_key=key,
                            min_resolution=effective_min_resolution,
                            min_duration=min_duration,
                            max_duration=max_duration,
                        )
                    )
                    if pixabay_candidates:
                        break
                except Exception as exc:
                    LOGGER.warning("%sPixabay source unavailable for scene %s (%s): %s", log_prefix, idx, query, exc)

        with lock:
            exclude_all = selected_urls.union(mongo_used_clips)
        target_clip_count = min_per_scene
        selected_or_fallback = get_media_for_scene(
            scene=scene,
            scene_idx=idx,
            output_dir=output_dir,
            pexels_candidates=pexels_candidates,
            pixabay_candidates=pixabay_candidates,
            used_file=used_file,
            exclude_urls=exclude_all,
            min_resolution=effective_min_resolution,
            min_duration=min_duration,
            max_duration=max_duration,
            target_clip_count=target_clip_count,
        )
        if not selected_or_fallback:
            LOGGER.warning("%sNo stock media found for scene %s. Skipping scene.", log_prefix, idx)
            return local_paths
        if isinstance(selected_or_fallback[0], Path):
            # fallback_media already resolved a local placeholder/media path.
            return [p for p in selected_or_fallback if isinstance(p, Path)]

        selected_batch = selected_or_fallback
        with lock:
            for s in selected_batch:
                selected_urls.add(_url_key(str(s.get("url", ""))))

        for clip_idx, selected in enumerate(selected_batch, start=1):
            out_path = output_dir / f"{batch_tag}_scene{idx:03d}_clip{clip_idx}.mp4"
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

    worker_count = min(len(scenes), 8) if scenes else 1  # FIXED: Scale parallel scene workers up to 8 as requested.
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(process_scene, idx, scene) for idx, scene in enumerate(scenes, start=1)]
        for future in futures:
            try:
                all_paths.extend(future.result())
            except Exception as exc:
                LOGGER.warning("%sScene media task failed: %s", log_prefix, str(exc)[:220])

    # Sort the paths to ensure sequential scene ordering is preserved (since futures complete out of order).
    # Since filenames are zero-padded (e.g. scene001_clip1.mp4), lexicographical sort will be correct.
    all_paths.sort()

    if not all_paths:
        fallback = _build_fallback_scene_clips(
            scenes=scenes,
            output_dir=output_dir,
            scene_duration=scene_duration,
            min_duration=min_duration,
            max_duration=max_duration,
        )
        if fallback:
            return fallback
        return []
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

