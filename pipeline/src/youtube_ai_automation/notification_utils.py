"""
Helpers for upload reporting and Telegram notifications.
"""

from __future__ import annotations

import json
from pathlib import Path

import requests


def reset_upload_report(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "uploads": [],
                "requested_count": 0,
                "completed_count": 0,
                "gemini_keywords": [],
                "gemini_topics": [],
                "selected_topics": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def append_upload_report(
    path: Path,
    *,
    title: str,
    topic: str,
    video_id: str,
    keywords: list[str],
) -> None:
    payload = {"uploads": []}
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            payload = {"uploads": []}

    uploads = payload.get("uploads", [])
    if not isinstance(uploads, list):
        uploads = []

    uploads.append(
        {
            "title": title,
            "topic": topic,
            "video_id": video_id,
            "keywords": keywords,
        }
    )
    payload["uploads"] = uploads
    payload["completed_count"] = len(uploads)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def update_upload_report_metadata(path: Path, **fields: object) -> None:
    payload = {
        "uploads": [],
        "requested_count": 0,
        "completed_count": 0,
        "gemini_keywords": [],
        "gemini_topics": [],
        "selected_topics": [],
    }
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    payload.update(fields)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_upload_report(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def send_telegram_message(bot_token: str, chat_id: str, text: str) -> None:
    token = bot_token
    if not token or not chat_id:
        return
    response = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data={"chat_id": chat_id, "text": text},
        timeout=20,
    )
    response.raise_for_status()


def build_upload_summary_message(report: dict) -> str:
    uploads = report.get("uploads", []) if isinstance(report, dict) else []
    if not uploads:
        return "Azure job completed, but no videos were uploaded."

    lines = ["Upload completed."]
    gemini_keywords = report.get("gemini_keywords", []) if isinstance(report, dict) else []
    gemini_topics = report.get("gemini_topics", []) if isinstance(report, dict) else []
    if gemini_keywords:
        lines.append("Gemini keywords: " + ", ".join(str(item).strip() for item in gemini_keywords[:12] if str(item).strip()))
    if gemini_topics:
        lines.append("Gemini topics: " + ", ".join(str(item).strip() for item in gemini_topics[:8] if str(item).strip()))
    for index, item in enumerate(uploads, start=1):
        title = str(item.get("title", "")).strip() or "Untitled"
        keywords = item.get("keywords", [])
        keyword_line = ", ".join(str(keyword).strip() for keyword in keywords if str(keyword).strip())
        lines.append(f"{index}. Title: {title}")
        if keyword_line:
            lines.append(f"Keywords: {keyword_line}")
    return "\n".join(lines)

