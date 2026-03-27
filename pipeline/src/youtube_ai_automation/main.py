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
import requests
import socket
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
    LOG_LEVEL,
    MAX_VIDEO_LENGTH,
    MIN_VIDEO_LENGTH,
    MAX_SCRIPT_SECONDS,
    MIN_SCRIPT_SECONDS,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    PEXELS_API_KEY,
    PIXABAY_API_KEY,
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
from youtube_ai_automation.video_creator import create_subtitles_from_script
from youtube_ai_automation.video_fetcher import download_scene_videos
from youtube_ai_automation.viral_pattern_engine import ViralPatternScore, estimate_viral_probability
from youtube_ai_automation.voice_generator import generate_voice, pick_voice_profile
from youtube_ai_automation.youtube_uploader import SHORTS_MAX_DURATION_SECONDS, upload_video
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
                            pixabay_key=PIXABAY_API_KEY,
                            scene_duration=scene_duration,
                            min_resolution=720,
                            used_clips_file=USED_CLIPS_FILE,
                            clips_per_scene_min=1,
                            clips_per_scene_max=1,
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


def _extract_target_duration(video_config: dict) -> int:
    raw = video_config.get("targetDuration", video_config.get("duration", 60))
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
    """Estimate TTS audio length from word count at 2.5 WPS."""
    words = max(1, len(str(script or "").split()))
    return round(words / 2.5, 2)


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
    words = str(script or "").split()
    if len(words) <= max_words:
        return str(script or "").strip()
    trimmed = " ".join(words[:max_words]).strip()
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed


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
) -> list[Path]:
    # Production prepared mode: deterministic timing + Google audio only.
    # Video stitching/upload side-effects are intentionally disabled in this mode.
    created: list[Path] = []
    if not isinstance(payload, dict):
        raise ValueError("PIPELINE_PAYLOAD must be an object.")

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

    target_duration = _extract_target_duration(video_config)
    cta_enabled = bool(video_config.get("ctaEnabled", video_config.get("enableCTA", False)))
    recap_enabled = bool(video_config.get("recapEnabled", False))
    story_mode = bool(video_config.get("storyMode", False))
    current_part = int(video_config.get("currentPart", 1) or 1)
    last_prompt = str(video_config.get("lastPrompt", ""))
    if story_mode and current_part <= 1:
        recap_enabled = False
    topic = str(youtube.get("title", "Prepared Topic") or "Prepared Topic").strip()
    voice_name = str(video_config.get("voice", "") or (video_config.get("voices") or [""])[0]).strip()
    if not voice_name:
        voice_name = DEFAULT_VOICE
    voice_rate = str(video_config.get("voiceRate", "") or "").strip()
    font_style = str(video_config.get("templateConfig", {}).get("fontStyle", "Anton")).strip() or "Anton"
    subtitle_color = str(video_config.get("templateConfig", {}).get("subtitleColor", "#FFFFFF")).strip() or "#FFFFFF"

    best_script = ""
    last_valid_script = script_text
    best_sections: dict[str, str] = {"hook": "", "main_content": "", "recap": "", "cta": ""}
    best_section_budget: dict[str, int] = {"hook": 0, "main_content": 0, "recap": 0, "cta": 0}
    last_errors: list[str] = []
    output_dir = AUDIO_PATH.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    MAX_ATTEMPTS = 4
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
        ordered_parts = [
            section_scripts["hook"],
            section_scripts["main_content"],
            section_scripts["recap"],
            section_scripts["cta"],
        ]
        full_script = " ".join(p for p in ordered_parts if p).strip()
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
            extra_words = int(deficit * 2.5)
            section_scripts["main_content"] = expand_meaningfully(
                section_scripts["main_content"],
                max(8, extra_words),
            )
            full_script = " ".join(
                p for p in [
                    section_scripts["hook"],
                    section_scripts["main_content"],
                    section_scripts["recap"],
                    section_scripts["cta"],
                ] if p
            ).strip()
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

        best_script = full_script
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

    hard_cap_words = int(60 * 2.5)
    words = best_script.split()
    if len(words) > hard_cap_words:
        best_script = " ".join(words[:hard_cap_words])

    best_package = {
        "script": best_script,
        "sections": best_sections,
        "sections_budget": best_section_budget,
        "estimated_duration": round(estimate_script_duration_seconds(best_script), 2),
    }

    MAX_SECONDS = 60
    if best_package["estimated_duration"] > MAX_SECONDS:
        words = best_package["script"].split()
        max_words = int(MAX_SECONDS * 2.5)
        if len(words) > max_words:
            best_package["script"] = " ".join(words[:max_words])
            best_package["estimated_duration"] = estimate_audio_duration(best_package["script"])
        LOGGER.warning(
            "Script trimmed to hard 60s cap. estimated=%.1fs",
            best_package["estimated_duration"]
        )

    full_audio_path: Path | None = None
    actual_audio_seconds = 0.0
    audio_retry_count = 0
    audio_failed = False
    min_words = max(30, int(max(10, target_duration - 5) * 2.5))
    max_words = int(min(60, target_duration) * 2.5)
    try:
        for audio_attempt in range(1, 4):
            # Keep script bounded before every expensive TTS attempt.
            best_package["script"] = _enforce_word_cap(best_package["script"], max_words)
            best_package["sections"]["main_content"] = _enforce_word_cap(
                best_package["sections"].get("main_content", ""),
                max(20, max_words - 40),
            )
            full_audio_path, _ = generate_voice(
                script=best_package["script"],
                voice=voice_name,
                rate=voice_rate,
                output_path=(output_dir / "voice_full.wav"),
                rotate_profile=False,
            )
            actual_audio_seconds = get_audio_duration_seconds(full_audio_path)
            if actual_audio_seconds <= 0:
                # Some providers may return audio data that isn't reliably parsable by wave.
                # Fall back to script-based duration instead of failing the whole job.
                actual_audio_seconds = estimate_audio_duration(best_package["script"])
                LOGGER.warning(
                    "Unable to measure generated audio duration; using estimated duration %.2fs",
                    actual_audio_seconds,
                )
                break
            drift = actual_audio_seconds - target_duration
            LOGGER.info(
                "audio_attempt=%s actual=%.2fs target=%ss drift=%.2fs",
                audio_attempt,
                actual_audio_seconds,
                target_duration,
                drift,
            )
            if abs(drift) <= 2:
                break
            # Regenerate only if drift is materially high
            if abs(drift) <= 3:
                break
            if audio_attempt >= 3:
                break
            audio_retry_count += 1
            current_main_seconds = max(
                1.0,
                estimate_duration_from_script(best_package["sections"].get("main_content", "")),
            )
            # Damped correction to avoid oscillation across retries.
            correction = max(1.0, abs(drift) * 0.7)
            if drift > 3:
                target_main_seconds = max(5, int(round(current_main_seconds - correction)))
                best_package["sections"]["main_content"] = adjust_script_to_duration(
                    script=best_package["sections"].get("main_content", ""),
                    target_seconds=target_main_seconds,
                    section_name="main",
                    topic_hint=topic,
                    story_mode=story_mode,
                )
            else:
                best_package["sections"]["main_content"] = expand_meaningfully(
                    best_package["sections"].get("main_content", ""),
                    max(8, int(abs(drift) * 2.5)),
                )
                target_main_seconds = max(5, int(round(current_main_seconds + correction)))
                best_package["sections"]["main_content"] = adjust_script_to_duration(
                    script=best_package["sections"]["main_content"],
                    target_seconds=target_main_seconds,
                    section_name="main",
                    topic_hint=topic,
                    story_mode=story_mode,
                )
            best_package["script"] = " ".join(
                p for p in [
                    best_package["sections"].get("hook", ""),
                    best_package["sections"].get("main_content", ""),
                    best_package["sections"].get("recap", ""),
                    best_package["sections"].get("cta", ""),
                ] if p
            ).strip()
            # Keep in a practical target window before next attempt.
            word_count_now = len(best_package["script"].split())
            if word_count_now < min_words:
                best_package["sections"]["main_content"] = expand_meaningfully(
                    best_package["sections"].get("main_content", ""),
                    min_words - word_count_now,
                )
                best_package["script"] = " ".join(
                    p for p in [
                        best_package["sections"].get("hook", ""),
                        best_package["sections"].get("main_content", ""),
                        best_package["sections"].get("recap", ""),
                        best_package["sections"].get("cta", ""),
                    ] if p
                ).strip()
            best_package["script"] = _enforce_word_cap(best_package["script"], max_words)
    except Exception as exc:
        audio_failed = True
        last_errors.append(f"audio_fallback:{str(exc)[:120]}")

    if full_audio_path is not None:
        created.append(full_audio_path)

    estimated_duration = estimate_audio_duration(best_package["script"])
    actual_audio_seconds = get_audio_duration_seconds(full_audio_path) if full_audio_path is not None else estimated_duration
    if actual_audio_seconds <= 0:
        actual_audio_seconds = estimated_duration
    if abs(actual_audio_seconds - estimated_duration) > 2:
        LOGGER.warning(
            "Audio/script sync drift detected. actual=%.2fs estimated=%.2fs",
            actual_audio_seconds,
            estimated_duration,
        )
        delta = actual_audio_seconds - estimated_duration
        if delta > 0:
            best_package["sections"]["main_content"] = adjust_script_to_duration(
                script=best_package["sections"].get("main_content", ""),
                target_seconds=max(5, int(best_package["sections_budget"].get("main_content", 5) - delta)),
                section_name="main",
                topic_hint=topic,
                story_mode=story_mode,
            )
        else:
            best_package["sections"]["main_content"] = expand_meaningfully(
                best_package["sections"].get("main_content", ""),
                max(6, int(abs(delta) * 2.5)),
            )
        best_package["script"] = " ".join(
            p for p in [
                best_package["sections"].get("hook", ""),
                best_package["sections"].get("main_content", ""),
                best_package["sections"].get("recap", ""),
                best_package["sections"].get("cta", ""),
            ] if p
        ).strip()
        best_package["script"] = _enforce_word_cap(best_package["script"], max_words)
        estimated_duration = estimate_audio_duration(best_package["script"])

    # Final hard guard: never return >60s practical script size.
    best_package["script"] = _enforce_word_cap(best_package["script"], int(60 * 2.5))
    timed_lines = build_timed_lines(best_package["script"])
    subtitle_file = create_subtitles_from_script(
        script=best_package["script"],
        estimated_duration_seconds=estimated_duration,
        subtitle_path=SUBTITLE_PATH,
        max_words=4,
        highlight_words=_extract_highlight_words(topic, best_package["sections"].get("hook", "")),
        line_mode=True,
        font_style=font_style,
        subtitle_color=subtitle_color,
    )

    valid, errors = validate_output(
        target_seconds=target_duration,
        actual_seconds=actual_audio_seconds or estimated_duration,
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
        if best_package["sections"].get("cta", "").strip():
            best_package["sections"]["cta"] = repair_section_ending_with_context(
                "cta", best_package["sections"], best_package["sections_budget"], topic, story_mode
            )
        elif best_package["sections"].get("recap", "").strip():
            best_package["sections"]["recap"] = repair_section_ending_with_context(
                "recap", best_package["sections"], best_package["sections_budget"], topic, story_mode
            )
        else:
            best_package["sections"]["main_content"] = repair_section_ending_with_context(
                "main_content", best_package["sections"], best_package["sections_budget"], topic, story_mode
            )
        best_package["script"] = " ".join(
            p for p in [
                best_package["sections"].get("hook", ""),
                best_package["sections"].get("main_content", ""),
                best_package["sections"].get("recap", ""),
                best_package["sections"].get("cta", ""),
            ] if p
        ).strip()
        ending_ok = True
    if ending_error:
        errors.append(f"ending:{ending_error}")

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
        "duration": best_package["estimated_duration"],
        "duration_target": target_duration,
        "duration_estimated": estimated_duration,
        "duration_actual": round(actual_audio_seconds or estimated_duration, 2),
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
    if audio_failed:
        result_payload["warning"] = "Used fallback due to retries"
        result_payload["duration"] = estimated_duration
        result_payload["validation_passed"] = False
    result_file = output_dir / "prepared_result.json"
    result_file.write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PIPELINE_OUTPUT_JSON:{json.dumps(result_payload, ensure_ascii=False)}")
    LOGGER.info("Prepared deterministic payload written to %s", result_file)
    return created


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
    if run_mode != "prepared":
        raise SystemExit(
            f"Pipeline supports only prepared mode "
            f"(RUN_MODE raw={run_mode_raw!r}, normalized={run_mode!r})"
        )
    raise SystemExit("Use azure_job_runner for prepared execution.")


if __name__ == "__main__":
    main()



