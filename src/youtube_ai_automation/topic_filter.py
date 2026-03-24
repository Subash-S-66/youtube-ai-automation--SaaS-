"""
Track and filter used topics so generated Shorts stay diverse over time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from typing import Iterable

from youtube_ai_automation.config import USED_TOPICS_FILE

LOGGER = logging.getLogger(__name__)


@dataclass
class UsedTopicEntry:
    topic: str
    used_at: str


def _normalize(topic: str) -> str:
    return " ".join(topic.lower().split()).strip()


# Small words to ignore when computing topic similarity
_STOPWORDS = frozenset(
    "a an the is are was were be been being have has had do does did will would "
    "shall should may might can could of in to for on with at by from as into "
    "this that these those it its and or but not no nor so yet both each every "
    "about after before between through during above below up down out off over "
    "under again further then once here there when where why how all any some "
    "most other such than too very just also now".split()
)


def _topic_tokens(topic: str) -> set[str]:
    """Extract meaningful lowercase tokens from a topic, ignoring stopwords."""
    import re
    tokens = set(re.findall(r"[a-z0-9]+", topic.lower()))
    return tokens - _STOPWORDS


def _is_similar_to_used(candidate: str, used_topics: set[str], raw_used: list[str]) -> bool:
    """Check if candidate is semantically similar to any already-used topic.

    Uses token overlap (Jaccard-like) to catch rephrased duplicates such as:
      - "OpenAI Acquires Promptfoo" vs "OpenAI acquisition of Promptfoo"
    """
    candidate_tokens = _topic_tokens(candidate)
    if len(candidate_tokens) < 2:
        return False

    for used in raw_used:
        used_tokens = _topic_tokens(used)
        if len(used_tokens) < 2:
            continue
        overlap = candidate_tokens & used_tokens
        smaller = min(len(candidate_tokens), len(used_tokens))
        # If 60%+ of the smaller set overlaps, topics are about the same thing
        if smaller > 0 and len(overlap) / smaller >= 0.6:
            return True
    return False


import os
from .topic_tracker import TopicTracker

def _read_used_topics(path: Path = USED_TOPICS_FILE) -> list[UsedTopicEntry]:
    tracker = TopicTracker(os.getenv("MONGO_URI"))
    if tracker.collection is not None:
        try:
            records = tracker.get_all_topics()
            entries = [
                UsedTopicEntry(topic=str(row.get("topic", "")).strip(), used_at=str(row.get("used_at", "")))
                for row in records
                if str(row.get("topic", "")).strip()
            ]
            return entries
        except Exception as e:
            LOGGER.error("Failed reading from MongoDB: %s", e)

    # Fallback to local file
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("used_topics", [])
        entries = [
            UsedTopicEntry(topic=str(row.get("topic", "")).strip(), used_at=str(row.get("used_at", "")))
            for row in rows
            if str(row.get("topic", "")).strip()
        ]
        return entries
    except Exception:
        return []


def _write_used_topics(entries: list[UsedTopicEntry], path: Path = USED_TOPICS_FILE) -> None:
    tracker = TopicTracker(os.getenv("MONGO_URI"))
    if tracker.collection is not None:
        for entry in entries[-500:]:
             tracker.mark_topic_used(entry.topic)

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "used_topics": [{"topic": item.topic, "used_at": item.used_at} for item in entries[-500:]]
    }
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def select_best_unused_topic(candidates: Iterable[str], path: Path = USED_TOPICS_FILE) -> str:
    """
    Return the first unused topic.
    STRICT MODE: Never repeat topics - raise error if all candidates are already used.
    Uses both exact matching AND fuzzy similarity to prevent rephrased duplicates.
    """
    entries = _read_used_topics(path)
    used = {_normalize(item.topic) for item in entries}
    raw_used = [item.topic for item in entries]
    cleaned = [" ".join(candidate.split()).strip() for candidate in candidates if candidate and candidate.strip()]
    if not cleaned:
        raise ValueError("No candidate topics to choose from.")

    LOGGER.debug(f"Selecting from {len(cleaned)} candidates. Already used: {len(used)} topics")

    # Find first unused topic (exact match + fuzzy similarity)
    for idx, candidate in enumerate(cleaned):
        normalized_candidate = _normalize(candidate)
        if normalized_candidate in used:
            LOGGER.debug(f"Skipping (exact match): {candidate[:70]}")
            continue
        if _is_similar_to_used(candidate, used, raw_used):
            LOGGER.debug(f"Skipping (similar to used): {candidate[:70]}")
            continue
        LOGGER.debug(f"Selected candidate #{idx+1}: {candidate[:70]}")
        return candidate

    # All candidates are used or too similar - raise error to force fresh topic selection
    raise ValueError(
        f"All {len(cleaned)} candidate topics have already been used or are too similar to past topics. "
        "Need to fetch fresh trending topics to avoid repeats."
    )


def filter_unused_topics(candidates: Iterable[str], path: Path = USED_TOPICS_FILE) -> list[str]:
    """
    Return candidates that are not already used (exact or similar).
    """
    entries = _read_used_topics(path)
    used = {_normalize(item.topic) for item in entries}
    raw_used = [item.topic for item in entries]
    cleaned = [" ".join(candidate.split()).strip() for candidate in candidates if candidate and candidate.strip()]
    if not cleaned:
        return []

    kept: list[str] = []
    for candidate in cleaned:
        normalized_candidate = _normalize(candidate)
        if normalized_candidate in used:
            continue
        if _is_similar_to_used(candidate, used, raw_used):
            continue
        if kept and _is_similar_to_used(candidate, set(), kept):
            continue
        kept.append(candidate)
    return kept


def mark_topic_as_used(topic: str, path: Path = USED_TOPICS_FILE) -> None:
    """
    Persist a topic as used to prevent repeated content.
    """
    normalized = " ".join(topic.split()).strip()
    if not normalized:
        LOGGER.debug("Topic normalization resulted in empty string, skipping")
        return

    try:
        entries = _read_used_topics(path)
        existing = {_normalize(item.topic) for item in entries}
        normalized_key = _normalize(normalized)
        
        if normalized_key in existing:
            LOGGER.debug("Topic already marked as used: %s", normalized)
            return

        entries.append(UsedTopicEntry(topic=normalized, used_at=datetime.now(timezone.utc).isoformat()))
        _write_used_topics(entries, path)
        LOGGER.info("✓ Topic marked as used: %s", normalized)
    except Exception as exc:
        LOGGER.error("Failed to mark topic as used: %s. Error: %s", normalized, str(exc))
        raise

