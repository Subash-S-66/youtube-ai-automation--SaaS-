from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import requests

from youtube_ai_automation.config import TOKEN_PATH, YOUTUBE_CLIENT_SECRET_FILE
from youtube_ai_automation.run_azure import main as run_azure_main

LOGGER = logging.getLogger("azure_job_runner")


def _safe_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _decode_b64(raw: str) -> str | None:
    if not raw:
        return None
    try:
        import base64

        return base64.b64decode(raw).decode("utf-8")
    except Exception:
        return None


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
            key_bytes = key_bytes.ljust(32, b"0")
        cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted_padded = decryptor.update(encrypted_data) + decryptor.finalize()
        pad_len = int(decrypted_padded[-1])
        if pad_len <= 0 or pad_len > 32:
            return None
        return decrypted_padded[:-pad_len].decode("utf-8")
    except Exception:
        return None


def _prepare_youtube_credentials() -> None:
    client_secret_path = Path(os.getenv("YOUTUBE_CLIENT_SECRET_FILE", YOUTUBE_CLIENT_SECRET_FILE))
    token_path = Path(os.getenv("TOKEN_PATH", str(TOKEN_PATH)))

    client_secret_b64 = os.getenv("YOUTUBE_CLIENT_SECRET_B64", "").strip()
    client_secret_json = os.getenv("YOUTUBE_CLIENT_SECRET_JSON", "").strip()
    token_b64 = os.getenv("YOUTUBE_TOKEN_B64", "").strip()
    token_json = os.getenv("YOUTUBE_TOKEN_JSON", "").strip()
    token_json_encrypted = os.getenv("YOUTUBE_TOKEN_JSON_ENCRYPTED", "").strip() or os.getenv("YOUTUBE_TOKEN_ENCRYPTED", "").strip()
    encryption_key = os.getenv("ENCRYPTION_KEY", "").strip()

    decoded_client_secret = _decode_b64(client_secret_b64)
    if decoded_client_secret:
        _safe_write_text(client_secret_path, decoded_client_secret)
    elif client_secret_json:
        _safe_write_text(client_secret_path, client_secret_json)

    decoded_token = _decode_b64(token_b64)
    if token_json_encrypted:  # FIXED: Prioritize encrypted channel-specific token payload from backend.
        decrypted_token_json = _decrypt_env_value(token_json_encrypted, encryption_key)  # FIXED: Decrypt selected-channel token JSON before writing token cache.
        if decrypted_token_json:  # FIXED: Only persist decrypted env token when decryption succeeds.
            _safe_write_text(token_path, decrypted_token_json)  # FIXED: Force token file to the selected-channel credentials.
            LOGGER.info("Prepared YouTube token from YOUTUBE_TOKEN_JSON_ENCRYPTED")  # FIXED: Trace token source for channel-routing audits.
        else:
            LOGGER.warning("YOUTUBE_TOKEN_JSON_ENCRYPTED was set but could not be decrypted")  # FIXED: Surface decryption problems early.
    elif token_json:
        _safe_write_text(token_path, token_json)  # FIXED: Use plain token JSON env only when encrypted payload is absent.
        LOGGER.info("Prepared YouTube token from YOUTUBE_TOKEN_JSON")  # FIXED: Trace fallback token source.
    elif decoded_token:
        _safe_write_text(token_path, decoded_token)  # FIXED: Keep base64 token as lowest-priority fallback to avoid stale override.
        LOGGER.info("Prepared YouTube token from YOUTUBE_TOKEN_B64")  # FIXED: Trace legacy fallback token source.


def _acquire_arm_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://management.azure.com/.default",
        "grant_type": "client_credentials",
    }
    response = requests.post(token_url, data=payload, timeout=20)
    response.raise_for_status()
    data = response.json()
    return str(data.get("access_token", "")).strip()


