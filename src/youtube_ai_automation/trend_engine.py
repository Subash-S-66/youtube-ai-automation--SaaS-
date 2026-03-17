"""
Trending topic engine:
- Google Trends via pytrends
- Reddit hot posts
- Optional YouTube trending titles via Data API
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import re
from typing import Iterable
from xml.etree import ElementTree

import requests

from youtube_ai_automation.config import REDDIT_SUBREDDITS, TREND_TOPIC_LIMIT, YOUTUBE_DATA_API_KEY, YOUTUBE_REGION_CODE

LOGGER = logging.getLogger(__name__)
GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=US"

NICHE_KEYWORDS = {
    "technology",
    "tech",
    "ai",
    "artificial intelligence",
    "machine learning",
    "productivity",
    "automation",
    "future",
    "future tech",
    "internet",
    "viral",
    "discovery",
    "science",
    "tools",
    "startup",
    "coding",
    "gadget",
    "openai",
    "apple",
    "google",
    "spacex",
    "startup",
    "startups",
    "cybersecurity",
    "smartphone",
    "iphone",
    "android",
    "browser",
    "hidden",
    "feature",
    "software",
    "trick",
    "discoveries",
    "productivity tools",
}

TREND_PRIORITY_TERMS = [
    "ai",
    "openai",
    "apple",
    "google",
    "spacex",
    "tech startups",
    "cybersecurity",
    "smartphone tricks",
    "productivity tools",
]

PRIORITY_TOPIC_SEEDS = [
    "Hidden iPhone Feature Most People Don't Know",
    "NASA telescope discovery most people missed",
    "The Tech Billionaires Are Quietly Investing In",
    "This Browser Trick Saves Hours",
    "Robotics breakthrough changing warehouse automation",
    "Apple shortcut that automates your daily tasks",
    "Cybersecurity setting every smartphone user should enable",
    "SpaceX Starship milestone changing spaceflight",
    "Nuclear fusion result scientists did not expect",
]

BLOCKED_KEYWORDS = {
    "porn",
    "pornstar",
    "nsfw",
    "onlyfans",
    "sex",
    "sexual",
    "nude",
    "violence",
    "gore",
    "war",
    "murder",
    "suicide",
    "politics",
    "election",
}


@dataclass
class TopicCandidate:
    """A trending topic with source and ranking score."""

    topic: str
    source: str
    score: float


def _normalize_topic(text: str) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"[\[\]\(\)\{\}\"`]+", "", text)
    return text[:120].strip(" -_:,")


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _score_topic(topic: str, source_weight: float = 1.0) -> float:
    tokens = _tokenize(topic)
    keyword_hits = sum(1 for keyword in NICHE_KEYWORDS if keyword in topic.lower())
    token_hits = sum(1 for token in tokens if token in NICHE_KEYWORDS)
    priority_hits = sum(1 for keyword in TREND_PRIORITY_TERMS if keyword in topic.lower())
    novelty_bonus = 0.8 if 4 <= len(tokens) <= 10 else 0.2
    return source_weight * (keyword_hits * 1.4 + token_hits * 0.8 + priority_hits * 1.6 + novelty_bonus)


def _passes_niche_filter(topic: str) -> bool:
    low = topic.lower()
    if any(keyword in low for keyword in BLOCKED_KEYWORDS):
        return False
    if any(keyword in low for keyword in NICHE_KEYWORDS):
        return True
    tokens = _tokenize(low)
    return bool(tokens.intersection(NICHE_KEYWORDS))


def _unique_topics(topics: Iterable[TopicCandidate]) -> list[TopicCandidate]:
    deduped: dict[str, TopicCandidate] = {}
    for candidate in topics:
        key = candidate.topic.lower()
        current = deduped.get(key)
        if current is None or candidate.score > current.score:
            deduped[key] = candidate
    return list(deduped.values())


def _build_topic_candidates(
    topics: Iterable[str],
    source: str,
    source_weight: float,
    limit: int,
) -> list[TopicCandidate]:
    results: list[TopicCandidate] = []
    for topic in topics:
        normalized = _normalize_topic(str(topic))
        if not normalized:
            continue
        results.append(
            TopicCandidate(
                topic=normalized,
                source=source,
                score=_score_topic(normalized, source_weight=source_weight),
            )
        )
        if len(results) >= limit:
            break
    return results


def _fetch_google_trends_via_pytrends(limit: int) -> list[TopicCandidate]:
    from pytrends.request import TrendReq  # Lazy import, optional dependency

    pytrends = TrendReq(hl="en-US", tz=330)
    df = pytrends.trending_searches(pn="united_states")
    if df.empty:
        return []
    topics = df.iloc[:, 0].astype(str).tolist()
    return _build_topic_candidates(
        topics=topics,
        source="google_trends",
        source_weight=1.3,
        limit=limit,
    )


def _fetch_google_trends_via_rss(limit: int) -> list[TopicCandidate]:
    headers = {"User-Agent": "youtube-ai-automation/1.0"}
    response = requests.get(GOOGLE_TRENDS_RSS_URL, headers=headers, timeout=20)
    response.raise_for_status()

    root = ElementTree.fromstring(response.content)
    channel = root.find("channel")
    if channel is None:
        return []

    topics = []
    for item in channel.findall("item"):
        title = item.findtext("title", default="")
        if title:
            topics.append(title)
    return _build_topic_candidates(
        topics=topics,
        source="google_trends_rss",
        source_weight=1.25,
        limit=limit,
    )


def _fetch_google_trends(limit: int = 30) -> list[TopicCandidate]:
    errors: list[str] = []

    try:
        results = _fetch_google_trends_via_pytrends(limit=limit)
        if results:
            return results
        errors.append("pytrends returned no topics")
    except Exception as exc:
        errors.append(f"pytrends: {exc}")

    try:
        results = _fetch_google_trends_via_rss(limit=limit)
        if results:
            return results
        errors.append("rss returned no topics")
    except Exception as exc:
        errors.append(f"rss: {exc}")

    LOGGER.debug("Google Trends unavailable, continuing with fallback sources (%s)", "; ".join(errors))
    return []


def _fetch_reddit_topics(limit: int = 30) -> list[TopicCandidate]:
    topics: list[TopicCandidate] = []
    subreddits = [item.strip() for item in REDDIT_SUBREDDITS.split(",") if item.strip()]
    headers = {"User-Agent": "youtube-ai-automation/1.0"}
    for subreddit in subreddits:
        url = f"https://www.reddit.com/r/{subreddit}/hot.json"
        try:
            response = requests.get(url, headers=headers, params={"limit": 20}, timeout=20)
            response.raise_for_status()
            payload = response.json()
            children = payload.get("data", {}).get("children", [])
            for child in children:
                raw = child.get("data", {}).get("title", "")
                normalized = _normalize_topic(raw)
                if not normalized:
                    continue
                topics.append(
                    TopicCandidate(
                        topic=normalized,
                        source=f"reddit:{subreddit}",
                        score=_score_topic(normalized, source_weight=1.0),
                    )
                )
                if len(topics) >= limit:
                    return topics[:limit]
        except Exception as exc:
            LOGGER.debug("Reddit source unavailable for r/%s: %s", subreddit, exc)
    return topics[:limit]


def _fetch_youtube_trending(limit: int = 20) -> list[TopicCandidate]:
    if not YOUTUBE_DATA_API_KEY:
        return []

    endpoint = "https://www.googleapis.com/youtube/v3/videos"
    params = {
        "part": "snippet",
        "chart": "mostPopular",
        "regionCode": YOUTUBE_REGION_CODE,
        "maxResults": min(50, limit),
        "videoCategoryId": "28",
        "key": YOUTUBE_DATA_API_KEY,
    }
    try:
        response = requests.get(endpoint, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        LOGGER.debug("YouTube trending source unavailable: %s", exc)
        return []

    topics: list[TopicCandidate] = []
    for item in payload.get("items", []):
        snippet = item.get("snippet", {})
        title = _normalize_topic(str(snippet.get("title", "")))
        if not title:
            continue
        topics.append(
            TopicCandidate(
                topic=title,
                source="youtube_trending",
                score=_score_topic(title, source_weight=1.1),
            )
        )
    return topics[:limit]


def _load_used_topic_set() -> set[str]:
    """Load already-used topics so seed/fallback topics don't crowd out live trends."""
    try:
        from youtube_ai_automation.config import USED_TOPICS_FILE
        import json
        if USED_TOPICS_FILE.exists():
            payload = json.loads(USED_TOPICS_FILE.read_text(encoding="utf-8"))
            return {
                " ".join(str(row.get("topic", "")).lower().split()).strip()
                for row in payload.get("used_topics", [])
                if row.get("topic", "")
            }
    except Exception:
        pass
    return set()


