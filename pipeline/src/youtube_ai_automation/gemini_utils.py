import os
import logging
import requests
import time
from typing import Callable, Any

LOGGER = logging.getLogger(__name__)
_KEY_COOLDOWNS: dict[str, float] = {}
_KEY_COOLDOWN_SECONDS = 60


def _is_rate_limited_429(error: Exception) -> bool:
    # FIXED: Detect 429 in both HTTPError responses and generic exception text.
    if isinstance(error, requests.exceptions.HTTPError) and error.response is not None:
        if error.response.status_code == 429:
            return True
    return "429" in str(error).lower()

def get_gemini_api_keys() -> list[str]:
    """
    Parse GEMINI_API_KEYS from the environment as a comma-separated list.
    Fallback to GEMINI_API_KEY if the former is not provided.
    """
    keys_str = os.getenv("GEMINI_API_KEYS")
    if keys_str:
        # Split by comma and remove empty strings
        keys = [k.strip() for k in keys_str.split(",") if k.strip()]
        if keys:
            return keys

    # Fallback to single key if available
    single_key = os.getenv("GEMINI_API_KEY")
    if single_key:
        return [single_key.strip()]

    return []

def execute_with_gemini_fallback(operation: Callable[[str], Any]) -> Any:
    """
    Execute a Gemini operation using multiple API keys with a fallback mechanism.
    The operation should be a callable that takes an API key as its only argument.
    It should raise an exception on failure (e.g. requests.exceptions.HTTPError).
    """
    keys = get_gemini_api_keys()

    if not keys:
        raise ValueError("No Gemini API keys found. Please set GEMINI_API_KEYS or GEMINI_API_KEY.")

    last_error = None
    attempted_any_key = False

    for i, key in enumerate(keys):
        now = time.time()
        cooldown_until = _KEY_COOLDOWNS.get(key, 0)
        if cooldown_until > now:
            remaining = int(cooldown_until - now)
            masked_key = f"{key[:4]}...{key[-4:]}" if len(key) > 8 else "***"
            LOGGER.info(f"Skipping Gemini key {i} ({masked_key}) on cooldown for {remaining}s")
            continue

        attempted_any_key = True
        masked_key = f"{key[:4]}...{key[-4:]}" if len(key) > 8 else "***"
        if i > 0:
            LOGGER.info(f"Trying Gemini fallback key {i} ({masked_key})")

        try:
            return operation(key)
        except Exception as e:
            last_error = e
            error_str = str(e).lower()

            # Switch keys on quota/rate limits, or generic API failures
            LOGGER.warning(f"Gemini key {i} ({masked_key}) failed: {e}")
            if _is_rate_limited_429(e):
                _KEY_COOLDOWNS[key] = time.time() + _KEY_COOLDOWN_SECONDS  # FIXED: Cool down rate-limited keys for 60s.
                LOGGER.info("Switching to next Gemini API key due to 429 rate limit and cooldown...")
                continue
            if "quota" in error_str or "rate" in error_str or "503" in error_str or "403" in error_str:
                LOGGER.info(f"Switching to next Gemini API key due to rate limit/quota error...")
                continue

            # For 400 Bad Request, it's likely a prompt issue, so still switch just in case
            # (or some keys might have different safety settings)
            LOGGER.info(f"Switching to next Gemini API key after error...")
            continue

    # If all keys were skipped due to cooldown
    if not attempted_any_key:
        raise RuntimeError("All Gemini API keys are temporarily on cooldown. Please retry shortly.")

    # If all attempted keys failed
    raise RuntimeError(f"All {len(keys)} Gemini API keys failed. Last error: {last_error}") from last_error
