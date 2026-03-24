"""
Convert text to speech using Edge TTS only.
Falls back to silent audio as last resort.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
import random
import re
import subprocess

import base64
import requests

try:
    import edge_tts
except Exception:  # pragma: no cover - optional dependency behavior
    edge_tts = None

LOGGER = logging.getLogger(__name__)

# Gemini Audio API constants
GEMINI_TTS_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

ROTATION_VOICES = [
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-DavisNeural",
    "en-US-AriaNeural",
    "en-US-JasonNeural",
    "en-US-SaraNeural",
    "en-US-TonyNeural",
    "en-US-NancyNeural",
]
RATE_OPTIONS = ["+5%", "+7%", "+8%", "+10%", "+12%", "+14%"]

# Edge TTS can silently fail on long texts. Split at this threshold.
_EDGE_TTS_CHUNK_LIMIT = 280

# Support for proxy configuration
EDGE_TTS_PROXY = os.getenv("EDGE_TTS_PROXY", "")  # e.g., "http://proxy:8080"
_EDGE_TTS_DISABLED_REASON = ""
EDGE_TTS_SINGLE_CHUNK_RETRIES = int(os.getenv("EDGE_TTS_SINGLE_CHUNK_RETRIES", "4"))
EDGE_TTS_MULTI_CHUNK_RETRIES = int(os.getenv("EDGE_TTS_MULTI_CHUNK_RETRIES", "4"))
EDGE_TTS_SINGLE_RETRY_DELAY_SECONDS = float(os.getenv("EDGE_TTS_SINGLE_RETRY_DELAY_SECONDS", "5"))
EDGE_TTS_CHUNK_RETRY_DELAY_SECONDS = float(os.getenv("EDGE_TTS_CHUNK_RETRY_DELAY_SECONDS", "4"))
EDGE_TTS_VOICE_SWITCH_DELAY_SECONDS = float(os.getenv("EDGE_TTS_VOICE_SWITCH_DELAY_SECONDS", "6"))
EDGE_TTS_INTER_CHUNK_DELAY_SECONDS = float(os.getenv("EDGE_TTS_INTER_CHUNK_DELAY_SECONDS", "1.2"))


def _probe_media_duration(output_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(output_path),
    ]
    try:
        import subprocess
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return float(result.stdout.strip())
    except Exception:
        return 0.0

def _is_nonrecoverable_edge_error(message: str) -> bool:
    """
    Detect Edge TTS failures that are unlikely to recover by retrying voices/chunks.
    """
    low = str(message).lower()
    patterns = (
        "cannot connect to host",
        "access is denied",
        "clientconnectorerror",
        "proxy",
        "403",
        "401",
        "forbidden",
    )
    return any(pattern in low for pattern in patterns)


def _sanitize_tts_text(text: str) -> str:
    """
    Clean script text for TTS engines.

    Strips non-ASCII characters, normalizes whitespace, and removes
    symbols that can cause Edge TTS to silently return no audio.
    """
    # Replace common unicode quotes/dashes with ASCII equivalents
    replacements = {
        "\u2018": "'", "\u2019": "'",   # smart single quotes
        "\u201c": '"', "\u201d": '"',   # smart double quotes
        "\u2013": "-", "\u2014": "-",   # en/em dash
        "\u2026": "...",                 # ellipsis
        "\u00a0": " ",                   # non-breaking space
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    # Strip any remaining non-ASCII
    text = text.encode("ascii", errors="ignore").decode("ascii")

    # Collapse multiple whitespace but preserve newlines
    lines = text.splitlines()
    cleaned_lines = [" ".join(line.split()) for line in lines]
    text = "\n".join(line for line in cleaned_lines if line.strip())

    return text.strip()


def pick_voice_profile(voice: str = "", rate: str = "") -> tuple[str, str]:
    """
    Choose a high-quality voice and slight speaking-rate variation.
    """
    pool = ROTATION_VOICES[:]
    clean_voice = " ".join(str(voice).split()).strip()
    if clean_voice and clean_voice not in pool:
        pool.append(clean_voice)
    selected_voice = random.choice(pool)
    selected_rate = " ".join(str(rate).split()).strip() or random.choice(RATE_OPTIONS)
    return selected_voice, selected_rate


def _split_into_chunks(text: str, limit: int) -> list[str]:
    """Split text at sentence boundaries so each chunk stays under *limit* chars."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                chunks.append(current)
            if len(sentence) > limit:
                # Split long sentence at commas/semicolons
                sub_parts = re.split(r"(?<=[,;:])\s+", sentence)
                for part in sub_parts:
                    if current and len(f"{current} {part}") <= limit:
                        current = f"{current} {part}"
                    else:
                        if current:
                            chunks.append(current)
                        current = part
            else:
                current = sentence
    if current:
        chunks.append(current)
    return chunks or [text]


