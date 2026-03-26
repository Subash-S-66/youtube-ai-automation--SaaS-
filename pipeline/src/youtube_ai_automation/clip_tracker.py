import os
from pymongo import MongoClient

class ClipTracker:
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
                self.collection = self.db['used_clips']
            except Exception as e:
                print(f"Failed to connect to MongoDB for ClipTracker: {e}")

    def get_used_clips(self):
        if self.collection is None:
            return set()

        try:
            records = self.collection.find({})
            return {doc['clip_id'] for doc in records if 'clip_id' in doc}
        except Exception:
            return set()

    def mark_clip_used(self, clip_id: str):
        if self.collection is None:
            return

        try:
            self.collection.update_one(
                {'clip_id': clip_id},
                {'$set': {'clip_id': clip_id}},
                upsert=True
            )
        except Exception:
            pass
