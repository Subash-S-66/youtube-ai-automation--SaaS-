"""
Convert generated script text into scene descriptions and stock-video queries.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class ScenePlan:
    scenes: list[str]
    search_queries: list[str]


_MAPPING = [
    (
        {"stop scrolling", "scroll", "phone", "hook"},
        "person looking amazed at smartphone screen close-up",
    ),
    (
        {"automation", "automate", "repetitive", "workflow"},
        "programmer automating tasks on multiple monitors",
    ),
    (
        {"summary", "summarize", "document", "notes", "report"},
        "professional reviewing AI generated document on laptop",
    ),
    (
        {"code", "coding", "developer", "copilot", "github"},
        "developer writing code with AI assistant on dark screen",
    ),
    (
        {"productivity", "time", "hours", "faster", "efficient"},
        "productivity dashboard with analytics graphs on monitor",
    ),
    (
        {"future", "innovation", "robot", "breakthrough"},
        "futuristic AI interface holographic display",
    ),
    (
        {"server", "cloud", "data", "database", "storage"},
        "modern server room with blue LED lights and cable racks",
    ),
    (
        {"chatbot", "chat", "gpt", "conversation", "assistant"},
        "person chatting with AI chatbot on computer screen",
    ),
    (
        {"security", "cyber", "hack", "password", "encrypt"},
        "cybersecurity lock screen with digital encryption visual",
    ),
    (
        {"startup", "business", "company", "enterprise"},
        "modern startup office team working on computers",
    ),
    (
        {"search", "google", "browser", "web", "internet"},
        "close-up of search engine results on computer screen",
    ),
    (
        {"car", "tesla", "autopilot", "driving", "vehicle"},
        "autonomous self driving car on highway with sensors",
    ),
    (
        {"space", "nasa", "satellite", "rocket", "mars"},
        "rocket launch with smoke trail against blue sky",
    ),
    (
        {"follow", "subscribe", "like", "share", "cta"},
        "person tapping follow button on smartphone screen",
    ),
]


def _clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def _split_sentences(script: str) -> list[str]:
    raw = str(script or "").strip()
    if not raw:
        return []

    # Respect explicit line breaks first so each narration line can map to a scene.
    line_chunks = [_clean_text(line) for line in raw.splitlines() if _clean_text(line)]
    if len(line_chunks) > 1:
        return line_chunks

    normalized = _clean_text(raw)
    chunks = re.split(r"[.!?]+", normalized)
    return [_clean_text(chunk) for chunk in chunks if _clean_text(chunk)]


def _topic_fallback_query(topic: str) -> str:
    topic_tokens = [token for token in re.findall(r"[a-z0-9]+", topic.lower()) if len(token) >= 3]
    if not topic_tokens:
        return "technology computer screen modern office"
    return " ".join(topic_tokens[:4]) + " technology computer screen"


def _scene_from_sentence(sentence: str) -> str:
    low = sentence.lower()
    for keywords, query in _MAPPING:
        if any(keyword in low for keyword in keywords):
            return query

    tokens = [token for token in re.findall(r"[a-z0-9]+", low) if len(token) >= 4]
    if not tokens:
        return "modern technology workspace computer screen"
    summary = " ".join(tokens[:5])
    return f"{summary} technology cinematic close-up"


def _dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        cleaned = _clean_text(item)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def extract_scenes(
    script: str,
    topic: str = "",
    seed_queries: list[str] | None = None,
    max_scenes: int = 5,
) -> ScenePlan:
    """
    Build scene descriptions + search queries from script text.
    """
    sentences = _split_sentences(script)
    candidates: list[str] = []
    for sentence in sentences:
        candidates.append(_scene_from_sentence(sentence))
        if len(candidates) >= max_scenes:
            break

    if seed_queries:
        candidates.extend(_clean_text(item) for item in seed_queries if _clean_text(item))

    deduped = _dedupe(candidates)
    while len(deduped) < 4:
        deduped.append(_topic_fallback_query(topic))
        deduped = _dedupe(deduped)

    selected = deduped[: max(1, min(max_scenes, 8))]
    scenes = [f"Scene {idx}: {query}" for idx, query in enumerate(selected, start=1)]
    return ScenePlan(scenes=scenes, search_queries=selected)

