from __future__ import annotations

from youtube_ai_automation.content_generator import generate_content


def _extract_script_components(script_text: str, enable_cta: bool) -> dict:
    lines = [line.strip() for line in str(script_text or "").splitlines() if line.strip()]
    if not lines and script_text:
        lines = [str(script_text).strip()]

    hook = lines[0] if lines else ""
    cta = lines[-1] if enable_cta and lines else ""

    return {
        "script": "\n".join(lines),
        "lines": lines,
        "hook": hook,
        "cta": cta,
        "hasCta": bool(cta),
    }


def generate_script(topic: str, video_style: str, enable_cta: bool, custom_prompt: str = "") -> dict:
    prompt_topic = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else topic
    generated = generate_content(
        topic=prompt_topic,
        provider="gemini",
        target_duration=40,
        content_type=(video_style or "tech").strip() or "tech",
    )
    return _extract_script_components(str(generated.script or "").strip(), enable_cta)
