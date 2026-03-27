from __future__ import annotations

from dataclasses import dataclass
import math
import re

WORDS_PER_SECOND = 2.5
MAX_DURATION_SECONDS = 60
MIN_DURATION_SECONDS = 15
ALLOWED_DRIFT_SECONDS = 5


@dataclass
class SectionBudget:
    hook: int
    main_content: int
    recap: int
    cta: int

    @property
    def total(self) -> int:
        return self.hook + self.main_content + self.recap + self.cta


def allocate_section_budget(target_seconds: int, has_cta: bool, has_recap: bool) -> SectionBudget:
    target = max(MIN_DURATION_SECONDS, min(MAX_DURATION_SECONDS, int(target_seconds)))
    hook = 5 if target >= 25 else max(3, int(round(target * 0.15)))
    cta = 0
    recap = 0

    if has_cta and has_recap:
        cta = max(6, int(round(target * 0.12)))
        recap = max(5, int(round(target * 0.10)))
    elif has_cta:
        cta = max(5, int(round(target * 0.13)))
    elif has_recap:
        recap = max(5, int(round(target * 0.12)))

    main_content = max(6, target - hook - cta - recap)
    budget = SectionBudget(hook=hook, main_content=main_content, recap=recap, cta=cta)

    drift = target - budget.total
    if drift != 0:
        budget.main_content += drift
    return budget


def estimate_script_duration_seconds(script: str) -> float:
    words = len(re.findall(r"\b[\w'-]+\b", script))
    if words <= 0:
        return 0.0
    return words / WORDS_PER_SECOND


def _split_sentences(script: str) -> list[str]:
    normalized = " ".join(str(script or "").split())
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if part.strip()]


def _join_sentences(sentences: list[str]) -> str:
    return " ".join(item.strip() for item in sentences if item.strip()).strip()


def _expansion_sentence(section_name: str, topic_hint: str = "") -> str:
    hint = f" about {topic_hint}" if topic_hint else ""
    if section_name == "hook":
        return f"Here is the key idea{hint}."
    if section_name == "recap":
        return f"To recap{hint}, this is the main takeaway."
    if section_name == "cta":
        return "Follow for more short explainers and practical tips."
    return f"This detail matters{hint} because it changes the outcome."


def adjust_script_to_duration(script: str, target_seconds: int, section_name: str, topic_hint: str = "") -> str:
    target = max(1, int(target_seconds))
    sentences = _split_sentences(script)
    if not sentences:
        sentences = [_expansion_sentence(section_name, topic_hint)]

    current = estimate_script_duration_seconds(_join_sentences(sentences))
    loops = 0
    while current > target + 0.25 and len(sentences) > 1 and loops < 50:
        sentences.pop()
        current = estimate_script_duration_seconds(_join_sentences(sentences))
        loops += 1

    loops = 0
    while current < target - 0.25 and loops < 50:
        sentences.append(_expansion_sentence(section_name, topic_hint))
        current = estimate_script_duration_seconds(_join_sentences(sentences))
        loops += 1

    return _join_sentences(sentences)


def build_timed_lines(script: str) -> list[dict[str, float | str]]:
    sentences = _split_sentences(script)
    timed: list[dict[str, float | str]] = []
    for sentence in sentences:
        duration = max(0.8, estimate_script_duration_seconds(sentence))
        timed.append({"text": sentence, "duration": round(duration, 2)})
    return timed


def validate_output(
    *,
    target_seconds: int,
    actual_seconds: float,
    has_cta: bool,
    has_recap: bool,
    cta_text: str,
    recap_text: str,
    full_script: str,
) -> tuple[bool, list[str]]:
    errors: list[str] = []
    target = max(MIN_DURATION_SECONDS, min(MAX_DURATION_SECONDS, int(target_seconds)))

    if actual_seconds > MAX_DURATION_SECONDS:
        errors.append(f"duration_exceeds_max:{actual_seconds:.2f}")
    if abs(actual_seconds - target) > ALLOWED_DRIFT_SECONDS:
        errors.append(f"duration_out_of_range:target={target},actual={actual_seconds:.2f}")
    if has_cta and not str(cta_text or "").strip():
        errors.append("missing_cta")
    if has_recap and not str(recap_text or "").strip():
        errors.append("missing_recap")

    clean_script = str(full_script or "").strip()
    if not clean_script:
        errors.append("empty_script")
    elif not re.search(r"[.!?]$", clean_script):
        errors.append("abrupt_ending")

    return len(errors) == 0, errors

