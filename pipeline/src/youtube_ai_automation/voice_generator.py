from __future__ import annotations

import asyncio
import base64
import logging
import os
from pathlib import Path
import random
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


def _uses_live_native_audio(model_name: str) -> bool:
    low = model_name.lower()
    return "native-audio" in low or "dialog" in low


def _resolve_gemini_voice(voice: str) -> str:
    clean = (voice or "").strip()
    if clean in GEMINI_VOICE_OPTIONS:
        return clean
    return DEFAULT_GEMINI_VOICE if DEFAULT_GEMINI_VOICE in GEMINI_VOICE_OPTIONS else random.choice(GEMINI_VOICE_OPTIONS)


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
    async with client.aio.live.connect(model=model_name, config=config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=script)],
            ),
            turn_complete=True,
        )

        async for response in session.receive():
            server_content = getattr(response, "server_content", None)
            if not server_content:
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
    audio_path = _save_gemini_voice_sync(clean_script, selected_voice, output_path)
    _validate_audio_file(audio_path)
    return audio_path, True
