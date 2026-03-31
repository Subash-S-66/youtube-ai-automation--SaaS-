from __future__ import annotations

import asyncio
import base64
import logging
import os
from pathlib import Path
import random
import re
import shutil
import subprocess
import tempfile
import wave

from .gemini_utils import get_gemini_api_keys

LOGGER = logging.getLogger(__name__)

DEFAULT_GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Puck")
GEMINI_VOICE_OPTIONS = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"]
GEMINI_AUDIO_MODEL = os.getenv("GEMINI_AUDIO_MODEL", "gemini-2.5-flash-native-audio-latest").strip()
GEMINI_AUDIO_MODELS = [GEMINI_AUDIO_MODEL]


def pick_voice_profile(voice: str = "", rate: str = "") -> tuple[str, str]:
    clean = voice.strip()
    if clean and clean in GEMINI_VOICE_OPTIONS:
        return clean, ""
    return random.choice(GEMINI_VOICE_OPTIONS), ""


def _validate_audio_file(path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"Audio file missing: {path}")
    duration = get_audio_duration_seconds(path)
    if duration < 1.0:
        raise RuntimeError("Invalid audio output")


def _split_script_chunks(script: str, max_chars: int = 700) -> list[str]:
    text = " ".join(str(script or "").split()).strip()
    if not text:
        return []
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if not sentences:
        return [text]
    chunks: list[str] = []
    buf = ""
    for sentence in sentences:
        candidate = sentence if not buf else f"{buf} {sentence}"
        if len(candidate) <= max_chars:
            buf = candidate
            continue
        if buf:
            chunks.append(buf.strip())
        buf = sentence
    if buf:
        chunks.append(buf.strip())
    return chunks


