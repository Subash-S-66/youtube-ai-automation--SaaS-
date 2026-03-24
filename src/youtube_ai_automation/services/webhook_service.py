import os
import requests
import logging

LOGGER = logging.getLogger("webhook_service")

def send_job_status(job_id: str, status: str, logs: str = "") -> None:
    webhook_url = os.getenv("WEBHOOK_URL")
    webhook_secret = os.getenv("WEBHOOK_SECRET", "")

    if not webhook_url or not job_id:
        return

    try:
        headers = {}
        if webhook_secret:
            headers["x-webhook-secret"] = webhook_secret

        payload = {
            "jobId": job_id,
            "status": status,
            "logs": logs
        }
        response = requests.post(webhook_url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
    except Exception as e:
        LOGGER.warning(f"Failed to send webhook update for job {job_id}: {e}")
