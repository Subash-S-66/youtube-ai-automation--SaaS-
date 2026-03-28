from __future__ import annotations

import logging
import time


class StageLogger:
    def __init__(self, job_id: str, debug: bool = False) -> None:
        self.job_id = job_id or "unknown"
        self.debug = debug
        self._logger = logging.getLogger("pipeline_v2")

    def _prefix(self, stage: str, status: str) -> str:
        return f"[{self.job_id}][{stage.upper()}][{status.upper()}]"

    def info(self, stage: str, message: str) -> None:
        self._logger.info("%s %s", self._prefix(stage, "ok"), message)

    def warn(self, stage: str, message: str) -> None:
        self._logger.warning("%s %s", self._prefix(stage, "warn"), message)

    def error(self, stage: str, message: str) -> None:
        self._logger.error("%s %s", self._prefix(stage, "failed"), message)

    def debug_log(self, stage: str, message: str) -> None:
        if self.debug:
            self._logger.info("%s %s", self._prefix(stage, "debug"), message)

    def timed(self, stage: str):
        return _StageTimer(self, stage)


class _StageTimer:
    def __init__(self, logger: StageLogger, stage: str) -> None:
        self.logger = logger
        self.stage = stage
        self.start = 0.0

    def __enter__(self):
        self.start = time.time()
        self.logger.debug_log(self.stage, "stage start")
        return self

    def __exit__(self, exc_type, exc, tb):
        elapsed = round(time.time() - self.start, 2)
        if exc:
            self.logger.error(self.stage, f"stage failed after {elapsed}s: {exc}")
        else:
            self.logger.info(self.stage, f"stage completed in {elapsed}s")

