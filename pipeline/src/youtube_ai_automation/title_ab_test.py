"""
Generate and score title variants for A/B-like selection.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class TitleVariantScore:
    title: str
    keyword_strength: float
    curiosity_level: float
    readability: float
    total_score: float


@dataclass
class TitleABResult:
    best_title: str
    variants: list[TitleVariantScore]


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _topic_label(topic: str) -> str:
    low = topic.lower()
    if "ai" in low:
        return "AI tools"
    if "productiv" in low:
        return "productivity hacks"
    if "automat" in low:
        return "automation trick"
    words = topic.split()
    return " ".join(words[:4]) if words else "tech trick"


def generate_title_variants(topic: str, hook: str, viral_keywords: list[str], count: int = 3) -> list[str]:
    """
    Produce at least 3 title options under 60 chars.
    """
    label = _topic_label(topic)
    keyword = viral_keywords[0] if viral_keywords else "tech"
    candidates = [
        f"{label} that saves hours every week",
        f"The {label} nobody talks about",
        f"Most people miss this {label}",
        f"This {keyword} shortcut changes everything",
        f"Try this {label} before your next task",
        f"Why this {label} is suddenly everywhere",
    ]

    # Include hook-derived title fragment if compact enough.
    hook_fragment = " ".join(hook.split()[:7]).strip(" -:.!?")
    if hook_fragment:
        candidates.insert(0, hook_fragment)

    unique: list[str] = []
    seen: set[str] = set()
    for title in candidates:
        compact = " ".join(title.split()).strip()
        if not compact:
            continue
        if len(compact) > 59:
            compact = compact[:59].rstrip(" -:;,.!?")
        key = compact.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(compact)
        if len(unique) >= count:
            break
    return unique


def _score_keyword_strength(title: str, viral_keywords: list[str]) -> float:
    tokens = _tokenize(title)
    if not tokens:
        return 0.0
    keyword_set = {item.lower() for item in viral_keywords}
    hits = sum(1 for token in tokens if token in keyword_set)
    return _clamp(25 + (hits * 22))


def _score_curiosity(title: str) -> float:
    low = title.lower()
    trigger_phrases = [
        "nobody",
        "hidden",
        "secret",
        "most people",
        "miss",
        "before",
        "why",
        "suddenly",
        "changes",
    ]
    hits = sum(1 for phrase in trigger_phrases if phrase in low)
    question_bonus = 8.0 if "?" in title else 0.0
    return _clamp(30 + hits * 12 + question_bonus)


def _score_readability(title: str) -> float:
    length = len(title.strip())
    words = len(_tokenize(title))
    length_score = 100 - abs(length - 45) * 1.8
    word_score = 100 - abs(words - 8) * 6.0
    return _clamp(length_score * 0.6 + word_score * 0.4)


def score_title_variants(variants: list[str], viral_keywords: list[str]) -> list[TitleVariantScore]:
    scored: list[TitleVariantScore] = []
    for variant in variants:
        keyword_strength = _score_keyword_strength(variant, viral_keywords=viral_keywords)
        curiosity_level = _score_curiosity(variant)
        readability = _score_readability(variant)
        total = keyword_strength * 0.32 + curiosity_level * 0.36 + readability * 0.32
        scored.append(
            TitleVariantScore(
                title=variant,
                keyword_strength=keyword_strength,
                curiosity_level=curiosity_level,
                readability=readability,
                total_score=_clamp(total),
            )
        )
    scored.sort(key=lambda row: row.total_score, reverse=True)
    return scored


def select_best_title(topic: str, hook: str, viral_keywords: list[str]) -> TitleABResult:
    variants = generate_title_variants(topic=topic, hook=hook, viral_keywords=viral_keywords, count=3)
    scored = score_title_variants(variants, viral_keywords=viral_keywords)
    if not scored:
        fallback = "Tech trick you should try today"
        return TitleABResult(
            best_title=fallback,
            variants=[
                TitleVariantScore(
                    title=fallback,
                    keyword_strength=50.0,
                    curiosity_level=50.0,
                    readability=50.0,
                    total_score=50.0,
                )
            ],
        )
    return TitleABResult(best_title=scored[0].title, variants=scored)

