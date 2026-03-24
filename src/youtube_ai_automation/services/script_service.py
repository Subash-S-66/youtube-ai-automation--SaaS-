from pathlib import Path
from youtube_ai_automation.gemini_content_generator import generate_youtube_shorts_script
from youtube_ai_automation.script_generator import extract_script_components

def generate_script(topic: str, video_style: str, enable_cta: bool, custom_prompt: str = "") -> dict:
    prompt = custom_prompt if custom_prompt else f"Write a {video_style} short about {topic}"
    raw_script = generate_youtube_shorts_script(prompt, topic)
    return extract_script_components(raw_script, enable_cta)