def _concat_audio_files(parts: list[Path], output: Path) -> Path:
    """Concatenate multiple mp3 files into one using ffmpeg."""
    if len(parts) == 1:
        import shutil
        shutil.move(str(parts[0]), str(output))
        return output

    concat_list = output.parent / "tts_concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{p.as_posix()}'" for p in parts),
        encoding="utf-8",
    )
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(output),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)

    for p in parts:
        if p.exists() and p != output:
            p.unlink()
    if concat_list.exists():
        concat_list.unlink()
    return output


async def _save_voice_async(script: str, voice: str, rate: str, output_path: Path) -> Path:
    """Generate voice via Edge TTS, splitting long scripts into sentence chunks."""
    if edge_tts is None:
        raise RuntimeError("edge-tts is not installed.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    proxy = EDGE_TTS_PROXY if EDGE_TTS_PROXY else None

    chunks = _split_into_chunks(script, _EDGE_TTS_CHUNK_LIMIT)
    LOGGER.info("Edge TTS: script split into %d chunk(s) (%d chars total)", len(chunks), len(script))

    if len(chunks) == 1:
        # Short script - retry several times before switching voice.
        for attempt in range(max(1, EDGE_TTS_SINGLE_CHUNK_RETRIES)):
            try:
                communicator = edge_tts.Communicate(text=chunks[0], voice=voice, rate=rate, proxy=proxy)
                await communicator.save(str(output_path))
                if output_path.exists() and output_path.stat().st_size > 1000:
                    duration = _probe_media_duration(output_path)
                    if duration < 1.0: # Less than 1 second is suspicious for a whole chunk
                        raise RuntimeError(f"Generated audio too short: {duration}s")
                    return output_path
                raise RuntimeError("Empty or too-small audio file")
            except Exception as e:
                err = str(e)
                if _is_nonrecoverable_edge_error(err):
                    raise RuntimeError(err)
                if attempt < max(1, EDGE_TTS_SINGLE_CHUNK_RETRIES) - 1:
                    LOGGER.warning(
                        "Edge TTS single-chunk attempt %d/%d failed: %s. Retrying in %.1fs...",
                        attempt + 1,
                        max(1, EDGE_TTS_SINGLE_CHUNK_RETRIES),
                        err[:80],
                        EDGE_TTS_SINGLE_RETRY_DELAY_SECONDS,
                    )
                    await asyncio.sleep(max(0.0, EDGE_TTS_SINGLE_RETRY_DELAY_SECONDS))
                    continue
                raise
        return output_path

    # Multiple chunks - generate each separately, then concatenate
    tmp_dir = output_path.parent / "tts_chunks"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    part_files: list[Path] = []

    for idx, chunk in enumerate(chunks):
        part_path = tmp_dir / f"chunk_{idx:03d}.mp3"
        for attempt in range(max(1, EDGE_TTS_MULTI_CHUNK_RETRIES)):
            try:
                communicator = edge_tts.Communicate(text=chunk, voice=voice, rate=rate, proxy=proxy)
                await communicator.save(str(part_path))
                if part_path.exists() and part_path.stat().st_size > 500:
                    duration = _probe_media_duration(part_path)
                    if duration < 0.5:
                        raise RuntimeError(f"Generated chunk too short: {duration}s")
                    part_files.append(part_path)
                    break
                raise RuntimeError("Empty audio chunk")
            except Exception as e:
                err = str(e)
                if _is_nonrecoverable_edge_error(err):
                    LOGGER.warning("Edge TTS chunk %d/%d hard-failed: %s", idx + 1, len(chunks), err[:80])
                    for p in part_files:
                        if p.exists():
                            p.unlink()
                    raise RuntimeError(err)
                if attempt < max(1, EDGE_TTS_MULTI_CHUNK_RETRIES) - 1:
                    LOGGER.warning(
                        "Edge TTS chunk %d/%d attempt %d/%d failed: %s. Retrying in %.1fs...",
                        idx + 1,
                        len(chunks),
                        attempt + 1,
                        max(1, EDGE_TTS_MULTI_CHUNK_RETRIES),
                        err[:80],
                        EDGE_TTS_CHUNK_RETRY_DELAY_SECONDS,
                    )
                    await asyncio.sleep(max(0.0, EDGE_TTS_CHUNK_RETRY_DELAY_SECONDS))
                    continue
                LOGGER.warning("Edge TTS chunk %d/%d failed: %s", idx + 1, len(chunks), err[:80])
                for p in part_files:
                    if p.exists():
                        p.unlink()
                raise
        # Small pause between chunks to avoid rate limits
        if idx < len(chunks) - 1:
            await asyncio.sleep(max(0.0, EDGE_TTS_INTER_CHUNK_DELAY_SECONDS))

    if len(part_files) != len(chunks):
        for p in part_files:
            if p.exists():
                p.unlink()
        raise RuntimeError("Edge TTS chunk mismatch: missing audio chunks.")

    result = _concat_audio_files(part_files, output_path)

    # Cleanup temp dir
    if tmp_dir.exists():
        for leftover in tmp_dir.iterdir():
            leftover.unlink()
        tmp_dir.rmdir()

    return result



def _estimate_duration_seconds(script: str) -> float:
    words = max(1, len(str(script).split()))
    estimated = words / 2.4
    return max(10.0, min(45.0, estimated))


def _write_silent_audio(output_path: Path, duration_seconds: float) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=mono",
        "-t",
        f"{duration_seconds:.2f}",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "5",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def _map_edge_voice_to_gemini(edge_voice: str) -> str:
    """Map Edge TTS voice names to Gemini Native Audio voice names."""
    low = str(edge_voice).lower()
    # Gemini voices: Puck, Charon, Kore, Fenrir, Aoede
    if "guy" in low or "jason" in low or "tony" in low or "davis" in low:
        return random.choice(["Puck", "Charon", "Fenrir"])
    else:
        return random.choice(["Kore", "Aoede"])

from .gemini_utils import execute_with_gemini_fallback

def _save_gemini_voice_sync(script: str, voice: str, output_path: Path) -> Path:
    gemini_voice = _map_edge_voice_to_gemini(voice)

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

    def operation(key: str) -> requests.Response:
        LOGGER.info(f"Calling Gemini 2.5 Flash Native Audio (Voice: {gemini_voice})...")
        response = requests.post(
            GEMINI_TTS_URL,
            params={"key": key},
            json=payload,
            timeout=60
        )
        response.raise_for_status()
        return response

    response = execute_with_gemini_fallback(operation)
    data = response.json()

    try:
        # Extract base64 audio data from the response.
        # Note: The exact structure might vary slightly depending on the live Gemini 2.5 API response,
        # but typically it returns inlineData for media.
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError("No candidates returned from Gemini")

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            raise RuntimeError("No parts returned from Gemini")

        audio_part = None
        for p in parts:
            if "inlineData" in p and p["inlineData"].get("mimeType", "").startswith("audio/"):
                audio_part = p["inlineData"]["data"]
                break

        if not audio_part:
            raise RuntimeError("No audio data found in Gemini response")

        # Decode and save
        audio_bytes = base64.b64decode(audio_part)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(audio_bytes)

        return output_path
    except Exception as e:
        raise RuntimeError(f"Failed to parse Gemini audio response: {e}")

def generate_voice(
    script: str,
    voice: str,
    output_path: Path,
    rate: str = "",
    rotate_profile: bool = True,
) -> tuple[Path, bool]:
    """
    Generate voice audio from script text.

    Tries Gemini Audio first, then Edge TTS with multiple voice rotations.
    Raises RuntimeError if all attempts fail — never returns silent audio,
    as a muted video upload is worse than a visible pipeline failure.

    Returns:
        (audio_path, True) on success
    Raises:
        RuntimeError: if all voice generation attempts are exhausted
    """
    if rotate_profile:
        selected_voice, selected_rate = pick_voice_profile(voice=voice, rate=rate)
    else:
        selected_voice = " ".join(str(voice).split()).strip() or ROTATION_VOICES[0]
        selected_rate = " ".join(str(rate).split()).strip() or random.choice(RATE_OPTIONS)

    # Sanitize text to avoid invisible characters that break TTS
    clean_script = _sanitize_tts_text(script)
    if not clean_script:
        raise RuntimeError("Script is empty after sanitization, unable to generate voice.")

    edge_error = ""
    global _EDGE_TTS_DISABLED_REASON

    # --- Stage 1: Try Gemini Audio (Primary) ---
    try:
        LOGGER.info("Attempting primary voice generation via Gemini Audio...")
        audio_file = _save_gemini_voice_sync(clean_script, selected_voice, output_path)
        if audio_file.exists() and audio_file.stat().st_size > 1000:
            LOGGER.info(f"Successfully generated voice via Gemini Audio ({audio_file.stat().st_size} bytes)")
            return audio_file, True
    except Exception as gemini_err:
        LOGGER.warning(f"Gemini Audio failed, falling back to Edge TTS. Error: {gemini_err}")
        LOGGER.info(f"FALLBACK TRIGGERED: Using Edge TTS for voice generation instead of Gemini Audio.")

    # --- Stage 2: Try Edge TTS with multiple voices (Fallback) ---
    if _EDGE_TTS_DISABLED_REASON:
        LOGGER.warning("Skipping Edge TTS (disabled earlier in this run): %s", _EDGE_TTS_DISABLED_REASON)
        edge_error = _EDGE_TTS_DISABLED_REASON
    else:
        # Build a list of voices to try: selected first, then 2 random alternates
        voices_to_try = [selected_voice]
        alternates = [v for v in ROTATION_VOICES if v != selected_voice]
        random.shuffle(alternates)
        voices_to_try.extend(alternates[:2])

        for idx, try_voice in enumerate(voices_to_try):
            try:
                LOGGER.info(
                    "Edge TTS attempt %d/%d: %s at %s",
                    idx + 1, len(voices_to_try), try_voice, selected_rate,
                )
                audio_file = asyncio.run(
                    _save_voice_async(clean_script, try_voice, selected_rate, output_path)
                )
                file_size = audio_file.stat().st_size
                LOGGER.info(
                    "Voice generated (Edge TTS): %s at %s (%s bytes)",
                    try_voice, selected_rate, f"{file_size:,}",
                )
                return audio_file, True
            except Exception as edge_exc:
                edge_error = str(edge_exc)[:150]
                LOGGER.warning("Edge TTS voice %s failed: %s", try_voice, edge_error)
                if _is_nonrecoverable_edge_error(str(edge_exc)):
                    _EDGE_TTS_DISABLED_REASON = edge_error or "nonrecoverable Edge TTS failure"
                    LOGGER.warning(
                        "Disabling Edge TTS for remaining videos in this run: %s",
                        _EDGE_TTS_DISABLED_REASON,
                    )
                    break
                if idx < len(voices_to_try) - 1:
                    import time
                    time.sleep(max(0.0, EDGE_TTS_VOICE_SWITCH_DELAY_SECONDS))

    # --- Stage 3: Hard fail so we never skip narration ---
    raise RuntimeError(f"All voice generation attempts failed: {edge_error}")