def _concat_wav_files(inputs: list[Path], output_path: Path) -> Path:
    if not inputs:
        raise RuntimeError("No audio chunks to merge.")
    params = None
    frames: list[bytes] = []
    for path in inputs:
        with wave.open(str(path), "rb") as wf:
            this_params = (wf.getnchannels(), wf.getsampwidth(), wf.getframerate())
            if params is None:
                params = this_params
            elif params != this_params:
                raise RuntimeError(f"Incompatible audio chunk format for {path}")
            frames.append(wf.readframes(wf.getnframes()))
    if not params:
        raise RuntimeError("Unable to read audio chunk params.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as wf_out:
        wf_out.setnchannels(params[0])
        wf_out.setsampwidth(params[1])
        wf_out.setframerate(params[2])
        for chunk_frames in frames:
            wf_out.writeframes(chunk_frames)
    _validate_audio_file(output_path)
    return output_path


def _ensure_wav_container(path: Path) -> None:
    """
    Gemini audio responses may arrive as raw PCM bytes.
    If the file is not a WAV container, wrap bytes as PCM16 mono @24kHz WAV.
    """
    try:
        with wave.open(str(path), "rb") as wf:
            if wf.getnframes() > 0 and wf.getframerate() > 0:
                return
    except Exception:
        pass

    raw = path.read_bytes()
    if not raw:
        raise RuntimeError(f"Audio file is empty: {path}")

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # PCM16
        wf.setframerate(24000)
        wf.writeframes(raw)


def get_audio_duration_seconds(audio_path: Path) -> float:
    try:
        with wave.open(str(audio_path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                return 0.0
            return frames / float(rate)
    except Exception:
        return 0.0


def _count_words(text: str) -> int:
    return len(str(text or "").split())  # FIXED: Reusable word counting for script budget enforcement.


def _build_atempo_chain(factor: float) -> str:
    value = max(0.25, min(4.0, float(factor)))  # FIXED: Clamp atempo factor to stable range before chain decomposition.
    parts: list[float] = []
    while value < 0.5:
        parts.append(0.5)  # FIXED: Build chained atempo filters for factors below ffmpeg lower bound.
        value /= 0.5
    while value > 2.0:
        parts.append(2.0)  # FIXED: Build chained atempo filters for factors above ffmpeg upper bound.
        value /= 2.0
    parts.append(value)
    return ",".join(f"atempo={p:.6f}" for p in parts)


def _speed_up_audio_to_target(input_path: Path, output_path: Path, target_seconds: float) -> tuple[Path, float]:
    current_seconds = get_audio_duration_seconds(input_path)
    if current_seconds <= 0 or target_seconds <= 0:
        return input_path, current_seconds
    if current_seconds <= target_seconds:
        return input_path, current_seconds  # FIXED: Never slow audio down when already at/below target duration.

    speed_factor = current_seconds / float(target_seconds)  # FIXED: Compute playback speed required to land exactly on target duration.
    filter_chain = _build_atempo_chain(speed_factor)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-filter:a",
            filter_chain,
            "-acodec",
            "pcm_s16le",
            str(output_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0 or not output_path.exists():
        raise RuntimeError(f"audio_speed_up_failed: {(proc.stderr or '')[-240:]}")
    return output_path, get_audio_duration_seconds(output_path)


def _expand_script_with_sentences(script: str, sentence_count: int = 2) -> str:
    additions = [
        "This shift is already visible in real systems operating at massive scale.",
        "Teams applying this approach consistently are reporting measurable gains week after week.",
    ]
    expanded = str(script or "").strip()
    for idx in range(max(1, min(2, int(sentence_count)))):
        expanded = f"{expanded} {additions[idx % len(additions)]}".strip()  # FIXED: Expand short scripts by adding 1-2 factual narration sentences.
    return expanded


def _normalize_script_word_window(script: str, min_words: int | None, hard_cap_words: int | None) -> str:
    normalized = " ".join(str(script or "").split()).strip()
    if hard_cap_words is not None and hard_cap_words > 0 and _count_words(normalized) > hard_cap_words:
        normalized = " ".join(normalized.split()[: int(hard_cap_words)]).strip()  # FIXED: Enforce hard word cap before TTS.
    if min_words is not None and min_words > 0:
        safety = 0
        while _count_words(normalized) < min_words and safety < 6:
            normalized = _expand_script_with_sentences(normalized, sentence_count=2)  # FIXED: Enforce minimum word floor before TTS.
            if hard_cap_words is not None and hard_cap_words > 0 and _count_words(normalized) > hard_cap_words:
                normalized = " ".join(normalized.split()[: int(hard_cap_words)]).strip()  # FIXED: Keep expanded script within hard cap.
            safety += 1
    return normalized


def generate_voice_with_duration_control(
    *,
    script: str,
    voice: str,
    output_path: Path,
    target_seconds: float,
    min_seconds: float,
    rate: str = "",
    min_words: int | None = None,
    hard_cap_words: int | None = None,
    max_expand_retries: int = 2,
) -> tuple[Path, float, str, str, int]:
    """Generate narration with bounded duration control for Shorts.

    Returns: (audio_path, duration_seconds, final_script, action, expansion_retries)
    """
    retries = 0
    current_script = _normalize_script_word_window(script, min_words=min_words, hard_cap_words=hard_cap_words)

    while True:
        attempt_audio_path = output_path.parent / f"{output_path.stem}_attempt_{retries + 1}.wav"
        generated_path, _ = generate_voice(
            script=current_script,
            voice=voice,
            output_path=attempt_audio_path,
            rate=rate,
            rotate_profile=False,
        )
        actual_seconds = get_audio_duration_seconds(generated_path)

        if actual_seconds > float(target_seconds):
            sped_path = output_path.parent / f"{output_path.stem}_speed.wav"
            adjusted_path, adjusted_seconds = _speed_up_audio_to_target(
                input_path=generated_path,
                output_path=sped_path,
                target_seconds=float(target_seconds),
            )
            shutil.copy2(adjusted_path, output_path)  # FIXED: Publish normalized audio at canonical output path.
            LOGGER.info("[DURATION_CHECK] target=%ss actual=%.2fs action=speed_up", int(round(target_seconds)), adjusted_seconds)  # FIXED: Required duration action log for speed-up path.
            return output_path, adjusted_seconds, current_script, "speed_up", retries

        if actual_seconds < float(min_seconds) and retries < int(max_expand_retries):
            LOGGER.info("[DURATION_CHECK] target=%ss actual=%.2fs action=expand", int(round(target_seconds)), actual_seconds)  # FIXED: Required duration action log for expansion retry path.
            current_script = _expand_script_with_sentences(current_script, sentence_count=2)
            current_script = _normalize_script_word_window(current_script, min_words=min_words, hard_cap_words=hard_cap_words)
            retries += 1
            continue

        shutil.copy2(generated_path, output_path)  # FIXED: Keep original-speed narration when within target window.
        LOGGER.info("[DURATION_CHECK] target=%ss actual=%.2fs action=ok", int(round(target_seconds)), actual_seconds)  # FIXED: Required duration action log for in-window audio.
        return output_path, actual_seconds, current_script, "ok", retries


def _uses_live_native_audio(model_name: str) -> bool:
    low = model_name.lower()
    return "native-audio" in low or "dialog" in low


def _resolve_gemini_voice(voice: str) -> str:
    clean = (voice or "").strip()
    if clean in GEMINI_VOICE_OPTIONS:
        return clean
    return DEFAULT_GEMINI_VOICE if DEFAULT_GEMINI_VOICE in GEMINI_VOICE_OPTIONS else random.choice(GEMINI_VOICE_OPTIONS)


def _build_verbatim_narration_prompt(script: str) -> str:
    normalized_script = " ".join(str(script or "").split()).strip()
    return (
        "You are a text-to-speech narrator. "
        "Speak only the text inside <narration> tags exactly as written. "
        "Do not answer, explain, paraphrase, summarize, or add any words.\n"
        f"<narration>{normalized_script}</narration>"
    )


async def _save_gemini_voice_live_async(
    *,
    script: str,
    gemini_voice: str,
    output_path: Path,
    model_name: str,
    api_key: str,
) -> Path:
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:
        raise RuntimeError(
            "google-genai package is required for Gemini Live native audio models. "
            "Install dependency: pip install google-genai"
        ) from exc

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=gemini_voice)
            )
        ),
    )

    chunks: list[bytes] = []
    narration_prompt = _build_verbatim_narration_prompt(script)
    async with client.aio.live.connect(model=model_name, config=config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=narration_prompt)],
            ),
            turn_complete=True,
        )

        async for response in session.receive():
            server_content = getattr(response, "server_content", None)
            if not server_content:
                # Log non-content responses for debugging (e.g. setup, turn_complete)
                LOGGER.debug("Gemini Live received response without server_content: %s", response)
                continue

            model_turn = getattr(server_content, "model_turn", None)
            if model_turn:
                parts = getattr(model_turn, "parts", []) or []
                for part in parts:
                    inline = getattr(part, "inline_data", None)
                    if not inline:
                        continue
                    data = getattr(inline, "data", None)
                    if not data:
                        continue
                    if isinstance(data, str):
                        chunks.append(base64.b64decode(data))
                    else:
                        chunks.append(bytes(data))

            if getattr(server_content, "turn_complete", False):
                LOGGER.debug("Gemini Live turn complete. Received %d audio chunks.", len(chunks))
                break

    if not chunks:
        raise RuntimeError("Gemini Live API returned no audio chunks.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as fh:
        fh.write(b"".join(chunks))
    _ensure_wav_container(output_path)
    _validate_audio_file(output_path)
    return output_path


def _save_gemini_voice_sync(script: str, voice: str, output_path: Path) -> Path:
    gemini_voice = _resolve_gemini_voice(voice)

    errors: list[str] = []
    for model_name in GEMINI_AUDIO_MODELS:
        try:
            if not _uses_live_native_audio(model_name):
                raise RuntimeError(
                    f"Invalid audio model '{model_name}'. "
                    "Audio is restricted to Gemini native-audio dialog models only."
                )
            keys = get_gemini_api_keys()
            if not keys:
                raise RuntimeError("No Gemini API keys found for Live API call.")
            last_error: Exception | None = None
            for key in keys:
                try:
                    output = asyncio.run(
                        _save_gemini_voice_live_async(
                            script=script,
                            gemini_voice=gemini_voice,
                            output_path=output_path,
                            model_name=model_name,
                            api_key=key,
                        )
                    )
                    _validate_audio_file(output)
                    return output
                except Exception as exc:
                    last_error = exc
                    continue
            raise RuntimeError(f"All Gemini Live keys failed. Last error: {last_error}")

        except Exception as exc:
            errors.append(f"{model_name}: {str(exc)[:180]}")
            continue

    raise RuntimeError("All configured Gemini audio models failed: " + " | ".join(errors))


def generate_voice(
    script: str,
    voice: str,
    output_path: Path,
    rate: str = "",
    rotate_profile: bool = True,
) -> tuple[Path, bool]:
    clean_script = " ".join(str(script or "").split()).strip()
    if not clean_script:
        raise RuntimeError("Script is empty after sanitization, unable to generate voice.")

    selected_voice = _resolve_gemini_voice(voice)
    # Long scripts can be truncated by a single TTS call; synthesize in chunks and stitch.
    chunks = _split_script_chunks(clean_script, max_chars=700)
    if len(chunks) <= 1:
        audio_path = _save_gemini_voice_sync(clean_script, selected_voice, output_path)
        _validate_audio_file(audio_path)
        return audio_path, True

    with tempfile.TemporaryDirectory(prefix="tts_chunks_", dir=str(output_path.parent)) as tmpdir:
        tmp = Path(tmpdir)
        chunk_paths: list[Path] = []
        for idx, chunk_text in enumerate(chunks, start=1):
            part_path = tmp / f"chunk_{idx:03d}.wav"
            chunk_audio = _save_gemini_voice_sync(chunk_text, selected_voice, part_path)
            _validate_audio_file(chunk_audio)
            chunk_paths.append(chunk_audio)
        merged = _concat_wav_files(chunk_paths, output_path)
        return merged, True