def get_trending_topics(limit: int = TREND_TOPIC_LIMIT) -> list[str]:
    """
    Aggregate trend sources and return top candidate topic strings.
    Seed topics that have already been used are excluded so live trends rank higher.
    """
    used = _load_used_topic_set()

    candidates: list[TopicCandidate] = []
    # Only include seed topics that haven't been used yet
    for item in PRIORITY_TOPIC_SEEDS:
        if " ".join(item.lower().split()).strip() not in used:
            candidates.append(
                TopicCandidate(topic=item, source="priority_seed", score=_score_topic(item, source_weight=1.35))
            )
    candidates.extend(_fetch_google_trends(limit=40))
    candidates.extend(_fetch_reddit_topics(limit=40))
    candidates.extend(_fetch_youtube_trending(limit=30))

    ranked = _unique_topics(candidates)
    ranked = [item for item in ranked if _passes_niche_filter(item.topic)]
    ranked.sort(key=lambda item: item.score, reverse=True)

    if not ranked:
        # Only use fallback topics that haven't been used yet
        fallback = [
            "Hidden iPhone Feature Most People Don't Know",
            "NASA telescope discovery most people missed",
            "The Tech Billionaires Are Quietly Investing In",
            "This Browser Trick Saves Hours",
            "Robotics breakthrough changing warehouse automation",
            "Apple shortcut that saves creators hours weekly",
            "Cybersecurity habit every phone user should adopt",
            "SpaceX Starship milestone changing spaceflight",
            "Nuclear fusion result scientists did not expect",
        ]
        unused_fallback = [t for t in fallback if " ".join(t.lower().split()).strip() not in used]
        return (unused_fallback or fallback)[:limit]

    return [item.topic for item in ranked[:limit]]

