"""
Track and filter used hooks so generated Shorts stay diverse over time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Iterable

from youtube_ai_automation.config import USED_HOOKS_FILE


@dataclass
class UsedHookEntry:
    hook: str
    used_at: str


def _normalize(hook: str) -> str:
    return " ".join(hook.lower().split()).strip()


def _read_used_hooks(path: Path = USED_HOOKS_FILE) -> list[UsedHookEntry]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("used_hooks", [])
        entries = [
            UsedHookEntry(hook=str(row.get("hook", "")).strip(), used_at=str(row.get("used_at", "")))
            for row in rows
            if str(row.get("hook", "")).strip()
        ]
        return entries
    except Exception:
        return []


def _write_used_hooks(entries: list[UsedHookEntry], path: Path = USED_HOOKS_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "used_hooks": [{"hook": item.hook, "used_at": item.used_at} for item in entries[-1000:]],
    }
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def select_best_unused_hook(candidates: Iterable[str], path: Path = USED_HOOKS_FILE) -> str:
    """
    Return the first unused hook. If all are used, return the first candidate.
    """
    entries = _read_used_hooks(path)
    used = {_normalize(item.hook) for item in entries}
    cleaned = [" ".join(candidate.split()).strip() for candidate in candidates if candidate and candidate.strip()]
    if not cleaned:
        raise ValueError("No candidate hooks to choose from.")

    for candidate in cleaned:
        if _normalize(candidate) not in used:
            return candidate
    return cleaned[0]


def mark_hook_as_used(hook: str, path: Path = USED_HOOKS_FILE) -> None:
    """
    Persist a hook as used to reduce repetition.
    """
    normalized = " ".join(hook.split()).strip()
    if not normalized:
        return

    entries = _read_used_hooks(path)
    existing = {_normalize(item.hook) for item in entries}
    if _normalize(normalized) in existing:
        return

    entries.append(UsedHookEntry(hook=normalized, used_at=datetime.now(timezone.utc).isoformat()))
    _write_used_hooks(entries, path)

