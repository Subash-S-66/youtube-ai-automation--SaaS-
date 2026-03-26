from pathlib import Path
from youtube_ai_automation.voice_generator import generate_voice

def generate_audio(script: str, voice: str, output_path: Path, rate: str = "") -> tuple[Path, bool]:
    return generate_voice(script, voice, output_path, rate=rate)
