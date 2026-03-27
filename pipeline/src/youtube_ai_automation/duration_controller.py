from __future__ import annotations

from dataclasses import dataclass
import re

WORDS_PER_SECOND = 2.5
MAX_DURATION_SECONDS = 60
MIN_DURATION_SECONDS = 15
ALLOWED_DRIFT_SECONDS = 10


@dataclass
class SectionBudget:
    hook: int
    main_content: int
    recap: int
    cta: int

    @property
    def total(self) -> int:
        return self.hook + self.main_content + self.recap + self.cta


def _word_bounds(target_duration: int) -> tuple[int, int]:
    """
    Compute min/max word counts based on 2.5 WPS average TTS speed.
    The +/-5 s window maps to +/-12-13 words.
    """
    target = max(15, min(60, int(target_duration)))
    min_words = max(30, int((target - 5) * 2.5))
    max_words = int(min(60, target + 5) * 2.5)
    return min_words, max_words


def allocate_section_budget(
    target_seconds: int,
    has_cta: bool,
    has_recap: bool
) -> SectionBudget:
    """
    Distribute target_seconds across hook / main_content / recap / cta.
    CTA and recap reduce main_content proportionally so that
    hook + main_content + recap + cta == target_seconds exactly.
    """
    target = max(15, min(60, int(target_seconds)))
    if target < 25:
        has_recap = False
    if target < 20:
        has_cta = False
    hook = max(3, int(target * 0.12))
    cta = max(5, int(target * 0.12)) if has_cta else 0
    recap = max(4, int(target * 0.10)) if has_recap else 0
    main_content = target - hook - cta - recap
    if main_content < 5:
        if has_cta:
            cta = min(cta, 4)
        if has_recap:
            recap = min(recap, 3)
        main_content = target - hook - cta - recap
        if main_content < 5:
            deficit = 5 - main_content
            if has_cta and cta > 0:
                delta = min(deficit, cta)
                cta -= delta
                deficit -= delta
            if has_recap and recap > 0 and deficit > 0:
                delta = min(deficit, recap)
                recap -= delta
                deficit -= delta
            main_content = target - hook - cta - recap
            if main_content < 5:
                main_content = 5
                overflow = (hook + main_content + cta + recap) - target
                if has_cta and cta > 0 and overflow > 0:
                    delta = min(overflow, cta)
                    cta -= delta
                    overflow -= delta
                if has_recap and recap > 0 and overflow > 0:
                    delta = min(overflow, recap)
                    recap -= delta
                    overflow -= delta
    return SectionBudget(
        hook=hook,
        main_content=main_content,
        recap=recap,
        cta=cta
    )


def estimate_duration_from_script(script: str) -> float:
    """2.5 words per second is the standard TTS speed for Shorts."""
    words = max(1, len(str(script or '').split()))
    return round(words / 2.5, 2)


def estimate_script_duration_seconds(script: str) -> float:
    words = len(re.findall(r"\b[\w'-]+\b", str(script or "")))
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
    normalized_topic = re.sub(r"#\d+", "", str(topic_hint or "")).strip(" .,:;")
    hint = f" in {normalized_topic}" if normalized_topic else ""
    if section_name == "hook":
        return f"Imagine one real-life moment{hint} that flips your expectation instantly."
    if section_name == "recap":
        return f"To recap{hint}, the key takeaway is practical and easy to apply today."
    if section_name == "cta":
        return "Follow for more concise explainers you can use immediately."
    return f"A concrete example{hint} shows how one small decision can change the final outcome."


def _smart_expansion_sentences(section_name: str, topic_hint: str = "", story_mode: bool = False) -> list[str]:
    normalized_topic = re.sub(r"#\d+", "", str(topic_hint or "")).strip(" .,:;")
    hint = f" in {normalized_topic}" if normalized_topic else ""
    base = [
        f"For example{hint}, a simple real-world case reveals the practical impact immediately.",
        f"An important insight{hint} is that small, repeatable actions drive long-term results.",
        f"To clarify{hint}, this works best when one change is applied consistently over time.",
    ]
    if story_mode:
        base.append(
            f"In a quick story{hint}, the turning point happens when one assumption is challenged."
        )
    if section_name == "hook":
        return [base[0]]
    if section_name == "recap":
        return [f"In short{hint}, the main lesson is clear and actionable from this point forward."]
    if section_name == "cta":
        return ["If this helped, follow now and watch the next part for the deeper breakdown."]
    return base


def adjust_script_to_duration(
    script: str,
    target_seconds: int,
    section_name: str,
    topic_hint: str = "",
    story_mode: bool = False,
) -> str:
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
    expansion_pool = _smart_expansion_sentences(
        section_name=section_name,
        topic_hint=topic_hint,
        story_mode=story_mode,
    )
    pool_idx = 0
    while current < target - 0.25 and loops < 50:
        sentences.append(expansion_pool[pool_idx % len(expansion_pool)])
        pool_idx += 1
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


def validate_section_limits(
    section_durations: dict[str, float],
    *,
    has_cta: bool,
    has_recap: bool,
) -> tuple[bool, list[str]]:
    errors: list[str] = []
    hook = float(section_durations.get("hook", 0.0))
    recap = float(section_durations.get("recap", 0.0))
    cta = float(section_durations.get("cta", 0.0))
    if hook > 5.0:
        errors.append(f"hook_overflow:{hook:.2f}")
    if has_recap and recap > 7.0:
        errors.append(f"recap_overflow:{recap:.2f}")
    if has_cta and cta > 8.0:
        errors.append(f"cta_overflow:{cta:.2f}")
    return len(errors) == 0, errors


def validate_ending(script: str, *, has_cta: bool, has_recap: bool) -> tuple[bool, str]:
    clean = str(script or "").strip()
    if not clean:
        return False, "empty_script"
    if not re.search(r"[.!?]$", clean):
        return False, "incomplete_sentence"
    lower = clean.lower()
    if has_cta:
        cta_markers = ("follow", "subscribe", "watch", "comment", "share", "next part")
        if not any(marker in lower for marker in cta_markers):
            return False, "cta_ending_missing_call_to_action"
    elif has_recap:
        recap_markers = ("recap", "key takeaway", "in short", "remember")
        if not any(marker in lower for marker in recap_markers):
            return False, "recap_ending_not_conclusive"
    return True, ""


def repair_section_ending(section_text: str, section_name: str) -> str:
    text = str(section_text or "").strip()
    if not text:
        return _expansion_sentence(section_name)
    if not re.search(r"[.!?]$", text):
        text = f"{text}."
    if section_name == "cta":
        lower = text.lower()
        if not any(marker in lower for marker in ("follow", "subscribe", "watch", "share", "comment")):
            text = f"{text} Follow for more."
    return text
