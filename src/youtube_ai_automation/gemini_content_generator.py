"""
Generate structured short-form content using Gemini Flash.
"""

from __future__ import annotations

from youtube_ai_automation.content_generator import GeneratedContent, generate_content


def generate_gemini_content(
    topic: str,
    gemini_api_key: str,
    gemini_model: str,
    min_seconds: int = 25,
    max_seconds: int = 40,
    content_type: str = "tech",
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
        min_seconds=min_seconds,
        max_seconds=max_seconds,
        content_type=content_type,
    )

