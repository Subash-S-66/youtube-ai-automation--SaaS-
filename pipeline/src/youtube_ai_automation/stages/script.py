from __future__ import annotations

from dataclasses import dataclass
import re

from youtube_ai_automation.content_generator import generate_content
from youtube_ai_automation.utils.fallback import minimal_safe_script
from youtube_ai_automation.utils.logger import StageLogger


@dataclass
class ScriptStageResult:
    lines: list[str]
    provider_used: str
    warnings: list[str]
    hard_failed: bool = False


_VISUAL_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into", "is",
    "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with", "you", "your",
}


def rewrite_to_visual_query(text: str) -> str:
    normalized = " ".join(str(text or "").split()).strip().lower()
    if not normalized:
        return "technology cinematic b-roll"

    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+", normalized)
        if token not in _VISUAL_STOP_WORDS and not token.isdigit() and len(token) > 2
    ]
    if not tokens:
        tokens = [token for token in re.findall(r"[a-z0-9]+", normalized) if len(token) > 2]

    base = " ".join(tokens[:6]).strip()
    if not base:
        base = "technology"
    return f"{base} cinematic b-roll"


def build_visual_queries(lines: list[str], max_queries: int = 10) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        query = rewrite_to_visual_query(line)
        key = query.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(query)
        if len(out) >= max(1, int(max_queries)):
            break
    return out


def generate_script(input_payload: dict, logger: StageLogger) -> ScriptStageResult:
    input_data = input_payload.get("input", {}) if isinstance(input_payload, dict) else {}
    topic = str(input_data.get("topic", "") or input_payload.get("topic", "")).strip() or "technology"
    duration = int(input_data.get("duration", 60) or 60)

    # Prefer provided script for deterministic queued runs.
    payload_script = input_payload.get("script", [])
    if isinstance(payload_script, list) and payload_script:
        lines: list[str] = []
        for row in payload_script:
            if isinstance(row, dict):
                t = str(row.get("text", "")).strip()
                if t:
                    lines.append(t)
            elif isinstance(row, str) and row.strip():
                lines.append(row.strip())
        if lines:
            logger.info("script", f"using provided script lines={len(lines)}")
            return ScriptStageResult(lines=lines, provider_used="provided_input", warnings=[])

    warnings: list[str] = []
    try:
        # generate_content internally does Jules -> Gemini fallback, then deterministic fallback.
        generated = generate_content(
            topic=topic,
            provider="gemini",
            target_duration=duration,
        )
        lines = [line.strip() for line in str(generated.script or "").split("\n") if line.strip()]
        if lines:
            logger.info("script", f"generated script lines={len(lines)} provider=jules_or_gemini")
            return ScriptStageResult(lines=lines, provider_used="jules_or_gemini", warnings=warnings)
    except Exception as exc:
        warnings.append(f"script_provider_error:{str(exc)[:180]}")
        logger.warn("script", f"provider generation failed; fallback script will be used ({str(exc)[:120]})")

    fallback_lines = minimal_safe_script(topic=topic, duration=duration)
    if fallback_lines:
        warnings.append("script_fallback_used")
        return ScriptStageResult(lines=fallback_lines, provider_used="fallback", warnings=warnings)

    return ScriptStageResult(lines=[], provider_used="none", warnings=warnings + ["script_complete_failure"], hard_failed=True)

