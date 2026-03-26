"""
Select a high-quality, non-repetitive topic from trend candidates.
"""

from __future__ import annotations

from typing import Iterable
import re

from youtube_ai_automation.topic_filter import select_best_unused_topic


TECH_PRIORITY_KEYWORDS = (
    "ai",
    "openai",
    "apple",
    "google",
    "spacex",
    "startup",
    "cybersecurity",
    "smartphone",
    "iphone",
    "android",
    "browser",
    "software",
    "internet",
    "future tech",
)

CURIOSITY_CUES = (
    "hidden",
    "nobody",
    "most people",
    "quietly",
    "replace",
    "in seconds",
    "secret",
    "trick",
    "feature",
)

GENERIC_PATTERNS = (
    r"\bai productivity tips\b",
    r"\b(tech|technology|ai|software)\s+(tips|facts|guide|basics)\b",
    r"\b(top|best)\s+\d+\s+(apps|tools)\b",
    r"\bintroduction to\b",
)


def _normalize(topic: str) -> str:
    return " ".join(str(topic).split()).strip()


def _is_generic(topic: str) -> bool:
    low = topic.lower()
    return any(re.search(pattern, low) for pattern in GENERIC_PATTERNS)


def _score_topic(topic: str, niche: str) -> float:
    low = topic.lower()
    score = 0.0
    score += sum(2.0 for keyword in TECH_PRIORITY_KEYWORDS if keyword in low)
    score += sum(1.2 for cue in CURIOSITY_CUES if cue in low)
    if re.search(r"\b\d+\b", low):
        score += 0.8
    if _is_generic(topic):
        score -= 5.0

    niche_tokens = [token for token in niche.lower().split() if len(token) > 2]
    score += sum(0.5 for token in niche_tokens if token in low)
    return score


def choose_topic(candidates: Iterable[str], preferred_topic: str = "", niche: str = "") -> str:
    """
    Pick a strong unused topic. If preferred_topic is provided, return it.
    """
    preferred = _normalize(preferred_topic)
    if preferred:
        return preferred

    cleaned: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        topic = _normalize(item)
        if not topic:
            continue
        key = topic.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(topic)

    if not cleaned:
        raise ValueError("No trending topic candidates available.")

    ranked = sorted(cleaned, key=lambda topic: _score_topic(topic, niche=niche), reverse=True)
    return select_best_unused_topic(ranked)


