"""
Generate and optimize Shorts ideas with strong hooks before video creation.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import math
import os
from pathlib import Path
import re
import time
from textwrap import dedent
from typing import Any

import requests

from youtube_ai_automation.config import GEMINI_TOPIC_MEMORY_FILE

LOGGER = logging.getLogger(__name__)
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "").strip()
GEMINI_FALLBACK_MODELS_DEFAULT: tuple[str, ...] = ()
GEMINI_RETRY_STATUS_CODES = {429, 503}
GEMINI_MAX_RETRIES_PER_MODEL = 2
GEMINI_RETRY_DELAYS_SECONDS = (2, 5, 10)
GEMINI_REQUEST_TIMEOUT_SECONDS = 35
GEMINI_MODEL_LIST_TIMEOUT_SECONDS = 12
GEMINI_MODEL_LIST_CACHE_SECONDS = 300

_GEMINI_AVAILABLE_MODELS_CACHE: dict[str, object] = {
    "fetched_at": 0.0,
    "models": None,
}


BASE_WPS = 2.45
# Voice rate rotates between +5% and +15%, so size scripts for that delivery speed.
SPEECH_RATE_MIN = 1.05
SPEECH_RATE_MAX = 1.15

BLOCKED_TOPIC_KEYWORDS = {
    "porn",
    "pornstar",
    "nsfw",
    "onlyfans",
    "sex",
    "sexual",
    "nude",
    "violence",
    "gore",
    "suicide",
    "murder",
    "politics",
    "election",
}

TREND_PRIORITY_KEYWORDS = [
    "ai",
    "openai",
    "apple",
    "google",
    "spacex",
    "nasa",
    "tesla",
    "startup",
    "cybersecurity",
    "smartphone",
    "quantum computing",
    "robotics",
    "biotech",
    "blockchain",
    "gaming",
    "electric vehicle",
    "neuralink",
    "james webb",
    "crispr",
    "fusion energy",
    "3d printing",
    "drone",
    "vr",
    "ar",
]

GENERIC_TOPIC_PATTERNS = [
    r"\bai productivity tips\b",
    r"^\s*(ai|technology|tech|software)\s+productivity\s+tools?\s*$",
    r"^\s*productivity\s+tools?\s+for\s+(ai|tech|technology|software)\s*$",
    r"\b(tech|technology|ai|software)\s+(tips|facts|basics|guide)\b",
    r"\b(top|best)\s+\d+\s+(apps|tools)\b",
    r"\bintro(duction)?\s+to\b",
]

WEAK_HOOK_PATTERNS = [
    r"^here (are|is)\b",
    r"^in this video\b",
    r"^today we\b",
    r"facts about\b",
]



@dataclass
class IdeaCandidate:
    topic: str
    hooks: list[str]
    script_outline: list[str]


def _unique_clean_lines(items: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        cleaned = _clean_text(str(item))
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= limit:
            break
    return out


def _filter_prompt_rules(items: list[str], limit: int = 20) -> list[str]:
    filtered: list[str] = []
    for item in _unique_clean_lines(items, limit=limit * 2):
        low = item.lower()
        if "common mistake" in low:
            continue
        if low.startswith("explain ") and "mistake" in low:
            continue
        filtered.append(item)
        if len(filtered) >= limit:
            break
    return filtered


def load_topic_generation_memory(path: Path = GEMINI_TOPIC_MEMORY_FILE) -> dict[str, list[str]]:
    if not path.exists():
        return {"keywords": [], "topic_directions": [], "prompt_rules": [], "search_queries": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"keywords": [], "topic_directions": [], "prompt_rules": [], "search_queries": []}
    return {
        "keywords": _unique_clean_lines(payload.get("keywords", []), limit=30),
        "topic_directions": _unique_clean_lines(payload.get("topic_directions", []), limit=30),
        "prompt_rules": _filter_prompt_rules(payload.get("prompt_rules", []), limit=20),
        "search_queries": _unique_clean_lines(payload.get("search_queries", []), limit=20),
    }


def _write_topic_generation_memory(memory: dict[str, list[str]], path: Path = GEMINI_TOPIC_MEMORY_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "keywords": _unique_clean_lines(memory.get("keywords", []), limit=30),
        "topic_directions": _unique_clean_lines(memory.get("topic_directions", []), limit=30),
        "prompt_rules": _filter_prompt_rules(memory.get("prompt_rules", []), limit=20),
        "search_queries": _unique_clean_lines(memory.get("search_queries", []), limit=20),
    }
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def refresh_topic_generation_memory(
    trending_topics: list[str],
    excluded_topics: list[str],
    selected_topic: str,
    provider: str,
    gemini_api_key: str,
    gemini_model: str,
    openai_api_key: str,
    openai_model: str,
    anthropic_api_key: str,
    anthropic_model: str,
    path: Path = GEMINI_TOPIC_MEMORY_FILE,
) -> dict[str, list[str]]:
    memory = load_topic_generation_memory(path)
    normalized_provider = provider.strip().lower()
    if normalized_provider in {"", "none", "template"}:
        return memory

    seed_text = "\n".join(f"- {item}" for item in trending_topics[:20])
    excluded_text = "\n".join(f"- {item}" for item in excluded_topics[:80])
    prompt = dedent(
        f"""
        You are maintaining idea-generation memory for a YouTube Shorts automation system.

        Based on these current trend signals:
        {seed_text or "- none"}

        And these previously used/excluded topics:
        {excluded_text or "- none"}

        Return strict JSON only with this shape:
        {{
          "keywords": ["...", "..."],
          "topic_directions": ["...", "..."],
          "prompt_rules": ["...", "..."],
          "search_queries": ["...", "..."]
        }}

        Requirements:
        - keywords: 10-15 short high-signal keyword phrases for future topic generation
        - topic_directions: 10-15 fresh topic angles that are DIFFERENT from excluded topics
        - prompt_rules: 6-10 short instructions that push future generations toward novelty and diversity
        - search_queries: 6-10 short search seeds to discover different upcoming topics next run
        - Prefer underused areas such as space, robotics, biotech, materials, energy, cybersecurity, browsers, mobile OS, science, and developer infrastructure
        - Avoid repeating the same company, product family, feature, or subtopic from excluded topics
        - If a selected topic is provided below, use it to propose follow-up keywords and adjacent but different topic directions for the next cycle
        - Selected topic for next-cycle expansion: {selected_topic or "none"}
        - No markdown, no commentary
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
            return memory
        refreshed = {
            "keywords": _unique_clean_lines(list(payload.get("keywords", [])), limit=30),
            "topic_directions": _unique_clean_lines(list(payload.get("topic_directions", [])), limit=30),
            "prompt_rules": _filter_prompt_rules(list(payload.get("prompt_rules", [])), limit=20),
            "search_queries": _unique_clean_lines(list(payload.get("search_queries", [])), limit=20),
        }
        _write_topic_generation_memory(refreshed, path)
        return refreshed
    except Exception as exc:
        LOGGER.warning("Topic generation memory refresh failed: %s", exc)
        return memory


