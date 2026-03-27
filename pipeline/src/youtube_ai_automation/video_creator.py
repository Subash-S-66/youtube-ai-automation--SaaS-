from __future__ import annotations

from pathlib import Path
import re
from typing import Iterable


def _format_srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    hours = ms // 3_600_000
    ms %= 3_600_000
    minutes = ms // 60_000
    ms %= 60_000
    secs = ms // 1000
    ms %= 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _format_ass_time(seconds: float) -> str:
    cs = int(round(seconds * 100))
    hours = cs // 360_000
    cs %= 360_000
    minutes = cs // 6_000
    cs %= 6_000
    secs = cs // 100
    cs %= 100
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{cs:02d}"


def _chunk_words(words: list[str], chunk_size: int) -> list[list[str]]:
    return [words[i: i + chunk_size] for i in range(0, len(words), chunk_size)]


def _split_caption_units(script: str, max_words: int, line_mode: bool) -> list[list[str]]:
    words = script.split()
    if not words:
        return []

    if not line_mode:
        return _chunk_words(words, max_words)

    raw_lines = [" ".join(line.split()).strip() for line in str(script).splitlines() if line.strip()]
    if len(raw_lines) <= 1:
        raw_lines = [item.strip() for item in re.split(r"(?<=[.!?])\s+", " ".join(words)) if item.strip()]

    chunks: list[list[str]] = []
    for line in raw_lines:
        line_words = line.split()
        if not line_words:
            continue
        chunks.append(line_words)
    return chunks


def _normalize_token(token: str) -> str:
    return re.sub(r"[^a-z0-9]", "", token.lower())


def _inject_highlight_ass(text: str, highlight_words: set[str]) -> str:
    if not highlight_words:
        return text.upper()
    lines = text.split(r"\N")
    out_lines: list[str] = []
    for line in lines:
        out_tokens: list[str] = []
        for token in line.split():
            base = _normalize_token(token)
            token_upper = token.upper()
            if base and base in highlight_words:
                out_tokens.append(r"{\c&H00CCFF&\b1}" + token_upper + r"{\rCaption}")
            else:
                out_tokens.append(token_upper)
        out_lines.append(" ".join(out_tokens))
    return r"\N".join(out_lines)


def _wrap_caption_text(text: str, max_words_per_line: int) -> str:
    if max_words_per_line <= 0:
        return text
    words = text.split()
    if not words:
        return text
    lines = []
    for i in range(0, len(words), max_words_per_line):
        lines.append(" ".join(words[i:i + max_words_per_line]))
    return r"\N".join(lines)


def _hex_to_ass_color(hex_color: str) -> str:
    """Convert #RRGGBB to ASS &H00BBGGRR format."""
    h = str(hex_color or "").strip().lstrip("#")
    if len(h) == 6:
        r, g, b = h[0:2], h[2:4], h[4:6]
        return f"&H00{b}{g}{r}&"
    return "&H00FFFFFF&"


def _build_ass_header(font_name: str = "Anton", hex_color: str = "#FFFFFF") -> str:
    ass_color = _hex_to_ass_color(hex_color)
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
        "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"Style: Caption,{font_name},52,{ass_color},&H0000FFFF,"
        "&H00000000,&HC0000000,1,0,0,0,100,100,0.5,0,1,2.5,1,2,100,100,520,1\n\n"
        "[Events]\n"
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )


def _allocate_caption_durations(
    chunks: list[list[str]],
    total_words: int,
    estimated_duration_seconds: float,
    line_mode: bool,
) -> list[float]:
    if not chunks or estimated_duration_seconds <= 0 or total_words <= 0:
        return []
    if not line_mode:
        return [estimated_duration_seconds * (len(chunk) / total_words) for chunk in chunks]
    weights = [max(1, len(chunk)) for chunk in chunks]
    total_weight = sum(weights)
    allocations = [estimated_duration_seconds * (weight / total_weight) for weight in weights]
    drift = estimated_duration_seconds - sum(allocations)
    if allocations:
        allocations[-1] += drift
    return allocations


def create_subtitles_from_script(
    script: str,
    estimated_duration_seconds: float,
    subtitle_path: Path,
    max_words: int = 4,
    highlight_words: Iterable[str] | None = None,
    line_mode: bool = True,
    font_style: str = "Anton",
    subtitle_color: str = "#FFFFFF",
) -> Path:
    words = script.split()
    if not words:
        raise ValueError("Script is empty. Cannot create subtitles.")

    duration = max(0.1, float(estimated_duration_seconds))
    chunks = _split_caption_units(script=script, max_words=max_words, line_mode=line_mode)
    total_words = len(words)
    normalized_highlight = {_normalize_token(item) for item in (highlight_words or []) if item}

    subtitle_path.parent.mkdir(parents=True, exist_ok=True)

    if subtitle_path.suffix.lower() == ".srt":
        lines: list[str] = []
        current = 0.0
        durations = _allocate_caption_durations(chunks, total_words, duration, line_mode)
        for idx, (chunk, chunk_duration) in enumerate(zip(chunks, durations, strict=True), start=1):
            start = current
            end = min(duration, current + chunk_duration)
            current = end
            lines.append(str(idx))
            lines.append(f"{_format_srt_time(start)} --> {_format_srt_time(end)}")
            lines.append(" ".join(chunk))
            lines.append("")
        subtitle_path.write_text("\n".join(lines), encoding="utf-8")
        return subtitle_path

    lines = [_build_ass_header(font_name=font_style, hex_color=subtitle_color)]
    current = 0.0
    durations = _allocate_caption_durations(chunks, total_words, duration, line_mode)
    for chunk, chunk_duration in zip(chunks, durations, strict=True):
        start = current
        end = min(duration, current + chunk_duration)
        current = end
        text = " ".join(chunk)
        text = _wrap_caption_text(text, max_words)
        text = _inject_highlight_ass(text, normalized_highlight)
        text = text.replace("\n", " ")
        fade_ms = min(150, int(chunk_duration * 100))
        anim_prefix = r"{\fad(" + str(fade_ms) + r",80)\an2}"
        lines.append(
            f"Dialogue: 0,{_format_ass_time(start)},{_format_ass_time(end)},Caption,,0,0,0,,{anim_prefix}{text}"
        )

    subtitle_path.write_text("\n".join(lines), encoding="utf-8")
    return subtitle_path
