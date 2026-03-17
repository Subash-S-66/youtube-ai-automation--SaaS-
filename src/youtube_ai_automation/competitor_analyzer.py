"""
Analyze trending Shorts competitors and extract viral patterns.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Iterable

import requests


STOP_WORDS = {
    "the",
    "a",
    "an",
    "to",
    "of",
    "for",
    "and",
    "or",
    "is",
    "are",
    "you",
    "your",
    "this",
    "that",
    "with",
    "from",
    "in",
    "on",
    "at",
    "it",
    "its",
    "how",
    "why",
    "what",
    "when",
    "who",
    "new",
    "best",
}


@dataclass
class CompetitorVideo:
    video_id: str
    title: str
    description: str
    tags: list[str]
    view_count: int
    publish_date: str


@dataclass
class CompetitorInsights:
    videos: list[CompetitorVideo]
    viral_keywords: list[str]
    viral_topics: list[str]
    popular_hooks: list[str]


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _normalize_text(text: str) -> str:
    return " ".join(text.split()).strip()


def _extract_hook_pattern(title: str) -> str:
    normalized = _normalize_text(title)
    if not normalized:
        return ""
    match = re.split(r"[.!?:\-|]", normalized, maxsplit=1)
    hook = match[0].strip()
    return hook[:80]


def _extract_candidate_topic(title: str) -> str:
    tokens = [token for token in _tokenize(title) if token not in STOP_WORDS]
    if len(tokens) < 2:
        return ""
    topic = " ".join(tokens[:4])
    return topic.strip()


def _fetch_search_results(api_key: str, query: str, max_results: int = 25) -> list[str]:
    endpoint = "https://www.googleapis.com/youtube/v3/search"
    published_after = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat().replace("+00:00", "Z")
    params = {
        "part": "snippet",
        "type": "video",
        "q": query,
        "videoDuration": "short",
        "maxResults": max(1, min(50, max_results)),
        "order": "viewCount",
        "publishedAfter": published_after,
        "relevanceLanguage": "en",
        "key": api_key,
    }
    response = requests.get(endpoint, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    video_ids = []
    for item in payload.get("items", []):
        vid = item.get("id", {}).get("videoId")
        if vid:
            video_ids.append(str(vid))
    return video_ids


def _fetch_video_details(api_key: str, video_ids: list[str]) -> list[CompetitorVideo]:
    if not video_ids:
        return []
    endpoint = "https://www.googleapis.com/youtube/v3/videos"
    chunks: list[list[str]] = [video_ids[i : i + 50] for i in range(0, len(video_ids), 50)]
    out: list[CompetitorVideo] = []
    for chunk in chunks:
        params = {
            "part": "snippet,statistics",
            "id": ",".join(chunk),
            "key": api_key,
            "maxResults": 50,
        }
        response = requests.get(endpoint, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("items", []):
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})
            out.append(
                CompetitorVideo(
                    video_id=str(item.get("id", "")),
                    title=_normalize_text(str(snippet.get("title", ""))),
                    description=_normalize_text(str(snippet.get("description", ""))),
                    tags=[str(tag) for tag in snippet.get("tags", []) if str(tag).strip()],
                    view_count=int(stats.get("viewCount", 0) or 0),
                    publish_date=str(snippet.get("publishedAt", "")),
                )
            )
    out.sort(key=lambda row: row.view_count, reverse=True)
    return out


def _extract_keyword_patterns(videos: Iterable[CompetitorVideo]) -> tuple[list[str], list[str], list[str]]:
    keyword_counter: Counter[str] = Counter()
    topic_counter: Counter[str] = Counter()
    hook_counter: Counter[str] = Counter()

    for video in videos:
        for token in _tokenize(video.title):
            if len(token) < 3 or token in STOP_WORDS:
                continue
            keyword_counter[token] += 1
        for tag in video.tags:
            for token in _tokenize(tag):
                if len(token) < 3 or token in STOP_WORDS:
                    continue
                keyword_counter[token] += 2
        topic = _extract_candidate_topic(video.title)
        if topic:
            topic_counter[topic] += 1
        hook = _extract_hook_pattern(video.title)
        if hook:
            hook_counter[hook] += 1

    viral_keywords = [word for word, _ in keyword_counter.most_common(25)]
    viral_topics = [word for word, _ in topic_counter.most_common(20)]
    popular_hooks = [word for word, _ in hook_counter.most_common(20)]
    return viral_keywords, viral_topics, popular_hooks


def analyze_competitor_shorts(
    youtube_api_key: str,
    seed_queries: list[str] | None = None,
    limit: int = 50,
) -> CompetitorInsights:
    """
    Analyze top trending Shorts-like videos and extract viral patterns.
    """
    default_queries = [
        "space discoveries shorts",
        "robotics shorts",
        "biotech breakthroughs shorts",
        "cybersecurity shorts",
        "tech facts shorts",
        "science breakthroughs shorts",
    ]
    query_pool = [query for query in (seed_queries or []) if query.strip()]
    query_pool.extend(default_queries)

    if not youtube_api_key:
        fallback_keywords = [
            "science",
            "technology",
            "breakthrough",
            "discovery",
            "robotics",
            "space",
            "cybersecurity",
            "technology",
            "innovation",
        ]
        fallback_topics = [
            "space telescope discoveries",
            "robotics breakthroughs",
            "biotech advances",
            "cybersecurity discoveries",
        ]
        fallback_hooks = [
            "Stop scrolling - this breakthrough changes what we thought was possible",
            "Nobody expected this discovery to work so well",
            "Most people missed why this technology matters",
        ]
        return CompetitorInsights(
            videos=[],
            viral_keywords=fallback_keywords,
            viral_topics=fallback_topics,
            popular_hooks=fallback_hooks,
        )

    unique_ids: list[str] = []
    seen_ids: set[str] = set()
    for query in query_pool[:8]:
        try:
            ids = _fetch_search_results(youtube_api_key, query, max_results=25)
        except Exception:
            continue
        for vid in ids:
            if vid in seen_ids:
                continue
            seen_ids.add(vid)
            unique_ids.append(vid)
            if len(unique_ids) >= limit:
                break
        if len(unique_ids) >= limit:
            break

    videos = _fetch_video_details(youtube_api_key, unique_ids[:limit])
    viral_keywords, viral_topics, popular_hooks = _extract_keyword_patterns(videos)

    if not viral_keywords:
        viral_keywords = ["science", "technology", "breakthrough", "discovery", "robotics"]
    if not viral_topics:
        viral_topics = ["space science discoveries", "robotics breakthroughs", "cybersecurity facts"]

    return CompetitorInsights(
        videos=videos[:limit],
        viral_keywords=viral_keywords,
        viral_topics=viral_topics,
        popular_hooks=popular_hooks,
    )