@dataclass
class OptimizedIdea:
    topic: str
    best_hook: str
    hook_options: list[str]
    script_outline: list[str]
    script: str
    title: str
    description: str
    hashtags: list[str]
    scenes: list[str]
    search_queries: list[str]
    viral_score: float = 0.0
    score_breakdown: dict[str, float] | None = None

    def upload_description(self) -> str:
        return f"{self.description}\n\n{' '.join(self.hashtags)}".strip()

    def tags(self) -> list[str]:
        tags = [item.replace("#", "").strip() for item in self.hashtags]
        clean = [item for item in tags if item]
        return clean[:15]


def _clean_text(text: str) -> str:
    return " ".join(str(text).split()).strip()


def _extract_json_payload(text: str) -> Any:
    candidate = text.strip()
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
    primary = _normalize_gemini_model_name(primary_model) or "gemini-3-flash"
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


from .gemini_utils import execute_with_gemini_fallback

def _call_gemini_single_key(prompt: str, api_key: str, model: str) -> str:
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
            except requests.exceptions.HTTPError as hexc:
                status_code = hexc.response.status_code
                response_text = (hexc.response.text or "")[:160]
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
                    raise hexc # Bubble up to trigger fallback switch
                elif status_code == 503:
                    error_str = "Service unavailable"
                    raise hexc # Bubble up to trigger fallback switch
                else:
                    error_str = f"HTTP {status_code}: {response_text or str(hexc)[:80]}"
                errors.append(f"{model_name}: {error_str}")
                break
            except Exception as exc:
                errors.append(f"{model_name}: {str(exc)[:100]}")
                break

    raise RuntimeError("Gemini request failed for all models: " + " | ".join(errors))

