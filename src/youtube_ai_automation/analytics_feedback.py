"""
Collect post-upload YouTube analytics and persist feedback history.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from math import log10
from pathlib import Path
from typing import Any

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


def _read_history(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("records", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []
    return []


def _write_history(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"records": rows[-2000:]}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _authenticated_service(token_path: Path, scopes: list[str]):
    if not token_path.exists():
        raise FileNotFoundError(f"Missing OAuth token file: {token_path}")

    # Keep token's granted scopes and avoid forcing scope expansion during refresh.
    creds = Credentials.from_authorized_user_file(str(token_path))
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as exc:
                raise ValueError(f"OAuth token refresh failed: {exc}") from exc
        else:
            raise ValueError("OAuth token is invalid and cannot be refreshed.")
    return build("youtube", "v3", credentials=creds)


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _performance_score(views: int, likes: int, comments: int) -> float:
    if views <= 0:
        return 0.0
    view_score = min(70.0, log10(views + 1) / 6.0 * 70.0)
    engagement_rate = (likes + comments) / max(1, views)
    engagement_score = min(30.0, engagement_rate * 600.0)
    return round(view_score + engagement_score, 2)


def fetch_video_statistics(video_id: str, token_path: Path, scopes: list[str]) -> dict[str, Any]:
    """
    Fetch basic public statistics for a YouTube video.
    """
    service = _authenticated_service(token_path=token_path, scopes=scopes)
    response = (
        service.videos()
        .list(part="snippet,statistics", id=video_id, maxResults=1)
        .execute()
    )
    items = response.get("items", [])
    if not items:
        raise ValueError(f"No analytics found for video id: {video_id}")

    item = items[0]
    snippet = item.get("snippet", {})
    statistics = item.get("statistics", {})
    views = _safe_int(statistics.get("viewCount"))
    likes = _safe_int(statistics.get("likeCount"))
    comments = _safe_int(statistics.get("commentCount"))

    return {
        "video_id": str(item.get("id", video_id)),
        "title": str(snippet.get("title", "")),
        "published_at": str(snippet.get("publishedAt", "")),
        "statistics": {
            "views": views,
            "likes": likes,
            "comments": comments,
        },
        "performance_score": _performance_score(views=views, likes=likes, comments=comments),
    }


def store_analytics_feedback(
    video_id: str,
    topic: str,
    hook: str,
    title: str,
    hashtags: list[str],
    score_breakdown: dict[str, float],
    history_file: Path,
    token_path: Path,
    scopes: list[str],
) -> dict[str, Any]:
    """
    Pull latest stats for the uploaded video and append a feedback record.
    """
    now = datetime.now(timezone.utc).isoformat()
    stats_payload: dict[str, Any] = {}
    error = ""
    try:
        stats_payload = fetch_video_statistics(video_id=video_id, token_path=token_path, scopes=scopes)
    except Exception as exc:
        error = str(exc)
        stats_payload = {
            "video_id": video_id,
            "title": title,
            "published_at": "",
            "statistics": {"views": 0, "likes": 0, "comments": 0},
            "performance_score": 0.0,
        }

    record = {
        "video_id": video_id,
        "topic": " ".join(topic.split()).strip(),
        "hook": " ".join(hook.split()).strip(),
        "title": " ".join(title.split()).strip(),
        "hashtags": [str(tag).strip() for tag in hashtags if str(tag).strip()],
        "collected_at": now,
        "score_breakdown": score_breakdown or {},
        "statistics": stats_payload.get("statistics", {}),
        "performance_score": float(stats_payload.get("performance_score", 0.0) or 0.0),
        "youtube_title": str(stats_payload.get("title", title)),
        "published_at": str(stats_payload.get("published_at", "")),
    }
    if error:
        record["analytics_error"] = error

    rows = _read_history(history_file)
    rows.append(record)
    _write_history(history_file, rows)
    return record

