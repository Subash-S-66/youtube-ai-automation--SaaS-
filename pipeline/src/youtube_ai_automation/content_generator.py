"""
Generate structured short-form content for YouTube Shorts.
Rewritten for:
  - Strict duration control (word budget enforced)
  - CTA / Recap flags properly embedded
  - One-sentence-per-line script for clean TTS + caption alignment
  - Scene queries matched 1:1 to script lines
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import math
import os
import re
import time
from typing import Any

import requests

LOGGER = logging.getLogger(__name__)

WORDS_PER_SECOND = 2.5
GEMINI_RETRY_STATUS_CODES = {429, 503}
GEMINI_MAX_RETRIES_PER_MODEL = 2
GEMINI_RETRY_DELAYS_SECONDS = (2, 5, 10)
GEMINI_REQUEST_TIMEOUT_SECONDS = 40


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class GeneratedContent:
    topic: str
    title: str
    hook: str
    description: str
    hashtags: list[str]
    script: str          # Full script, one sentence per line
    scenes: list[str]    # One per script line
    search_queries: list[str]  # One per script line

    def upload_description(self) -> str:
        tag_line = " ".join(self.hashtags)
        return f"{self.description}\n\n{tag_line}".strip()

    def tags(self) -> list[str]:
        cleaned = [tag.replace("#", "").strip() for tag in self.hashtags]
        return [tag for tag in cleaned if tag][:15]


# ─────────────────────────────────────────────────────────────────────────────
# Text helpers
# ─────────────────────────────────────────────────────────────────────────────
def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _word_bounds(target_duration: int) -> tuple[int, int]:
    """Tight ±5 second window around target duration."""
    t = max(15, min(60, int(target_duration)))
    return math.floor((t - 5) * WORDS_PER_SECOND), math.floor((t + 5) * WORDS_PER_SECOND)


def _split_into_lines(script: str) -> list[str]:
    """Split script at sentence boundaries, one sentence per line."""
    text = " ".join(str(script or "").split()).strip()
    if not text:
        return []
    # First try newline-delimited (already pre-split by the model)
    newline_parts = [p.strip() for p in text.splitlines() if p.strip()]
    if len(newline_parts) >= 2:
        return newline_parts
    # Fall back to sentence-boundary splitting
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def _estimate_duration(line: str) -> float:
    words = len(str(line or "").split())
    return max(0.5, words / WORDS_PER_SECOND)


def _count_words(text: str) -> int:
    return len(str(text or "").split())


def _clean_hashtags(raw: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in raw:
        value = _clean(tag)
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


def _extract_json(text: str) -> Any:
    """Extract the first JSON object from model output."""
    candidate = str(text).strip()
    # Strip markdown fences
    candidate = re.sub(r'^```(?:json)?\s*', '', candidate, flags=re.IGNORECASE)
    candidate = re.sub(r'\s*```$', '', candidate)
    start = candidate.find('{')
    end = candidate.rfind('}')
    if start == -1 or end <= start:
        raise ValueError("No JSON object found in model response.")
    return json.loads(candidate[start:end + 1])


# ─────────────────────────────────────────────────────────────────────────────
# THE CONTENT PROMPT
# This prompt is called from the Python pipeline and must match the TS version.
# ─────────────────────────────────────────────────────────────────────────────
def _build_content_prompt(
    narration_brief: str,
    topic: str,
    target_duration: int,
    index: int,
    total: int,
    story_mode: bool,
    current_part: int,
    recap_enabled: bool,
    cta_enabled: bool,
    last_prompt: str,
) -> str:
    target = max(15, min(60, int(target_duration)))
    min_words, max_words = _word_bounds(target)

    # Section budgets
    hook_words = round(min_words * 0.18)
    cta_words = round(min_words * 0.14) if cta_enabled else 0
    recap_words = round(min_words * 0.12) if recap_enabled else 0
    main_words = min_words - hook_words - cta_words - recap_words

    variation_note = (
        f"This is video {index} of {total} in this batch. Use a DIFFERENT hook and angle from any previous video."
        if total > 1 else ""
    )
    story_note = ""
    if story_mode:
        if current_part > 1 and last_prompt:
            story_note = f"STORY MODE Part {current_part}: Continue from: \"{last_prompt[:120]}\". Frame as ongoing series."
        else:
            story_note = f"STORY MODE Part {current_part}: Open the story arc. Frame as episode 1 of a series."

    recap_line = (
        f"• Recap (second-to-last line): ~{recap_words} words — one sentence summarising the key takeaway."
        if recap_enabled else "• NO recap section."
    )
    cta_line = (
        f"• CTA (last line): ~{cta_words} words — a direct action call (follow, subscribe, save, share, etc.)."
        if cta_enabled else "• NO call-to-action. End with a strong closing statement or thought."
    )

    return f"""You are an elite YouTube Shorts content engine. Return ONLY valid JSON — no markdown, no extra text.

