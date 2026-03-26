"""
Central config for the YouTube automation project.
Load values from environment variables so secrets stay out of source code.
"""

from pathlib import Path
import os

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"

# Load variables from .env if present. Override shell values to ensure repo config wins.
env_file = CONFIG_DIR / ".env"
if env_file.exists():
    load_dotenv(env_file, override=True)
else:
    load_dotenv(override=True)

# Base paths used across modules.
OUTPUT_DIR = DATA_DIR / "output"
ASSETS_DIR = DATA_DIR / "assets"
IMAGES_DIR = OUTPUT_DIR / "images"
CLIPS_DIR = Path(os.getenv("CLIPS_DIR", str(ASSETS_DIR / "clips")))
USED_CLIPS_FILE = Path(os.getenv("USED_CLIPS_FILE", str(ASSETS_DIR / "used_clips.json")))
AUDIO_PATH = OUTPUT_DIR / "voice.mp3"
SUBTITLE_PATH = OUTPUT_DIR / "subtitles.ass"
VIDEO_PATH = OUTPUT_DIR / "short.mp4"
TOKEN_PATH = Path(os.getenv("TOKEN_PATH", str(OUTPUT_DIR / "token.json")))
UPLOADED_DOWNLOAD_DIR = OUTPUT_DIR / "uploaded"
USED_TOPICS_FILE = OUTPUT_DIR / "used_topics.json"
USED_HOOKS_FILE = OUTPUT_DIR / "used_hooks.json"
GENERATED_IDEAS_FILE = OUTPUT_DIR / "generated_ideas.json"
USED_TITLES_FILE = OUTPUT_DIR / "used_titles.json"
ANALYTICS_HISTORY_FILE = OUTPUT_DIR / "analytics_history.json"
IMPROVEMENT_STATE_FILE = OUTPUT_DIR / "improvement_state.json"
GEMINI_TOPIC_MEMORY_FILE = OUTPUT_DIR / "gemini_topic_memory.json"
UPLOAD_REPORT_FILE = OUTPUT_DIR / "upload_report.json"

# API keys and settings.
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")
PIXABAY_API_KEY = os.getenv("PIXABAY_API_KEY", "")
GNEWS_API_KEY = os.getenv("GNEWS_API_KEY", "")
NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
NEWS_QUERY = os.getenv("NEWS_QUERY", "world")
NEWS_LANGUAGE = os.getenv("NEWS_LANGUAGE", "en")
NEWS_LOOKBACK_HOURS = int(os.getenv("NEWS_LOOKBACK_HOURS", "24"))
NEWS_FETCH_MULTIPLIER = int(os.getenv("NEWS_FETCH_MULTIPLIER", "5"))
YOUTUBE_CLIENT_SECRET_FILE = os.getenv(
    "YOUTUBE_CLIENT_SECRET_FILE",
    str(CONFIG_DIR / "client_secret.json"),
)
YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
YOUTUBE_DATA_API_KEY = os.getenv("YOUTUBE_DATA_API_KEY", "")
YOUTUBE_REGION_CODE = os.getenv("YOUTUBE_REGION_CODE", "US")
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest")
REDDIT_SUBREDDITS = os.getenv(
    "REDDIT_SUBREDDITS",
    "technology,artificial,productivity,InternetIsBeautiful,todayilearned,Futurology",
)
TREND_TOPIC_LIMIT = int(os.getenv("TREND_TOPIC_LIMIT", "10"))
IDEA_CANDIDATE_COUNT = int(os.getenv("IDEA_CANDIDATE_COUNT", "10"))
HOOKS_PER_TOPIC = int(os.getenv("HOOKS_PER_TOPIC", "3"))
VIDEOS_PER_DAY = int(os.getenv("VIDEOS_PER_DAY", "1"))
SCENE_DURATION = float(os.getenv("SCENE_DURATION", "4"))
MIN_VIDEO_LENGTH = int(os.getenv("MIN_VIDEO_LENGTH", "30"))
MAX_VIDEO_LENGTH = int(os.getenv("MAX_VIDEO_LENGTH", "60"))
MIN_SCRIPT_SECONDS = int(os.getenv("MIN_SCRIPT_SECONDS", "20"))
MAX_SCRIPT_SECONDS = int(os.getenv("MAX_SCRIPT_SECONDS", "35"))
BACKGROUND_MUSIC_PATH = os.getenv("BACKGROUND_MUSIC_PATH", "")
BACKGROUND_MUSIC_VOLUME = float(os.getenv("BACKGROUND_MUSIC_VOLUME", "0.12"))
CLEANUP_LOCAL_FILES_AFTER_UPLOAD = os.getenv("CLEANUP_LOCAL_FILES_AFTER_UPLOAD", "true").strip().lower() in {
    "1",
    "true",
    "yes",
}
DOWNLOAD_UPLOADED_VIDEO = os.getenv("DOWNLOAD_UPLOADED_VIDEO", "true").strip().lower() in {
    "1",
    "true",
    "yes",
}
VALIDATE_SHORTS_BEFORE_UPLOAD = os.getenv("VALIDATE_SHORTS_BEFORE_UPLOAD", "true").strip().lower() in {
    "1",
    "true",
    "yes",
}
STRICT_SHORTS_VALIDATION = os.getenv("STRICT_SHORTS_VALIDATION", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID", "").strip()

# Content defaults.
DEFAULT_TOPIC = os.getenv("DEFAULT_TOPIC", "")
DEFAULT_NICHE = os.getenv("DEFAULT_NICHE", "")
DEFAULT_VOICE = os.getenv("EDGE_TTS_VOICE", "en-US-AriaNeural")

