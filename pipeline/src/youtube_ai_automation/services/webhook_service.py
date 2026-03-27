import os
import requests
import logging
import time

LOGGER = logging.getLogger("webhook_service")
_JOB_STATUS_PATH = "/api/webhook/job-status"


def _normalize_webhook_candidates(webhook_url: str) -> list[str]:
    base = (webhook_url or "").strip().rstrip("/")
    if not base:
        return []
    if base.endswith(_JOB_STATUS_PATH):
        return [base]
    from urllib.parse import urlparse
    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return [origin + _JOB_STATUS_PATH]


def send_with_retry(url: str, payload: dict, headers: dict) -> None:
    for attempt in range(3):
        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=5
            )
            if response.status_code >= 400:
                raise Exception(f"Webhook failed: {response.status_code}")
            return
        except Exception as exc:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def send_job_status(
    job_id: str,
    status: str,
    logs: str = "",
    video_url: str = "",
    youtube_video_id: str = "",
    error_message: str = "",
    error_stage: str = "",
) -> None:
    webhook_url = os.getenv("WEBHOOK_URL")
    webhook_secret = os.getenv("WEBHOOK_SECRET")

    if not webhook_url or not job_id:
        return

    normalized_status = str(status or "").strip()
    if normalized_status.lower() == "running":
        normalized_status = "processing"

    payload = {
        "jobId": job_id,
        "status": normalized_status,
        "logs": logs,
        "videoUrl": video_url,
        "youtubeVideoId": youtube_video_id,
        "errorMessage": error_message,
        "errorStage": error_stage,
    }
    headers = {"Content-Type": "application/json"}
    if webhook_secret:
        headers["x-webhook-secret"] = webhook_secret

    last_error: Exception | None = None
    for candidate_url in _normalize_webhook_candidates(webhook_url):
        try:
            send_with_retry(candidate_url, payload, headers)
            return
        except requests.HTTPError as e:
            last_error = e
            status_code = getattr(e.response, "status_code", None)
            if status_code == 404:
                continue
            break
        except Exception as e:
            last_error = e
            break

    if last_error:
        LOGGER.warning(f"Failed to send webhook update for job {job_id}: {last_error}")
