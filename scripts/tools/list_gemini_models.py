"""
List available Gemini models for the configured API key.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys

import requests

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency
    load_dotenv = None


def main() -> int:
    if load_dotenv:
        env_path = Path(__file__).resolve().parents[2] / "config" / ".env"
        if env_path.exists():
            load_dotenv(env_path)
        else:
            load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY is missing in the environment.")
        return 2

    try:
        response = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
            timeout=15,
        )
        response.raise_for_status()
    except Exception as exc:
        print(f"Failed to fetch models list: {exc}")
        return 1

    payload = response.json()
    models = []
    for item in payload.get("models", []):
        name = str(item.get("name", "")).strip()
        if name:
            if name.startswith("models/"):
                name = name[len("models/") :]
            models.append(name)

    if not models:
        print("No models returned by the API.")
        return 0

    print("Available Gemini models:")
    for model in sorted(set(models)):
        print(f"- {model}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
