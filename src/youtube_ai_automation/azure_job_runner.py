import base64
import logging
import os
from pathlib import Path

import requests

from youtube_ai_automation.config import DEFAULT_NICHE, TOKEN_PATH, YOUTUBE_CLIENT_SECRET_FILE
from youtube_ai_automation.main import (
    _run_network_preflight,
    _setup_logging,
    reset_upload_report,
    run_auto_pipeline,
    run_news_pipeline,
    run_optimized_pipeline,
    run_pipeline,
    update_upload_report_metadata,
    UPLOAD_REPORT_FILE,
)
from youtube_ai_automation.notification_utils import build_upload_summary_message, load_upload_report, send_telegram_message


LOGGER = logging.getLogger("azure_job_runner")


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, value)


def _normalize_mode(value: str) -> str:
    cleaned = value.strip().strip('"').strip("'").lower()
    if not cleaned:
        return ""
    token = cleaned.replace(",", " ").split()[0]
    aliases = {
        "news": "news",
        "gnews": "news",
        "breaking": "news",
        "auto": "auto",
        "optimized": "optimized",
        "opt": "optimized",
        "manual": "manual",
        "single": "single",
    }
    return aliases.get(token, token)


def _resolve_mode() -> str:
    explicit = _normalize_mode(os.getenv("RUN_MODE", ""))
    if explicit:
        return explicit
    if _env_flag("RUN_OPTIMIZED", False):
        return "optimized"
    if _env_flag("RUN_AUTO", False):
        return "auto"
    return "optimized"


def _safe_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _decode_b64(raw: str) -> str | None:
    if not raw:
        return None
    try:
        return base64.b64decode(raw).decode("utf-8")
    except Exception:
        return None


def _prepare_youtube_credentials() -> None:
    client_secret_path = Path(os.getenv("YOUTUBE_CLIENT_SECRET_FILE", YOUTUBE_CLIENT_SECRET_FILE))
    token_path = Path(os.getenv("TOKEN_PATH", str(TOKEN_PATH)))

    client_secret_b64 = os.getenv("YOUTUBE_CLIENT_SECRET_B64", "").strip()
    client_secret_json = os.getenv("YOUTUBE_CLIENT_SECRET_JSON", "").strip()
    token_b64 = os.getenv("YOUTUBE_TOKEN_B64", "").strip()
    token_json = os.getenv("YOUTUBE_TOKEN_JSON", "").strip()

    decoded_client_secret = _decode_b64(client_secret_b64)
    if decoded_client_secret:
        _safe_write_text(client_secret_path, decoded_client_secret)
    elif client_secret_json:
        _safe_write_text(client_secret_path, client_secret_json)

    decoded_token = _decode_b64(token_b64)
    if decoded_token:
        _safe_write_text(token_path, decoded_token)
    elif token_json:
        _safe_write_text(token_path, token_json)


from src.youtube_ai_automation.services.webhook_service import send_job_status

def _notify_telegram(message: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
    if not token or not chat_id:
        return
    try:
        send_telegram_message(token, chat_id, message)
    except Exception as exc:
        LOGGER.warning("Telegram notify failed: %s", exc, exc_info=True)
        return

def _notify_backend(status: str, logs: str = "") -> None:
    job_id = os.getenv("JOB_ID", "").strip()
    if job_id:
        send_job_status(job_id, status, logs)


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
    if not _env_flag("AZURE_SYNC_TOKEN_TO_JOB", False):
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


def main() -> None:
    _setup_logging()
    reset_upload_report(UPLOAD_REPORT_FILE)

    run_mode = _resolve_mode()
    count = _env_int("RUN_COUNT", 1)
    upload = _env_flag("UPLOAD", True) or _env_flag("RUN_UPLOAD", True)
    topic = os.getenv("TOPIC", "").strip()
    niche = os.getenv("NICHE", DEFAULT_NICHE).strip()
    publish_at = os.getenv("PUBLISH_AT", "").strip() or None

    update_upload_report_metadata(UPLOAD_REPORT_FILE, requested_count=count)
    _prepare_youtube_credentials()
    token_path = Path(os.getenv("TOKEN_PATH", str(TOKEN_PATH)))
    initial_token = token_path.read_text(encoding="utf-8") if token_path.exists() else None

    LOGGER.info("Azure job starting. mode=%s count=%s upload=%s", run_mode, count, upload)
    _notify_telegram(f"Azure job starting. mode={run_mode} count={count} upload={upload}")
    _notify_backend("running", f"Job started in mode={run_mode}")

    _run_network_preflight(check_trend_sources=run_mode in {"auto", "optimized"}, upload=upload)

    try:
        if run_mode == "news":
            run_news_pipeline(upload=upload, publish_at=publish_at, count=count)
            report = load_upload_report(UPLOAD_REPORT_FILE)
            _notify_telegram(build_upload_summary_message(report))
            _notify_backend("SUCCESS", "Pipeline completed successfully.")
            return
        if run_mode == "optimized":
            run_optimized_pipeline(topic=topic, niche=niche, upload=upload, publish_at=publish_at, count=count)
            report = load_upload_report(UPLOAD_REPORT_FILE)
            _notify_telegram(build_upload_summary_message(report))
            _notify_backend("SUCCESS", "Pipeline completed successfully.")
            return
        if run_mode == "auto":
            run_auto_pipeline(topic=topic, niche=niche, upload=upload, publish_at=publish_at, count=count)
            report = load_upload_report(UPLOAD_REPORT_FILE)
            _notify_telegram(build_upload_summary_message(report))
            _notify_backend("SUCCESS", "Pipeline completed successfully.")
            return
        if run_mode in {"manual", "single"}:
            if not topic:
                raise SystemExit("RUN_MODE=manual requires TOPIC.")
            run_pipeline(topic=topic, upload=upload, niche=niche, generate_topic=False, publish_at=publish_at)
            report = load_upload_report(UPLOAD_REPORT_FILE)
            _notify_telegram(build_upload_summary_message(report))
            _notify_backend("SUCCESS", "Pipeline completed successfully.")
            return

        raise SystemExit(f"Unknown RUN_MODE: {run_mode}")
    except Exception as exc:
        LOGGER.exception("Azure job failed: %s", exc)
        _notify_telegram(f"Azure job failed: {exc}")

        # Determine if failed due to YouTube limits
        err_str = str(exc).lower()
        if "quota" in err_str or "upload limit" in err_str or "daily limit" in err_str:
            _notify_backend("YOUTUBE_REJECTED", f"PIPELINE_STATUS:YOUTUBE_REJECTED\nAzure job failed: {exc}")
        else:
            _notify_backend("FAILED", f"PIPELINE_STATUS:FAILED\nAzure job failed: {exc}")

        raise
    finally:
        _sync_token_to_azure_job(token_path, initial_token)


if __name__ == "__main__":
    main()

