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
    value = max(0.25, min(4.0, float(factor)))
    parts: list[float] = []
    while value < 0.5:
        parts.append(0.5)
        value /= 0.5
    while value > 2.0:
        parts.append(2.0)
        value /= 2.0
    parts.append(value)
    return ",".join(f"atempo={p:.6f}" for p in parts)


def _speed_adjust(input_path: Path, output_path: Path, target_seconds: float) -> float:
    current = _audio_duration_seconds(input_path)
    if current <= 0 or target_seconds <= 0:
        return current
    factor = current / float(target_seconds)
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
        raise RuntimeError(f"audio_speed_adjust_failed:{(proc.stderr or '')[-200:]}")
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
        logger.info("audio", f"generated once duration={duration:.2f}s")
        if duration < 50.0 or duration > 70.0:
            adjusted_target = max(50.0, min(70.0, float(target_duration)))
            adjusted_path = output_dir / "voice_adjusted.wav"
            duration = _speed_adjust(generated_path, adjusted_path, adjusted_target)
            final_path = adjusted_path
            warnings.append("audio_speed_adjusted_once")
            logger.warn("audio", f"duration out-of-window; speed-adjusted once to {duration:.2f}s")
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

