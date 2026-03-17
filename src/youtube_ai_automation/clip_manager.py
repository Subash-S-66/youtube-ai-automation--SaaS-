"""
Persistent clip history management to avoid repeated stock clips.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import random
from typing import Any


def _normalize_url(url: str) -> str:
    return str(url).split("?", 1)[0].strip().lower()


def _read_used_clips(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("used_clips", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []
    return []


def _write_used_clips(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"used_clips": rows[-5000:]}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def used_clip_urls(path: Path) -> set[str]:
    return {
        _normalize_url(str(item.get("url", "")))
        for item in _read_used_clips(path)
        if str(item.get("url", "")).strip()
    }


def is_clip_used(url: str, path: Path) -> bool:
    normalized = _normalize_url(url)
    if not normalized:
        return False
    return normalized in used_clip_urls(path)


def mark_clip_as_used(
    url: str,
    source: str,
    query: str,
    path: Path,
    local_path: str = "",
) -> None:
    normalized = _normalize_url(url)
    if not normalized:
        return
    rows = _read_used_clips(path)
    if any(_normalize_url(str(row.get("url", ""))) == normalized for row in rows):
        return
    rows.append(
        {
            "url": normalized,
            "source": str(source).strip(),
            "query": " ".join(str(query).split()).strip(),
            "local_path": str(local_path).strip(),
            "used_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    _write_used_clips(path, rows)


def choose_candidate(
    candidates: list[dict[str, Any]],
    used_clips_file: Path,
    exclude_urls: set[str] | None = None,
    top_k: int = 4,
    min_resolution: int = 720,
    allow_used_fallback: bool = False,
) -> dict[str, Any] | None:
    """
    Pick a high-score candidate that was not used in prior videos.
    Falls back to the best available candidate if all are used.
    """
    if not candidates:
        return None

    selected = choose_candidates(
        candidates=candidates,
        used_clips_file=used_clips_file,
        count=1,
        exclude_urls=exclude_urls,
        top_k=top_k,
        min_resolution=min_resolution,
        allow_used_fallback=allow_used_fallback,
    )
    return selected[0] if selected else None


def choose_candidates(
    candidates: list[dict[str, Any]],
    used_clips_file: Path,
    count: int,
    exclude_urls: set[str] | None = None,
    top_k: int = 4,
    min_resolution: int = 720,
    allow_used_fallback: bool = False,
) -> list[dict[str, Any]]:
    """
    Pick up to `count` clips from the highest-scored candidates with randomness.
    """
    if not candidates or count <= 0:
        return []

    exclude = {_normalize_url(url) for url in (exclude_urls or set()) if str(url).strip()}
    used = used_clip_urls(used_clips_file)

    deduped: dict[str, dict[str, Any]] = {}
    for item in candidates:
        normalized = _normalize_url(str(item.get("url", "")))
        if not normalized:
            continue
        width = int(item.get("width", 0) or 0)
        height = int(item.get("height", 0) or 0)
        if width < min_resolution and height < min_resolution:
            continue
        existing = deduped.get(normalized)
        if not existing or float(item.get("score", 0.0)) > float(existing.get("score", 0.0)):
            deduped[normalized] = item

    base_pool = [
        item
        for key, item in deduped.items()
        if key not in exclude and key not in used
    ]
    if not base_pool and allow_used_fallback:
        base_pool = [item for key, item in deduped.items() if key not in exclude]
    if not base_pool:
        return []

    ranked = sorted(base_pool, key=lambda row: float(row.get("score", 0.0)), reverse=True)
    selected: list[dict[str, Any]] = []
    selected_urls: set[str] = set()
    max_count = min(count, len(ranked))
    while len(selected) < max_count:
        remaining = [
            item
            for item in ranked
            if _normalize_url(str(item.get("url", ""))) not in selected_urls
        ]
        if not remaining:
            break
        window = remaining[: max(1, top_k)]
        choice = random.choice(window)
        selected.append(choice)
        selected_urls.add(_normalize_url(str(choice.get("url", ""))))

    return selected


def select_best_unused_candidates(
    candidates: list[dict[str, Any]],
    used_clips_file: Path,
    count: int,
    exclude_urls: set[str] | None = None,
    top_k: int = 4,
    min_resolution: int = 720,
) -> list[dict[str, Any]]:
    """
    Compatibility wrapper: strict no-reuse candidate selection.
    """
    return choose_candidates(
        candidates=candidates,
        used_clips_file=used_clips_file,
        count=count,
        exclude_urls=exclude_urls,
        top_k=top_k,
        min_resolution=min_resolution,
        allow_used_fallback=False,
    )


def filter_candidates(
    candidates: list[dict[str, Any]],
    used_clips_file: Path,
    exclude_urls: set[str] | None = None,
    min_resolution: int = 720,
) -> list[dict[str, Any]]:
    """
    Return de-duplicated, unused, resolution-valid candidates.
    """
    selected = choose_candidates(
        candidates=candidates,
        used_clips_file=used_clips_file,
        count=len(candidates),
        exclude_urls=exclude_urls,
        top_k=max(1, len(candidates)),
        min_resolution=min_resolution,
        allow_used_fallback=False,
    )
    if not selected:
        return []

    return sorted(selected, key=lambda row: float(row.get("score", 0.0)), reverse=True)

