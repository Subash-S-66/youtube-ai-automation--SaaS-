"""
Upload a video to YouTube using YouTube Data API v3.
"""

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import subprocess

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from youtube_ai_automation.config import TELEGRAM_ALLOWED_CHAT_ID, TELEGRAM_BOT_TOKEN
from youtube_ai_automation.notification_utils import send_telegram_message

LOGGER = logging.getLogger(__name__)
SHORTS_MAX_DURATION_SECONDS = 180.0


def _notify_token_issue(message: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ALLOWED_CHAT_ID:
        return
    try:
        send_telegram_message(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, message)
    except Exception as exc:
        LOGGER.warning("Failed to send Telegram token alert: %s", exc)


def _get_authenticated_service(client_secret_file: str, scopes: list[str], token_path: Path):
    """Create authenticated YouTube API client with token caching."""
    if not Path(client_secret_file).exists():
        raise FileNotFoundError(
            f"Missing client secret file: {client_secret_file}. "
            "Create OAuth credentials in Google Cloud and download the JSON file."
        )

    creds = None
    if token_path.exists():
        try:
            # Load cached scopes as-is to avoid refresh failures caused by scope expansion.
            creds = Credentials.from_authorized_user_file(str(token_path))
        except Exception as exc:
            LOGGER.warning("Could not parse cached OAuth token %s: %s", token_path, exc)
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                token_path.parent.mkdir(parents=True, exist_ok=True)
                token_path.write_text(creds.to_json(), encoding="utf-8")
            except RefreshError as exc:
                _notify_token_issue(f"YouTube OAuth refresh failed: {exc}. Re-auth is required.")
                if "invalid_scope" in str(exc).lower():
                    LOGGER.warning(
                        "OAuth token refresh failed with invalid_scope. "
                        "Clearing cached token and requesting new consent."
                    )
                    try:
                        token_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    creds = None
                else:
                    raise
        elif creds and creds.expired and not creds.refresh_token:
            _notify_token_issue(
                "YouTube OAuth token expired and has no refresh token. Re-auth is required."
            )
        if not creds or not creds.valid:
            flow = InstalledAppFlow.from_client_secrets_file(client_secret_file, scopes)
            creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")

    return build("youtube", "v3", credentials=creds)


def _normalize_publish_at(publish_at: str | None) -> str | None:
    """Validate and normalize a scheduled publish time to RFC3339 UTC."""
    if not publish_at:
        return None

    normalized = publish_at.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        raise ValueError("publish_at must include a timezone offset, for example +05:30.")

    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _probe_video_details(video_path: Path) -> tuple[float, int, int]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height",
        "-of",
        "json",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout or "{}")
    duration = float(payload.get("format", {}).get("duration", 0.0))
    width = 0
    height = 0
    for stream in payload.get("streams", []):
        if stream.get("codec_type") != "video":
            continue
        width = int(stream.get("width", 0) or 0)
        height = int(stream.get("height", 0) or 0)
        break
    if duration <= 0 or width <= 0 or height <= 0:
        raise ValueError(f"Invalid media metadata: duration={duration}, width={width}, height={height}")
    return duration, width, height


def _validate_shorts_candidate(video_path: Path, strict_shorts_validation: bool) -> None:
    try:
        duration, width, height = _probe_video_details(video_path)
    except Exception as exc:
        message = f"Could not run Shorts pre-check via ffprobe for {video_path}: {exc}"
        if strict_shorts_validation:
            raise RuntimeError(message) from exc
        LOGGER.warning("%s. Upload will continue.", message)
        return

    aspect_ratio = width / height
    LOGGER.info(
        "Shorts pre-check metadata: duration=%.2fs resolution=%sx%s aspect=%.3f",
        duration,
        width,
        height,
        aspect_ratio,
    )

    issues: list[str] = []
    if duration > SHORTS_MAX_DURATION_SECONDS:
        issues.append(
            f"Duration is {duration:.2f}s, above Shorts max of {SHORTS_MAX_DURATION_SECONDS:.0f}s."
        )
    if height < width:
        issues.append(f"Video is horizontal ({width}x{height}); Shorts should be square or vertical.")

    if issues:
        message = "Shorts pre-check failed: " + " ".join(issues)
        if strict_shorts_validation:
            raise ValueError(message)
        LOGGER.warning("%s Upload will continue because strict validation is disabled.", message)
        return

    LOGGER.info("Shorts pre-check passed. YouTube should classify it as a Short after processing.")


def upload_video(
    video_path: Path,
    title: str,
    description: str,
    tags: list[str],
    privacy_status: str,
    client_secret_file: str,
    scopes: list[str],
    token_path: Path,
    publish_at: str | None = None,
    validate_shorts: bool = True,
    strict_shorts_validation: bool = False,
) -> dict:
    """
    Upload video and return YouTube API response.
    """
    if validate_shorts:
        _validate_shorts_candidate(video_path=video_path, strict_shorts_validation=strict_shorts_validation)

    service = _get_authenticated_service(client_secret_file, scopes, token_path)
    status = {"privacyStatus": privacy_status}
    publish_at_utc = _normalize_publish_at(publish_at)
    if publish_at_utc:
        status["privacyStatus"] = "private"
        status["publishAt"] = publish_at_utc

    request = service.videos().insert(
        part="snippet,status",
        body={
            "snippet": {
                "title": title,
                "description": description,
                "tags": tags,
                "categoryId": "22",
            },
            "status": status,
        },
        media_body=MediaFileUpload(str(video_path), chunksize=-1, resumable=True),
    )
    response = request.execute()
    return response
