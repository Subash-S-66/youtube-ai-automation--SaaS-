"""
Download related stock images from Pexels or Pixabay.
"""

from pathlib import Path
from typing import List

import requests


def _download_file(url: str, out_file: Path) -> None:
    """Download a single file to disk."""
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    out_file.write_bytes(response.content)


def fetch_from_pexels(query: str, api_key: str, output_dir: Path, count: int = 6) -> List[Path]:
    """Fetch images from Pexels API."""
    if not api_key:
        raise ValueError("PEXELS_API_KEY is missing.")

    output_dir.mkdir(parents=True, exist_ok=True)
    endpoint = "https://api.pexels.com/v1/search"
    headers = {"Authorization": api_key}
    params = {"query": query, "per_page": count, "orientation": "portrait"}

    response = requests.get(endpoint, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    photos = data.get("photos", [])
    if not photos:
        raise RuntimeError(f"No images found on Pexels for query: {query}")

    files: List[Path] = []
    for i, photo in enumerate(photos, start=1):
        image_url = photo["src"]["large2x"]
        out_file = output_dir / f"image_{i:02d}.jpg"
        _download_file(image_url, out_file)
        files.append(out_file)
    return files


def fetch_from_pixabay(query: str, api_key: str, output_dir: Path, count: int = 6) -> List[Path]:
    """Fetch images from Pixabay API."""
    if not api_key:
        raise ValueError("PIXABAY_API_KEY is missing.")

    output_dir.mkdir(parents=True, exist_ok=True)
    endpoint = "https://pixabay.com/api/"
    params = {
        "key": api_key,
        "q": query,
        "image_type": "photo",
        "orientation": "vertical",
        "per_page": count,
    }

    response = requests.get(endpoint, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    hits = data.get("hits", [])
    if not hits:
        raise RuntimeError(f"No images found on Pixabay for query: {query}")

    files: List[Path] = []
    for i, hit in enumerate(hits, start=1):
        image_url = hit["largeImageURL"]
        out_file = output_dir / f"image_{i:02d}.jpg"
        _download_file(image_url, out_file)
        files.append(out_file)
    return files


def fetch_images(
    query: str,
    output_dir: Path,
    count: int = 6,
    pexels_key: str = "",
    pixabay_key: str = "",
) -> List[Path]:
    """
    Try Pexels first, then fallback to Pixabay.
    """
    if pexels_key:
        return fetch_from_pexels(query, pexels_key, output_dir, count=count)
    if pixabay_key:
        return fetch_from_pixabay(query, pixabay_key, output_dir, count=count)
    raise ValueError("No stock API key found. Set PEXELS_API_KEY or PIXABAY_API_KEY.")


