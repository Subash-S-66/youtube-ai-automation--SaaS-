import os
import logging
from datetime import datetime, timezone
from pymongo import MongoClient

LOGGER = logging.getLogger(__name__)

class TopicTracker:
    def __init__(self, mongo_uri=None):
        self.mongo_uri = mongo_uri or os.getenv("MONGO_URI")
        self.client = None
        self.db = None
        self.collection = None

        if self.mongo_uri:
            try:
                self.client = MongoClient(self.mongo_uri)
                # Parse DB name from URI or use default
                db_name = self.mongo_uri.split('/')[-1].split('?')[0]
                if not db_name:
                    db_name = "clipforge"
                self.db = self.client[db_name]
                self.collection = self.db['used_topics']
            except Exception as e:
                LOGGER.error(f"Failed to connect to MongoDB for TopicTracker: {e}")

    def get_all_topics(self) -> list[dict]:
        if self.collection is None:
            return []

        try:
            records = self.collection.find({}).sort("used_at", -1).limit(500)
            return [{"topic": doc.get('topic', ''), "used_at": doc.get('used_at', '')} for doc in records]
        except Exception as e:
            LOGGER.error(f"Failed to get topics from MongoDB: {e}")
            return []

    def mark_topic_used(self, topic: str):
        if self.collection is None:
            return

        try:
            now = datetime.now(timezone.utc).isoformat()
            self.collection.update_one(
                {'topic': topic},
                {'$setOnInsert': {'topic': topic, 'used_at': now}},
                upsert=True
            )
        except Exception as e:
            LOGGER.error(f"Failed to mark topic used in MongoDB: {e}")
