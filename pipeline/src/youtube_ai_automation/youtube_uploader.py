"""
Upload a video to YouTube using YouTube Data API v3.
"""

from datetime import datetime, timezone
import json
import logging
import os
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
    """
    Create authenticated YouTube API client.

    Priority order:
    1. YOUTUBE_TOKEN_JSON_ENCRYPTED (channel-specific token from backend) — ALWAYS preferred
    2. YOUTUBE_TOKEN_JSON (plain JSON in env)
    3. Cached token file at token_path (ONLY used when no env token is present)
    4. YOUTUBE_TOKEN_ENCRYPTED (access-token-only fallback)
    5. Interactive browser flow (local dev only)

    IMPORTANT: When an env token is provided (cases 1-2), we NEVER fall back to the
    cached token file. The cached file may contain credentials for a different YouTube
    channel from a previous run, causing uploads to the wrong channel.
    """
    encryption_key = os.environ.get("ENCRYPTION_KEY", "").strip()
    env_token_json_encrypted = os.environ.get("YOUTUBE_TOKEN_JSON_ENCRYPTED", "").strip()
    env_token_json = os.environ.get("YOUTUBE_TOKEN_JSON", "").strip()

    # --- Phase 1: Try channel-specific token from env (highest priority) ---
    decrypted_token_json = _decrypt_env_value(env_token_json_encrypted, encryption_key)
    token_json_payload = decrypted_token_json or env_token_json

    if token_json_payload:
        try:
            parsed = json.loads(token_json_payload)
            creds = Credentials.from_authorized_user_info(parsed, scopes=scopes)

            # Refresh if expired — the JSON includes the refresh_token for this specific channel
            if not creds.valid and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                LOGGER.info("Refreshed channel-specific OAuth token from env payload.")

            if creds.valid:
                # Overwrite any stale cached file so subsequent calls in this run use the right channel
                token_path.parent.mkdir(parents=True, exist_ok=True)
                token_path.write_text(creds.to_json(), encoding="utf-8")
                LOGGER.info("Using channel-specific OAuth credentials from env (YOUTUBE_TOKEN_JSON_ENCRYPTED).")
                return build("youtube", "v3", credentials=creds)
            else:
                LOGGER.warning("Env token payload present but credentials are not valid after refresh attempt.")
        except RefreshError as exc:
            LOGGER.error("OAuth refresh failed for channel-specific env token: %s", exc)
            _notify_token_issue(f"YouTube OAuth refresh failed (channel token): {exc}")
            raise RuntimeError(
                f"YouTube channel token refresh failed: {exc}. "
                "The user must reconnect this channel via the dashboard."
            ) from exc
        except Exception as exc:
            LOGGER.error("Failed to parse/use channel-specific env token: %s", exc)
            # Fall through to cached file only if env token parse completely failed
            token_json_payload = None  # mark as failed

    # --- Phase 2: Cached token file (only when NO env token was provided) ---
    # If token_json_payload was set above but failed parsing, we do NOT fall back to the
    # cached file — it might be from a different channel. Only use cached file when
    # no env token was configured at all.
    env_token_was_provided = bool(env_token_json_encrypted or env_token_json)

    creds = None
    if not env_token_was_provided and token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path))
            LOGGER.info("Loaded cached OAuth token from %s", token_path)
        except Exception as exc:
            LOGGER.warning("Could not parse cached OAuth token %s: %s", token_path, exc)
            creds = None

    if creds is not None and not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                token_path.write_text(creds.to_json(), encoding="utf-8")
            except RefreshError as exc:
                _notify_token_issue(f"YouTube OAuth refresh failed: {exc}. Re-auth is required.")
                creds = None
        else:
            creds = None

    if creds is not None and creds.valid:
        return build("youtube", "v3", credentials=creds)

    # --- Phase 3: Access-token-only fallback (legacy / emergency) ---
    env_token_encrypted = os.environ.get("YOUTUBE_TOKEN_ENCRYPTED", "").strip()
    if env_token_encrypted and encryption_key:
        try:
            env_token = _decrypt_env_value(env_token_encrypted, encryption_key)
            if env_token:
                LOGGER.warning(
                    "Using access-token-only credentials (YOUTUBE_TOKEN_ENCRYPTED). "
                    "Token may expire without refresh capability."
                )
                creds = Credentials(token=env_token)
                return build("youtube", "v3", credentials=creds)
        except Exception as e:
            LOGGER.error("Failed to decrypt YOUTUBE_TOKEN_ENCRYPTED: %s", e)

    # --- Phase 4: Interactive flow (local dev only) ---
    if os.environ.get("NON_INTERACTIVE") == "1" or not os.environ.get("DISPLAY"):
        raise RuntimeError(
            "YouTube token expired/missing and running headlessly. "
            "Please reconnect this YouTube channel via the dashboard."
        )

    if not Path(client_secret_file).exists():
        raise FileNotFoundError(
            f"Missing client secret file: {client_secret_file}. "
            "Create OAuth credentials in Google Cloud Console and download the JSON file."
        )

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