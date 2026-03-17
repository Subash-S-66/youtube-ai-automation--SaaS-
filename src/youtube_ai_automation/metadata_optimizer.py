"""
Optimize metadata and maintain title diversity history.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import re


@dataclass
class OptimizedMetadata:
    title: str
    description: str
    hashtags: list[str]
    tags: list[str]


def _normalize(text: str) -> str:
    return " ".join(text.split()).strip()


def _sanitize_hashtag(text: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9_]", "", text.replace("#", ""))
    if not token:
        return ""
    return f"#{token.lower()}"


def _read_used_titles(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("used_titles", [])
        return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []


def _write_used_titles(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"used_titles": rows[-1000:]}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _title_exists(title: str, rows: list[dict]) -> bool:
    key = _normalize(title).lower()
    return any(_normalize(str(row.get("title", ""))).lower() == key for row in rows)


def _topic_tags(topic: str) -> list[str]:
    tokens = [token for token in re.findall(r"[a-z0-9]+", topic.lower()) if len(token) >= 3]
    out = []
    for token in tokens[:4]:
        out.append(f"#{token}")
    return out


def _diverse_hashtags(topic: str, viral_keywords: list[str], rows: list[dict]) -> list[str]:
    base_pool = [
        "#shorts",
        "#aitools",
        "#productivity",
        "#automation",
        "#futuretech",
        "#techfacts",
        "#technology",
        "#viral",
        "#learn",
        "#creator",
        "#developer",
        "#workflows",
        "#innovation",
        "#growth",
        "#facts",
    ]
    keyword_tags = [_sanitize_hashtag(word) for word in viral_keywords[:8]]
    topic_tags = [_sanitize_hashtag(word) for word in _topic_tags(topic)]

    history_hashtags = []
    for row in rows[-10:]:
        for tag in row.get("hashtags", []):
            clean = _sanitize_hashtag(str(tag))
            if clean:
                history_hashtags.append(clean)

    recent_counter: dict[str, int] = {}
    for tag in history_hashtags:
        recent_counter[tag] = recent_counter.get(tag, 0) + 1

    combined = []
    for tag in (["#shorts"] + keyword_tags + topic_tags + base_pool):
        clean = _sanitize_hashtag(tag)
        if not clean:
            continue
        combined.append(clean)

    unique: list[str] = []
    seen: set[str] = set()
    for tag in combined:
        if tag in seen:
            continue
        seen.add(tag)
        unique.append(tag)

    # Prefer less frequently used hashtags in recent history.
    unique.sort(key=lambda tag: recent_counter.get(tag, 0))

    # Keep #shorts in first position for consistency.
    if "#shorts" in unique:
        unique.remove("#shorts")
    selected = ["#shorts"]
    selected.extend(unique[:14])
    return selected[:15]


def _build_description(topic: str, hook: str, script: str) -> str:
    line1 = _normalize(hook)
    line2 = _normalize(f"Quick breakdown of {topic} with practical takeaways you can use immediately.")
    line3 = _normalize("Watch till the end and follow for more high-retention Shorts.")
    description = f"{line1}\n{line2}\n{line3}"
    if len(description) > 450:
        description = description[:450].rstrip()
    return description


def _make_tags(hashtags: list[str], topic: str, viral_keywords: list[str]) -> list[str]:
    tag_pool = [tag.replace("#", "") for tag in hashtags]
    topic_tokens = [token for token in re.findall(r"[a-z0-9]+", topic.lower()) if len(token) >= 3]
    keyword_tokens = [token.lower() for token in viral_keywords if len(token) >= 3]
    merged = tag_pool + topic_tokens + keyword_tokens
    out: list[str] = []
    seen: set[str] = set()
    for item in merged:
        clean = _normalize(item).replace(" ", "")
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
        if len(out) >= 15:
            break
    return out


def optimize_metadata(
    topic: str,
    hook: str,
    script: str,
    selected_title: str,
    viral_keywords: list[str],
    used_titles_file: Path,
) -> OptimizedMetadata:
    """
    Optimize title/description/hashtags/tags and enforce title diversity.
    """
    rows = _read_used_titles(used_titles_file)
    title = _normalize(selected_title)[:59]
    if not title:
        title = _normalize(f"This {topic} trick saves serious time")[:59]
    if _title_exists(title, rows):
        suffixes = ["today", "right now", "in 30 seconds", "for creators", "for developers"]
        for suffix in suffixes:
            candidate = _normalize(f"{title} {suffix}")[:59]
            if not _title_exists(candidate, rows):
                title = candidate
                break

    hashtags = _diverse_hashtags(topic=topic, viral_keywords=viral_keywords, rows=rows)
    description = _build_description(topic=topic, hook=hook, script=script)
    tags = _make_tags(hashtags=hashtags, topic=topic, viral_keywords=viral_keywords)

    rows.append(
        {
            "title": title,
            "hashtags": hashtags,
            "date": datetime.now(timezone.utc).isoformat(),
        }
    )
    _write_used_titles(used_titles_file, rows)
    return OptimizedMetadata(title=title, description=description, hashtags=hashtags, tags=tags)

