from __future__ import annotations

import logging

LOGGER = logging.getLogger(__name__)


class TopicTracker:
    """
    Stateless tracker used by pipeline runtime.
    Database access is intentionally disabled; backend is the single DB writer.
    """

    def __init__(self, mongo_uri=None):
        self.mongo_uri = None
        self.collection = None

    def get_all_topics(self) -> list[dict]:
        return []

    def mark_topic_used(self, topic: str) -> None:
        return
