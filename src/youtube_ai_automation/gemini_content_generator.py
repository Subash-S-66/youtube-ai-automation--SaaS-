"""
Generate structured short-form content using Gemini Flash.
"""

from __future__ import annotations

from youtube_ai_automation.content_generator import GeneratedContent, generate_content


def generate_gemini_content(
    topic: str,
    gemini_api_key: str,
    gemini_model: str,
    target_duration: int = 40,
    content_type: str = "tech",
    story_mode: bool = False,
    current_part: int = 1,
    recap_enabled: bool = False,
    last_prompt: str = "",
) -> GeneratedContent:
    """
    Force content generation through Gemini so script + scenes are created
    after topic selection.
    """
    return generate_content(
        topic=topic,
        provider="gemini",
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        target_duration=target_duration,
        content_type=content_type,
        story_mode=story_mode,
        current_part=current_part,
        recap_enabled=recap_enabled,
        last_prompt=last_prompt,
    )

