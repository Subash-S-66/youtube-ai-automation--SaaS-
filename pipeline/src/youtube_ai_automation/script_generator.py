"""
Backward-compatible wrappers around the advanced content engine.
"""

from __future__ import annotations

from youtube_ai_automation.content_generator import GeneratedContent, generate_content as _generate_content


def generate_content(
    topic: str,
    provider: str = "gemini",
    gemini_api_key: str = "",
    gemini_model: str = "gemini-3.1-flash-lite",
    openai_api_key: str = "",
    openai_model: str = "gpt-4.1-mini",
    anthropic_api_key: str = "",
    anthropic_model: str = "claude-3-5-haiku-latest",
    story_mode: bool = False,
    current_part: int = 1,
) -> GeneratedContent:
    return _generate_content(
        topic=topic,
        provider=provider,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        anthropic_api_key=anthropic_api_key,
        anthropic_model=anthropic_model,
        min_seconds=20,
        max_seconds=40,
        story_mode=story_mode,
        current_part=current_part,
    )


def generate_topic_ideas(niche: str, count: int = 5, provider: str = "template", **_: str) -> list[str]:
    niche = " ".join(niche.split()).strip() or "technology"
    seeds = [
        f"Hidden {niche} tools that save time",
        f"{niche} tricks nobody talks about",
        f"Future of {niche} in 30 seconds",
        f"Viral discoveries in {niche}",
        f"Best beginner workflow for {niche}",
    ]
    return seeds[:count]


def generate_short_script(topic: str) -> str:
    return generate_content(topic=topic).script

