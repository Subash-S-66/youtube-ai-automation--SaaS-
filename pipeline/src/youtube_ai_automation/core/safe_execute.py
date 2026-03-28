from __future__ import annotations

from typing import Callable, TypeVar

from youtube_ai_automation.utils.logger import StageLogger

T = TypeVar("T")


def safe_execute(stage_name: str, fn: Callable[[], T], fallback: Callable[[Exception], T], logger: StageLogger) -> T:
    try:
        return fn()
    except Exception as exc:
        logger.error(stage_name, f"{exc}")
        return fallback(exc)

