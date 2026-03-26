"""
Viral scoring heuristics for Shorts topics and hooks.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


TRIGGER_WORDS = {
    "secret",
    "hidden",
    "nobody",
    "never",
    "unknown",
    "shocking",
    "truth",
    "mistake",
    "trick",
    "hack",
    "change",
    "save",
    "faster",
    "instantly",
    "forever",
    "stop",
}

RELATABLE_WORDS = {
    "you",
    "your",
    "daily",
    "today",
    "work",
    "life",
    "time",
    "hours",
    "phone",
    "team",
    "creator",
    "developer",
}

SHAREABLE_WORDS = {
    "must",
    "best",
    "top",
    "vs",
    "before",
    "after",
    "worth",
    "real",
    "tested",
    "proof",
    "facts",
}


@dataclass
class ViralScoreBreakdown:
    curiosity_score: float
    surprise_score: float
    clarity_score: float
    relatability_score: float
    trend_score: float
    shareability_score: float
    viral_score: float

    def as_dict(self) -> dict[str, float]:
        return {
            "curiosity_score": round(self.curiosity_score, 2),
            "surprise_score": round(self.surprise_score, 2),
            "clarity_score": round(self.clarity_score, 2),
            "relatability_score": round(self.relatability_score, 2),
            "trend_score": round(self.trend_score, 2),
            "shareability_score": round(self.shareability_score, 2),
            "viral_score": round(self.viral_score, 2),
        }


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _keyword_hits(tokens: list[str], keyword_set: set[str]) -> int:
    return sum(1 for token in tokens if token in keyword_set)


def _score_curiosity(hook: str) -> float:
    tokens = _tokenize(hook)
    hits = _keyword_hits(tokens, TRIGGER_WORDS)
    question_bonus = 10.0 if "?" in hook else 0.0
    number_bonus = 8.0 if re.search(r"\d", hook) else 0.0
    length_penalty = 0.0 if 6 <= len(tokens) <= 15 else 8.0
    raw = 35 + hits * 9 + question_bonus + number_bonus - length_penalty
    return _clamp(raw)


def _score_surprise(hook: str, outline: list[str]) -> float:
    text = f"{hook} {' '.join(outline)}".lower()
    surprise_tokens = {"unexpected", "crazy", "mind", "blowing", "nobody", "hidden", "myth", "fake"}
    hits = sum(1 for token in surprise_tokens if token in text)
    contrast_bonus = 10.0 if "but" in text or "instead" in text else 0.0
    raw = 30 + hits * 10 + contrast_bonus
    return _clamp(raw)


def _score_clarity(hook: str, outline: list[str]) -> float:
    hook_tokens = _tokenize(hook)
    avg_outline_len = 0.0
    if outline:
        avg_outline_len = sum(len(_tokenize(item)) for item in outline) / len(outline)
    hook_len_score = 95 - abs(len(hook_tokens) - 11) * 4.0
    outline_score = 95 - abs(avg_outline_len - 9) * 3.0
    raw = (hook_len_score * 0.6) + (outline_score * 0.4)
    return _clamp(raw)


def _score_relatability(topic: str, hook: str) -> float:
    tokens = _tokenize(f"{topic} {hook}")
    hits = _keyword_hits(tokens, RELATABLE_WORDS)
    raw = 25 + hits * 12
    return _clamp(raw)


def _score_shareability(topic: str, hook: str, outline: list[str]) -> float:
    tokens = _tokenize(f"{topic} {hook} {' '.join(outline)}")
    hits = _keyword_hits(tokens, SHAREABLE_WORDS)
    cta_bonus = 8.0 if any(word in tokens for word in {"share", "send", "save"}) else 0.0
    raw = 30 + hits * 9 + cta_bonus
    return _clamp(raw)


def _score_trend_relevance(topic: str, trending_topics: list[str]) -> float:
    if not trending_topics:
        return 50.0
    topic_tokens = set(_tokenize(topic))
    if not topic_tokens:
        return 0.0
    best_overlap = 0.0
    for trend in trending_topics:
        trend_tokens = set(_tokenize(trend))
        if not trend_tokens:
            continue
        overlap = len(topic_tokens.intersection(trend_tokens)) / max(1, len(topic_tokens))
        best_overlap = max(best_overlap, overlap)
    return _clamp(20 + (best_overlap * 80))


def score_viral_potential(topic: str, hook: str, outline: list[str], trending_topics: list[str]) -> ViralScoreBreakdown:
    """
    Score a topic + hook combination from 0 to 100.
    """
    curiosity_score = _score_curiosity(hook)
    surprise_score = _score_surprise(hook, outline)
    clarity_score = _score_clarity(hook, outline)
    relatability_score = _score_relatability(topic, hook)
    trend_score = _score_trend_relevance(topic, trending_topics)
    shareability_score = _score_shareability(topic, hook, outline)

    viral = (
        curiosity_score * 0.23
        + surprise_score * 0.14
        + clarity_score * 0.18
        + relatability_score * 0.14
        + trend_score * 0.19
        + shareability_score * 0.12
    )
    return ViralScoreBreakdown(
        curiosity_score=curiosity_score,
        surprise_score=surprise_score,
        clarity_score=clarity_score,
        relatability_score=relatability_score,
        trend_score=trend_score,
        shareability_score=shareability_score,
        viral_score=_clamp(viral),
    )

