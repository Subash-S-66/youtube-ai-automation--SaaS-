from __future__ import annotations


class ClipTracker:
    """
    Stateless tracker used by pipeline runtime.
    Database access is intentionally disabled; backend is the single DB writer.
    """

    def __init__(self, mongo_uri=None):
        self.mongo_uri = None

    def get_used_clips(self) -> set[str]:
        return set()

    def mark_clip_used(self, clip_id: str) -> None:
        return
