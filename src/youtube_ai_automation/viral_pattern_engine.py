"""
Rule-based viral pattern scoring engine.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class ViralPatternScore:
    topic_popularity: float
    search_interest: float
    keyword_strength: float
    novelty: float
    hook_style: float
    title_length_fit: float
    viral_probability_score: float

    def as_dict(self) -> dict[str, float]:
        return {
            "topic_popularity": round(self.topic_popularity, 2),
            "search_interest": round(self.search_interest, 2),
            "keyword_strength": round(self.keyword_strength, 2),
            "novelty": round(self.novelty, 2),
            "hook_style": round(self.hook_style, 2),
            "title_length_fit": round(self.title_length_fit, 2),
            "viral_probability_score": round(self.viral_probability_score, 2),
        }


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _overlap_ratio(a: set[str], b: set[str]) -> float:
    if not a:
        return 0.0
    return len(a.intersection(b)) / len(a)


def _score_topic_popularity(topic: str, viral_topics: list[str]) -> float:
    topic_tokens = set(_tokenize(topic))
    if not topic_tokens:
        return 0.0
    best = 0.0
    for viral_topic in viral_topics:
        viral_tokens = set(_tokenize(viral_topic))
        best = max(best, _overlap_ratio(topic_tokens, viral_tokens))
    return _clamp(25 + best * 75)


def _score_search_interest(topic: str, trending_topics: list[str]) -> float:
    topic_tokens = set(_tokenize(topic))
    if not topic_tokens:
        return 0.0
    best = 0.0
    for trend in trending_topics:
        trend_tokens = set(_tokenize(trend))
        best = max(best, _overlap_ratio(topic_tokens, trend_tokens))
    return _clamp(20 + best * 80)


def _score_keyword_strength(topic: str, hook: str, title: str, viral_keywords: list[str]) -> float:
    tokens = _tokenize(f"{topic} {hook} {title}")
    if not tokens:
        return 0.0
    keyword_set = set(token.lower() for token in viral_keywords)
    hits = sum(1 for token in tokens if token in keyword_set)
    hit_ratio = hits / len(tokens)
    return _clamp(30 + hit_ratio * 260)


def _score_novelty(topic: str, previous_topics: list[str]) -> float:
    topic_tokens = set(_tokenize(topic))
    if not previous_topics:
        return 95.0
    closest = 0.0
    for prev in previous_topics:
        prev_tokens = set(_tokenize(prev))
        closest = max(closest, _overlap_ratio(topic_tokens, prev_tokens))
    novelty = 100 - (closest * 100)
    return _clamp(novelty)


def _score_hook_style(hook: str) -> float:
    tokens = _tokenize(hook)
    if not tokens:
        return 0.0
    trigger_words = {"stop", "hidden", "nobody", "secret", "change", "save", "mistake", "trick"}
    trigger_hits = sum(1 for token in tokens if token in trigger_words)
    number_bonus = 8.0 if re.search(r"\d", hook) else 0.0
    question_bonus = 7.0 if "?" in hook else 0.0
    length_score = 90 - abs(len(tokens) - 11) * 4
    return _clamp(length_score * 0.6 + trigger_hits * 8 + number_bonus + question_bonus)


def _score_title_length_fit(title: str) -> float:
    length = len(title.strip())
    # Shorts titles usually perform well around 35-55 chars.
    return _clamp(100 - abs(length - 45) * 2.1)


def estimate_viral_probability(
    topic: str,
    hook: str,
    title: str,
    trending_topics: list[str],
    viral_keywords: list[str],
    viral_topics: list[str],
    previous_topics: list[str],
) -> ViralPatternScore:
    """
    Estimate virality probability with a rule-based 0-100 score.
    """
    topic_popularity = _score_topic_popularity(topic, viral_topics=viral_topics)
    search_interest = _score_search_interest(topic, trending_topics=trending_topics)
    keyword_strength = _score_keyword_strength(topic, hook, title, viral_keywords=viral_keywords)
    novelty = _score_novelty(topic, previous_topics=previous_topics)
    hook_style = _score_hook_style(hook)
    title_length_fit = _score_title_length_fit(title)

    viral_score = (
        topic_popularity * 0.22
        + search_interest * 0.20
        + keyword_strength * 0.17
        + novelty * 0.14
        + hook_style * 0.17
        + title_length_fit * 0.10
    )

    return ViralPatternScore(
        topic_popularity=topic_popularity,
        search_interest=search_interest,
        keyword_strength=keyword_strength,
        novelty=novelty,
        hook_style=hook_style,
        title_length_fit=title_length_fit,
        viral_probability_score=_clamp(viral_score),
    )