def _update_containerapps_job_secret(
    *,
    subscription_id: str,
    resource_group: str,
    job_name: str,
    api_version: str,
    token: str,
    secret_name: str,
    secret_value: str,
) -> None:
    base_url = (
        "https://management.azure.com/subscriptions/"
        f"{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.App/jobs/{job_name}"
    )
    headers = {"Authorization": f"Bearer {token}"}
    get_resp = requests.get(f"{base_url}?api-version={api_version}", headers=headers, timeout=20)
    get_resp.raise_for_status()
    job = get_resp.json()

    config = job.get("properties", {}).get("configuration", {})
    secrets = config.get("secrets", []) if isinstance(config.get("secrets"), list) else []
    updated = False
    for item in secrets:
        if item.get("name") == secret_name:
            item["value"] = secret_value
            updated = True
            break
    if not updated:
        secrets.append({"name": secret_name, "value": secret_value})

    patch_body = {"properties": {"configuration": {"secrets": secrets}}}
    patch_resp = requests.patch(
        f"{base_url}?api-version={api_version}",
        headers={**headers, "Content-Type": "application/json"},
        json=patch_body,
        timeout=20,
    )
    patch_resp.raise_for_status()


def _sync_token_to_azure_job(token_path: Path, initial_token: str | None) -> None:
    raw_flag = str(os.getenv("AZURE_SYNC_TOKEN_TO_JOB", "")).strip().lower()
    if raw_flag not in {"1", "true", "yes", "on"}:
        return
    if not token_path.exists():
        LOGGER.warning("Token sync skipped: token file missing at %s", token_path)
        return

    current_token = token_path.read_text(encoding="utf-8")
    if initial_token is not None and current_token == initial_token:
        LOGGER.info("Token sync skipped: token unchanged.")
        return

    subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", "").strip()
    resource_group = os.getenv("AZURE_RESOURCE_GROUP", "").strip()
    job_name = os.getenv("AZURE_JOB_NAME", "").strip()
    tenant_id = os.getenv("AZURE_TENANT_ID", "").strip()
    client_id = os.getenv("AZURE_CLIENT_ID", "").strip()
    client_secret = os.getenv("AZURE_CLIENT_SECRET", "").strip()
    api_version = os.getenv("AZURE_ARM_API_VERSION", "2025-01-01").strip()
    secret_name = os.getenv("AZURE_TOKEN_SECRET_NAME", "youtube-token-json").strip()

    missing = [
        name
        for name, value in [
            ("AZURE_SUBSCRIPTION_ID", subscription_id),
            ("AZURE_RESOURCE_GROUP", resource_group),
            ("AZURE_JOB_NAME", job_name),
            ("AZURE_TENANT_ID", tenant_id),
            ("AZURE_CLIENT_ID", client_id),
            ("AZURE_CLIENT_SECRET", client_secret),
        ]
        if not value
    ]
    if missing:
        LOGGER.warning("Token sync skipped: missing %s", ", ".join(missing))
        return

    try:
        arm_token = _acquire_arm_token(tenant_id, client_id, client_secret)
        if not arm_token:
            raise RuntimeError("Empty ARM token")
        _update_containerapps_job_secret(
            subscription_id=subscription_id,
            resource_group=resource_group,
            job_name=job_name,
            api_version=api_version,
            token=arm_token,
            secret_name=secret_name,
            secret_value=current_token,
        )
        LOGGER.info("Synced refreshed YouTube token to Azure secret '%s'.", secret_name)
    except Exception as exc:
        LOGGER.warning("Failed to sync token to Azure secret: %s", exc)


def main(argv: list[str] | None = None) -> dict:
    _prepare_youtube_credentials()
    token_path = Path(os.getenv("TOKEN_PATH", str(TOKEN_PATH)))
    initial_token = token_path.read_text(encoding="utf-8") if token_path.exists() else None
    try:
        return run_azure_main(argv if argv is not None else sys.argv[1:])
    finally:
        _sync_token_to_azure_job(token_path, initial_token)


if __name__ == "__main__":
    main()