def _call_gemini(prompt: str, api_key: str, model: str) -> str:
    def operation(key: str) -> str:
        return _call_gemini_single_key(prompt, key, model)
    return execute_with_gemini_fallback(operation)


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


def _normalize_topic(topic: str) -> str:
    topic = _clean_text(topic)
    topic = re.sub(r"[\[\]\(\)\{\}\"`]+", "", topic)
    return topic[:100].strip(" -_:,")


def _topic_family(topic: str) -> str:
    low = topic.lower()
    if any(token in low for token in ("ai", "artificial", "chatgpt", "copilot", "llm", "model")):
        return "ai"
    if any(token in low for token in ("space", "nasa", "webb", "mars", "rocket", "spacex")):
        return "space"
    if any(token in low for token in ("robot", "boston dynamics", "automation")):
        return "robotics"
    if any(token in low for token in ("crispr", "gene", "biotech", "dna", "medical")):
        return "biotech"
    if any(token in low for token in ("cyber", "security", "hack", "privacy")):
        return "cybersecurity"
    if any(token in low for token in ("tesla", "electric", "ev ", "battery", "self-driving")):
        return "ev"
    if any(token in low for token in ("fusion", "energy", "solar", "nuclear")):
        return "energy"
    if any(token in low for token in ("iphone", "android", "apple", "browser", "google chrome")):
        return "consumer"
    if any(token in low for token in ("productiv", "tool", "workflow", "software")):
        return "software"
    return "other"


def _is_generic_topic(topic: str) -> bool:
    low = topic.lower()
    return any(re.search(pattern, low) for pattern in GENERIC_TOPIC_PATTERNS)


def _upgrade_topic(topic: str) -> str:
    return _normalize_topic(topic)


def _is_allowed_topic(topic: str) -> bool:
    low = topic.lower()
    if any(keyword in low for keyword in BLOCKED_TOPIC_KEYWORDS):
        return False
    if _is_generic_topic(topic):
        return False
    return True


def _is_weak_hook(hook: str) -> bool:
    low = _clean_text(hook).lower()
    if len(low.split()) < 5:
        return True
    return any(re.search(pattern, low) for pattern in WEAK_HOOK_PATTERNS)


def _sanitize_idea_payload(payload: Any, count: int, hook_count: int) -> list[IdeaCandidate]:
    if not isinstance(payload, list):
        raise ValueError("Idea payload must be a JSON array.")
    ideas: list[IdeaCandidate] = []
    seen: set[str] = set()
    family_counts: dict[str, int] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        topic = _upgrade_topic(str(item.get("topic", "")))
        if not topic:
            continue
        if not _is_allowed_topic(topic):
            continue
        key = topic.lower()
        if key in seen:
            continue
        family = _topic_family(topic)
        family_limit = 1 if family in {"ai", "software"} else 2
        if family_counts.get(family, 0) >= family_limit:
            continue
        seen.add(key)

        raw_hooks = item.get("hooks", [])
        hooks = []
        if isinstance(raw_hooks, list):
            hooks = [_clean_text(hook) for hook in raw_hooks if _clean_text(hook)]
        if not hooks:
            single_hook = _clean_text(str(item.get("hook", "")))
            if single_hook:
                hooks = [single_hook]
        if len(hooks) < hook_count:
            raise ValueError(f"Idea hooks missing or insufficient for topic: {topic}")
        cleaned_hooks: list[str] = []
        seen_hooks: set[str] = set()
        for hook in hooks:
            if _is_weak_hook(hook):
                continue
            words = hook.split()
            if len(words) > 14:
                hook = " ".join(words[:14]).rstrip(".,;:!?") + "."
            normalized_hook = _clean_text(hook)
            key = normalized_hook.lower()
            if key in seen_hooks:
                continue
            seen_hooks.add(key)
            cleaned_hooks.append(normalized_hook)
        if len(cleaned_hooks) < hook_count:
            raise ValueError(f"Filtered hooks insufficient for topic: {topic}")
        hooks = cleaned_hooks[:hook_count]

        raw_outline = item.get("script_outline", [])
        outline = []
        if isinstance(raw_outline, list):
            outline = [_clean_text(row) for row in raw_outline if _clean_text(row)]
        if len(outline) < 3:
            raise ValueError(f"Script outline missing or insufficient for topic: {topic}")

        ideas.append(IdeaCandidate(topic=topic, hooks=hooks, script_outline=outline[:3]))
        family_counts[family] = family_counts.get(family, 0) + 1
        if len(ideas) >= count:
            break
    return ideas


