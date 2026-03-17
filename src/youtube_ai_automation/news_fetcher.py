"""
Fetches news articles from GNews (gnews.io).
"""

from datetime import datetime, timedelta, timezone
import requests
from youtube_ai_automation.config import GNEWS_API_KEY, NEWS_API_KEY, NEWS_LANGUAGE, NEWS_LOOKBACK_HOURS, NEWS_QUERY


def _parse_published_at(value: str) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except Exception:
        return None


def _within_lookback(value: str, *, now_utc: datetime, hours: int) -> bool:
    dt = _parse_published_at(value)
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt >= now_utc - timedelta(hours=hours)


def _resolve_news_key() -> str:
    return GNEWS_API_KEY or NEWS_API_KEY

def get_top_headlines(
    country: str = "us",
    category: str = "general",
    limit: int = 10,
    query: str | None = None,
    language: str | None = None,
    lookback_hours: int | None = None,
) -> list[dict]:
    """
    Fetches top news headlines from GNews.

    Args:
        country: The 2-letter ISO 3166-1 code of the country you want to get headlines for.
        category: The category you want to get headlines for.
                  Possible options: business, entertainment, general, health, science, sports, technology.
        limit: The number of results to return.

    Returns:
        A list of news articles (dictionaries).
    """
    api_key = _resolve_news_key()
    if not api_key:
        raise ValueError("GNEWS_API_KEY is not set in the environment variables.")

    resolved_language = (language or NEWS_LANGUAGE).strip() or "en"
    hours = lookback_hours or NEWS_LOOKBACK_HOURS
    now_utc = datetime.now(timezone.utc)
    from_dt = now_utc - timedelta(hours=hours)

    params = {
        "category": category,
        "token": api_key,
        "max": limit,
        "lang": resolved_language,
        "from": from_dt.isoformat().replace("+00:00", "Z"),
        "to": now_utc.isoformat().replace("+00:00", "Z"),
    }
    if query:
        params["q"] = query
    if country:
        params["country"] = country

    url = "https://gnews.io/api/v4/top-headlines"

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        return data.get("articles", [])
    except requests.exceptions.RequestException as e:
        print(f"Error fetching news from GNews: {e}")
        return []

def get_everything(
    query: str | None = None,
    language: str | None = None,
    limit: int = 10,
    lookback_hours: int | None = None,
) -> list[dict]:
    """
    Fetches news articles from the GNews search endpoint.

    Args:
        query: The query to search for.
        language: The 2-letter ISO-639-1 code of the language to get headlines in.
        limit: The number of results to return.
        lookback_hours: How many hours back to include (default from config).

    Returns:
        A list of news articles (dictionaries).
    """
    api_key = _resolve_news_key()
    if not api_key:
        raise ValueError("GNEWS_API_KEY is not set in the environment variables.")

    resolved_query = (query or NEWS_QUERY).strip()
    resolved_language = (language or NEWS_LANGUAGE).strip() or "en"
    hours = lookback_hours or NEWS_LOOKBACK_HOURS
    now_utc = datetime.now(timezone.utc)
    from_dt = now_utc - timedelta(hours=hours)

    params = {
        "q": resolved_query,
        "lang": resolved_language,
        "from": from_dt.isoformat().replace("+00:00", "Z"),
        "to": now_utc.isoformat().replace("+00:00", "Z"),
        "sortby": "publishedAt",
        "token": api_key,
        "max": limit,
    }
    url = "https://gnews.io/api/v4/search"

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        return data.get("articles", [])
    except requests.exceptions.RequestException as e:
        print(f"Error fetching news from GNews: {e}")
        return []


def get_latest_news(
    query: str | None = None,
    language: str | None = None,
    limit: int = 10,
    lookback_hours: int | None = None,
) -> list[dict]:
    """
    Fetch latest articles, preferring the `everything` endpoint.
    Falls back to `top-headlines` if no results are returned.
    """
    resolved_query = (query or NEWS_QUERY).strip()
    resolved_language = (language or NEWS_LANGUAGE).strip() or "en"
    hours = lookback_hours or NEWS_LOOKBACK_HOURS

    articles = get_everything(
        query=resolved_query,
        language=resolved_language,
        limit=limit,
        lookback_hours=hours,
    )
    if articles:
        return articles

    # Fallback: top-headlines does not support from/to; filter locally.
    fallback_query = resolved_query
    if " OR " in fallback_query or len(fallback_query) > 40:
        fallback_query = "world"
    headlines = get_top_headlines(
        country="",
        category="general",
        limit=limit,
        query=fallback_query,
        language=resolved_language,
        lookback_hours=hours,
    )
    now_utc = datetime.now(timezone.utc)
    filtered = [
        item
        for item in headlines
        if _within_lookback(str(item.get("publishedAt", "")), now_utc=now_utc, hours=hours)
    ]
    return filtered

if __name__ == "__main__":
    # Example usage
    try:
        articles = get_everything(query="world news", limit=5)
        if articles:
            print("Top World News:")
            for article in articles:
                print(f"- {article['title']}")
    except ValueError as e:
        print(e)

