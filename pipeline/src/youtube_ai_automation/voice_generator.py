from __future__ import annotations

import asyncio
import base64
import logging
import os
from pathlib import Path
import random

import requests

from .gemini_utils import execute_with_gemini_fallback
from .gemini_utils import get_gemini_api_keys

LOGGER = logging.getLogger(__name__)

DEFAULT_GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Puck")
GEMINI_VOICE_OPTIONS = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"]
GEMINI_AUDIO_MODEL = os.getenv("GEMINI_AUDIO_MODEL", "gemini-2.5-flash-preview-tts").strip()
GEMINI_AUDIO_MODELS = [
    item.strip()
    for item in os.getenv(
        "GEMINI_AUDIO_MODELS",
        f"{GEMINI_AUDIO_MODEL},gemini-2.5-flash-preview-tts,gemini-2.5-flash",
    ).split(",")
    if item.strip()
]


def pick_voice_profile(voice: str = "", rate: str = "") -> tuple[str, str]:
    clean = voice.strip()
    if clean and clean in GEMINI_VOICE_OPTIONS:
        return clean, ""
    return random.choice(GEMINI_VOICE_OPTIONS), ""


def _validate_audio_file(path: Path) -> None:
    if not path.exists() or path.stat().st_size < 500:
        raise RuntimeError(f"Audio file missing or too small: {path}")


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
    _validate_audio_file(output_path)
    return output_path


def _save_gemini_voice_sync(script: str, voice: str, output_path: Path) -> Path:
    gemini_voice = _resolve_gemini_voice(voice)
    payload = {
        "contents": [{"parts": [{"text": script}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": gemini_voice
                    }
                }
            }
        }
    }

    errors: list[str] = []
    for model_name in GEMINI_AUDIO_MODELS:
        try:
            if _uses_live_native_audio(model_name):
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

            gemini_tts_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"

            def operation(key: str) -> requests.Response:
                response = requests.post(
                    gemini_tts_url,
                    params={"key": key},
                    json=payload,
                    timeout=60
                )
                response.raise_for_status()
                return response

            response = execute_with_gemini_fallback(operation)
            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise RuntimeError("No candidates returned from Gemini")

            parts = candidates[0].get("content", {}).get("parts", [])
            audio_part = None
            for part in parts:
                inline = part.get("inlineData", {})
                if inline.get("mimeType", "").startswith("audio/"):
                    audio_part = inline.get("data")
                    break

            if not audio_part:
                raise RuntimeError("No audio data found in Gemini response")

            audio_bytes = base64.b64decode(audio_part)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as file_handle:
                file_handle.write(audio_bytes)
            _validate_audio_file(output_path)
            return output_path
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