def generate_idea_candidates(
    trending_topics: list[str],
    niche: str,
    count: int,
    hook_count: int,
    provider: str = "gemini",
    gemini_api_key: str = "",
    gemini_model: str = "gemini-3-flash",
    openai_api_key: str = "",
    openai_model: str = "gpt-4.1-mini",
    anthropic_api_key: str = "",
    anthropic_model: str = "claude-3-5-haiku-latest",
    prompt_mode: str = "default",
    excluded_topics: list[str] | None = None,
    memory: dict[str, list[str]] | None = None,
) -> list[IdeaCandidate]:
    """
    Generate multiple topic ideas, 3 hooks per topic, and a script outline.
    """
    normalized_provider = provider.strip().lower()
    if normalized_provider in {"", "none", "template"}:
        raise ValueError("AI provider required; local fallback disabled.")

    seed_text = "\n".join(f"- {item}" for item in trending_topics[:15])
    trend_keyword_text = ", ".join(TREND_PRIORITY_KEYWORDS)
    excluded_text = "\n".join(f"- {item}" for item in (excluded_topics or [])[:60])
    memory = memory or {"keywords": [], "topic_directions": [], "prompt_rules": []}
    learned_keywords = ", ".join(memory.get("keywords", [])[:20]) or "none"
    learned_directions = "\n".join(f"- {item}" for item in memory.get("topic_directions", [])[:20]) or "- none"
    learned_rules = "\n".join(f"- {item}" for item in memory.get("prompt_rules", [])[:12]) or "- none"
    learned_search_queries = "\n".join(f"- {item}" for item in memory.get("search_queries", [])[:12]) or "- none"
    if prompt_mode == "novelty":
        prompt = dedent(
            f"""
            Create exactly {count} YouTube Shorts ideas for this niche: {niche}.
            Use these trend signals when relevant:
            {seed_text}
            Prioritize these trend keywords when relevant:
            {trend_keyword_text}
            Learned novelty keywords:
            {learned_keywords}
            Learned topic directions:
            {learned_directions}
            Learned prompt rules:
            {learned_rules}
            Learned search queries:
            {learned_search_queries}

            Return strict JSON array only.
            Every item must have:
            - topic: string (must include the REAL name of a specific technology, tool, or product)
            - hooks: array of exactly {hook_count} hooks
            - script_outline: array of exactly 3 concise bullet points

            NOVELTY RULE (critical):
            - Every generated topic MUST be substantially different from the excluded list below.
            - Avoid the same company, same product family, same feature, and same scientific subtopic.
            - If excluded topics include AI tools, do not return another AI tool topic unless it is about a clearly different real product and use case.
            - Prefer underused areas like space, robotics, biotech, materials, physics, EVs, manufacturing, climate tech, cybersecurity, browsers, mobile OS features, and developer tools.

            Excluded topics:
            {excluded_text or "- none"}

            FACTUAL ACCURACY RULES:
            - Every topic MUST reference a real, verifiable technology by its exact name
            - No hallucinated products, fake features, or made-up capabilities
            - Each bullet point must contain verifiable, factual information

            Rules:
            - Topic must be curiosity-driven, specific, and tech-focused
            - Reject generic topics like "AI productivity tips"
            - Topics should target specific discoveries, named technologies, hidden features, or science breakthroughs
            - Hooks must hit in first 2 seconds and feel punchy while being truthful
            - Avoid weak hooks like "Here are some facts..."
            - Do not use repetitive framing like "Explain the common mistake people make with ..."
            - Outline must map to 20-40 seconds short
            - No markdown, no extra keys, no commentary
            """
        ).strip()
    else:
        prompt = dedent(
            f"""
            Create exactly {count} YouTube Shorts ideas for this niche: {niche}.
            Use these trend signals when relevant:
            {seed_text}
            Prioritize these trend keywords when relevant:
            {trend_keyword_text}
            Learned novelty keywords:
            {learned_keywords}
            Learned topic directions:
            {learned_directions}
            Learned prompt rules:
            {learned_rules}
            Learned search queries:
            {learned_search_queries}

            Return strict JSON array only.
            Every item must have:
            - topic: string (must include the REAL name of a specific technology, tool, or product)
            - hooks: array of exactly {hook_count} hooks
            - script_outline: array of exactly 3 concise bullet points

            TOPIC DIVERSITY RULE (critical):
            - Each idea MUST cover a DIFFERENT area of science and technology.
            - Spread across: space/astronomy, robotics, biotech/health, energy, physics,
              consumer electronics, cybersecurity, automotive/EV, gaming, AI, environment, ocean/earth science.
            - NEVER generate more than 1 idea about the same company or same sub-field.
            - Bad: 3 ideas about OpenAI + 2 about Google AI (too repetitive)
            - Good: 1 about SpaceX, 1 about CRISPR, 1 about quantum computing, 1 about Tesla FSD, 1 about deep ocean discovery

            FACTUAL ACCURACY RULES:
            - Every topic MUST reference a real, verifiable technology by its exact name
            - Good: "James Webb Telescope detects high-carbon atmosphere on exoplanet" / "Tesla FSD v12 neural network rewrite"
            - Bad: "An AI tool that writes code" / "A new tech feature"
            - No hallucinated products, fake features, or made-up capabilities
            - Each bullet point must contain verifiable, factual information

            Rules:
            - Topic must be curiosity-driven, specific, and tech-focused
            - Reject generic topics like "AI productivity tips"
            - Topics should target specific discoveries, named technologies, hidden features, or science breakthroughs
            - Avoid matching the excluded topics below too closely:
            {excluded_text or "- none"}
            - Hooks must hit in first 2 seconds and feel punchy while being truthful
            - Avoid weak hooks like "Here are some facts..."
            - Do not use repetitive framing like "Explain the common mistake people make with ..."
            - Outline must map to 20-40 seconds short
            - No markdown, no extra keys, no commentary
            """
        ).strip()

    try:
        attempts = max(1, int(os.getenv("AI_IDEA_TOPUP_ATTEMPTS", "3")))
        collected: list[IdeaCandidate] = []
        for attempt in range(1, attempts + 1):
            remaining = count - len(collected)
            if remaining <= 0:
                break

            extra_note = ""
            if collected:
                used_topics = "\n".join(f"- {item.topic}" for item in collected[:40])
                extra_note = dedent(
                    f"""
                    Already accepted topics (do not repeat or paraphrase):
                    {used_topics}

                    Return only {remaining} new ideas to complete the set.
                    """
                ).strip()

            raw = _call_model(
                prompt=f"{prompt}\n\n{extra_note}".strip(),
                provider=normalized_provider,
                gemini_api_key=gemini_api_key,
                gemini_model=gemini_model,
                openai_api_key=openai_api_key,
                openai_model=openai_model,
                anthropic_api_key=anthropic_api_key,
                anthropic_model=anthropic_model,
            )
            payload = _extract_json_payload(raw)
            ideas = _sanitize_idea_payload(payload, count=remaining, hook_count=hook_count)
            for idea in ideas:
                if all(existing.topic.lower() != idea.topic.lower() for existing in collected):
                    collected.append(idea)
                if len(collected) >= count:
                    break

        if len(collected) < count:
            raise RuntimeError(f"AI returned {len(collected)}/{count} usable ideas.")
        return collected[:count]
    except Exception as exc:
        raise RuntimeError(
            f"Idea generation failed (AI-only mode, fallback disabled to avoid repeats): {exc}"
        ) from exc


