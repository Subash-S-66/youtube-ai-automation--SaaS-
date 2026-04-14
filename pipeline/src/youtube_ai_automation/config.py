"""
Central config for the Clip Forge project.
Load values from environment variables so secrets stay out of source code.
"""

from pathlib import Path
import logging
import os

from dotenv import load_dotenv


LOGGER = logging.getLogger("youtube_ai_automation.config")


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"


def _resolve_path_env(value: str, default_path: Path) -> Path:
    raw = (value or "").strip()
    if not raw:
        return default_path
    p = Path(raw)
    if p.is_absolute():
        return p
    # Resolve all relative env paths against PROJECT_ROOT, not process cwd.
    # Handle common duplicated prefix issue: PROJECT_ROOT already equals ".../pipeline"
    # while env may provide "pipeline/data/...".
    normalized = raw.replace("\\", "/").lstrip("./")
    if normalized.startswith("pipeline/") and PROJECT_ROOT.name.lower() == "pipeline":
        return (PROJECT_ROOT.parent / normalized).resolve()
    return (PROJECT_ROOT / p).resolve()

# Load variables from .env if present, but keep runtime env precedence.
# This allows CI/job-level env (for example RUN_MODE=prepared) to override .env defaults.
env_file = CONFIG_DIR / ".env"
if env_file.exists():
    load_dotenv(env_file, override=False)
else:
    load_dotenv(override=False)

# Base paths used across modules.
OUTPUT_DIR = DATA_DIR / "output"
ASSETS_DIR = DATA_DIR / "assets"
IMAGES_DIR = OUTPUT_DIR / "images"
CLIPS_DIR = _resolve_path_env(os.getenv("CLIPS_DIR", ""), ASSETS_DIR / "clips")
USED_CLIPS_FILE = _resolve_path_env(os.getenv("USED_CLIPS_FILE", ""), ASSETS_DIR / "used_clips.json")
AUDIO_PATH = OUTPUT_DIR / "voice.mp3"
SUBTITLE_PATH = OUTPUT_DIR / "subtitles.ass"
VIDEO_PATH = OUTPUT_DIR / "short.mp4"
TOKEN_PATH = _resolve_path_env(os.getenv("TOKEN_PATH", ""), OUTPUT_DIR / "token.json")
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
PEXELS_API_KEYS = [
    key.strip()
    for key in [*PEXELS_API_KEY.split(","), os.getenv("PEXELS_API_KEY_2", ""), os.getenv("PEXELS_API_KEY_SECONDARY", "")]
    if key and key.strip()
]
PIXABAY_API_KEYS = [
    key.strip()
    for key in [*PIXABAY_API_KEY.split(","), os.getenv("PIXABAY_API_KEY_2", ""), os.getenv("PIXABAY_API_KEY_SECONDARY", "")]
    if key and key.strip()
]
GNEWS_API_KEY = os.getenv("GNEWS_API_KEY", "")
NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
NEWS_QUERY = os.getenv("NEWS_QUERY", "world")
NEWS_LANGUAGE = os.getenv("NEWS_LANGUAGE", "en")
NEWS_LOOKBACK_HOURS = int(os.getenv("NEWS_LOOKBACK_HOURS", "24"))
NEWS_FETCH_MULTIPLIER = int(os.getenv("NEWS_FETCH_MULTIPLIER", "5"))
YOUTUBE_CLIENT_SECRET_FILE = str(
    _resolve_path_env(
        os.getenv("YOUTUBE_CLIENT_SECRET_FILE", ""),
        CONFIG_DIR / "client_secret.json",
    )
)
YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
YOUTUBE_DATA_API_KEY = os.getenv("YOUTUBE_DATA_API_KEY", "")
YOUTUBE_REGION_CODE = os.getenv("YOUTUBE_REGION_CODE", "US")
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
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
MIN_VIDEO_LENGTH = int(os.getenv("MIN_VIDEO_LENGTH", "15"))
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

REQUIRED_SECRETS = ["GEMINI_API_KEY", "WEBHOOK_SECRET", "ENCRYPTION_KEY"]  # FIXED: Define required runtime secrets for security baseline checks.
for secret in REQUIRED_SECRETS:
    if not os.getenv(secret, "").strip():
        LOGGER.critical("[SECURITY] Required secret %s is not set!", secret)  # FIXED: Emit startup critical log when mandatory secret is missing.

# Content defaults.
DEFAULT_TOPIC = os.getenv("DEFAULT_TOPIC", "")
DEFAULT_NICHE = os.getenv("DEFAULT_NICHE", "")
GEMINI_AUDIO_ENABLED = True
DEFAULT_VOICE = os.getenv("GEMINI_VOICE", "Puck")