NARRATION BRIEF (this IS what the video is about — follow it exactly):
"{narration_brief}"

TOPIC: {topic}
TARGET DURATION: {target} seconds
TOTAL WORD BUDGET: {min_words}–{max_words} words (entire script must stay in this range)

SECTION BREAKDOWN (each section's words add to the total budget):
• Hook (first line): ~{hook_words} words — strong curiosity/shock/question opening. MUST be the first sentence.
• Main body: ~{main_words} words — deliver the core insight. Plain, punchy, spoken sentences.
{recap_line}
{cta_line}

{variation_note}
{story_note}

SCRIPT RULES (critical):
1. Every line will be spoken aloud by a TTS voice. Write for the ear.
2. Split the script into SHORT lines — one sentence per line, max 15 words per line.
3. NEVER start a line with: "In this video", "Welcome back", "Today we", "Here are", "Let me tell you".
4. NO labels in the script (do NOT write "Hook:", "CTA:", "Main:", "Recap:").
5. Hook must be first. CTA (if enabled) must be last. Recap (if enabled) must be second-to-last.
6. Count words: total script must be {min_words}–{max_words} words. Expand main body if under. Trim if over.

SCENE RULES:
- Generate exactly one scene per script line (minimum 5, maximum 12 scenes total).
- Each scene is a stock-video search phrase: specific, visual, 4-8 words.
  Good: "scientist examining glowing DNA strand under microscope"
  Bad: "technology innovation"
- Scenes must visually match what is being SAID on that line.

HASHTAG RULES:
- 10–15 hashtags, all lowercase with #
- Must include #shorts
- Mix broad (#science) and specific (#spacediscovery) tags

OUTPUT — return ONLY this JSON structure:
{{
  "topic": "string — the video topic, max 80 chars",
  "title": "string — YouTube title, max 60 chars, curiosity-driven, includes key subject",
  "hook": "string — the first line of the script (copied from script line 1)",
  "description": "string — 2-3 SEO sentences, factually accurate",
  "hashtags": ["#shorts", "..."],
  "script": "string — ALL lines separated by newlines, one sentence per line, total {min_words}–{max_words} words",
  "scenes": ["scene for line 1", "scene for line 2", "..."],
  "search_queries": ["stock video query 1", "stock video query 2", "..."]
}}

The "scenes" and "search_queries" arrays MUST have the SAME number of items as there are lines in "script".
FINAL CHECK: count the words in "script". It MUST be {min_words}–{max_words} words total."""


# ─────────────────────────────────────────────────────────────────────────────
# Validate + normalise one AI response
# ─────────────────────────────────────────────────────────────────────────────
def _normalise_output(payload: dict[str, Any], target_duration: int) -> GeneratedContent:
    topic = _clean(payload.get("topic", ""))
    title = _clean(payload.get("title", ""))[:100]
    description = _clean(payload.get("description", ""))
    raw_script = _clean(payload.get("script", ""))
    min_words, max_words = _word_bounds(target_duration)

    if not topic:
        raise ValueError("Missing topic.")
    if not title:
        raise ValueError("Missing title.")
    if not description:
        raise ValueError("Missing description.")
    if not raw_script:
        raise ValueError("Missing script.")

    lines = _split_into_lines(raw_script)
    if len(lines) < 2:
        raise ValueError(f"Script has only {len(lines)} line(s). Need at least 2.")

    total_words = _count_words(raw_script)
    if total_words < min_words:
        raise ValueError(
            f"Script too short: {total_words} words, need {min_words}–{max_words} for {target_duration}s."
        )
    # Soft trim if over budget (keep first lines that fit)
    if total_words > max_words + 20:
        trimmed: list[str] = []
        word_count = 0
        for line in lines:
            lw = _count_words(line)
            if word_count + lw > max_words and len(trimmed) >= 3:
                break
            trimmed.append(line)
            word_count += lw
        lines = trimmed

    raw_scenes = payload.get("scenes", [])
    raw_queries = payload.get("search_queries", [])
    raw_hashtags = payload.get("hashtags", [])

    scenes = [_clean(x) for x in raw_scenes if _clean(x)]
    search_queries = [_clean(x) for x in raw_queries if _clean(x)]
    hashtags = _clean_hashtags([_clean(x) for x in raw_hashtags])

    if len(scenes) < 3:
        raise ValueError(f"Too few scenes: {len(scenes)}, need at least 3.")
    if not hashtags:
        raise ValueError("No hashtags returned.")

    hook = _clean(payload.get("hook", "")) or lines[0]

    return GeneratedContent(
        topic=topic,
        title=title,
        hook=hook,
        description=description,
        hashtags=hashtags,
        script="\n".join(lines),
        scenes=scenes[:max(5, len(lines))],
        search_queries=search_queries[:max(5, len(lines))],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Model call helpers
# ─────────────────────────────────────────────────────────────────────────────
def _normalize_model_name(model: str) -> str:
    name = " ".join(str(model).split()).strip()
    return name[len("models/"):] if name.startswith("models/") else name


def _model_candidates(primary: str) -> list[str]:
    primary = _normalize_model_name(primary) or "gemini-2.0-flash"
    fallbacks_env = os.getenv("GEMINI_FALLBACK_MODELS", "")
    fallbacks = [_normalize_model_name(m) for m in fallbacks_env.split(",") if m.strip()]
    seen: set[str] = set()
    result: list[str] = []
    for m in [primary, *fallbacks]:
        if m and m not in seen:
            seen.add(m)
            result.append(m)
    return result


def _call_gemini(prompt: str, api_key: str, model: str) -> str:
    from .gemini_utils import execute_with_gemini_fallback

    def _single_call(key: str) -> str:
        errors: list[str] = []
        for model_name in _model_candidates(model):
            for attempt in range(1, GEMINI_MAX_RETRIES_PER_MODEL + 1):
                try:
                    resp = requests.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                        params={"key": key},
                        headers={"Content-Type": "application/json"},
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {
                                "temperature": 0.4,
                                "maxOutputTokens": 1200,
                            },
                        },
                        timeout=GEMINI_REQUEST_TIMEOUT_SECONDS,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    parts: list[str] = []
                    for cand in data.get("candidates", []):
                        for part in cand.get("content", {}).get("parts", []):
                            if part.get("text"):
                                parts.append(str(part["text"]))
                    text = "\n".join(parts).strip()
                    if text:
                        return text
                    errors.append(f"{model_name}: empty response")
                    break
                except requests.exceptions.HTTPError as e:
                    status = e.response.status_code
                    if status in GEMINI_RETRY_STATUS_CODES and attempt < GEMINI_MAX_RETRIES_PER_MODEL:
                        delay = GEMINI_RETRY_DELAYS_SECONDS[min(attempt - 1, 2)]
                        LOGGER.warning("Gemini %s HTTP %s, retrying in %ss", model_name, status, delay)
                        time.sleep(delay)
                        continue
                    errors.append(f"{model_name}: HTTP {status}")
                    break
                except Exception as exc:
                    errors.append(f"{model_name}: {str(exc)[:80]}")
                    break
        raise RuntimeError("Gemini failed: " + " | ".join(errors))

    return execute_with_gemini_fallback(_single_call)


def _call_openai(prompt: str, api_key: str, model: str) -> str:
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.4,
            "max_tokens": 1200,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise ValueError("OpenAI returned empty response.")
    return text


def _call_anthropic(prompt: str, api_key: str, model: str) -> str:
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 1200,
            "temperature": 0.4,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    text = "\n".join(p for p in parts if p).strip()
    if not text:
        raise ValueError("Anthropic returned empty response.")
    return text


def _call_model(prompt: str, provider: str, gemini_api_key: str, gemini_model: str,
                openai_api_key: str, openai_model: str,
                anthropic_api_key: str, anthropic_model: str) -> str:
    # Jules routing (highest priority)
    jules_url = os.getenv("JULES_API_URL")
    jules_key = os.getenv("JULES_API_KEY")
    if jules_url and jules_key:
        try:
            resp = requests.post(
                jules_url,
                headers={"Authorization": f"Bearer {jules_key}", "Content-Type": "application/json"},
                json={"prompt": prompt},
                timeout=60,
            )
            if resp.ok:
                data = resp.json()
                out = data.get("output_text") or data.get("response") or data.get("text")
                if out:
                    return str(out).strip()
        except Exception as e:
            LOGGER.warning("Jules API failed: %s", e)

    norm = provider.strip().lower()
    if norm in {"gemini", "google"}:
        if not gemini_api_key:
            raise ValueError("GEMINI_API_KEY is missing.")
        return _call_gemini(prompt, gemini_api_key, gemini_model)
    if norm == "openai":
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is missing.")
        return _call_openai(prompt, openai_api_key, openai_model)
    if norm in {"anthropic", "claude"}:
        if not anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is missing.")
        return _call_anthropic(prompt, anthropic_api_key, anthropic_model)
    raise ValueError(f"Unsupported provider: {provider}")


# ─────────────────────────────────────────────────────────────────────────────
# Retry wrapper
# ─────────────────────────────────────────────────────────────────────────────
def _generate_with_retry(
    model_prompt: str,
    topic: str,
    target_duration: int,
    provider: str,
    gemini_api_key: str,
    gemini_model: str,
    openai_api_key: str,
    openai_model: str,
    anthropic_api_key: str,
    anthropic_model: str,
) -> GeneratedContent:
    MAX_RETRIES = 3
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw_text = _call_model(
                model_prompt, provider, gemini_api_key, gemini_model,
                openai_api_key, openai_model, anthropic_api_key, anthropic_model,
            )
            payload = _extract_json(raw_text)
            return _normalise_output(payload, target_duration)
        except Exception as exc:
            last_error = exc
            LOGGER.warning("Content gen attempt %s/%s failed: %s", attempt, MAX_RETRIES, str(exc)[:120])
            if attempt < MAX_RETRIES:
                time.sleep(attempt * 1.5)

    raise RuntimeError(f"Content generation failed after {MAX_RETRIES} attempts: {last_error}")


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic fallback
# ─────────────────────────────────────────────────────────────────────────────
def _fallback(topic: str, narration_brief: str, target_duration: int) -> GeneratedContent:
    safe_topic = _clean(topic) or "This Topic"
    brief_sentence = (_clean(narration_brief).split(".")[0] or safe_topic) + "."
    lines = [
        f"Did you know this about {safe_topic}?",
        brief_sentence,
        "Most people completely overlook this.",
        "Once you see it, everything changes.",
        "Follow for more fast facts like this.",
    ]
    return GeneratedContent(
        topic=safe_topic,
        title=f"{safe_topic} — What You Need to Know"[:60],
        hook=lines[0],
        description=f"Quick breakdown of {safe_topic} in under a minute.",
        hashtags=["#shorts", "#facts", "#viral", "#youtube"],
        script="\n".join(lines),
        scenes=[
            "person looking amazed at smartphone screen",
            "technology concept abstract background",
            "person thinking with curious expression",
            "mind blown reaction close up",
            "person tapping subscribe button on phone",
        ],
        search_queries=[
            "amazed person smartphone screen",
            "technology abstract background",
            "person curious expression",
            "mind blown reaction",
            "subscribe button phone",
        ],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point (called from main.py and azure_job_runner.py)
# ─────────────────────────────────────────────────────────────────────────────
def generate_content(
    topic: str,
    provider: str = "gemini",
    gemini_api_key: str = "",
    gemini_model: str = "gemini-2.0-flash",
    openai_api_key: str = "",
    openai_model: str = "gpt-4o-mini",
    anthropic_api_key: str = "",
    anthropic_model: str = "claude-3-5-haiku-latest",
    target_duration: int = 40,
    content_type: str = "tech",
    story_mode: bool = False,
    current_part: int = 1,
    recap_enabled: bool = False,
    cta_enabled: bool = False,
    last_prompt: str = "",
    video_index: int = 1,
    video_total: int = 1,
) -> GeneratedContent:
    topic = _clean(topic)
    if not topic:
        raise ValueError("Topic is required for content generation.")

    norm_provider = provider.strip().lower()
    if norm_provider in {"", "none", "template"}:
        raise ValueError("An AI provider is required. Set AI_PROVIDER in environment.")

    # The narration brief should come from the pipeline payload (already AI-generated).
    # For local single-shot calls, we build a minimal brief from the topic.
    narration_brief = topic

    model_prompt = _build_content_prompt(
        narration_brief=narration_brief,
        topic=topic,
        target_duration=target_duration,
        index=video_index,
        total=video_total,
        story_mode=story_mode,
        current_part=current_part,
        recap_enabled=recap_enabled,
        cta_enabled=cta_enabled,
        last_prompt=last_prompt,
    )

    try:
        return _generate_with_retry(
            model_prompt=model_prompt,
            topic=topic,
            target_duration=target_duration,
            provider=norm_provider,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model,
            openai_api_key=openai_api_key,
            openai_model=openai_model,
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
        )
    except Exception as exc:
        LOGGER.error("All content generation attempts failed. Using fallback. Error: %s", exc)
        return _fallback(topic, narration_brief, target_duration)