def build_script_from_outline(
    best_hook: str,
    outline: list[str],
    topic: str = "",
    min_seconds: int = 20,
    max_seconds: int = 35,
) -> str:
    """
    Build final script with strict structure:
    HOOK -> detail -> detail -> detail -> CTA
    """
    min_words = max(55, math.ceil(min_seconds * BASE_WPS * SPEECH_RATE_MAX))
    max_words = max(min_words + 8, math.floor(max_seconds * BASE_WPS * SPEECH_RATE_MIN))
    points = [item for item in outline if _clean_text(item)]
    if len(points) < 3:
        raise ValueError("Outline must contain at least 3 non-empty points.")
    points = points[:3]

    lines = [
        _clean_text(best_hook),
        _clean_text(points[0]),
        _clean_text(points[1]),
        _clean_text(points[2]),
    ]
    script = _clean_text(" ".join(lines))
    words = script.split()
    if len(words) < min_words or len(words) > max_words:
        raise ValueError("Script length out of bounds; requires AI revision.")
    return script


def _generate_script_with_ai(
    topic: str,
    best_hook: str,
    outline: list[str],
    provider: str,
    gemini_api_key: str,
    gemini_model: str,
    openai_api_key: str,
    openai_model: str,
    anthropic_api_key: str,
    anthropic_model: str,
    min_seconds: int,
    max_seconds: int,
) -> str:
    min_words = max(55, math.ceil(min_seconds * BASE_WPS * SPEECH_RATE_MAX))
    max_words = max(min_words + 8, math.floor(max_seconds * BASE_WPS * SPEECH_RATE_MIN))
    prompt = dedent(
        f"""
        You are writing a narration script for a YouTube Short about a REAL technology or science topic.

        Topic: {topic}
        Hook to start with (must be first sentence): {best_hook}
        Outline points:
        - {outline[0] if len(outline) > 0 else ""}
        - {outline[1] if len(outline) > 1 else ""}
        - {outline[2] if len(outline) > 2 else ""}

        Requirements:
        - Return strict JSON only with key: script
        - Script must be {min_words}-{max_words} words total
        - No questions and no section labels (no "What changed now", "Quick move to test", "In this video", "Here are")
        - No filler or CTA lines
        - Plain sentences, factual, clear, and easy to understand
        - Must include the exact real technology name
        - Keep it punchy and dynamic
        """
    ).strip()
    raw = _call_model(
        prompt=prompt,
        provider=provider,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        anthropic_api_key=anthropic_api_key,
        anthropic_model=anthropic_model,
    )
    payload = _extract_json_payload(raw)
    if not isinstance(payload, dict):
        raise ValueError("Script payload must be a JSON object.")
    script = _clean_text(str(payload.get("script", "")))
    if not script:
        raise ValueError("AI script missing.")
    words = script.split()
    if len(words) < min_words or len(words) > max_words:
        raise ValueError("AI script length out of bounds.")
    return script


