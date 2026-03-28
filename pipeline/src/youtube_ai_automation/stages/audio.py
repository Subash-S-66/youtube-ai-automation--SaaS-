from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
import wave

from youtube_ai_automation.utils.fallback import create_silent_audio
from youtube_ai_automation.utils.logger import StageLogger
from youtube_ai_automation.voice_generator import generate_voice


def _audio_duration_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return frames / float(rate) if rate > 0 else 0.0
    except Exception:
        return 0.0


def _build_atempo_chain(factor: float) -> str:
    """Build ffmpeg atempo filter chain. Only used for speeding up (factor > 1.0)."""
    value = max(1.0, min(4.0, float(factor)))  # Never slow down (never < 1.0)
    parts: list[float] = []
    while value > 2.0:
        parts.append(2.0)
        value /= 2.0
    parts.append(value)
    return ",".join(f"atempo={p:.6f}" for p in parts)


def _speed_up_audio(input_path: Path, output_path: Path, max_duration: float) -> float:
    """Speed up audio to fit within max_duration. Never slows down."""
    current = _audio_duration_seconds(input_path)
    if current <= 0 or current <= max_duration:
        return current
    factor = current / float(max_duration)
    if factor < 1.05:
        # Too small a difference to bother; use as-is
        return current
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-filter:a",
        _build_atempo_chain(factor),
        "-acodec",
        "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not output_path.exists():
        return current  # Failed — return original duration, don't crash
    return _audio_duration_seconds(output_path)


@dataclass
class AudioStageResult:
    path: str
    duration: float
    warnings: list[str]


def generate_audio(lines: list[str], output_dir: Path, target_duration: float, logger: StageLogger) -> AudioStageResult:
    warnings: list[str] = []
    text = " ".join(lines).strip()
    if not text:
        silent = create_silent_audio(output_dir / "voice_silent.wav", duration_seconds=target_duration)
        if silent is None:
            return AudioStageResult(path="", duration=0.0, warnings=["audio_missing_and_silent_failed"])
        warnings.append("audio_silent_fallback")
        return AudioStageResult(path=str(silent), duration=target_duration, warnings=warnings)

    first_path = output_dir / "voice_primary.wav"
    final_path = first_path
    duration = 0.0
    try:
        generated_path, _ = generate_voice(script=text, voice="", rate="", output_path=first_path, rotate_profile=False)
        duration = _audio_duration_seconds(generated_path)
        logger.info("audio", f"generated duration={duration:.2f}s target={target_duration:.2f}s")

        # Only speed UP if significantly over limit (> 70s). Never slow down.
        if duration > 70.0:
            adjusted_path = output_dir / "voice_adjusted.wav"
            new_duration = _speed_up_audio(generated_path, adjusted_path, max_duration=68.0)
            if new_duration > 0 and adjusted_path.exists():
                final_path = adjusted_path
                duration = new_duration
                warnings.append(f"audio_speed_up_applied from={duration:.1f}s to=68s")
                logger.warn("audio", f"audio too long ({duration:.1f}s), sped up to {new_duration:.1f}s")
        elif duration < 15.0:
            warnings.append(f"audio_very_short duration={duration:.2f}s")
            logger.warn("audio", f"audio is very short ({duration:.2f}s) but using as-is — do not slow down")
        else:
            logger.info("audio", f"audio duration {duration:.2f}s is acceptable, using as-is")

        return AudioStageResult(path=str(final_path), duration=round(duration, 2), warnings=warnings)

    except Exception as exc:
        warnings.append(f"audio_error:{str(exc)[:180]}")
        logger.warn("audio", f"audio generation failed; using silent fallback ({str(exc)[:120]})")
        silent = create_silent_audio(output_dir / "voice_silent.wav", duration_seconds=target_duration)
        if silent is None:
            warnings.append("audio_silent_fallback_failed")
            return AudioStageResult(path="", duration=0.0, warnings=warnings)
        warnings.append("audio_silent_fallback")
        return AudioStageResult(path=str(silent), duration=round(float(target_duration), 2), warnings=warnings)