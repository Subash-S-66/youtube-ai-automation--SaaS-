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
from pathlib import Path
import random
import socket
import time

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
from youtube_ai_automation.video_creator import (
    create_scene_based_video,
    create_subtitles_from_script,
    probe_media_duration,
)
from youtube_ai_automation.video_fetcher import download_scene_videos
from youtube_ai_automation.viral_pattern_engine import ViralPatternScore, estimate_viral_probability
from youtube_ai_automation.voice_generator import generate_voice, pick_voice_profile
from youtube_ai_automation.youtube_uploader import SHORTS_MAX_DURATION_SECONDS, upload_video

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
    import os, json, random
    settings_env = os.getenv("SETTINGS", "{}")
    try:
        settings = json.loads(settings_env)
    except Exception:
        settings = {}

    target_duration = _script_duration_bounds(settings)
    LOGGER.info("Selected best topic: %s", idea.topic)
    LOGGER.info("Selected best hook: %s", idea.best_hook)
    LOGGER.info("Selected viral score: %.2f", idea.viral_score)

    voices = settings.get("voices", [])
    preferred_voice = ""
    if voices and isinstance(voices, list):
        preferred_voice = random.choice(voices)

    LOGGER.info("Generating voice narration")
    audio_file = _generate_narration_with_retries(
        script=idea.script,
        output_path=AUDIO_PATH,
        preferred_voice=preferred_voice,
    )

    content_type = settings.get("contentType", "clips").lower()
    user_media_paths = settings.get("userMediaPaths", [])

    scene_duration = _choose_scene_duration()
    try:
        audio_seconds = probe_media_duration(audio_file)
    except Exception as exc:
        audio_seconds = 0.0
        LOGGER.warning("Could not probe audio duration: %s", str(exc)[:160])
    target_scenes = _compute_target_scene_count(audio_seconds, scene_duration)

    scene_plan = extract_scenes(
        script=idea.script,
        topic=idea.topic,
        seed_queries=idea.search_queries,
        max_scenes=target_scenes,
    )
    scene_queries = scene_plan.search_queries[:]
    scene_queries = _extend_scene_queries(scene_queries, target_scenes)
    if len(scene_queries) > 2:
        body = scene_queries[1:]
        random.shuffle(body)
        scene_queries = [scene_queries[0], *body]

    videos = []

    # Pre-fill videos with user uploaded media if available
    if user_media_paths and isinstance(user_media_paths, list):
        for media_path in user_media_paths:
            path_obj = Path(media_path)
            if path_obj.exists():
                videos.append(path_obj)
        LOGGER.info(f"Loaded {len(videos)} user uploaded media clips")

    # If we need more videos than the user provided, fetch the rest
    needed_clips = len(scene_queries) - len(videos)

    if needed_clips > 0:
        remaining_queries = scene_queries[len(videos):]
        from youtube_ai_automation.services.media_service import fetch_media

        if content_type == "images":
            LOGGER.info("Media mode 'images': Downloading stock images via MediaService")
            videos.extend(fetch_media(remaining_queries, CLIPS_DIR, PEXELS_API_KEY, PIXABAY_API_KEY, use_images=True))
        elif content_type == "mixed":
            LOGGER.info("Media mode 'mixed': Downloading video and image clips via MediaService")
            for idx, query in enumerate(remaining_queries, start=1):
                try:
                    is_image = idx != 1 and idx != len(remaining_queries)
                    clips = fetch_media([query], CLIPS_DIR, PEXELS_API_KEY, PIXABAY_API_KEY, use_images=is_image)
                    videos.extend(clips)
                except Exception as e:
                    LOGGER.warning(f"Failed to fetch media for mixed scene '{query}': {e}")
        else:
            LOGGER.info("Media mode 'clips': Downloading stock videos via MediaService")
            videos.extend(fetch_media(remaining_queries, CLIPS_DIR, PEXELS_API_KEY, PIXABAY_API_KEY, use_images=False))

    LOGGER.info("Prepared %s media clips", len(videos))

    caption_chunk = _pick_caption_chunk_size()
    subtitle_file = create_subtitles_from_script(
        script=idea.script,
        audio_path=audio_file,
        subtitle_path=SUBTITLE_PATH,
        max_words=3,
        highlight_words=_extract_highlight_words(idea.topic, idea.best_hook),
        line_mode=True,
    )

    music_path = Path(BACKGROUND_MUSIC_PATH) if BACKGROUND_MUSIC_PATH else None
    video_file = create_scene_based_video(
        videos=videos,
        audio_path=audio_file,
        subtitle_path=subtitle_file,
        output_path=VIDEO_PATH,
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

    metadata = optimize_metadata(
        topic=idea.topic,
        hook=idea.best_hook,
        script=idea.script,
        selected_title=idea.title,
        viral_keywords=viral_keywords,
        used_titles_file=USED_TITLES_FILE,
    )
    upload_description = f"{metadata.description}\n\n{' '.join(metadata.hashtags)}".strip()
    LOGGER.info("Selected optimized title: %s", metadata.title)

    upload_result: dict | None = None
    if upload:
        LOGGER.info("Uploading optimized short to YouTube")
        LOGGER.info("Upload description preview: %s", upload_description[:220])
        LOGGER.info("Upload hashtags: %s", " ".join(metadata.hashtags))
        upload_result = upload_video(
            video_path=video_file,
            title=metadata.title,
            description=upload_description,
            tags=metadata.tags,
            privacy_status="public",
            client_secret_file=YOUTUBE_CLIENT_SECRET_FILE,
            scopes=YOUTUBE_SCOPES,
            token_path=TOKEN_PATH,
            publish_at=publish_at,
            validate_shorts=VALIDATE_SHORTS_BEFORE_UPLOAD,
            strict_shorts_validation=STRICT_SHORTS_VALIDATION,
        )
        LOGGER.info("Upload complete. Video ID: %s", upload_result.get("id"))
    else:
        LOGGER.info("Upload skipped (--upload not set)")

    if upload_result and upload_result.get("id"):
        uploaded_video_id = str(upload_result.get("id"))
        _record_successful_upload(
            title=metadata.title,
            topic=idea.topic,
            video_id=uploaded_video_id,
            keywords=metadata.tags,
        )
        _notify_progress_update(title=metadata.title, keywords=metadata.tags)
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
            topic=idea.topic,
            hook=idea.best_hook,
            title=metadata.title,
            hashtags=metadata.hashtags,
            score_breakdown=idea.score_breakdown or {},
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

    mark_topic_as_used(idea.topic)
    mark_hook_as_used(idea.best_hook)
    mark_generated_idea(
        topic=idea.topic,
        hook=idea.best_hook,
        generated_ideas_file=GENERATED_IDEAS_FILE,
        upload_date=publish_at,
    )
    return video_file


def _select_optimized_idea(topic: str, niche: str) -> AutoSelection:
    min_script_seconds, max_script_seconds = _script_duration_bounds()
    trend_candidates = get_trending_topics(limit=TREND_TOPIC_LIMIT)
    if topic.strip():
        trend_candidates = [topic.strip(), *trend_candidates]
    trend_candidates = _dedupe_preserve_order(trend_candidates)
    previous_topics = _load_previous_topics()
    base_memory = refresh_topic_generation_memory(
        trending_topics=trend_candidates,
        excluded_topics=previous_topics,
        selected_topic="",
        provider=AI_PROVIDER,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
    )
    memory_seed_queries = _dedupe_preserve_order(
        [*base_memory.get("search_queries", []), *base_memory.get("keywords", [])]
    )

    LOGGER.info("Analyzing trending Shorts competitors")
    insights = analyze_competitor_shorts(
        youtube_api_key=YOUTUBE_DATA_API_KEY,
        seed_queries=[*trend_candidates[:6], *memory_seed_queries[:6]],
        limit=50,
    )
    LOGGER.info(
        "Competitor insights: %s keywords, %s topics",
        len(insights.viral_keywords),
        len(insights.viral_topics),
    )

    topic_signals = _dedupe_preserve_order(
        [
            *trend_candidates,
            *insights.viral_topics,
            *base_memory.get("topic_directions", []),
            *base_memory.get("keywords", []),
            *base_memory.get("search_queries", []),
        ]
    )
    topic_memory = refresh_topic_generation_memory(
        trending_topics=topic_signals,
        excluded_topics=previous_topics,
        selected_topic="",
        provider=AI_PROVIDER,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
    )

    target_candidate_count = 10
    LOGGER.info("Generating %s idea candidates", target_candidate_count)
    idea_candidates = generate_idea_candidates(
        trending_topics=topic_signals,
        niche=niche,
        count=target_candidate_count,
        hook_count=HOOKS_PER_TOPIC,
        provider=AI_PROVIDER,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
        excluded_topics=previous_topics,
        memory=topic_memory,
    )
    LOGGER.info("Generated %s candidate ideas", len(idea_candidates))

    strategy = load_strategy(IMPROVEMENT_STATE_FILE)
    LOGGER.info(
        "Using strategy weights: base=%.3f pattern=%.3f",
        strategy.base_weight,
        strategy.pattern_weight,
    )
    growth_ranked = _build_growth_ranked_candidates(
        idea_candidates=idea_candidates,
        topic_signals=topic_signals,
        viral_keywords=insights.viral_keywords,
        viral_topics=insights.viral_topics,
        previous_topics=previous_topics,
        strategy=strategy,
    )

    try:
        selected_ranked = _pick_optimized_ranked_selection(growth_ranked)
    except ValueError:
        raise
    except Exception:
        raise

    try:
        select_best_unused_topic([item.ranked_idea.topic for item in growth_ranked])
    except ValueError as exc:
        LOGGER.warning(
            "Strict used-topic filter rejected initial optimized candidates. "
            "Regenerating with novelty prompt. Reason: %s",
            exc,
        )
        novelty_candidates = generate_idea_candidates(
            trending_topics=topic_signals,
            niche=niche,
            count=target_candidate_count,
            hook_count=HOOKS_PER_TOPIC,
            provider=AI_PROVIDER,
            gemini_api_key=GEMINI_API_KEY,
            gemini_model=GEMINI_MODEL,
            openai_api_key=OPENAI_API_KEY,
            openai_model=OPENAI_MODEL,
            anthropic_api_key=ANTHROPIC_API_KEY,
            anthropic_model=ANTHROPIC_MODEL,
            prompt_mode="novelty",
            excluded_topics=previous_topics,
            memory=topic_memory,
        )
        novelty_growth_ranked = _build_growth_ranked_candidates(
            idea_candidates=novelty_candidates,
            topic_signals=topic_signals,
            viral_keywords=insights.viral_keywords,
            viral_topics=insights.viral_topics,
            previous_topics=previous_topics,
            strategy=strategy,
        )
        selected_ranked = _pick_optimized_ranked_selection(novelty_growth_ranked)

    selected_candidate = IdeaCandidate(
        topic=selected_ranked.ranked_idea.topic,
        hooks=selected_ranked.ranked_idea.hook_options,
        script_outline=selected_ranked.ranked_idea.script_outline,
    )
    selected_hook = select_best_unused_hook(selected_candidate.hooks)
    score_breakdown = selected_ranked.ranked_idea.score_breakdown.as_dict()
    score_breakdown.update(selected_ranked.pattern_score.as_dict())
    score_breakdown["base_viral_score"] = round(selected_ranked.ranked_idea.viral_score, 2)
    score_breakdown["pattern_viral_score"] = round(
        selected_ranked.pattern_score.viral_probability_score,
        2,
    )
    score_breakdown["strategy_base_weight"] = round(strategy.base_weight, 4)
    score_breakdown["strategy_pattern_weight"] = round(strategy.pattern_weight, 4)
    score_breakdown["combined_viral_score"] = round(selected_ranked.combined_score, 2)

    # To properly set duration here, we fetch it from settings
    import os, json
    settings_env = os.getenv("SETTINGS", "{}")
    try:
        settings = json.loads(settings_env)
    except Exception:
        settings = {}
    target_duration = _script_duration_bounds(settings)

    optimized = build_optimized_idea(
        candidate=selected_candidate,
        best_hook=selected_hook,
        viral_score=selected_ranked.combined_score,
        score_breakdown=score_breakdown,
        provider=AI_PROVIDER,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
        target_duration=target_duration,
    )
    topic_memory = refresh_topic_generation_memory(
        trending_topics=topic_signals,
        excluded_topics=previous_topics,
        selected_topic=selected_candidate.topic,
        provider=AI_PROVIDER,
        gemini_api_key=GEMINI_API_KEY,
        gemini_model=GEMINI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        openai_model=OPENAI_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_model=ANTHROPIC_MODEL,
    )
    optimized.title = selected_ranked.title_result.best_title[:59]
    try:
        payload = json.loads(UPLOAD_REPORT_FILE.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    selected_topics = payload.get("selected_topics", [])
    if not isinstance(selected_topics, list):
        selected_topics = []
    selected_topics.append(selected_candidate.topic)
    update_upload_report_metadata(
        UPLOAD_REPORT_FILE,
        gemini_keywords=topic_memory.get("keywords", []),
        gemini_topics=topic_memory.get("topic_directions", []),
        selected_topics=selected_topics[:20],
    )
    return AutoSelection(idea=optimized, viral_keywords=insights.viral_keywords, topic_memory=topic_memory)


def _resolve_topic(auto: bool, topic: str, niche: str, mark_used: bool = True) -> str:
    provided = " ".join((topic or "").split()).strip()
    if not auto:
        if not provided:
            raise ValueError("Topic is required when auto mode is off.")
        return provided

    LOGGER.info("Fetching trending candidates...")
    candidates = get_trending_topics(limit=TREND_TOPIC_LIMIT)
    niche_tokens = {token for token in niche.lower().split() if len(token) > 2}
    if niche_tokens:
        candidates.sort(
            key=lambda item: sum(1 for token in niche_tokens if token in item.lower()),
            reverse=True,
        )
    LOGGER.info("Found %s trend candidates", len(candidates))
    if provided:
        # Ensure explicit topic still wins in auto mode.
        selected = provided
    else:
        selected = select_best_unused_topic(candidates)
        if mark_used:
            mark_topic_as_used(selected)
    LOGGER.info("Selected topic: %s", selected)
    return selected


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
    user_media_paths = settings.get("userMediaPaths", [])

    LOGGER.info("Generating voice narration via VoiceService")
    from youtube_ai_automation.services.voice_service import generate_audio

    audio_file, _ = generate_audio(
        script=content.script,
        voice=preferred_voice,
        output_path=AUDIO_PATH,
    )

    scene_duration = _choose_scene_duration()
    try:
        audio_seconds = probe_media_duration(audio_file)
    except Exception as exc:
        audio_seconds = 0.0
        LOGGER.warning("Could not probe audio duration: %s", str(exc)[:160])
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

    # Pre-fill videos with user uploaded media if available
    if user_media_paths and isinstance(user_media_paths, list):
        for media_path in user_media_paths:
            path_obj = Path(media_path)
            if path_obj.exists():
                videos.append(path_obj)
        LOGGER.info(f"Loaded {len(videos)} user uploaded media clips")

    # If we need more videos than the user provided, fetch the rest
    needed_clips = len(scene_queries) - len(videos)

    if needed_clips > 0:
        remaining_queries = scene_queries[len(videos):]
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
        audio_path=audio_file,
        subtitle_path=SUBTITLE_PATH,
        max_words=3,
        highlight_words=_extract_highlight_words(content.topic, content.hook),
        line_mode=True,
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
    resolved_topic = _resolve_topic(auto=generate_topic, topic=topic, niche=niche, mark_used=False)
    return _build_single_short(topic=resolved_topic, upload=upload, publish_at=publish_at)


def run_news_pipeline(
    upload: bool,
    publish_at: str | None,
    count: int,
) -> list[Path]:
    """
    News pipeline:
    news_fetcher -> gemini_content_generator -> video pipeline
    """
    created: list[Path] = []
    target_duration = 40 # Default if settings not available here
    LOGGER.info("Starting news generation")
    try:
        fetch_limit = max(count * NEWS_FETCH_MULTIPLIER, count)
        articles = get_latest_news(
            query=NEWS_QUERY,
            language=NEWS_LANGUAGE,
            lookback_hours=NEWS_LOOKBACK_HOURS,
            limit=fetch_limit,
        )
    except ValueError as e:
        LOGGER.error(f"Could not fetch news: {e}")
        return created

    if not articles:
        LOGGER.warning("No news articles found.")
        return created

    headlines: list[str] = []
    seen = set()
    for article in articles:
        title = str(article.get("title", "")).strip()
        if not title:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        headlines.append(title)

    if not headlines:
        LOGGER.warning("No usable headlines found in news articles.")
        return created

    filtered_headlines = filter_unused_topics(headlines)
    if not filtered_headlines:
        LOGGER.warning("All fetched headlines are already used. Try again later.")
        return created

    if len(filtered_headlines) < count:
        LOGGER.warning(
            "Only %s fresh headlines available (requested %s). Proceeding with available.",
            len(filtered_headlines),
            count,
        )

    effective_count = min(count, len(filtered_headlines))

    for index, headline in enumerate(filtered_headlines[:effective_count]):
        LOGGER.info("Starting news video generation %s/%s", index + 1, effective_count)
        LOGGER.info("news_fetcher: selected headline: %s", headline)

        LOGGER.info("gemini_content_generator: generating structured content via Gemini Flash")
        content = generate_gemini_content(
            topic=headline,
            gemini_api_key=GEMINI_API_KEY,
            gemini_model=GEMINI_MODEL,
            target_duration=target_duration,
            content_type="news",
        )
        try:
            video_path = _build_video_from_content(
                content=content,
                upload=upload,
                publish_at=None,
            )
            created.append(video_path)
        except NarrationUnavailableError as exc:
            LOGGER.error("Skipping news video %s/%s: %s", index + 1, effective_count, exc)
    return created


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
    created: list[Path] = []
    target_duration = 40
    for index in range(max(1, count)):
        LOGGER.info("Starting auto generation %s/%s", index + 1, count)
        LOGGER.info("trend_engine: collecting trend candidates")
        trend_candidates = get_trending_topics(limit=TREND_TOPIC_LIMIT)
        try:
            selected_topic = choose_topic(
                candidates=trend_candidates,
                preferred_topic=topic if index == 0 else "",
                niche=niche,
            )
        except ValueError as exc:
            LOGGER.error("Skipping auto video %s/%s: %s", index + 1, count, exc)
            continue
        LOGGER.info("topic_selector: selected topic: %s", selected_topic)

        LOGGER.info("gemini_content_generator: generating structured content via Gemini Flash")
        content = generate_gemini_content(
            topic=selected_topic,
            gemini_api_key=GEMINI_API_KEY,
            gemini_model=GEMINI_MODEL,
            target_duration=target_duration,
        )
        try:
            video_path = _build_video_from_content(
                content=content,
                upload=upload,
                publish_at=publish_at if index == 0 else None,
            )
            created.append(video_path)
        except NarrationUnavailableError as exc:
            LOGGER.error("Skipping auto video %s/%s: %s", index + 1, count, exc)
    return created


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
    created: list[Path] = []
    for index in range(max(1, count)):
        LOGGER.info("Starting optimized generation %s/%s", index + 1, count)
        selection: AutoSelection | None = None
        for attempt in range(1, TOPIC_SELECTION_RETRY_ATTEMPTS + 1):
            try:
                selection = _select_optimized_idea(
                    topic=topic if index == 0 else "",
                    niche=niche,
                )
                break
            except ValueError as exc:
                message = str(exc)
                if "already been used" in message.lower() or "no candidate topics" in message.lower():
                    if attempt < TOPIC_SELECTION_RETRY_ATTEMPTS:
                        wait_seconds = 2 * attempt
                        LOGGER.warning(
                            "Topic pool exhausted for optimized video %s/%s (attempt %s/%s). "
                            "Retrying with fresh trends in %ss.",
                            index + 1,
                            count,
                            attempt,
                            TOPIC_SELECTION_RETRY_ATTEMPTS,
                            wait_seconds,
                        )
                        time.sleep(wait_seconds)
                        continue
                    LOGGER.error(
                        "Skipping optimized video %s/%s: %s",
                        index + 1,
                        count,
                        message,
                    )
                    break
                raise
            except RuntimeError as exc:
                if attempt < TOPIC_SELECTION_RETRY_ATTEMPTS:
                    wait_seconds = 2 * attempt
                    LOGGER.warning(
                        "Optimized idea selection failed for video %s/%s (attempt %s/%s): %s. Retrying in %ss.",
                        index + 1,
                        count,
                        attempt,
                        TOPIC_SELECTION_RETRY_ATTEMPTS,
                        str(exc),
                        wait_seconds,
                    )
                    time.sleep(wait_seconds)
                    continue
                LOGGER.error("Skipping optimized video %s/%s: %s", index + 1, count, exc)
                break

        if selection is None:
            continue

        try:
            video_path = _build_short_from_optimized_idea(
                idea=selection.idea,
                viral_keywords=selection.viral_keywords,
                upload=upload,
                publish_at=publish_at if index == 0 else None,
            )
            created.append(video_path)
        except NarrationUnavailableError as exc:
            LOGGER.error("Skipping optimized video %s/%s: %s", index + 1, count, exc)
    return created


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
    reset_upload_report(UPLOAD_REPORT_FILE)
    args = parse_args()
    update_upload_report_metadata(UPLOAD_REPORT_FILE, requested_count=max(1, args.count))
    if sum([args.auto, args.optimized, args.news]) > 1:
        raise SystemExit("Choose only one mode: --auto, --optimized, or --news")

    is_trending_mode = args.auto or args.optimized or args.generate_topic
    _run_network_preflight(check_trend_sources=is_trending_mode, upload=args.upload)

    if args.optimized:
        run_optimized_pipeline(
            topic=args.topic,
            niche=args.niche,
            upload=args.upload,
            publish_at=args.publish_at,
            count=max(1, args.count),
        )
    elif args.auto:
        run_auto_pipeline(
            topic=args.topic,
            niche=args.niche,
            upload=args.upload,
            publish_at=args.publish_at,
            count=max(1, args.count),
        )
    else:
        run_news_pipeline(
            upload=args.upload,
            publish_at=args.publish_at,
            count=max(1, args.count),
        )


if __name__ == "__main__":
    main()