def _sanitize_hashtags(raw: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        token = re.sub(r"[^a-zA-Z0-9_]", "", str(item).replace("#", ""))
        if not token:
            continue
        normalized = f"#{token.lower()}"
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out[:15]


def _enrich_with_ai(
    topic: str,
    best_hook: str,
    outline: list[str],
    script: str,
    provider: str,
    gemini_api_key: str,
    gemini_model: str,
    openai_api_key: str,
    openai_model: str,
    anthropic_api_key: str,
    anthropic_model: str,
) -> tuple[list[str], list[str], str, str, list[str]]:
    prompt = dedent(
        f"""
        Create high-retention assets for a YouTube Short about a REAL technology or science topic.
        Topic: {topic}
        Hook: {best_hook}
        Outline points:
        - {outline[0] if len(outline) > 0 else ""}
        - {outline[1] if len(outline) > 1 else ""}
        - {outline[2] if len(outline) > 2 else ""}
        Script:
        {script}

        Return strict JSON only with keys:
        title, description, hashtags, scenes, search_queries

        FACTUAL ACCURACY:
        - Title must include the real technology/discovery name (not a vague synonym)
        - Description must be factually accurate with no made-up claims
        - Scene descriptions must be specific enough for stock video search

        Rules:
        - title under 60 chars, curiosity-based, includes the technology/discovery name
        - description is 2-3 SEO-friendly sentences with factual accuracy
        - hashtags length 10-15 and include #shorts and #science
        - scenes: exactly 5 short visual descriptions for stock video search
          (e.g. "rocket launching with fire and smoke at night" NOT "space technology")
          (e.g. "scientist examining DNA strand under microscope" NOT "biotech innovation")
        - search_queries: exactly 5, map scene-by-scene for Pexels/Pixabay search
        - avoid phrases like "point one", "point two", "point three" in any generated text
        """
    ).strip()
    raw = _call_model(
        prompt=prompt,
        provider=provider,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        anthropic_api_key=anthropic_api_key,
        anthropic_model=anthropic_model,
    )
    payload = _extract_json_payload(raw)
    if not isinstance(payload, dict):
        raise ValueError("Enrichment payload must be a JSON object.")

    raw_scenes = payload.get("scenes", [])
    scenes = [_clean_text(item) for item in raw_scenes if _clean_text(item)] if isinstance(raw_scenes, list) else []
    raw_queries = payload.get("search_queries", [])
    queries = [_clean_text(item) for item in raw_queries if _clean_text(item)] if isinstance(raw_queries, list) else []
    raw_hashtags = payload.get("hashtags", [])
    hashtags = _sanitize_hashtags(raw_hashtags if isinstance(raw_hashtags, list) else [])
    title = _clean_text(str(payload.get("title", "")))[:59]
    description = _clean_text(str(payload.get("description", "")))

    if len(scenes) < 4 or len(queries) < 4 or len(hashtags) < 10 or not title or not description:
        raise ValueError("AI enrichment output did not satisfy quality constraints.")
    return scenes[:5], queries[:5], title, description, hashtags


def build_optimized_idea(
    candidate: IdeaCandidate,
    best_hook: str,
    viral_score: float = 0.0,
    score_breakdown: dict[str, float] | None = None,
    provider: str = "gemini",
    gemini_api_key: str = "",
    gemini_model: str = "gemini-3-flash",
    openai_api_key: str = "",
    openai_model: str = "gpt-4.1-mini",
    anthropic_api_key: str = "",
    anthropic_model: str = "claude-3-5-haiku-latest",
    target_duration: int = 40,
) -> OptimizedIdea:
    normalized_provider = provider.strip().lower()
    if normalized_provider in {"", "none", "template"}:
        raise ValueError("AI provider required; local fallback disabled.")
    script = _generate_script_with_ai(
        topic=candidate.topic,
        best_hook=best_hook,
        outline=candidate.script_outline,
        provider=normalized_provider,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        anthropic_api_key=anthropic_api_key,
        anthropic_model=anthropic_model,
        target_duration=target_duration,
    )
    scenes, queries, title, description, hashtags = _enrich_with_ai(
        topic=candidate.topic,
        best_hook=best_hook,
        outline=candidate.script_outline,
        script=script,
        provider=normalized_provider,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        anthropic_api_key=anthropic_api_key,
        anthropic_model=anthropic_model,
    )

    hashtags = _sanitize_hashtags(hashtags)
    if len(hashtags) < 10:
        raise ValueError("AI hashtags insufficient; local fallback disabled.")

    return OptimizedIdea(
        topic=candidate.topic,
        best_hook=_clean_text(best_hook),
        hook_options=[_clean_text(item) for item in candidate.hooks[:10]],
        script_outline=[_clean_text(item) for item in candidate.script_outline[:3]],
        script=script,
        title=title[:59],
        description=description,
        hashtags=hashtags[:15],
        scenes=scenes[:5],
        search_queries=queries[:5] if queries else scenes[:5],
        viral_score=round(float(viral_score), 2),
        score_breakdown=score_breakdown or {},
    )

