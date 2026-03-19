import os
import logging
import requests
from typing import Callable, Any

LOGGER = logging.getLogger(__name__)

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

    for i, key in enumerate(keys):
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
            if "429" in error_str or "quota" in error_str or "rate" in error_str or "503" in error_str or "403" in error_str:
                LOGGER.info(f"Switching to next Gemini API key due to rate limit/quota error...")
                continue

            # For 400 Bad Request, it's likely a prompt issue, so still switch just in case
            # (or some keys might have different safety settings)
            LOGGER.info(f"Switching to next Gemini API key after error...")
            continue

    # If all keys failed
    raise RuntimeError(f"All {len(keys)} Gemini API keys failed. Last error: {last_error}") from last_error
