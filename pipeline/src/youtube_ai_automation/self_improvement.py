"""
Adjust ranking weights from analytics feedback history.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
from pathlib import Path
from typing import Any


DEFAULT_BASE_WEIGHT = 0.62
DEFAULT_PATTERN_WEIGHT = 0.38

STOP_WORDS = {
    "this",
    "that",
    "with",
    "from",
    "your",
    "about",
    "into",
    "most",
    "people",
    "they",
    "them",
    "will",
    "just",
    "have",
    "need",
}


@dataclass
class ImprovementStrategy:
    base_weight: float = DEFAULT_BASE_WEIGHT
    pattern_weight: float = DEFAULT_PATTERN_WEIGHT
    sample_count: int = 0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def load_strategy(state_file: Path) -> ImprovementStrategy:
    payload = _read_json(state_file)
    strategy = payload.get("strategy", {})
    if not isinstance(strategy, dict):
        return ImprovementStrategy()
    base_weight = _clamp(_to_float(strategy.get("base_weight"), DEFAULT_BASE_WEIGHT), 0.2, 0.8)
    pattern_weight = _clamp(_to_float(strategy.get("pattern_weight"), DEFAULT_PATTERN_WEIGHT), 0.2, 0.8)
    total = base_weight + pattern_weight
    if total <= 0:
        return ImprovementStrategy()
    base_weight = base_weight / total
    pattern_weight = pattern_weight / total
    return ImprovementStrategy(
        base_weight=round(base_weight, 4),
        pattern_weight=round(pattern_weight, 4),
        sample_count=int(_to_float(strategy.get("sample_count"), 0)),
    )


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _extract_top_tokens(records: list[dict[str, Any]], key: str, limit: int = 8) -> list[str]:
    counter: dict[str, int] = {}
    for record in records:
        text = str(record.get(key, ""))
        for token in _tokenize(text):
            if len(token) < 4 or token in STOP_WORDS:
                continue
            counter[token] = counter.get(token, 0) + 1
    ranked = sorted(counter.items(), key=lambda item: item[1], reverse=True)
    return [token for token, _ in ranked[:limit]]


def _read_records(history_file: Path) -> list[dict[str, Any]]:
    payload = _read_json(history_file)
    rows = payload.get("records", [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _performance(row: dict[str, Any]) -> float:
    direct = _to_float(row.get("performance_score"), -1.0)
    if direct >= 0.0:
        return direct

    statistics = row.get("statistics", {})
    if not isinstance(statistics, dict):
        return 0.0
    views = _to_float(statistics.get("views"), 0.0)
    likes = _to_float(statistics.get("likes"), 0.0)
    comments = _to_float(statistics.get("comments"), 0.0)
    if views <= 0:
        return 0.0
    engagement_rate = (likes + comments) / max(1.0, views)
    return min(100.0, (views ** 0.25) * 6.0 + (engagement_rate * 500.0))


def update_strategy_from_feedback(history_file: Path, state_file: Path) -> ImprovementStrategy:
    """
    Update ranker weights using historical performance from uploaded videos.
    """
    current = load_strategy(state_file)
    rows = _read_records(history_file)

    samples: list[tuple[float, float, float, dict[str, Any]]] = []
    for row in rows:
        breakdown = row.get("score_breakdown", {})
        if not isinstance(breakdown, dict):
            continue
        base_score = _to_float(breakdown.get("base_viral_score"), _to_float(breakdown.get("viral_score"), 0.0))
        pattern_score = _to_float(
            breakdown.get("pattern_viral_score"),
            _to_float(breakdown.get("viral_probability_score"), 0.0),
        )
        perf = _performance(row)
        if base_score <= 0.0 or pattern_score <= 0.0 or perf <= 0.0:
            continue
        samples.append((base_score, pattern_score, perf, row))

    if len(samples) < 3:
        # Not enough data to tune, keep current strategy.
        payload = {
            "strategy": {
                "base_weight": round(current.base_weight, 4),
                "pattern_weight": round(current.pattern_weight, 4),
                "sample_count": len(samples),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "insights": {
                "top_topics": [],
                "top_hook_tokens": [],
            },
        }
        _write_json(state_file, payload)
        return current

    weighted_base = 0.0
    weighted_pattern = 0.0
    for base_score, pattern_score, perf, _ in samples:
        p = _clamp(perf / 100.0, 0.05, 1.0)
        weighted_base += base_score * p
        weighted_pattern += pattern_score * p

    ratio_pattern = weighted_pattern / max(1e-6, (weighted_base + weighted_pattern))
    ratio_pattern = _clamp(ratio_pattern, 0.25, 0.75)
    new_pattern = _clamp((current.pattern_weight * 0.65) + (ratio_pattern * 0.35), 0.25, 0.75)
    new_base = 1.0 - new_pattern

    sorted_by_perf = sorted(samples, key=lambda item: item[2], reverse=True)
    top_count = max(3, int(len(sorted_by_perf) * 0.35))
    top_rows = [item[3] for item in sorted_by_perf[:top_count]]

    strategy = ImprovementStrategy(
        base_weight=round(new_base, 4),
        pattern_weight=round(new_pattern, 4),
        sample_count=len(samples),
    )
    payload = {
        "strategy": {
            "base_weight": strategy.base_weight,
            "pattern_weight": strategy.pattern_weight,
            "sample_count": strategy.sample_count,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        "insights": {
            "top_topics": _extract_top_tokens(top_rows, key="topic", limit=8),
            "top_hook_tokens": _extract_top_tokens(top_rows, key="hook", limit=8),
        },
    }
    _write_json(state_file, payload)
    return strategy


