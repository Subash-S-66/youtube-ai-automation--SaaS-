"""
Generate structured short-form content for YouTube Shorts.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import math
import os
import random
import re
import time
from textwrap import dedent
from typing import Any

import requests

LOGGER = logging.getLogger(__name__)
GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite"
GEMINI_FALLBACK_MODELS_DEFAULT = (
    "gemini-3.1-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
    "gemini-1.0-pro",
)
GEMINI_RETRY_STATUS_CODES = {429, 503}
GEMINI_MAX_RETRIES_PER_MODEL = 2
GEMINI_RETRY_DELAYS_SECONDS = (2, 5, 10)
GEMINI_REQUEST_TIMEOUT_SECONDS = 35
GEMINI_MODEL_LIST_TIMEOUT_SECONDS = 8
GEMINI_MODEL_LIST_CACHE_SECONDS = 120
_GEMINI_AVAILABLE_MODELS_CACHE: dict[str, Any] = {"fetched_at": 0.0, "models": None}

BASE_WPS = 2.4
# Voice rate rotates between +5% and +15%, so plan word counts for that faster delivery window.
SPEECH_RATE_MIN = 1.05
SPEECH_RATE_MAX = 1.15


@dataclass
class GeneratedContent:
    topic: str
    title: str
    hook: str
    description: str
    hashtags: list[str]
    script: str
    scenes: list[str]
    search_queries: list[str]

    def upload_description(self) -> str:
        tag_line = " ".join(self.hashtags)
        return f"{self.description}\n\n{tag_line}".strip()

    def tags(self) -> list[str]:
        cleaned = [tag.replace("#", "").strip() for tag in self.hashtags]
        return [tag for tag in cleaned if tag][:15]


def _clean_text(value: str) -> str:
    return " ".join(str(value).split()).strip()


def _word_bounds(min_seconds: int, max_seconds: int) -> tuple[int, int]:
    min_words = math.floor(min_seconds * BASE_WPS * SPEECH_RATE_MIN)
    max_words = math.ceil(max_seconds * BASE_WPS * SPEECH_RATE_MAX)
    return max(20, min_words), max(min_words + 10, max_words)


def _split_script_lines(script: str) -> list[str]:
    return [line.strip() for line in str(script).splitlines() if line.strip()]


def _limit_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(".,;:!?")


def _enforce_script_length(lines: list[str], min_words: int, max_words: int) -> list[str]:
    words = [word for line in lines for word in line.split()]
    if len(words) <= max_words:
        return lines

    # Trim from the end to fit the max word count.
    remaining = max_words
    trimmed: list[str] = []
    for line in lines:
        line_words = line.split()
        if remaining <= 0:
            break
        if len(line_words) <= remaining:
            trimmed.append(line)
            remaining -= len(line_words)
        else:
            trimmed.append(" ".join(line_words[:remaining]).rstrip(".,;:!?"))
            remaining = 0
    return trimmed


def _clean_hashtags(raw: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in raw:
        value = _clean_text(tag)
        if not value:
            continue
        if not value.startswith("#"):
            value = f"#{value}"
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    return cleaned[:15]


def _extract_json_payload(text: str) -> Any:
    candidate = str(text).strip()
    if candidate.startswith("```"):
        lines = [line for line in candidate.splitlines() if not line.strip().startswith("```")]
        candidate = "\n".join(lines).strip()
    decoder = json.JSONDecoder()
    for idx, char in enumerate(candidate):
        if char not in "[{":
            continue
        try:
            parsed, _ = decoder.raw_decode(candidate[idx:])
            return parsed
        except json.JSONDecodeError:
            continue
    raise ValueError("No valid JSON payload found.")


def _validate_content_quality(payload: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    topic = _clean_text(payload.get("topic", ""))
    if not topic:
        warnings.append("Missing topic.")
    script = _clean_text(payload.get("script", ""))
    if not script:
        warnings.append("Missing script.")
    return warnings


def _sanitize_output(payload: dict[str, Any], min_seconds: int, max_seconds: int, gemini_api_key: str = "") -> GeneratedContent:
    min_words, max_words = _word_bounds(min_seconds, max_seconds)

    topic = _clean_text(str(payload.get("topic", "")))
    if not topic:
        raise ValueError("Topic is missing or empty.")

    title = _clean_text(str(payload.get("title", "")))
    if not title:
        raise ValueError("Title is missing or empty.")

    description = _clean_text(str(payload.get("description", "")))
    if not description:
        raise ValueError("Description is missing or empty.")

    raw_script = str(payload.get("script", ""))
    lines = _split_script_lines(raw_script)
    if len(lines) != 5:
        raise ValueError("Script must contain exactly 5 non-empty lines for structured Shorts output.")
    lines = [_clean_text(line) for line in lines if _clean_text(line)]
    if len(lines) != 5:
        raise ValueError("Script must contain 5 non-empty lines for structured Shorts output.")

    # Dynamic CTA Generation via Jules or Gemini
    cta_prompt = f"Generate a short, punchy call-to-action (CTA) for a YouTube Short about this topic: '{topic}'. Do not include quotation marks or extra text, just the CTA sentence."

    # Try Jules first
    cta = None
    jules_url = os.getenv("JULES_API_URL")
    jules_key = os.getenv("JULES_API_KEY")
    if jules_url and jules_key:
        cta = _call_jules(cta_prompt, jules_url, jules_key)

    # Fallback to Gemini
    if not cta:
        if gemini_api_key:
            try:
                cta = _call_model(cta_prompt, "gemini", gemini_api_key, GEMINI_FALLBACK_MODEL, "", "", "", "")
            except Exception as e:
                LOGGER.warning(f"Failed to generate dynamic CTA via Gemini: {e}")

    # Ultimate Fallback
    if not cta:
        cta = "Subscribe for more content like this!"

    cta = cta.strip().strip('"').strip("'")

    # Merge line 4 + line 5 content so CTA can stand alone.
    merged = " ".join([lines[3].strip(), lines[4].strip()]).strip()
    lines[3] = merged
    lines[4] = cta

    lines = _enforce_script_length(lines, min_words=min_words, max_words=max_words)
    script = "\n".join(lines)

    raw_hashtags = payload.get("hashtags")
    if not isinstance(raw_hashtags, list):
        raise ValueError("Hashtags must be a list of strings.")
    hashtags = _clean_hashtags([str(item) for item in raw_hashtags])
    if not hashtags:
        raise ValueError("Hashtags list cannot be empty.")

    raw_scenes = payload.get("scenes")
    if not isinstance(raw_scenes, list):
        raise ValueError("Scenes must be a list of 5 strings.")
    scenes = [_clean_text(str(item)) for item in raw_scenes if _clean_text(str(item))]
    if len(scenes) != 5:
        raise ValueError("Scenes must contain exactly 5 non-empty items.")

    raw_queries = payload.get("search_queries")
    if not isinstance(raw_queries, list):
        raise ValueError("Search queries must be a list of 5 strings.")
    search_queries = [_clean_text(str(item)) for item in raw_queries if _clean_text(str(item))]
    if len(search_queries) != 5:
        raise ValueError("Search queries must contain exactly 5 non-empty items.")

    return GeneratedContent(
        topic=topic,
        title=title,
        hook=lines[0],
        description=description,
        hashtags=hashtags,
        script=script,
        scenes=scenes,
        search_queries=search_queries,
    )


def _call_openai(prompt: str, api_key: str, model: str) -> str:
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"model": model, "input": prompt},
        timeout=75,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("output_text"):
        return str(payload["output_text"]).strip()
    parts: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            text = content.get("text")
            if text:
                parts.append(str(text))
    result = "\n".join(parts).strip()
    if not result:
        raise ValueError("OpenAI response did not contain text output.")
    return result


def _normalize_gemini_model_name(model: str) -> str:
    model_name = " ".join(str(model).split()).strip()
    if model_name.startswith("models/"):
        model_name = model_name[len("models/") :]
    return model_name


def _gemini_model_candidates(primary_model: str) -> list[str]:
    primary = _normalize_gemini_model_name(primary_model) or GEMINI_FALLBACK_MODEL
    env_fallbacks_raw = os.getenv("GEMINI_FALLBACK_MODELS", "")
    env_fallbacks = [
        _normalize_gemini_model_name(item)
        for item in env_fallbacks_raw.split(",")
        if _normalize_gemini_model_name(item)
    ]
    out: list[str] = [
        primary,
        GEMINI_FALLBACK_MODEL,
        *env_fallbacks,
        *GEMINI_FALLBACK_MODELS_DEFAULT,
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for item in out:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _fetch_available_gemini_models(api_key: str) -> set[str] | None:
    now = time.time()
    cached_at = float(_GEMINI_AVAILABLE_MODELS_CACHE.get("fetched_at", 0.0))
    cached_models = _GEMINI_AVAILABLE_MODELS_CACHE.get("models")
    if cached_models and now - cached_at < GEMINI_MODEL_LIST_CACHE_SECONDS:
        return cached_models if isinstance(cached_models, set) else None

    try:
        response = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
            timeout=GEMINI_MODEL_LIST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        models = set()
        for item in payload.get("models", []):
            name = _normalize_gemini_model_name(item.get("name", ""))
            if name:
                models.add(name)
        if models:
            _GEMINI_AVAILABLE_MODELS_CACHE["fetched_at"] = now
            _GEMINI_AVAILABLE_MODELS_CACHE["models"] = models
            return models
    except Exception as exc:
        LOGGER.warning("Failed to fetch Gemini models list: %s", str(exc)[:120])

    _GEMINI_AVAILABLE_MODELS_CACHE["fetched_at"] = now
    _GEMINI_AVAILABLE_MODELS_CACHE["models"] = None
    return None


def _call_gemini(prompt: str, api_key: str, model: str) -> str:
    errors: list[str] = []
    model_candidates = _gemini_model_candidates(model)
    available_models = _fetch_available_gemini_models(api_key)
    if available_models:
        primary = model_candidates[0] if model_candidates else ""
        filtered = [item for item in model_candidates[1:] if item in available_models]
        if primary:
            if primary not in available_models:
                LOGGER.warning(
                    "Primary Gemini model '%s' not in models list; will still try it first.",
                    primary,
                )
            model_candidates = [primary, *filtered]
        elif filtered:
            model_candidates = filtered
        else:
            LOGGER.warning(
                "No Gemini model candidates matched the models API list. Falling back to configured list."
            )

    for index, model_name in enumerate(model_candidates):
        for attempt in range(1, GEMINI_MAX_RETRIES_PER_MODEL + 1):
            try:
                response = requests.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                    params={"key": api_key},
                    headers={"Content-Type": "application/json"},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                    timeout=GEMINI_REQUEST_TIMEOUT_SECONDS,
                )
                response.raise_for_status()
                payload = response.json()
                parts: list[str] = []
                for candidate in payload.get("candidates", []):
                    content = candidate.get("content", {})
                    for part in content.get("parts", []):
                        text = part.get("text")
                        if text:
                            parts.append(str(text))
                result = "\n".join(parts).strip()
                if result:
                    if index > 0:
                        LOGGER.info("Gemini fallback model in use: %s", model_name)
                    return result
                errors.append(f"{model_name}: empty response")
                break
            except requests.exceptions.HTTPError as exc:
                status_code = exc.response.status_code
                response_text = (exc.response.text or "")[:160]
                if status_code in GEMINI_RETRY_STATUS_CODES and attempt < GEMINI_MAX_RETRIES_PER_MODEL:
                    delay = GEMINI_RETRY_DELAYS_SECONDS[min(attempt - 1, len(GEMINI_RETRY_DELAYS_SECONDS) - 1)]
                    LOGGER.warning(
                        "Gemini %s HTTP %s on attempt %s/%s. Retrying in %ss.",
                        model_name,
                        status_code,
                        attempt,
                        GEMINI_MAX_RETRIES_PER_MODEL,
                        delay,
                    )
                    time.sleep(delay)
                    continue
                if status_code == 404:
                    LOGGER.warning("Gemini model not found: %s", model_name)
                    error_str = f"Model not found ({model_name})"
                elif status_code == 400:
                    error_str = f"Bad request ({model_name}): {response_text}"
                elif status_code == 429:
                    error_str = "Quota exceeded / Rate limited"
                elif status_code == 503:
                    error_str = "Service unavailable"
                else:
                    error_str = f"HTTP {status_code}: {response_text or str(exc)[:80]}"
                errors.append(f"{model_name}: {error_str}")
                break
            except Exception as exc:
                errors.append(f"{model_name}: {str(exc)[:100]}")
                break

    raise RuntimeError("Gemini request failed for all models: " + " | ".join(errors))


def _call_anthropic(prompt: str, api_key: str, model: str) -> str:
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 1600,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=75,
    )
    response.raise_for_status()
    payload = response.json()
    parts = [
        str(block.get("text", "")).strip()
        for block in payload.get("content", [])
        if block.get("type") == "text"
    ]
    result = "\n".join(part for part in parts if part).strip()
    if not result:
        raise ValueError("Anthropic response did not contain text output.")
    return result


def _call_jules(prompt: str, api_url: str, api_key: str) -> str | None:
    try:
        LOGGER.info("Calling Jules API for content generation...")
        response = requests.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"prompt": prompt},
            timeout=75,
        )
        response.raise_for_status()
        payload = response.json()
        result = payload.get("output_text") or payload.get("response") or payload.get("text")
        if result:
            return str(result).strip()
    except Exception as exc:
        LOGGER.warning(f"Jules API failed: {exc}")
    return None

def _call_model(
    prompt: str,
    provider: str,
    gemini_api_key: str,
    gemini_model: str,
    openai_api_key: str,
    openai_model: str,
    anthropic_api_key: str,
    anthropic_model: str,
) -> str:
    # Try Jules API First
    jules_url = os.getenv("JULES_API_URL")
    jules_key = os.getenv("JULES_API_KEY")
    if jules_url and jules_key:
        jules_result = _call_jules(prompt, jules_url, jules_key)
        if jules_result:
            return jules_result

    normalized = provider.strip().lower()
    if normalized in {"gemini", "google"}:
        if not gemini_api_key:
            raise ValueError("GEMINI_API_KEY is missing.")
        return _call_gemini(prompt, gemini_api_key, gemini_model)
    if normalized == "openai":
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is missing.")
        return _call_openai(prompt, openai_api_key, openai_model)
    if normalized in {"anthropic", "claude"}:
        if not anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is missing.")
        return _call_anthropic(prompt, anthropic_api_key, anthropic_model)
    raise ValueError(f"Unsupported provider: {provider}")


def generate_content(
    topic: str,
    provider: str = "gemini",
    gemini_api_key: str = "",
    gemini_model: str = "gemini-3.1-flash-lite",
    openai_api_key: str = "",
    openai_model: str = "gpt-4.1-mini",
    anthropic_api_key: str = "",
    anthropic_model: str = "claude-3.5-sonnet",
    min_seconds: int = 25,
    max_seconds: int = 40,
    content_type: str = "tech",
    story_mode: bool = False,
    current_part: int = 1,
) -> GeneratedContent:
    """
    Generate content for a single short video.
    """
    topic = _clean_text(topic)
    if not topic:
        raise ValueError("Topic is required for content generation.")
    normalized_provider = provider.strip().lower()
    if normalized_provider in {"", "none", "template"}:
        raise ValueError("AI provider is required; template/default content is disabled.")

    min_words, max_words = _word_bounds(min_seconds, max_seconds)

    story_instruction = ""
    if story_mode:
        if current_part > 1:
            story_instruction = f"\nThis is PART {current_part} of an ongoing story. Summarize the previous events briefly, then continue the story from where it left off."
        else:
            story_instruction = "\nThis is PART 1 of a new multi-part story series. Introduce the story and characters, but leave a cliffhanger at the end."

    prompt = dedent(
        f"""
        You are a news reporter creating a YouTube Short (vertical video, under 60 seconds) about a breaking news story.
        Your audience is the general public.
        Tone: neutral, informative, and factual.
        Use simple, clear language.

        NEWS HEADLINE: {topic}
        {story_instruction}

        --------------------------------
        ABSOLUTE RULES - FACTUAL ACCURACY
        --------------------------------
        1.  Stick to the facts of the news headline. Do not add opinions or speculation.
        2.  The script should be a concise summary of the news story.
        3.  Every claim must be verifiable.

        --------------------------------
        SCRIPT STRUCTURE (exactly 5 newline-separated lines)
        --------------------------------
        Write 5 clean narration lines with no labels or headings.
        The lines should flow naturally as a short news report.
        - Line 1: The headline and most important information (the hook).
        - Line 2: Additional context or background.
        - Line 3: Key details or developments.
        - Line 4: The impact or significance of the news.
        - Line 5: A concluding statement or a look at what might happen next.

        Total script word count: between {min_words} and {max_words} words.

        --------------------------------
        SCENE DESCRIPTIONS (for stock video search)
        --------------------------------
        Generate exactly 5 scenes, one per script line. Each scene is a short visual description
        that will be used to search for stock footage. Make them specific and visual, and relevant to the news story.

        GOOD scene examples:
            "politician speaking at a podium"
            "rescue workers at a natural disaster site"
            "protestors marching in a street"
            "stock market data on a screen"

        BAD scene examples (too vague):
            "news" / "world" / "important event"

        --------------------------------
        OUTPUT FORMAT - strict JSON, no markdown, no commentary
        --------------------------------
        {{
          "topic": "<the news headline>",
          "title": "<under 60 chars, informative, based on the headline>",
          "hook": "<same as script line 1>",
          "description": "<2-3 SEO sentences summarizing the news story>",
          "hashtags": ["#shorts", "#news", "#breakingnews", ... 10-15 total],
          "script": "<all 5 lines separated by newlines>",
          "scenes": ["<scene 1>", "<scene 2>", "<scene 3>", "<scene 4>", "<scene 5>"],
          "search_queries": ["<query 1>", "<query 2>", "<query 3>", "<query 4>", "<query 5>"]
        }}
        """
    ).strip()

    try:
        raw = _call_model(
            prompt=prompt,
            provider=normalized_provider,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model,
            openai_api_key=openai_api_key,
            openai_model=openai_model,
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
        )
        payload = _extract_json_payload(raw)
        if not isinstance(payload, dict):
            raise ValueError("Model output was not a JSON object.")

        # Content quality validation
        quality_warnings = _validate_content_quality(payload)
        if quality_warnings:
            for warning in quality_warnings:
                LOGGER.warning("Content quality issue: %s", warning)

        return _sanitize_output(payload, min_seconds=min_seconds, max_seconds=max_seconds, gemini_api_key=gemini_api_key)
    except Exception as exc:
        if normalized_provider in {"gemini", "google"}:
            raise RuntimeError(f"Gemini content generation failed: {exc}") from exc
        raise RuntimeError(f"AI content generation failed: {exc}") from exc

