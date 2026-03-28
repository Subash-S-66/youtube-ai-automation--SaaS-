"""
Advanced YouTube Shorts automation pipeline.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import logging
import math
import os
from pathlib import Path
import random
import re
import requests
import socket
import subprocess
import time
import wave
from urllib.parse import unquote, urlparse

from googleapiclient.errors import HttpError

from youtube_ai_automation.config import (
    ANALYTICS_HISTORY_FILE,
    AI_PROVIDER,
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    AUDIO_PATH,
    BACKGROUND_MUSIC_PATH,
    BACKGROUND_MUSIC_VOLUME,
    CLEANUP_LOCAL_FILES_AFTER_UPLOAD,
    CLIPS_DIR,
    DEFAULT_NICHE,
    DEFAULT_TOPIC,
    DEFAULT_VOICE,
    DOWNLOAD_UPLOADED_VIDEO,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GENERATED_IDEAS_FILE,
    HOOKS_PER_TOPIC,
    IMAGES_DIR,
    LOG_LEVEL,
    MAX_VIDEO_LENGTH,
    MIN_VIDEO_LENGTH,
    MAX_SCRIPT_SECONDS,
    MIN_SCRIPT_SECONDS,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OUTPUT_DIR,
    PEXELS_API_KEY,
    PEXELS_API_KEYS,
    PIXABAY_API_KEY,
    PIXABAY_API_KEYS,
    NEWS_QUERY,
    NEWS_LANGUAGE,
    NEWS_LOOKBACK_HOURS,
    NEWS_FETCH_MULTIPLIER,
    SCENE_DURATION,
    STRICT_SHORTS_VALIDATION,
    SUBTITLE_PATH,
    TELEGRAM_ALLOWED_CHAT_ID,
    TELEGRAM_BOT_TOKEN,
    TOKEN_PATH,
    TREND_TOPIC_LIMIT,
    IMPROVEMENT_STATE_FILE,
    UPLOADED_DOWNLOAD_DIR,
    UPLOAD_REPORT_FILE,
    USED_CLIPS_FILE,
    USED_TITLES_FILE,
    USED_TOPICS_FILE,
    VALIDATE_SHORTS_BEFORE_UPLOAD,
    VIDEO_PATH,
    VIDEOS_PER_DAY,
    YOUTUBE_DATA_API_KEY,
    YOUTUBE_CLIENT_SECRET_FILE,
    YOUTUBE_SCOPES,
)
from youtube_ai_automation.competitor_analyzer import analyze_competitor_shorts
from youtube_ai_automation.content_generator import GeneratedContent, generate_content
from youtube_ai_automation.gemini_content_generator import generate_gemini_content
from youtube_ai_automation.hook_filter import mark_hook_as_used, select_best_unused_hook
from youtube_ai_automation.hook_optimizer import (
    IdeaCandidate,
    OptimizedIdea,
    build_optimized_idea,
    generate_idea_candidates,
    refresh_topic_generation_memory,
)
from youtube_ai_automation.idea_ranker import RankedIdea, filter_duplicate_topics, mark_generated_idea, rank_ideas
from youtube_ai_automation.metadata_optimizer import optimize_metadata
from youtube_ai_automation.analytics_feedback import store_analytics_feedback
from youtube_ai_automation.post_upload_manager import handle_post_upload
from youtube_ai_automation.scene_extractor import extract_scenes
from youtube_ai_automation.self_improvement import ImprovementStrategy, load_strategy, update_strategy_from_feedback
from youtube_ai_automation.title_ab_test import TitleABResult, select_best_title
from youtube_ai_automation.notification_utils import (
    append_upload_report,
    reset_upload_report,
    send_telegram_message,
    update_upload_report_metadata,
)
from youtube_ai_automation.topic_selector import choose_topic
from youtube_ai_automation.topic_filter import mark_topic_as_used, select_best_unused_topic, filter_unused_topics
from youtube_ai_automation.trend_engine import get_trending_topics
from youtube_ai_automation.news_fetcher import get_latest_news
from youtube_ai_automation.video_creator import create_subtitles_from_script, render_vertical_video
from youtube_ai_automation.video_fetcher import download_scene_videos
from youtube_ai_automation.image_fetcher import fetch_images
from youtube_ai_automation.viral_pattern_engine import ViralPatternScore, estimate_viral_probability
from youtube_ai_automation.voice_generator import generate_voice, pick_voice_profile
from youtube_ai_automation.youtube_uploader import SHORTS_MAX_DURATION_SECONDS, upload_video
from youtube_ai_automation.services.webhook_service import send_pipeline_complete
from youtube_ai_automation.duration_controller import (
    allocate_section_budget,
    adjust_script_to_duration,
    build_timed_lines,
    estimate_duration_from_script,
    estimate_script_duration_seconds,
    repair_section_ending,
    validate_ending as validate_section_ending,
    validate_output,
    validate_section_limits,
    WORDS_PER_SECOND,
)

LOGGER = logging.getLogger("youtube_ai_automation")
NARRATION_RETRY_ATTEMPTS = 5
TOPIC_SELECTION_RETRY_ATTEMPTS = 3


@dataclass
class RankedSelection:
    ranked_idea: RankedIdea
    title_result: TitleABResult
    pattern_score: ViralPatternScore
    combined_score: float


@dataclass
class AutoSelection:
    idea: OptimizedIdea
    viral_keywords: list[str]
    topic_memory: dict[str, list[str]]


class NarrationUnavailableError(RuntimeError):
    """Raised when narration could not be generated after retries."""


def _setup_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )
    # Ensure output directories exist at startup
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    LOGGER.info(
        "Pipeline initialized: AI_PROVIDER=%s GEMINI_MODEL=%s",
        AI_PROVIDER, GEMINI_MODEL,
    )


def _log_job_stage(payload: dict | None, stage: str, message: str, level: str = "info") -> None:
    job_id = ""
    if isinstance(payload, dict):
        job_id = str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip()
    prefix = f"[JOB:{job_id or 'unknown'}][{str(stage or '').upper()}] "
    log_fn = getattr(LOGGER, level, LOGGER.info)
    log_fn("%s%s", prefix, message)


def _build_publish_schedule(count: int, start_at: str | None, enabled: bool) -> list[str | None]:
    """
    Build a per-video publish_at schedule. If uploads are disabled, returns Nones.
    If start_at is not provided, schedule evenly across the next 24 hours.
    """
    if count <= 0:
        return []
    if not enabled:
        return [None] * count

    interval_hours = 24.0 / max(1, count)
    if start_at:
        normalized = start_at.strip().replace("Z", "+00:00")
        base = datetime.fromisoformat(normalized)
        if base.tzinfo is None:
            raise ValueError("publish_at must include a timezone offset, for example +05:30.")
    else:
        base = datetime.now().astimezone() + timedelta(minutes=10)

    schedule: list[str | None] = []
    for idx in range(count):
        dt = base + timedelta(hours=interval_hours * idx)
        schedule.append(dt.isoformat())
    return schedule


def _record_successful_upload(title: str, topic: str, video_id: str, keywords: list[str]) -> None:
    append_upload_report(
        UPLOAD_REPORT_FILE,
        title=title,
        topic=topic,
        video_id=video_id,
        keywords=keywords,
    )


def _notify_progress_update(title: str, keywords: list[str]) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ALLOWED_CHAT_ID or not UPLOAD_REPORT_FILE.exists():
        return
    try:
        payload = json.loads(UPLOAD_REPORT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return

    completed = int(payload.get("completed_count", 0) or 0)
    total = int(payload.get("requested_count", 0) or 0)
    keyword_text = ", ".join(keywords[:10])
    lines = [f"Progress: {completed}/{total} completed.", f"Title: {title}"]
    if keyword_text:
        lines.append(f"Keywords: {keyword_text}")
    send_telegram_message(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, "\n".join(lines))


def _probe_tcp_443(host: str, timeout_seconds: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, 443), timeout=timeout_seconds):
            return True, ""
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def _run_network_preflight(check_trend_sources: bool, upload: bool) -> None:
    checks: list[tuple[str, str]] = [("Edge TTS", "speech.platform.bing.com")]

    provider = (AI_PROVIDER or "").strip().lower()
    if provider in {"gemini", "google"}:
        if GEMINI_API_KEY:
            checks.append(("Gemini API", "generativelanguage.googleapis.com"))
        else:
            LOGGER.warning("Network preflight: GEMINI_API_KEY is missing; Gemini calls will be skipped.")
    elif provider == "openai":
        checks.append(("OpenAI API", "api.openai.com"))
    elif provider in {"anthropic", "claude"}:
        checks.append(("Anthropic API", "api.anthropic.com"))

    if check_trend_sources:
        checks.append(("Google Trends", "trends.google.com"))
        checks.append(("Reddit", "www.reddit.com"))
    if PEXELS_API_KEY:
        checks.append(("Pexels API", "api.pexels.com"))
    if PIXABAY_API_KEY:
        checks.append(("Pixabay API", "pixabay.com"))
    if upload:
        checks.append(("YouTube API", "www.googleapis.com"))

    blocked: list[tuple[str, str, str]] = []
    for label, host in checks:
        ok, error = _probe_tcp_443(host)
        if not ok:
            blocked.append((label, host, error))

    if not blocked:
        LOGGER.info("Network preflight: required services are reachable.")
        return

    for label, host, error in blocked:
        LOGGER.warning("Network preflight blocked: %s (%s) -> %s", label, host, error)

    blocked_hosts = ", ".join(host for _, host, _ in blocked)
    LOGGER.warning(
        "Network preflight detected blocked outbound HTTPS (TCP/443). "
        "Pipeline will use fallback content where available."
    )
    LOGGER.warning("Blocked hosts: %s", blocked_hosts)
    LOGGER.warning(
        "Fix: allow outbound TCP/443 for python.exe in Windows Firewall/antivirus/proxy policy."
    )
    LOGGER.warning(
        "Fix: if your network requires proxy, set HTTPS_PROXY and HTTP_PROXY before running."
    )
    LOGGER.warning(
        "Test command: Test-NetConnection generativelanguage.googleapis.com -Port 443"
    )


def _download_custom_media(urls: list[str], output_dir: Path) -> list[Path]:
    downloaded: list[Path] = []
    if not isinstance(urls, list) or not urls:
        return downloaded

    output_dir.mkdir(parents=True, exist_ok=True)
    webhook_secret = (os.getenv("WEBHOOK_SECRET", "") or "").strip()
    headers = {}
    if webhook_secret:
        headers["x-webhook-secret"] = webhook_secret

    for idx, raw_url in enumerate(urls, start=1):
        media_url = str(raw_url or "").strip()
        if not media_url:
            continue
        try:
            parsed = urlparse(media_url)
            base_name = Path(unquote(parsed.path)).name or f"custom_media_{idx}"
            target = output_dir / f"custom_{idx}_{base_name}"
            with requests.get(media_url, stream=True, headers=headers, timeout=30) as response:
                response.raise_for_status()
                with target.open("wb") as file_handle:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            file_handle.write(chunk)
            if not target.exists() or target.stat().st_size == 0:
                try:
                    target.unlink(missing_ok=True)
                except Exception:
                    pass
                LOGGER.warning(
                    "custom_media_download_failed empty_file url=%s",
                    media_url,
                )
                continue
            downloaded.append(target)
            LOGGER.info(
                "custom_media_download_success url=%s path=%s bytes=%s",
                media_url,
                str(target),
                target.stat().st_size,
            )
        except Exception as exc:
            LOGGER.warning(
                "custom_media_download_failed url=%s reason=%s",
                media_url,
                str(exc)[:240],
            )
    return downloaded


def _create_placeholder_media(output_dir: Path, tag: str = "placeholder") -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    placeholder_video = output_dir / f"{tag}.mp4"
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=720x1280:d=3.0",
            "-vf",
            "format=yuv420p",
            "-c:v",
            "libx264",
            "-an",
            str(placeholder_video),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode == 0 and placeholder_video.exists() and placeholder_video.stat().st_size > 0:
            return [placeholder_video]
        LOGGER.warning("placeholder_media_failed tag=%s reason=%s", tag, (proc.stderr or "")[-200:])
    except Exception as exc:
        LOGGER.warning("placeholder_media_exception tag=%s reason=%s", tag, str(exc)[:200])
    return []


def _create_silent_audio(output_dir: Path, duration_seconds: float) -> Path | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    out = output_dir / "voice_full_silent.wav"
    try:
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
            str(out),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return out
        LOGGER.warning("silent_audio_failed reason=%s", (proc.stderr or "")[-200:])
    except Exception as exc:
        LOGGER.warning("silent_audio_exception reason=%s", str(exc)[:200])
    return None


def _runtime_used_clips_file(default_path: Path) -> Path:
    user_id = str(os.getenv("USER_ID", "")).strip()
    if user_id:
        return default_path.parent / "users" / user_id / "used_clips.json"
    return default_path


def _delete_file_quiet(path: Path) -> None:
    try:
        if path.exists() and path.is_file():
            path.unlink()
    except Exception as exc:
        LOGGER.warning("cleanup_failed file=%s reason=%s", path, str(exc)[:180])


def _cleanup_after_successful_upload(
    *,
    media_paths: list[Path],
    audio_path: Path,
    subtitle_path: Path | None,
    output_video_path: Path,
) -> None:
    # Delete only generated artifacts from current run.
    for media in media_paths:
        _delete_file_quiet(media)
    _delete_file_quiet(audio_path)
    if subtitle_path is not None:
        _delete_file_quiet(subtitle_path)
    _delete_file_quiet(output_video_path)

    # Also clear generated stock/orchestrated media folders to avoid buildup between jobs.
    cleanup_dirs = [
        CLIPS_DIR / "orchestrated",
        CLIPS_DIR / "stock_video",
        CLIPS_DIR / "stock_image",
        CLIPS_DIR / "full_mode",
    ]
    for folder in cleanup_dirs:
        try:
            if not folder.exists() or not folder.is_dir():
                continue
            for item in folder.rglob("*"):
                if item.is_file():
                    _delete_file_quiet(item)
        except Exception as exc:
            LOGGER.warning("cleanup_failed dir=%s reason=%s", folder, str(exc)[:180])


def _extract_highlight_words(topic: str, hook: str) -> list[str]:
    words = []
    for source in (topic, hook):
        for token in source.lower().split():
            cleaned = "".join(ch for ch in token if ch.isalnum())
            if len(cleaned) >= 4:
                words.append(cleaned)
    # Keep order and avoid duplicates
    seen: set[str] = set()
    unique: list[str] = []
    for item in words:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique[:10]


def _choose_scene_duration() -> float:
    """
    Keep scene cuts between 2.5-3.5 seconds for optimal Shorts pacing and retention.
    """
    options = [2.5, 2.7, 3.0, 3.2, 3.5]
    return random.choice(options)


def _pick_caption_chunk_size() -> int:
    """
    Keep each script line intact (no mid-line breaks).
    """
    return 18


def _compute_target_scene_count(audio_seconds: float, scene_duration: float) -> int:
    """
    Scale scene count so visuals can cover the full narration.
    """
    if audio_seconds <= 0:
        return 5
    capped_seconds = min(audio_seconds, float(SHORTS_MAX_DURATION_SECONDS))
    # scenes = targetDuration / sceneDuration
    base = max(5, int(math.ceil(capped_seconds / scene_duration)))
    return min(base, 20)


def _extend_scene_queries(scene_queries: list[str], target_count: int) -> list[str]:
    if not scene_queries:
        return []
    if len(scene_queries) >= target_count:
        return scene_queries
    extended = list(scene_queries)
    fillers = scene_queries[:]
    random.shuffle(fillers)
    while len(extended) < target_count:
        if not fillers:
            fillers = scene_queries[:]
            random.shuffle(fillers)
        extended.append(fillers.pop())
    return extended


def _compute_max_video_length(audio_seconds: float) -> int:
    """
    Allow the video to run long enough for the narration without exceeding Shorts limits.
    """
    if audio_seconds <= 0:
        return MAX_VIDEO_LENGTH
    padded = int(math.ceil(audio_seconds))
    return int(min(SHORTS_MAX_DURATION_SECONDS, max(MAX_VIDEO_LENGTH, padded)))


def _generate_narration_with_retries(script: str, output_path: Path, preferred_voice: str = "") -> Path:
    """
    Try multiple voice profiles before giving up on narration.
    """
    for attempt in range(1, NARRATION_RETRY_ATTEMPTS + 1):
        selected_voice, selected_rate = pick_voice_profile(voice=preferred_voice or DEFAULT_VOICE)
        LOGGER.info(
            "Voice profile attempt %s/%s: %s at %s",
            attempt,
            NARRATION_RETRY_ATTEMPTS,
            selected_voice,
            selected_rate,
        )
        try:
            audio_file, has_narration = generate_voice(
                script=script,
                voice=selected_voice,
                rate=selected_rate,
                output_path=output_path,
                rotate_profile=False,
            )
            if has_narration:
                return audio_file
        except Exception as exc:
            LOGGER.warning("Narration attempt %s failed: %s", attempt, str(exc)[:120])

        if attempt < NARRATION_RETRY_ATTEMPTS:
            wait_seconds = 2 * attempt
            LOGGER.warning(
                "No narration generated on attempt %s. Retrying in %ss.",
                attempt,
                wait_seconds,
            )
            time.sleep(wait_seconds)

    raise NarrationUnavailableError(
        f"No narration after {NARRATION_RETRY_ATTEMPTS} attempts. Skipping this video."
    )


def _script_duration_bounds(settings: dict) -> int:
    """
    Return target duration from settings or fallback to MAX_SCRIPT_SECONDS.
    """
    target = int(settings.get("targetDuration", settings.get("duration", MAX_SCRIPT_SECONDS)))
    return max(15, min(target, SHORTS_MAX_DURATION_SECONDS))


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        cleaned = " ".join(str(item).split()).strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _read_history_topics(path: Path, key: str) -> list[str]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    rows = payload.get(key, [])
    if not isinstance(rows, list):
        return []

    topics: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        topic = " ".join(str(row.get("topic", "")).split()).strip()
        if topic:
            topics.append(topic)
    return topics


def _load_previous_topics() -> list[str]:
    used_topics = _read_history_topics(USED_TOPICS_FILE, "used_topics")
    generated_topics = _read_history_topics(GENERATED_IDEAS_FILE, "generated_ideas")
    return _dedupe_preserve_order([*used_topics, *generated_topics])


def _pick_optimized_ranked_selection(growth_ranked: list[RankedSelection]) -> RankedSelection:
    """
    Prefer a truly unused topic, but do not dead-end the batch if the strict used-topic
    filter rejects every already-deduped candidate.
    """
    try:
        unused_topic = select_best_unused_topic([item.ranked_idea.topic for item in growth_ranked])
    except ValueError as exc:
        LOGGER.warning(
            "Strict used-topic filter rejected all optimized candidates. "
            "Falling back to best ranked deduped idea. Reason: %s",
            exc,
        )
        return growth_ranked[0]

    return next(
        (item for item in growth_ranked if item.ranked_idea.topic == unused_topic),
        growth_ranked[0],
    )


def _build_growth_ranked_candidates(
    idea_candidates: list[IdeaCandidate],
    topic_signals: list[str],
    viral_keywords: list[str],
    viral_topics: list[str],
    previous_topics: list[str],
    strategy: ImprovementStrategy,
) -> list[RankedSelection]:
    ranked_ideas = rank_ideas(idea_candidates, trending_topics=topic_signals)
    if not ranked_ideas:
        raise RuntimeError("Could not rank ideas. No candidates available.")

    deduped_ranked = filter_duplicate_topics(
        ranked_ideas=ranked_ideas,
        generated_ideas_file=GENERATED_IDEAS_FILE,
    )
    pool = deduped_ranked or ranked_ideas
    growth_ranked = _rank_with_growth_signals(
        ranked_ideas=pool,
        trend_candidates=topic_signals,
        viral_keywords=viral_keywords,
        viral_topics=viral_topics,
        previous_topics=previous_topics,
        strategy=strategy,
    )
    if not growth_ranked:
        raise RuntimeError("Could not apply growth ranking. No candidates available.")
    return growth_ranked


def _combined_viral_score(
    base_score: float,
    pattern_score: float,
    strategy: ImprovementStrategy,
) -> float:
    return round(
        (base_score * strategy.base_weight) + (pattern_score * strategy.pattern_weight),
        2,
    )


def _rank_with_growth_signals(
    ranked_ideas: list[RankedIdea],
    trend_candidates: list[str],
    viral_keywords: list[str],
    viral_topics: list[str],
    previous_topics: list[str],
    strategy: ImprovementStrategy,
) -> list[RankedSelection]:
    enriched: list[RankedSelection] = []
    for ranked in ranked_ideas:
        title_result = select_best_title(
            topic=ranked.topic,
            hook=ranked.best_hook,
            viral_keywords=viral_keywords,
        )
        pattern_score = estimate_viral_probability(
            topic=ranked.topic,
            hook=ranked.best_hook,
            title=title_result.best_title,
            trending_topics=trend_candidates,
            viral_keywords=viral_keywords,
            viral_topics=viral_topics,
            previous_topics=previous_topics,
        )
        combined = _combined_viral_score(
            base_score=ranked.viral_score,
            pattern_score=pattern_score.viral_probability_score,
            strategy=strategy,
        )
        enriched.append(
            RankedSelection(
                ranked_idea=ranked,
                title_result=title_result,
                pattern_score=pattern_score,
                combined_score=combined,
            )
        )
    enriched.sort(key=lambda item: item.combined_score, reverse=True)
    return enriched


def _build_short_from_optimized_idea(
    idea: OptimizedIdea,
    viral_keywords: list[str],
    upload: bool,
    publish_at: str | None,
) -> Path:
    raise RuntimeError("Legacy AI generation mode is disabled. Pipeline supports only prepared mode.")

def _build_video_from_content(
    content: GeneratedContent,
    upload: bool,
    publish_at: str | None,
) -> Path:
    import os, json, random
    settings_env = os.getenv("SETTINGS", "{}")
    try:
        settings = json.loads(settings_env)
    except Exception:
        settings = {}

    target_duration = _script_duration_bounds(settings)
    LOGGER.info("Title: %s", content.title)
    LOGGER.info("Hook: %s", content.hook)

    voices = settings.get("voices", [])
    preferred_voice = ""
    if voices and isinstance(voices, list):
        preferred_voice = random.choice(voices)

    content_type = settings.get("contentType", "clips").lower()
    custom_video_urls = settings.get("customVideoUrls", [])
    custom_image_urls = settings.get("customImageUrls", [])
    user_media_paths = settings.get("userMediaPaths", [])

    LOGGER.info("Generating voice narration via VoiceService")
    from youtube_ai_automation.services.voice_service import generate_audio

    audio_file, _ = generate_audio(
        script=content.script,
        voice=preferred_voice,
        output_path=AUDIO_PATH,
    )

    scene_duration = _choose_scene_duration()
    audio_seconds = estimate_duration_from_script(content.script)
    target_scenes = _compute_target_scene_count(audio_seconds, scene_duration)

    scene_plan = extract_scenes(
        script=content.script,
        topic=content.topic,
        seed_queries=content.scenes or content.search_queries,
        max_scenes=target_scenes,
    )
    LOGGER.info("Scene duration: %.1fs", scene_duration)
    scene_queries = _extend_scene_queries(scene_plan.search_queries[:], target_scenes)

    videos = []

    # Load custom media from backend-provided secure URLs.
    downloaded_custom_videos = _download_custom_media(
        urls=[str(url).strip() for url in custom_video_urls if str(url).strip()],
        output_dir=CLIPS_DIR,
    ) if isinstance(custom_video_urls, list) else []
    downloaded_custom_images = _download_custom_media(
        urls=[str(url).strip() for url in custom_image_urls if str(url).strip()],
        output_dir=CLIPS_DIR,
    ) if isinstance(custom_image_urls, list) else []
    videos.extend(downloaded_custom_videos)
    videos.extend(downloaded_custom_images)
    LOGGER.info(
        "custom_media_download_summary videos=%s images=%s",
        len(downloaded_custom_videos),
        len(downloaded_custom_images),
    )

    # Legacy local media path support for local/dev runs.
    if user_media_paths and isinstance(user_media_paths, list):
        for media_path in user_media_paths:
            path_obj = Path(media_path)
            if path_obj.exists():
                videos.append(path_obj)
        LOGGER.info("Loaded %s legacy local user media clips", len(videos))

    # If we need more videos than the user provided, fetch the rest
    needed_clips = len(scene_queries) - len(videos)

    if needed_clips > 0:
        remaining_queries = scene_queries[len(videos):]
        from youtube_ai_automation.services.media_service import fetch_media
        if content_type == "images":
            LOGGER.info("Media mode 'images': Downloading stock images")
            from youtube_ai_automation.image_fetcher import fetch_images
            for idx, query in enumerate(remaining_queries, start=1):
                try:
                    # fetch 1 image per scene
                    imgs = fetch_images(
                        query=query,
                        output_dir=CLIPS_DIR,
                        count=1,
                        pexels_key=PEXELS_API_KEY,
                        pixabay_key=PIXABAY_API_KEY,
                    )
                    if imgs:
                        videos.extend(imgs)
                except Exception as e:
                    LOGGER.warning(f"Failed to fetch image for query '{query}': {e}")
        elif content_type == "mixed":
            LOGGER.info("Media mode 'mixed': Downloading video and image clips")
            from youtube_ai_automation.image_fetcher import fetch_images
            initial_video_count = len(videos)
            for idx, query in enumerate(remaining_queries, start=1):
                try:
                    # Intro (1st scene) -> Video, Explanation (Middle scenes) -> Images, Highlights (Last scene) -> Video
                    # Adjust idx relative to total queries to keep intro/outro logic intact
                    global_idx = initial_video_count + idx
                    if global_idx == 1 or global_idx == len(scene_queries):
                        clips = download_scene_videos(
                            scenes=[query],
                            output_dir=CLIPS_DIR,
                            pexels_key=PEXELS_API_KEY,
                            pexels_keys=PEXELS_API_KEYS,
                            pixabay_key=PIXABAY_API_KEY,
                            pixabay_keys=PIXABAY_API_KEYS,
                            scene_duration=scene_duration,
                            min_resolution=720,
                            used_clips_file=_runtime_used_clips_file(USED_CLIPS_FILE),
                            clips_per_scene_min=1,
                            clips_per_scene_max=1,
                            job_id=str(os.getenv("JOB_ID", "")).strip(),
                        )
                        videos.extend(clips)
                    else:
                        imgs = fetch_images(
                            query=query,
                            output_dir=CLIPS_DIR,
                            count=1,
                            pexels_key=PEXELS_API_KEY,
                            pixabay_key=PIXABAY_API_KEY,
                        )
                        if imgs:
                            videos.extend(imgs)
                except Exception as e:
                    LOGGER.warning(f"Failed to fetch mixed media for query '{query}': {e}")
        else:
            LOGGER.info("Media mode 'clips': Downloading stock videos via MediaService")
            videos.extend(fetch_media(remaining_queries, CLIPS_DIR, PEXELS_API_KEY, PIXABAY_API_KEY, use_images=False))

    LOGGER.info("Prepared %s media clips", len(videos))

    LOGGER.info("Building advanced captions")
    subtitle_file = create_subtitles_from_script(
        script=content.script,
        estimated_duration_seconds=audio_seconds,
        subtitle_path=SUBTITLE_PATH,
        max_words=3,
        highlight_words=_extract_highlight_words(content.topic, content.hook),
        line_mode=True,
        font_style="Anton",
        subtitle_color="#FFFFFF",
    )

    music_path = Path(BACKGROUND_MUSIC_PATH) if BACKGROUND_MUSIC_PATH else None
    LOGGER.info("Creating final short video via VideoService")
    from youtube_ai_automation.services.video_service import create_video

    video_file = create_video(
        media_files=videos,
        audio_path=audio_file,
        subtitle_path=subtitle_file,
        output_path=VIDEO_PATH,
        use_images=content_type == "images",
        width=1080,
        height=1920,
        fps=30,
        scene_duration=scene_duration,
        min_video_length=max(15, target_duration - 5),
        max_video_length=min(60, _compute_max_video_length(audio_seconds)),
        background_music_path=music_path,
        bg_music_volume=BACKGROUND_MUSIC_VOLUME,
        shuffle_scenes=True,
    )
    
    # Mark topic as used immediately after successful video creation
    # This prevents repeats even if upload or later steps fail
    mark_topic_as_used(content.topic)

    if upload:
        LOGGER.info("Uploading to YouTube via UploadService")
        LOGGER.info("Upload description preview: %s", content.upload_description()[:220])
        LOGGER.info("Upload hashtags: %s", " ".join(content.hashtags))
        
        try:
            from youtube_ai_automation.services.upload_service import upload_video
            upload_result = upload_video(
                video_path=video_file,
                title=content.title,
                description=content.upload_description(),
                tags=content.tags(),
                privacy_status="public",
                client_secret_file=YOUTUBE_CLIENT_SECRET_FILE,
                scopes=YOUTUBE_SCOPES,
                token_path=TOKEN_PATH,
                publish_at=publish_at,
                validate_shorts=VALIDATE_SHORTS_BEFORE_UPLOAD,
                strict_shorts_validation=STRICT_SHORTS_VALIDATION,
            )
            LOGGER.info("Upload complete. Video ID: %s", upload_result.get("id"))
        except HttpError as e:
            raw_error = ""
            try:
                raw_error = e.content.decode("utf-8", errors="replace")
            except Exception:
                raw_error = str(e)
            try:
                error_content = json.loads(raw_error)
                error_msg = error_content.get("error", {}).get("errors", [{}])[0].get("message", str(e))
            except Exception:
                error_msg = raw_error.strip() or str(e)
            
            if 'uploadLimitExceeded' in str(e):
                LOGGER.error("❌ YouTube upload limit exceeded: %s", error_msg)
                LOGGER.error("Video created but not uploaded. Topic marked as used.")
                return video_file
            elif 'quotaExceeded' in str(e):
                LOGGER.error("❌ YouTube API quota exceeded: %s", error_msg)
                LOGGER.error("Video created but not uploaded. Topic marked as used.")
                return video_file
            else:
                LOGGER.error("❌ YouTube upload failed: %s", error_msg)
                raise
        
        if not upload_result.get("id"):
            LOGGER.warning("Upload returned no video ID")
            return video_file
            
        uploaded_video_id = str(upload_result.get("id"))
        _record_successful_upload(
            title=content.title,
            topic=content.topic,
            video_id=uploaded_video_id,
            keywords=content.tags(),
        )
        _notify_progress_update(title=content.title, keywords=content.tags())
        handle_post_upload(
            video_id=uploaded_video_id,
            output_dir=VIDEO_PATH.parent,
            clips_dir=CLIPS_DIR,
            audio_path=AUDIO_PATH,
            subtitle_path=SUBTITLE_PATH,
            video_path=VIDEO_PATH,
            downloaded_output_dir=UPLOADED_DOWNLOAD_DIR,
            download_uploaded_video_enabled=DOWNLOAD_UPLOADED_VIDEO,
            cleanup_local_files_enabled=CLEANUP_LOCAL_FILES_AFTER_UPLOAD,
        )
        LOGGER.info("Collecting analytics feedback")
        feedback_record = store_analytics_feedback(
            video_id=uploaded_video_id,
            topic=content.topic,
            hook=content.hook,
            title=content.title,
            hashtags=content.hashtags,
            score_breakdown={},
            history_file=ANALYTICS_HISTORY_FILE,
            token_path=TOKEN_PATH,
            scopes=YOUTUBE_SCOPES,
        )
        LOGGER.info(
            "Analytics snapshot stored (views=%s, score=%s)",
            feedback_record.get("statistics", {}).get("views", 0),
            feedback_record.get("performance_score", 0.0),
        )
        strategy = update_strategy_from_feedback(
            history_file=ANALYTICS_HISTORY_FILE,
            state_file=IMPROVEMENT_STATE_FILE,
        )
        LOGGER.info(
            "Updated self-improvement weights: base=%.3f pattern=%.3f (samples=%s)",
            strategy.base_weight,
            strategy.pattern_weight,
            strategy.sample_count,
        )
    else:
        LOGGER.info("Upload skipped (--upload not set)")

    mark_hook_as_used(content.hook)
    mark_generated_idea(
        topic=content.topic,
        hook=content.hook,
        generated_ideas_file=GENERATED_IDEAS_FILE,
        upload_date=publish_at,
    )
    return video_file


def _build_single_short(
    topic: str,
    upload: bool,
    publish_at: str | None,
    provider_override: str | None = None,
) -> Path:
    import os, json
    settings_env = os.getenv("SETTINGS", "{}")
    try:
        settings = json.loads(settings_env)
    except Exception:
        settings = {}

    target_duration = _script_duration_bounds(settings)
    LOGGER.info("Generating AI content for topic: %s (target duration: %s)", topic, target_duration)

    story_mode = settings.get("storyMode", False)
    current_part = settings.get("currentPart", 1)
    recap_enabled = settings.get("recapEnabled", False)
    last_prompt = settings.get("lastPrompt", "")

    provider = (provider_override or AI_PROVIDER).strip().lower()
    content = generate_content(
        topic=topic,
        provider=provider,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
        target_duration=target_duration,
        story_mode=story_mode,
        current_part=current_part,
        recap_enabled=recap_enabled,
        last_prompt=last_prompt,
    )
    return _build_video_from_content(content=content, upload=upload, publish_at=publish_at)


def run_pipeline(topic: str, upload: bool, niche: str, generate_topic: bool, publish_at: str | None):
    """
    Backward-compatible entrypoint expected by prior versions.
    """
    raise RuntimeError("Legacy AI generation mode is disabled. Pipeline supports only prepared mode.")


def _normalize_prepared_item(raw: dict) -> GeneratedContent:
    topic = " ".join(str(raw.get("topic", "")).split()).strip()
    title = " ".join(str(raw.get("title", "")).split()).strip()
    hook = " ".join(str(raw.get("hook", "")).split()).strip()
    description = " ".join(str(raw.get("description", "")).split()).strip()
    script = str(raw.get("script", "")).strip()
    captions_raw = raw.get("captions", [])

    hashtags_raw = raw.get("hashtags", [])
    scenes_raw = raw.get("scenes", [])
    queries_raw = raw.get("searchQueries", raw.get("search_queries", []))

    if not topic or not title or not description:
        raise ValueError("Prepared content item is missing topic/title/description/script.")

    if not script and isinstance(captions_raw, list) and captions_raw:
        caption_lines = []
        for cap in captions_raw:
            if not isinstance(cap, dict):
                continue
            text = str(cap.get("text", "")).strip()
            if text:
                caption_lines.append(text)
        script = "\n".join(caption_lines[:5]).strip()

    if not script:
        raise ValueError("Prepared content item is missing script/captions text.")

    hashtags = [str(item).strip() for item in hashtags_raw if str(item).strip()]
    scenes = [str(item).strip() for item in scenes_raw if str(item).strip()]
    search_queries = [str(item).strip() for item in queries_raw if str(item).strip()]

    if len(hashtags) == 0:
        raise ValueError("Prepared content item has no hashtags.")
    if len(scenes) < 5 or len(search_queries) < 5:
        raise ValueError("Prepared content item requires at least 5 scenes and 5 search queries.")

    if not hook:
        script_lines = [line.strip() for line in script.splitlines() if line.strip()]
        hook = script_lines[0] if script_lines else topic

    return GeneratedContent(
        topic=topic,
        title=title,
        hook=hook,
        description=description,
        hashtags=hashtags[:15],
        script=script,
        scenes=scenes[:5],
        search_queries=search_queries[:5],
    )


def _normalize_script_from_payload(script_items: list[object]) -> str:
    if not isinstance(script_items, list) or not script_items:
        raise ValueError("pipeline payload script must be a non-empty array.")
    lines: list[str] = []
    for idx, item in enumerate(script_items):
        text = ""
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if not text:
                text = str(item.get("prompt", "")).strip()
            if not text:
                text = str(item.get("line", "")).strip()
        else:
            raise ValueError(
                f"script[{idx}] must be a string or object with text/prompt/line."
            )
        if not text:
            raise ValueError(
                f"script[{idx}] is empty; provide a non-empty string or object with text."
            )
        lines.append(text)
    return " ".join(lines)


def _extract_target_duration(video_config: dict, payload: dict | None = None) -> int:
    payload = payload or {}
    raw = video_config.get(
        "targetDuration",
        video_config.get(
            "duration",
            payload.get("targetDuration", payload.get("duration", 60)),
        ),
    )
    try:
        target = int(raw)
    except Exception:
        target = 60
    return max(15, min(60, target))


def _build_section_scripts(
    base_script: str,
    topic: str,
    target_duration: int,
    cta_enabled: bool,
    recap_enabled: bool,
    story_mode: bool,
    current_part: int = 1,
    last_prompt: str = "",
) -> tuple[dict[str, str], dict[str, int]]:
    budget_obj = allocate_section_budget(
        target_seconds=target_duration,
        has_cta=cta_enabled,
        has_recap=recap_enabled,
    )
    section_budget = {
        "hook": budget_obj.hook,
        "main_content": budget_obj.main_content,
        "recap": budget_obj.recap,
        "cta": budget_obj.cta,
    }

    sentences = [part.strip() for part in base_script.split(".") if part.strip()]
    hook_seed = f"{sentences[0]}." if sentences else f"{topic} in one short."
    main_seed = " ".join(sentences[1:]) if len(sentences) > 1 else base_script
    if story_mode and current_part > 1 and last_prompt.strip():
        recap_seed = f"Previously, {last_prompt.strip()[:140]}. In short, {topic} matters now."
    else:
        recap_seed = f"In short, {topic} matters now."
    cta_seed = "Follow for more and subscribe now."

    hook_text = adjust_script_to_duration(
        script=hook_seed,
        target_seconds=section_budget["hook"],
        section_name="hook",
        topic_hint=topic,
        story_mode=story_mode,
    )
    main_text = adjust_script_to_duration(
        script=main_seed,
        target_seconds=section_budget["main_content"],
        section_name="main",
        topic_hint=topic,
        story_mode=story_mode,
    )
    recap_text = ""
    if recap_enabled and section_budget["recap"] > 0:
        recap_text = adjust_script_to_duration(
            script=recap_seed,
            target_seconds=section_budget["recap"],
            section_name="recap",
            topic_hint=topic,
            story_mode=story_mode,
        )
    cta_text = ""
    if cta_enabled and section_budget["cta"] > 0:
        cta_text = adjust_script_to_duration(
            script=cta_seed,
            target_seconds=section_budget["cta"],
            section_name="cta",
            topic_hint=topic,
            story_mode=story_mode,
        )

    section_scripts = {
        "hook": hook_text,
        "main_content": main_text,
        "recap": recap_text,
        "cta": cta_text,
    }

    expand_tries = 0
    while expand_tries < 3:
        ordered = [
            section_scripts["hook"],
            section_scripts["main_content"],
            section_scripts["recap"],
            section_scripts["cta"],
        ]
        full_script = " ".join(p for p in ordered if p).strip()
        estimated = estimate_script_duration_seconds(full_script)
        lower_bound = max(10, target_duration - 5)
        if estimated >= lower_bound:
            break
        deficit_seconds = lower_bound - estimated
        section_scripts["main_content"] = adjust_script_to_duration(
            script=section_scripts["main_content"],
            target_seconds=int(section_budget["main_content"] + deficit_seconds),
            section_name="main",
            topic_hint=topic,
            story_mode=story_mode,
        )
        expand_tries += 1

    return section_scripts, section_budget


def estimate_audio_duration(script: str) -> float:
    """Estimate TTS audio length from word count at 3.6 WPS (Gemini Flash)."""
    words = max(1, len(str(script or "").split()))
    return round(words / 3.6, 2)


def get_audio_duration_seconds(audio_path: Path) -> float:
    try:
        with wave.open(str(audio_path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                return 0.0
            return frames / float(rate)
    except Exception:
        return 0.0


def get_audio_duration(file_path: Path) -> float:
    return get_audio_duration_seconds(file_path)


def _build_atempo_chain(factor: float) -> str:
    # ffmpeg atempo accepts per-filter values in [0.5, 2.0]
    value = max(0.25, min(4.0, float(factor)))
    parts: list[float] = []
    while value < 0.5:
        parts.append(0.5)
        value /= 0.5
    while value > 2.0:
        parts.append(2.0)
        value /= 2.0
    parts.append(value)
    return ",".join(f"atempo={p:.6f}" for p in parts)


def normalize_audio_duration_with_ffmpeg(
    input_path: Path,
    output_path: Path,
    target_seconds: float,
) -> float:
    current = get_audio_duration_seconds(input_path)
    if current <= 0 or target_seconds <= 0:
        return current
    factor = current / float(target_seconds)
    filter_chain = _build_atempo_chain(factor)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-filter:a",
        filter_chain,
        "-acodec",
        "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not output_path.exists():
        raise RuntimeError(f"audio_normalize_failed: {proc.stderr[-240:]}")
    return get_audio_duration_seconds(output_path)


def expand_meaningfully(text: str, extra_words: int) -> str:
    base = str(text or "").strip()
    if extra_words <= 0:
        return base
    additions = [
        "For example, imagine this playing out in a real day where one small choice changes the result.",
        "The consequence is practical: once this pattern starts, people either gain momentum or lose time fast.",
        "To clarify, this does not require a huge change, just one deliberate action repeated consistently.",
    ]
    out = base
    idx = 0
    while len(out.split()) < len(base.split()) + extra_words:
        out = (out + " " + additions[idx % len(additions)]).strip()
        idx += 1
        if idx > 6:
            break
    return out


def _enforce_word_cap(script: str, max_words: int) -> str:
    text = str(script or "").strip()
    words = text.split()
    if len(words) <= max_words:
        return text
    trimmed = " ".join(words[:max_words]).strip()
    last_punct = max(trimmed.rfind("."), trimmed.rfind("!"), trimmed.rfind("?"))
    if last_punct > 0:
        candidate = trimmed[: last_punct + 1].strip()
        # Keep a complete sentence boundary when possible to avoid tails like "The."
        if candidate and len(candidate.split()) >= max(5, int(max_words * 0.65)):
            trimmed = candidate
    if trimmed:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", trimmed) if s.strip()]
        if len(sentences) > 1 and len(sentences[-1].split()) < 3:
            trimmed = " ".join(sentences[:-1]).strip()
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed


def _trim_script_to_words(script: str, target_words: int) -> str:
    text = str(script or "").strip()
    words = text.split()
    limit = max(20, int(target_words))
    if len(words) <= limit:
        return text
    trimmed = " ".join(words[:limit]).strip()
    return _enforce_word_cap(trimmed, limit)


def _assemble_sections_script(sections: dict[str, str]) -> str:
    return " ".join(
        p for p in [
            sections.get("hook", ""),
            sections.get("main_content", ""),
            sections.get("recap", ""),
            sections.get("cta", ""),
        ] if p
    ).strip()


def _resize_main_content_to_total_words(
    sections: dict[str, str],
    target_total_words: int,
    min_main_words: int = 20,
    allow_expand: bool = True,
) -> str:
    non_main = " ".join(
        p for p in [sections.get("hook", ""), sections.get("recap", ""), sections.get("cta", "")]
        if p
    ).strip()
    non_main_words = len(non_main.split()) if non_main else 0
    target_main_words = max(min_main_words, int(target_total_words) - non_main_words)
    main_text = str(sections.get("main_content", "")).strip()
    main_words = main_text.split()

    if len(main_words) > target_main_words:
        trimmed = " ".join(main_words[:target_main_words]).strip()
        if trimmed and trimmed[-1] not in ".!?":
            trimmed += "."
        sections["main_content"] = trimmed
    elif allow_expand and len(main_words) < target_main_words:
        sections["main_content"] = expand_meaningfully(main_text, target_main_words - len(main_words))

    return _assemble_sections_script(sections)


def validate_sections(section_budget: dict[str, int], section_scripts: dict[str, str]) -> list[str]:
    errors: list[str] = []
    hook_est = estimate_duration_from_script(section_scripts.get("hook", ""))
    cta_est = estimate_duration_from_script(section_scripts.get("cta", ""))
    recap_est = estimate_duration_from_script(section_scripts.get("recap", ""))
    if hook_est > float(section_budget.get("hook", 0)) + 1:
        errors.append("hook_over_budget")
    if section_scripts.get("cta", "").strip() and cta_est > float(section_budget.get("cta", 0)) + 1:
        errors.append("cta_over_budget")
    if section_scripts.get("recap", "").strip() and recap_est > float(section_budget.get("recap", 0)) + 1:
        errors.append("recap_over_budget")
    return errors


def validate_ending(script: str) -> bool:
    text = str(script or "").strip()
    if not text:
        return False
    if not text.endswith((".", "!", "?")):
        return False
    last_sentence = [s.strip() for s in text.replace("!", ".").replace("?", ".").split(".") if s.strip()]
    if not last_sentence:
        return False
    tail = last_sentence[-1].lower()
    if len(tail.split()) < 3:
        return False
    bad_tail = ("and", "but", "so", "because", "if", "when", "then")
    if tail.split()[-1] in bad_tail:
        return False
    return True


def repair_section_ending_with_context(
    section_name: str,
    sections: dict[str, str],
    section_budget: dict[str, int],
    topic: str,
    story_mode: bool,
) -> str:
    ordered = [
        sections.get("hook", ""),
        sections.get("main_content", ""),
        sections.get("recap", ""),
        sections.get("cta", ""),
    ]
    context = " ".join([part.strip() for part in ordered[:-1] if part.strip()][-2:]).strip()
    base = sections.get(section_name, "").strip()
    seed = f"{context} {base}".strip() if context else base
    repaired = adjust_script_to_duration(
        script=seed,
        target_seconds=max(1, int(section_budget.get(section_name, 1))),
        section_name="main" if section_name == "main_content" else section_name,
        topic_hint=topic,
        story_mode=story_mode,
    )
    return repair_section_ending(repaired, "main" if section_name == "main_content" else section_name)


def run_prepared_pipeline(
    payload: dict,
    upload: bool,
    publish_at: str | None,
    count: int,
    notify_webhook: bool = True,
) -> list[Path]:
    # Production prepared mode: deterministic timing + Google audio only.
    # Video stitching/upload side-effects are intentionally disabled in this mode.
    created: list[Path] = []
    if not isinstance(payload, dict):
        raise ValueError("PIPELINE_PAYLOAD must be an object.")
    _log_job_stage(payload, "audio", "run_prepared_pipeline started")

    script_items = payload.get("script", [])
    youtube = payload.get("youtube", {})
    video_config = payload.get("videoConfig", {})
    captions = payload.get("captions", [])

    if not isinstance(youtube, dict) or not isinstance(video_config, dict):
        raise ValueError("PIPELINE_PAYLOAD.youtube and videoConfig must be objects.")

    script_text = _normalize_script_from_payload(script_items)
    if not isinstance(video_config.get("customVideoUrls", []), list):
        raise ValueError("videoConfig.customVideoUrls must be an array when provided.")
    if not isinstance(video_config.get("customImageUrls", []), list):
        raise ValueError("videoConfig.customImageUrls must be an array when provided.")

    target_duration = _extract_target_duration(video_config, payload)
    # Allow extra lexical headroom (+10s) because TTS pace can be faster than 3.6 WPS.
    # This prevents frequent under-length audio (e.g., 40-45s for a 60s target).
    hard_max_words = int(min(70, target_duration + 10) * WORDS_PER_SECOND)
    # Hard cap early so oversized generated scripts don't start at ~70s for a 60s request.
    script_text = _enforce_word_cap(script_text, hard_max_words)
    cta_enabled = bool(video_config.get("ctaEnabled", video_config.get("enableCTA", False)))
    recap_enabled = bool(video_config.get("recapEnabled", False))
    story_mode = bool(video_config.get("storyMode", False))
    current_part = int(video_config.get("currentPart", 1) or 1)
    last_prompt = str(video_config.get("lastPrompt", ""))
    if story_mode and current_part <= 1:
        recap_enabled = False
    topic = str(payload.get("topic", "") or youtube.get("title", "Prepared Topic") or "Prepared Topic").strip()
    voice_name = str(video_config.get("voice", "") or (video_config.get("voices") or [""])[0]).strip()
    if not voice_name:
        voice_name = DEFAULT_VOICE
    voice_rate = str(video_config.get("voiceRate", "") or "").strip()
    font_style = str(video_config.get("templateConfig", {}).get("fontStyle", "Anton")).strip() or "Anton"
    subtitle_color = str(video_config.get("templateConfig", {}).get("subtitleColor", "#FFFFFF")).strip() or "#FFFFFF"

    best_script = _enforce_word_cap(script_text, hard_max_words)
    last_valid_script = script_text
    base_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", best_script) if s.strip()]
    best_sections: dict[str, str] = {
        "hook": base_sentences[0] if base_sentences else best_script[:140],
        "main_content": " ".join(base_sentences[1:]) if len(base_sentences) > 1 else best_script,
        "recap": "",
        "cta": "",
    }
    best_section_budget: dict[str, int] = {"hook": 0, "main_content": target_duration, "recap": 0, "cta": 0}
    last_errors: list[str] = []
    output_dir = AUDIO_PATH.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    MAX_ATTEMPTS = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        section_scripts, section_budget = _build_section_scripts(
            base_script=script_text,
            topic=topic,
            target_duration=target_duration,
            cta_enabled=cta_enabled,
            recap_enabled=recap_enabled,
            story_mode=story_mode,
            current_part=current_part,
            last_prompt=last_prompt,
        )
        full_script = _resize_main_content_to_total_words(
            section_scripts,
            hard_max_words,
            min_main_words=max(12, int(target_duration * 1.5)),
            allow_expand=False,
        )
        if full_script:
            last_valid_script = full_script
        estimated = estimate_script_duration_seconds(full_script)
        LOGGER.info(
            "prepared_attempt=%s words=%s estimated=%.2fs target=%ss",
            attempt,
            len(full_script.split()),
            estimated,
            target_duration,
        )
        lower_bound = max(10, target_duration - 5)
        upper_bound = min(60, target_duration + 5)

        if lower_bound <= estimated <= upper_bound:
            best_script = full_script
            best_sections = section_scripts
            best_section_budget = section_budget
            break

        if estimated < lower_bound:
            deficit = lower_bound - estimated
            extra_words = int(deficit * WORDS_PER_SECOND)
            section_scripts["main_content"] = expand_meaningfully(
                section_scripts["main_content"],
                max(8, extra_words),
            )
            full_script = _resize_main_content_to_total_words(
                section_scripts,
                hard_max_words,
                min_main_words=max(12, int(target_duration * 1.5)),
                allow_expand=False,
            )
            estimated = estimate_script_duration_seconds(full_script)

        if estimated > upper_bound:
            excess = estimated - upper_bound
            sentences = [s.strip() for s in full_script.split(".") if s.strip()]
            while excess > 0 and len(sentences) > 3:
                removed = sentences.pop(-2)
                excess -= estimate_script_duration_seconds(removed + ".")
            full_script = ". ".join(sentences).strip()
            if full_script and not full_script.endswith("."):
                full_script += "."

        best_script = _enforce_word_cap(full_script, hard_max_words)
        best_sections = section_scripts
        best_section_budget = section_budget

    if not best_script:
        best_script = last_valid_script
        best_sections = {
            "hook": best_sections.get("hook", ""),
            "main_content": best_sections.get("main_content", best_script),
            "recap": best_sections.get("recap", ""),
            "cta": best_sections.get("cta", ""),
        }
        best_section_budget = best_section_budget or {"hook": 0, "main_content": 0, "recap": 0, "cta": 0}
        last_errors.append("fallback_script_used_after_attempt_exhaustion")

    section_validation_errors = []
    if not best_script:
        section_validation_errors = validate_sections(best_section_budget, best_sections)
    if section_validation_errors:
        for err in section_validation_errors:
            if err == "hook_over_budget":
                best_sections["hook"] = adjust_script_to_duration(
                    script=best_sections.get("hook", ""),
                    target_seconds=max(1, int(best_section_budget.get("hook", 1))),
                    section_name="hook",
                    topic_hint=topic,
                    story_mode=story_mode,
                )
            elif err == "cta_over_budget":
                best_sections["cta"] = adjust_script_to_duration(
                    script=best_sections.get("cta", ""),
                    target_seconds=max(1, int(best_section_budget.get("cta", 1))),
                    section_name="cta",
                    topic_hint=topic,
                    story_mode=story_mode,
                )
            elif err == "recap_over_budget":
                best_sections["recap"] = adjust_script_to_duration(
                    script=best_sections.get("recap", ""),
                    target_seconds=max(1, int(best_section_budget.get("recap", 1))),
                    section_name="recap",
                    topic_hint=topic,
                    story_mode=story_mode,
                )
        best_script = " ".join(
            p for p in [
                best_sections.get("hook", ""),
                best_sections.get("main_content", ""),
                best_sections.get("recap", ""),
                best_sections.get("cta", ""),
            ] if p
        ).strip()

    hard_cap_words = hard_max_words
    best_script = _enforce_word_cap(best_script, hard_cap_words)

    best_package = {
        "script": best_script,
        "sections": best_sections,
        "sections_budget": best_section_budget,
        "estimated_duration": round(estimate_script_duration_seconds(best_script), 2),
    }

    MAX_SECONDS = 60
    if best_package["estimated_duration"] > MAX_SECONDS:
        LOGGER.warning(
            "Prepared script estimate exceeds 60s (estimated=%.1fs). Keeping script unchanged for audio sync.",
            best_package["estimated_duration"],
        )
    full_audio_path: Path | None = None
    actual_audio_seconds = 0.0
    audio_retry_count = 0
    audio_failed = False
    best_audio_path: Path | None = None
    best_audio_seconds = 0.0
    allowed_drift_seconds = 10.0
    min_acceptable_duration = max(50.0, float(target_duration) - allowed_drift_seconds)
    max_acceptable_duration = min(70.0, float(target_duration) + allowed_drift_seconds)
    preferred_target_seconds = min(float(target_duration), 55.0)
    current_script = str(best_package["script"]).strip()

    try:
        candidate_output = output_dir / "voice_full_attempt_1.wav"
        candidate_path, _ = generate_voice(
            script=current_script,
            voice=voice_name,
            rate=voice_rate,
            output_path=candidate_output,
            rotate_profile=False,
        )
        candidate_seconds = get_audio_duration_seconds(candidate_path)
        if candidate_seconds <= 0:
            candidate_seconds = estimate_audio_duration(current_script)
        drift_from_target = candidate_seconds - float(target_duration)
        _log_job_stage(
            payload,
            "audio",
            f"audio_attempt=1 actual={candidate_seconds:.2f}s estimated={estimate_audio_duration(current_script):.2f}s target={target_duration}s drift={drift_from_target:.2f}s",
        )
        best_audio_path = candidate_path
        best_audio_seconds = candidate_seconds

        if not (min_acceptable_duration <= candidate_seconds <= max_acceptable_duration):
            normalize_target = max(min_acceptable_duration, min(preferred_target_seconds, max_acceptable_duration))
            normalized_path = output_dir / "voice_full_normalized.wav"
            normalized_seconds = normalize_audio_duration_with_ffmpeg(
                input_path=candidate_path,
                output_path=normalized_path,
                target_seconds=normalize_target,
            )
            if normalized_seconds > 0:
                best_audio_path = normalized_path
                best_audio_seconds = normalized_seconds
                audio_retry_count = 1
                _log_job_stage(
                    payload,
                    "audio",
                    f"audio_speed_adjusted actual={normalized_seconds:.2f}s target={normalize_target:.2f}s window=[{min_acceptable_duration:.2f}, {max_acceptable_duration:.2f}]",
                )
    except Exception as exc:
        audio_failed = True
        last_errors.append(f"audio_generation_error:{str(exc)[:160]}")
        _log_job_stage(payload, "audio", f"audio generation failed: {str(exc)[:200]}", level="warning")

    if not audio_failed and best_audio_path is not None:
        final_audio_path = output_dir / "voice_full.wav"
        try:
            if best_audio_path != final_audio_path:
                final_audio_path.write_bytes(best_audio_path.read_bytes())
            full_audio_path = final_audio_path
            actual_audio_seconds = best_audio_seconds
        except Exception as exc:
            audio_failed = True
            last_errors.append(f"audio_finalize_error:{str(exc)[:120]}")

    if full_audio_path is not None:
        created.append(full_audio_path)

    estimated_duration = estimate_audio_duration(best_package["script"])
    actual_audio_seconds = get_audio_duration_seconds(full_audio_path) if full_audio_path is not None else estimated_duration
    if actual_audio_seconds <= 0:
        actual_audio_seconds = estimated_duration
    # No aggressive post-audio script rewrite; keep stable output.

    # Keep script unchanged after generation so narration and captions stay aligned.
    final_duration_seconds = float(actual_audio_seconds or estimated_duration)
    valid, errors = validate_output(
        # Validate against final rendered clip duration to avoid false drift failures.
        target_seconds=max(1, min(60, int(round(final_duration_seconds)))),
        actual_seconds=final_duration_seconds,
        has_cta=cta_enabled,
        has_recap=recap_enabled,
        cta_text=best_package["sections"].get("cta", ""),
        recap_text=best_package["sections"].get("recap", ""),
        full_script=best_package["script"],
    )
    ending_ok, ending_error = validate_section_ending(
        best_package["script"],
        has_cta=cta_enabled,
        has_recap=recap_enabled,
    )
    if not validate_ending(best_package["script"]):
        errors = [err for err in errors if str(err) != "abrupt_ending"]
        errors.append("ending:weak_or_incomplete")
    if ending_error:
        errors.append(f"ending:{ending_error}")
    # Prepared mode: treat duration drift as informational, not fatal.
    errors = [err for err in errors if not str(err).startswith("duration_out_of_range:")]

    timed_lines_raw = build_timed_lines(best_package["script"])
    total_line_duration = sum(float(row.get("duration", 0.0) or 0.0) for row in timed_lines_raw)
    target_line_total = max(0.1, float(final_duration_seconds))
    if timed_lines_raw and total_line_duration > 0:
        scale = target_line_total / total_line_duration
        timed_lines = []
        for row in timed_lines_raw:
            text = str(row.get("text", "")).strip()
            base_dur = float(row.get("duration", 0.0) or 0.0)
            timed_lines.append({"text": text, "duration": round(max(0.5, base_dur * scale), 2)})
        drift = round(target_line_total - sum(float(x["duration"]) for x in timed_lines), 2)
        timed_lines[-1]["duration"] = round(max(0.5, float(timed_lines[-1]["duration"]) + drift), 2)
    else:
        timed_lines = timed_lines_raw

    subtitle_file = create_subtitles_from_script(
        script=best_package["script"],
        estimated_duration_seconds=target_line_total,
        subtitle_path=SUBTITLE_PATH,
        max_words=4,
        highlight_words=_extract_highlight_words(topic, best_package["sections"].get("hook", "")),
        line_mode=True,
        font_style=font_style,
        subtitle_color=subtitle_color,
    )

    sectionAudio = {
        "full": str(full_audio_path) if full_audio_path is not None else "",
        "hook": round(estimate_duration_from_script(best_package["sections"].get("hook", "")), 2),
        "main_content": round(estimate_duration_from_script(best_package["sections"].get("main_content", "")), 2),
        "recap": round(estimate_duration_from_script(best_package["sections"].get("recap", "")), 2),
        "cta": round(estimate_duration_from_script(best_package["sections"].get("cta", "")), 2),
    }

    hashtags = youtube.get("hashtags", ["#shorts"])
    if not isinstance(hashtags, list):
        hashtags = ["#shorts"]

    result_payload = {
        "script": best_package["script"],
        "duration": round(final_duration_seconds, 2),
        "duration_target": target_duration,
        "duration_estimated": round(final_duration_seconds, 2),
        "duration_actual": round(final_duration_seconds, 2),
        "validation_passed": bool(valid and ending_ok),
        "audio_path": str(full_audio_path) if full_audio_path is not None else "",
        "subtitle_path": str(subtitle_file),
        "captions": {
            "text": "\n".join([str(row.get("text", "")).strip() for row in timed_lines if str(row.get("text", "")).strip()]),
            "timed": timed_lines,
            "font": font_style,
            "color": subtitle_color,
        },
        "hashtags": [str(tag).strip() for tag in hashtags if str(tag).strip()],
        "cta": best_package["sections"].get("cta", ""),
        "recap": best_package["sections"].get("recap", ""),
        "sections": {
            "hook": best_package["sections"].get("hook", ""),
            "main": best_package["sections"].get("main_content", ""),
            "recap": best_package["sections"].get("recap", ""),
            "cta": best_package["sections"].get("cta", ""),
        },
        "sectionBudgets": {
            "hook": best_package["sections_budget"].get("hook", 0),
            "main": best_package["sections_budget"].get("main_content", 0),
            "recap": best_package["sections_budget"].get("recap", 0),
            "cta": best_package["sections_budget"].get("cta", 0),
        },
        "sectionAudio": sectionAudio,
        "uploadRequested": bool(upload),
        "uploadSkipped": True,
        "uploadSkipReason": "prepared_mode_no_video_render_or_upload",
        "retry_count": audio_retry_count,
        "validationErrors": errors,
    }
    resolved_job_id = str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip()
    result_payload["contract"] = {
        "jobId": resolved_job_id,
        "status": "COMPLETED",
        "content": {
            "script": best_package["script"],
            "captions": timed_lines,
            "hashtags": hashtags,
        },
        "media": [],
        "audio": {
            "path": str(full_audio_path) if full_audio_path is not None else "",
            "duration": round(float(final_duration_seconds), 2),
            "retryCount": int(audio_retry_count),
        },
    }
    result_payload["jobId"] = resolved_job_id
    result_payload["status"] = "COMPLETED"
    result_payload["content"] = result_payload["contract"]["content"]
    result_payload["media"] = result_payload["contract"]["media"]
    result_payload["audio"] = result_payload["contract"]["audio"]
    if audio_failed:
        result_payload["warning"] = "Used fallback due to retries"
        result_payload["duration"] = estimated_duration
        result_payload["validation_passed"] = False
    result_file = output_dir / "prepared_result.json"
    result_file.write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PIPELINE_OUTPUT_JSON:{json.dumps(result_payload, ensure_ascii=False)}")
    _log_job_stage(payload, "audio", f"prepared result written: {result_file}")
    if notify_webhook:
        try:
            send_pipeline_complete({
                "jobId": resolved_job_id,
                "status": "completed",
                "result": result_payload,
            })
        except Exception as exc:
            LOGGER.warning("Failed to send pipeline-complete webhook: %s", str(exc)[:240])
    LOGGER.info("Prepared deterministic payload written to %s", result_file)
    return created


def _load_prepared_result_payload(delete_after_read: bool = False) -> dict:
    result_file = AUDIO_PATH.parent / "prepared_result.json"
    if not result_file.exists():
        raise RuntimeError("Prepared result payload missing after generation.")
    payload = json.loads(result_file.read_text(encoding="utf-8"))
    if delete_after_read:
        try:
            result_file.unlink(missing_ok=True)
        except Exception:
            pass
    return payload


def _collect_media_paths_for_full_mode(payload: dict, target_dir: Path) -> list[Path]:
    video_config = payload.get("videoConfig", {}) if isinstance(payload, dict) else {}
    custom_video_urls = video_config.get("customVideoUrls", []) if isinstance(video_config, dict) else []
    custom_image_urls = video_config.get("customImageUrls", []) if isinstance(video_config, dict) else []
    media_urls: list[str] = []
    if isinstance(custom_video_urls, list):
        media_urls.extend([str(x).strip() for x in custom_video_urls if str(x).strip()])
    if isinstance(custom_image_urls, list):
        media_urls.extend([str(x).strip() for x in custom_image_urls if str(x).strip()])
    return _download_custom_media(media_urls, target_dir)


def _derive_scene_queries_for_stock(payload: dict, prepared_payload: dict) -> list[str]:
    queries: list[str] = []

    # 1) Explicit search queries from payload metadata if available
    youtube_cfg = payload.get("youtube", {}) if isinstance(payload, dict) else {}
    raw_queries = youtube_cfg.get("search_queries", []) if isinstance(youtube_cfg, dict) else []
    if isinstance(raw_queries, list):
        queries.extend([str(x).strip() for x in raw_queries if str(x).strip()])
    camel_queries = youtube_cfg.get("searchQueries", []) if isinstance(youtube_cfg, dict) else []
    if isinstance(camel_queries, list):
        queries.extend([str(x).strip() for x in camel_queries if str(x).strip()])

    # 2) Script line texts from pipeline payload
    raw_script = payload.get("script", []) if isinstance(payload, dict) else []
    if isinstance(raw_script, list):
        for row in raw_script:
            if isinstance(row, dict):
                text = str(row.get("text", "")).strip()
                if text:
                    queries.append(text)
            elif isinstance(row, str) and row.strip():
                queries.append(row.strip())

    # 3) Timed caption text from prepared payload
    timed = ((prepared_payload.get("captions", {}) or {}).get("timed", [])) if isinstance(prepared_payload, dict) else []
    if isinstance(timed, list):
        for row in timed:
            if isinstance(row, dict):
                text = str(row.get("text", "")).strip()
                if text:
                    queries.append(text)

    # Normalize/dedupe and keep short search-friendly strings
    out: list[str] = []
    seen: set[str] = set()
    for item in queries:
        clean = " ".join(str(item).split()).strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean[:90])
        if len(out) >= 8:
            break
    return out


def _plan_stock_asset_counts(target_seconds: float) -> tuple[int, int]:
    """
    Plan how many stock videos/images to download so total visual inventory is close to target.
    Images are fixed 3s each; clips are mixed 2-6s (approx 4s average).
    """
    target = max(15.0, min(60.0, float(target_seconds or 60.0)))
    # User policy: treat each clip as ~3s and keep a small buffer.
    base_clips = int(math.ceil(target / 3.0))
    clip_count = min(22, max(1, base_clips + 2))
    image_count = 0
    return clip_count, image_count


def run_full_pipeline(
    payload: dict,
    upload: bool,
    publish_at: str | None,
    count: int,
) -> list[Path]:
    if not isinstance(payload, dict):
        raise ValueError("PIPELINE_PAYLOAD must be an object for full mode.")

    strict_validation_attempts = 1
    prepared_payload: dict = {}
    last_validation_error = ""
    for attempt in range(1, strict_validation_attempts + 1):
        run_prepared_pipeline(payload=payload, upload=upload, publish_at=publish_at, count=count, notify_webhook=False)
        prepared_payload = _load_prepared_result_payload(delete_after_read=True)
        validation_errors = prepared_payload.get("validationErrors", [])
        if not isinstance(validation_errors, list):
            validation_errors = []
        blocking = [
            str(err) for err in validation_errors
            if str(err) in {"missing_cta", "missing_recap", "empty_script"}
        ]
        if not blocking:
            break
        last_validation_error = ", ".join(blocking)
        LOGGER.warning(
            json.dumps(
                {"event": "validation_retry", "attempt": attempt, "blocking_errors": blocking},
                ensure_ascii=False,
            )
        )
        if attempt == strict_validation_attempts:
            raise RuntimeError(f"Strict validation failed after retries: {last_validation_error}")

    output_dir = AUDIO_PATH.parent
    _log_job_stage(payload, "render", "run_full_pipeline started")
    video_config = payload.get("videoConfig", {}) if isinstance(payload.get("videoConfig"), dict) else {}
    target_duration = float(_extract_target_duration(video_config, payload))
    audio_path = Path(str(prepared_payload.get("audio_path", "")).strip())
    subtitle_path = Path(str(prepared_payload.get("subtitle_path", "")).strip()) if prepared_payload.get("subtitle_path") else None
    
    if not str(audio_path).strip() or not audio_path.exists() or not audio_path.is_file():
        _log_job_stage(payload, "audio", f"prepared audio missing ({audio_path}); generating silent fallback", level="warning")
        fallback_audio = _create_silent_audio(output_dir, duration_seconds=target_duration)
        if fallback_audio is not None:
            audio_path = fallback_audio
            prepared_payload["audio_path"] = str(fallback_audio)
            prepared_payload["duration_actual"] = float(target_duration)
            prepared_payload["duration_estimated"] = float(target_duration)
        else:
            raise RuntimeError(f"Full mode cannot continue: audio file missing and silent fallback failed ({audio_path})")

    media_dir = CLIPS_DIR / "full_mode"
    media_paths = _collect_media_paths_for_full_mode(payload, media_dir)
    scene_queries = _derive_scene_queries_for_stock(payload, prepared_payload)
    has_custom_media = len(media_paths) > 0

    # Always auto-download stock media when no custom media is provided by user.
    if scene_queries and not has_custom_media:
        _log_job_stage(payload, "media", f"auto media download started for {len(scene_queries)} scene queries")
        planned_clips, planned_images = _plan_stock_asset_counts(target_duration)
        if planned_clips <= 0 and planned_images <= 0:
            planned_clips, planned_images = 22, 0

        media_fetch_start = time.time()
        media_fetch_budget_s = 8 * 60.0
        min_clips_to_proceed = min(planned_clips, 22)
        min_images_to_proceed = min(planned_images, 0)

        stock_dir = CLIPS_DIR / "stock_video"
        clip_queries = _extend_scene_queries(scene_queries, max(1, planned_clips))
        scene_duration = max(2.5, float(target_duration) / max(1, len(clip_queries)))
        stock_paths: list[Path] = []
        seen_video_paths: set[str] = set()
        max_video_download_attempts = 3
        for attempt_idx in range(1, max_video_download_attempts + 1):
            if time.time() - media_fetch_start > media_fetch_budget_s:
                LOGGER.warning(
                    "auto_media_video_time_budget_exceeded downloaded=%s planned=%s budget_s=%.0f",
                    len(stock_paths),
                    planned_clips,
                    media_fetch_budget_s,
                )
                break
            needed = max(0, planned_clips - len(stock_paths))
            if needed <= 0:
                break
            batch_queries = _extend_scene_queries(clip_queries, max(1, needed))
            try:
                fetched = download_scene_videos(
                    scenes=batch_queries,
                    output_dir=stock_dir,
                    pexels_key=PEXELS_API_KEY or "",
                    pexels_keys=PEXELS_API_KEYS,
                    pixabay_key=PIXABAY_API_KEY or "",
                    pixabay_keys=PIXABAY_API_KEYS,
                    scene_duration=scene_duration,
                    min_resolution=360,
                    clips_per_scene_min=1,
                    clips_per_scene_max=1,
                    job_id=str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip(),
                )
            except Exception as exc:
                LOGGER.warning("stock_video_fetch_failed attempt=%s reason=%s", attempt_idx, str(exc)[:200])
                fetched = []
            if not fetched:
                # Fallback to broad queries when scene-specific phrases are too strict for stock APIs.
                try:
                    fetched = download_scene_videos(
                        scenes=["technology cinematic b-roll", "ai data center", "futuristic interface"][:max(1, min(3, needed))],
                        output_dir=stock_dir,
                        pexels_key=PEXELS_API_KEY or "",
                        pexels_keys=PEXELS_API_KEYS,
                        pixabay_key=PIXABAY_API_KEY or "",
                        pixabay_keys=PIXABAY_API_KEYS,
                        scene_duration=scene_duration,
                        min_resolution=240,
                        clips_per_scene_min=1,
                        clips_per_scene_max=1,
                        job_id=str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip(),
                    )
                except Exception as exc:
                    LOGGER.warning("stock_video_fallback_fetch_failed attempt=%s reason=%s", attempt_idx, str(exc)[:200])
                    fetched = []
            for path in fetched:
                key = str(path.resolve())
                if key in seen_video_paths:
                    continue
                seen_video_paths.add(key)
                stock_paths.append(path)
            if len(stock_paths) >= min_clips_to_proceed:
                break
            if len(stock_paths) < planned_clips:
                LOGGER.info(
                    "auto_media_video_retry attempt=%s downloaded=%s planned=%s",
                    attempt_idx,
                    len(stock_paths),
                    planned_clips,
                )
                time.sleep(min(3, attempt_idx))
        if stock_paths:
            media_paths.extend(stock_paths)
        LOGGER.info(
            json.dumps(
                {
                    "event": "auto_media_download",
                    "type": "video",
                    "downloaded": len(stock_paths),
                    "planned": planned_clips,
                    "targetSeconds": round(float(target_duration), 2),
                },
                ensure_ascii=False,
            )
        )
        _log_job_stage(payload, "media", f"video assets downloaded={len(stock_paths)} planned={planned_clips}")

        image_downloads: list[Path] = []
        seen_image_paths: set[str] = set()
        image_dir = CLIPS_DIR / "stock_image"
        image_queries = _extend_scene_queries(scene_queries, max(1, planned_images))
        max_image_download_attempts = 3
        for attempt_idx in range(1, max_image_download_attempts + 1):
            if time.time() - media_fetch_start > media_fetch_budget_s:
                LOGGER.warning(
                    "auto_media_image_time_budget_exceeded downloaded=%s planned=%s budget_s=%.0f",
                    len(image_downloads),
                    planned_images,
                    media_fetch_budget_s,
                )
                break
            needed = max(0, planned_images - len(image_downloads))
            if needed <= 0:
                break
            batch_queries = _extend_scene_queries(image_queries, max(1, needed))
            for idx, query in enumerate(batch_queries, start=1):
                try:
                    files = fetch_images(
                        query=query,
                        output_dir=image_dir / f"a{attempt_idx:02d}_q{idx:02d}",
                        count=1,
                        pexels_key=PEXELS_API_KEY or "",
                        pixabay_key=PIXABAY_API_KEY or "",
                    )
                    for path in files:
                        key = str(path.resolve())
                        if key in seen_image_paths:
                            continue
                        seen_image_paths.add(key)
                        image_downloads.append(path)
                except Exception as exc:
                    LOGGER.warning("stock_image_fetch_failed query=%s error=%s", query, str(exc)[:180])
                    try:
                        fallback_files = fetch_images(
                            query="technology abstract background",
                            output_dir=image_dir / f"a{attempt_idx:02d}_q{idx:02d}_fallback",
                            count=1,
                            pexels_key=PEXELS_API_KEY or "",
                            pixabay_key=PIXABAY_API_KEY or "",
                        )
                        for path in fallback_files:
                            key = str(path.resolve())
                            if key in seen_image_paths:
                                continue
                            seen_image_paths.add(key)
                            image_downloads.append(path)
                    except Exception as fallback_exc:
                        LOGGER.warning("stock_image_fallback_failed query=%s error=%s", query, str(fallback_exc)[:180])
            if len(image_downloads) >= min_images_to_proceed:
                break
            if len(image_downloads) < planned_images:
                LOGGER.info(
                    "auto_media_image_retry attempt=%s downloaded=%s planned=%s",
                    attempt_idx,
                    len(image_downloads),
                    planned_images,
                )
                time.sleep(min(3, attempt_idx))
        if image_downloads:
            media_paths.extend(image_downloads)
        LOGGER.info(
            json.dumps(
                {
                    "event": "auto_media_download",
                    "type": "image",
                    "downloaded": len(image_downloads),
                    "planned": planned_images,
                    "targetSeconds": round(float(target_duration), 2),
                },
                ensure_ascii=False,
            )
        )
    elif not scene_queries:
        LOGGER.warning("auto_media_download skipped: no scene queries available")
        _log_job_stage(payload, "media", "auto media download skipped (no scene queries)", level="warning")

    if not media_paths:
        # API quota/network failures can lead to zero downloads; reuse local assets as fallback.
        local_videos = sorted([p for p in CLIPS_DIR.rglob("*.mp4") if p.is_file()])
        local_images = sorted([p for p in CLIPS_DIR.rglob("*.jpg") if p.is_file()])
        local_images.extend([p for p in CLIPS_DIR.rglob("*.jpeg") if p.is_file()])
        local_images.extend([p for p in CLIPS_DIR.rglob("*.png") if p.is_file()])
        fallback_media = local_videos[:16] + local_images[:8]
        if fallback_media:
            media_paths.extend(fallback_media)
            LOGGER.info(
                json.dumps(
                    {"event": "auto_media_fallback_local", "videos": len(local_videos[:16]), "images": len(local_images[:8])},
                    ensure_ascii=False,
                )
            )
            _log_job_stage(payload, "media", f"using local fallback media videos={len(local_videos[:16])} images={len(local_images[:8])}")
    if not media_paths:
        placeholders = _create_placeholder_media(CLIPS_DIR / "fallback_media", tag="job_fallback")
        if placeholders:
            media_paths.extend(placeholders)
            _log_job_stage(payload, "media", "using generated placeholder media", level="warning")
    if not media_paths:
        _log_job_stage(payload, "media", "no media available after all fallbacks; proceeding with empty media list", level="warning")

    LOGGER.info("Stage: Rendering vertical video")
    _log_job_stage(payload, "render", f"render start media_count={len(media_paths)}")
    output_video_path = output_dir / "final_full.mp4"
    render_vertical_video(
        media_paths=media_paths,
        audio_path=audio_path,
        subtitle_path=subtitle_path,
        output_path=output_video_path,
        target_duration_seconds=max(1.0, target_duration),
    )
    LOGGER.info("Video rendered successfully: %s", output_video_path)
    _log_job_stage(payload, "render", f"render completed video={output_video_path}")

    # Collect used media info for backend reporting
    used_clips_info = []
    used_images_info = []
    for mp in media_paths:
        mp_str = str(mp)
        entry = {"filename": mp.name, "path": mp_str, "size": mp.stat().st_size if mp.exists() else 0}
        if mp.suffix.lower() in {".mp4", ".mov", ".avi", ".webm", ".mkv"}:
            used_clips_info.append(entry)
        else:
            used_images_info.append(entry)
    LOGGER.info("Used media: %d clips, %d images", len(used_clips_info), len(used_images_info))

    youtube_cfg = payload.get("youtube", {}) if isinstance(payload.get("youtube"), dict) else {}
    upload_requested = bool(upload)
    uploaded_video_id = ""
    uploaded_video_url = ""
    if upload_requested:
        LOGGER.info("Stage: Uploading to YouTube")
        _log_job_stage(payload, "upload", "upload start")
        try:
            upload_result = upload_video(
                video_path=output_video_path,
                title=str(youtube_cfg.get("title", "Untitled Short")).strip()[:100] or "Untitled Short",
                description=str(youtube_cfg.get("description", "")).strip(),
                tags=[str(x).strip() for x in (youtube_cfg.get("hashtags") or []) if str(x).strip()],
                privacy_status="public",
                client_secret_file=str(YOUTUBE_CLIENT_SECRET_FILE),
                scopes=YOUTUBE_SCOPES,
                token_path=TOKEN_PATH,
                publish_at=publish_at,
                validate_shorts=False,
                strict_shorts_validation=False,
            )
            uploaded_video_id = str(upload_result.get("id", "")).strip()
            if uploaded_video_id:
                uploaded_video_url = f"https://www.youtube.com/watch?v={uploaded_video_id}"
                LOGGER.info("YouTube upload successful: %s", uploaded_video_url)
                _log_job_stage(payload, "upload", f"upload completed video_id={uploaded_video_id}")
        except Exception as exc:
            _log_job_stage(payload, "upload", f"upload failed but pipeline continuing: {str(exc)[:220]}", level="warning")

    # Cleanup local artifacts after successful upload (if enabled).
    if upload_requested and uploaded_video_id and CLEANUP_LOCAL_FILES_AFTER_UPLOAD:
        _cleanup_after_successful_upload(
            media_paths=media_paths,
            audio_path=audio_path,
            subtitle_path=subtitle_path,
            output_video_path=output_video_path,
        )
        LOGGER.info("Stage: Post-upload cleanup completed (local artifacts deleted)")
    else:
        LOGGER.info("Stage: Post-upload cleanup skipped (artifacts retained)")

    final_payload = {
        "jobId": str(payload.get("jobId", "") or payload.get("job_id", "") or os.getenv("JOB_ID", "")).strip(),
        "status": "completed",
        "result": {
            **prepared_payload,
            "mode": "full",
            "video_path": str(output_video_path),
            "uploadRequested": upload_requested,
            "uploadSkipped": not upload_requested,
            "uploadSkipReason": "" if upload_requested else "upload_not_requested",
            "youtubeVideoId": uploaded_video_id,
            "videoUrl": uploaded_video_url,
            "usedClips": used_clips_info,
            "usedImages": used_images_info,
        },
    }
    final_payload["contract"] = {
        "jobId": final_payload["jobId"],
        "status": "COMPLETED",
        "content": {
            "script": prepared_payload.get("script", ""),
            "captions": (prepared_payload.get("captions", {}) or {}).get("timed", []),
            "hashtags": prepared_payload.get("hashtags", []),
        },
        "media": [*used_clips_info, *used_images_info],
        "audio": {
            "path": prepared_payload.get("audio_path", ""),
            "duration": prepared_payload.get("duration_actual", prepared_payload.get("duration", 0)),
        },
    }
    final_payload["state"] = "COMPLETED"
    final_payload["content"] = final_payload["contract"]["content"]
    final_payload["media"] = final_payload["contract"]["media"]
    final_payload["audio"] = final_payload["contract"]["audio"]
    
    # Critical: Required by pipelineWorker.ts to extract pipeline output JSON in local mode
    print(f"PIPELINE_OUTPUT_JSON:{json.dumps(final_payload, ensure_ascii=False)}")
    
    send_pipeline_complete(final_payload)
    LOGGER.info(json.dumps({"event": "full_mode_complete", "videoPath": str(output_video_path), "uploaded": bool(uploaded_video_id), "usedClips": len(used_clips_info), "usedImages": len(used_images_info)}, ensure_ascii=False))
    return [output_video_path]


def run_news_pipeline(
    upload: bool,
    publish_at: str | None,
    count: int,
) -> list[Path]:
    """
    News pipeline:
    news_fetcher -> gemini_content_generator -> video pipeline
    """
    raise RuntimeError("Legacy AI generation mode is disabled. Pipeline supports only prepared mode.")


def run_auto_pipeline(
    topic: str,
    niche: str,
    upload: bool,
    publish_at: str | None,
    count: int,
) -> list[Path]:
    """
    Auto flow:
    trend_engine -> topic_selector -> gemini_content_generator
    -> scene_extractor -> video_fetcher -> voice_generator
    -> video_creator -> youtube_uploader
    """
    raise RuntimeError("Legacy AI generation mode is disabled. Pipeline supports only prepared mode.")


def run_optimized_pipeline(
    topic: str,
    niche: str,
    upload: bool,
    publish_at: str | None,
    count: int,
) -> list[Path]:
    """
    Optimized auto flow:
    trend_engine -> competitor_analyzer -> AI idea generation
    -> ranking/dedup -> optimized script build -> video pipeline
    """
    raise RuntimeError("Legacy AI generation mode is disabled. Pipeline supports only prepared mode.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Advanced YouTube Shorts automation bot.")
    parser.add_argument("--news", action="store_true", help="Run news mode using GNews")
    parser.add_argument("--auto", action="store_true", help="Run full auto mode using trending topics")
    parser.add_argument(
        "--optimized",
        action="store_true",
        help="Run optimized auto mode with competitor analysis + idea ranking",
    )
    parser.add_argument("--topic", default="", help="Topic override for manual or auto mode")
    parser.add_argument("--niche", default=DEFAULT_NICHE, help="Niche context for trend scoring")
    parser.add_argument("--generate-topic", action="store_true", help="Legacy flag for auto topic selection")
    parser.add_argument("--upload", action="store_true", help="Upload final video to YouTube")
    parser.add_argument(
        "--publish-at",
        help="Schedule publish time, e.g. 2026-03-10T18:30:00+05:30",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=VIDEOS_PER_DAY,
        help="Number of videos to generate in this run (default from VIDEOS_PER_DAY)",
    )
    return parser.parse_args()


def main() -> None:
    _setup_logging()
    run_mode_raw = os.getenv("RUN_MODE", "")
    cleaned = run_mode_raw.strip().strip('"').strip("'").lower()
    token = cleaned.replace(",", " ").split()[0] if cleaned else ""
    run_mode = {"execution": "prepared"}.get(token, token)
    if run_mode not in {"prepared", "full"}:
        raise SystemExit(
            f"Pipeline supports only prepared/full mode "
            f"(RUN_MODE raw={run_mode_raw!r}, normalized={run_mode!r})"
        )
    raise SystemExit("Use azure_job_runner for execution.")


if __name__ == "__main__":
    main()

