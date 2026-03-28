"""
Upload a video to YouTube using YouTube Data API v3.
"""

from datetime import datetime, timezone
import json
import logging
from pathlib import Path

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


def _decrypt_env_value(raw: str, encryption_key: str) -> str | None:
    if not raw or not encryption_key:
        return None
    try:
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        parts = raw.split(":")
        if len(parts) != 2:
            return None
        iv = bytes.fromhex(parts[0])
        encrypted_data = bytes.fromhex(parts[1])
        key_bytes = encryption_key.encode("utf-8")[:32]
        if len(key_bytes) < 32:
            key_bytes = key_bytes.ljust(32, b"\0")
        cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted_padded = decryptor.update(encrypted_data) + decryptor.finalize()
        pad_len = int(decrypted_padded[-1])
        if pad_len <= 0 or pad_len > 32:
            return None
        return decrypted_padded[:-pad_len].decode("utf-8")
    except Exception:
        return None


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
    import os

    env_token_json = os.environ.get("YOUTUBE_TOKEN_JSON", "").strip()
    env_token_json_encrypted = os.environ.get("YOUTUBE_TOKEN_JSON_ENCRYPTED", "").strip()
    encryption_key = os.environ.get("ENCRYPTION_KEY", "").strip()

    decrypted_token_json = _decrypt_env_value(env_token_json_encrypted, encryption_key)
    token_json_payload = decrypted_token_json or env_token_json
    if token_json_payload:
        try:
            parsed = json.loads(token_json_payload)
            creds = Credentials.from_authorized_user_info(parsed, scopes=scopes)
            token_path.parent.mkdir(parents=True, exist_ok=True)
            token_path.write_text(creds.to_json(), encoding="utf-8")
        except Exception as exc:
            LOGGER.warning("Could not parse YOUTUBE_TOKEN_JSON payload from env: %s", exc)
            creds = None

    if not creds and token_path.exists():
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
                exc_low = str(exc).lower()
                if "invalid_scope" in exc_low or "invalid_grant" in exc_low or "revoked" in exc_low:
                    LOGGER.warning(
                        "OAuth token refresh failed with invalid/expired grant. "
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
            # Use YOUTUBE_TOKEN_ENCRYPTED environment variable if available (passed from the backend)
            # We must decrypt it using the ENCRYPTION_KEY environment variable.
            env_token_encrypted = os.environ.get("YOUTUBE_TOKEN_ENCRYPTED")
            encryption_key = os.environ.get("ENCRYPTION_KEY")

            if env_token_encrypted and encryption_key:
                try:
                    env_token = _decrypt_env_value(env_token_encrypted, encryption_key)
                    if env_token:
                        # Backward-compatible fallback for access-token-only payloads.
                        creds = Credentials(token=env_token)
                except Exception as e:
                    LOGGER.error(f"Failed to decrypt and use YOUTUBE_TOKEN_ENCRYPTED: {e}")
                    raise RuntimeError("Invalid encrypted YouTube token provided by backend. Re-auth required.")
            else:
                # Local development fallback
                if os.environ.get("NON_INTERACTIVE") == "1" or not os.environ.get("DISPLAY"):
                    raise RuntimeError("YouTube token expired/missing and running headlessly. Please re-authenticate via frontend UI.")

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


def _validate_shorts_candidate(video_path: Path, strict_shorts_validation: bool) -> None:
    LOGGER.info("Shorts pre-check skipped in prepared mode for %s", video_path)


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
