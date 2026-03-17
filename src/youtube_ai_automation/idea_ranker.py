"""
Rank and select ideas using viral scoring plus duplicate avoidance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path

from youtube_ai_automation.hook_optimizer import IdeaCandidate
from youtube_ai_automation.viral_score import ViralScoreBreakdown, score_viral_potential


@dataclass
class RankedIdea:
    topic: str
    hook_options: list[str]
    best_hook: str
    script_outline: list[str]
    score_breakdown: ViralScoreBreakdown

    @property
    def viral_score(self) -> float:
        return self.score_breakdown.viral_score


def rank_ideas(candidates: list[IdeaCandidate], trending_topics: list[str]) -> list[RankedIdea]:
    """
    Rank each candidate by best hook and viral score.
    """
    ranked: list[RankedIdea] = []
    for candidate in candidates:
        if not candidate.hooks:
            continue

        best_hook = candidate.hooks[0]
        best_breakdown = score_viral_potential(
            topic=candidate.topic,
            hook=best_hook,
            outline=candidate.script_outline,
            trending_topics=trending_topics,
        )
        for hook in candidate.hooks[1:]:
            breakdown = score_viral_potential(
                topic=candidate.topic,
                hook=hook,
                outline=candidate.script_outline,
                trending_topics=trending_topics,
            )
            if breakdown.viral_score > best_breakdown.viral_score:
                best_breakdown = breakdown
                best_hook = hook

        ranked.append(
            RankedIdea(
                topic=candidate.topic,
                hook_options=candidate.hooks[:],
                best_hook=best_hook,
                script_outline=candidate.script_outline[:],
                score_breakdown=best_breakdown,
            )
        )

    ranked.sort(key=lambda item: item.viral_score, reverse=True)
    return ranked


def _normalize(text: str) -> str:
    return " ".join(str(text).lower().split()).strip()


_STOPWORDS = frozenset(
    "a an the is are was were be been being have has had do does did will would "
    "shall should may might can could of in to for on with at by from as into "
    "this that these those it its and or but not no nor so yet both each every "
    "about after before between through during above below up down out off over "
    "under again further then once here there when where why how all any some "
    "most other such than too very just also now".split()
)


def _topic_tokens(text: str) -> set[str]:
    import re
    tokens = set(re.findall(r"[a-z0-9]+", text.lower()))
    return tokens - _STOPWORDS


def _is_similar_topic(candidate: str, used_topics_raw: list[str]) -> bool:
    """Check if candidate is semantically similar to any already-generated topic."""
    candidate_tokens = _topic_tokens(candidate)
    if len(candidate_tokens) < 2:
        return False
    for used in used_topics_raw:
        used_tokens = _topic_tokens(used)
        if len(used_tokens) < 2:
            continue
        overlap = candidate_tokens & used_tokens
        smaller = min(len(candidate_tokens), len(used_tokens))
        if smaller > 0 and len(overlap) / smaller >= 0.6:
            return True
    return False


def _read_generated_ideas(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("generated_ideas", [])
        return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []


def _write_generated_ideas(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"generated_ideas": rows[-1000:]}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def filter_duplicate_topics(ranked_ideas: list[RankedIdea], generated_ideas_file: Path) -> list[RankedIdea]:
    """
    Filter ideas if topic already exists (exact or similar) in generated_ideas.json.
    """
    history = _read_generated_ideas(generated_ideas_file)
    used_topics = {_normalize(item.get("topic", "")) for item in history}
    used_topics_raw = [item.get("topic", "") for item in history if item.get("topic", "")]
    out: list[RankedIdea] = []
    for idea in ranked_ideas:
        if _normalize(idea.topic) in used_topics:
            continue
        if _is_similar_topic(idea.topic, used_topics_raw):
            continue
        out.append(idea)
    return out


def select_best_idea(ranked_ideas: list[RankedIdea], generated_ideas_file: Path) -> RankedIdea:
    """
    Return top ranked idea that is not already generated.
    """
    filtered = filter_duplicate_topics(ranked_ideas, generated_ideas_file=generated_ideas_file)
    if filtered:
        return filtered[0]
    if ranked_ideas:
        return ranked_ideas[0]
    raise ValueError("No ranked ideas available for selection.")


def mark_generated_idea(
    topic: str,
    hook: str,
    generated_ideas_file: Path,
    upload_date: str | None = None,
) -> None:
    """
    Persist generated topic+hook history to avoid duplicate videos.
    """
    normalized_topic = " ".join(topic.split()).strip()
    normalized_hook = " ".join(hook.split()).strip()
    if not normalized_topic:
        return

    rows = _read_generated_ideas(generated_ideas_file)
    topic_key = _normalize(normalized_topic)
    hook_key = _normalize(normalized_hook)
    exists = False
    for row in rows:
        if _normalize(row.get("topic", "")) == topic_key and _normalize(row.get("hook", "")) == hook_key:
            exists = True
            break
    if exists:
        return

    rows.append(
        {
            "topic": normalized_topic,
            "hook": normalized_hook,
            "upload_date": upload_date or datetime.now(timezone.utc).isoformat(),
        }
    )
    _write_generated_ideas(generated_ideas_file, rows)

