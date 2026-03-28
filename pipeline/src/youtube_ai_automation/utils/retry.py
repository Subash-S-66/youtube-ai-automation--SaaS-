from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


def retry_with_backoff(fn: Callable[[], T], attempts: int = 3, base_delay: float = 1.0) -> T:
    last_exc: Exception | None = None
    for i in range(max(1, attempts)):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if i >= attempts - 1:
                break
            time.sleep(base_delay * (2 ** i))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("retry_with_backoff exhausted without captured error")

