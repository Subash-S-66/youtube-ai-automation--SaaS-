from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import random
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


def _resolve_caption_position(position: str) -> tuple[int, int, str]:
    normalized = str(position or "bottom").strip().lower()
    if normalized == "top":
        return 8, 120, r"\an8"
    if normalized == "middle":
        return 5, 0, r"\an5"
    return 2, 140, r"\an2"


def _resolve_caption_anchor(position: str) -> tuple[int, int]:
    normalized = str(position or "bottom").strip().lower()
    if normalized == "top":
        return 540, 220
    if normalized == "middle":
        return 540, 960
    return 540, 1680


def _normalize_caption_animation(animation: str) -> str:
    normalized = str(animation or "fade").strip().lower()
    aliases = {
        "fade": "fade",
        "fade_in_out": "fade",
        "shade": "fade",
        "shade_in_out": "fade",
        "slide_left": "slide_left",
        "slideleft": "slide_left",
        "left": "slide_left",
        "slide_right": "slide_right",
        "slideright": "slide_right",
        "right": "slide_right",
        "pop": "pop",
        "zoom": "pop",
        "zoom_pop": "pop",
        "none": "none",
        "static": "none",
        "off": "none",
    }
    return aliases.get(normalized, "fade")


def _build_caption_animation_override(caption_animation: str, chunk_duration: float, caption_position: str) -> str:
    mode = _normalize_caption_animation(caption_animation)
    fade_in_ms = max(80, min(260, int(chunk_duration * 220)))
    fade_out_ms = max(90, min(280, int(chunk_duration * 240)))

    if mode == "none":
        return ""

    if mode == "slide_left":
        end_x, anchor_y = _resolve_caption_anchor(caption_position)
        start_x = max(0, end_x - 220)
        return rf"\move({start_x},{anchor_y},{end_x},{anchor_y},0,{fade_in_ms})\fad(0,{fade_out_ms})"

    if mode == "slide_right":
        end_x, anchor_y = _resolve_caption_anchor(caption_position)
        start_x = min(1080, end_x + 220)
        return rf"\move({start_x},{anchor_y},{end_x},{anchor_y},0,{fade_in_ms})\fad(0,{fade_out_ms})"

    if mode == "pop":
        return rf"\fscx72\fscy72\t(0,{fade_in_ms},\fscx105\fscy105)\fad(0,{fade_out_ms})"

    return rf"\fad({fade_in_ms},{fade_out_ms})"


def _build_ass_header(font_name: str = "Anton", hex_color: str = "#FFFFFF", caption_position: str = "bottom") -> str:
    ass_color = _hex_to_ass_color(hex_color)
    alignment, margin_v, _ = _resolve_caption_position(caption_position)
    # Use requested font; if unavailable, libass will pick a system fallback.
    safe_font = font_name.strip() if font_name.strip() else "Liberation Sans"
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
        f"Style: Caption,{safe_font},58,{ass_color},&H0000FFFF,"
        f"&H00000000,&HC0000000,1,0,0,0,105,100,0.5,0,1,2.5,1,{alignment},100,100,{margin_v},1\n\n"
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
    caption_position: str = "bottom",
    caption_animation: str = "fade",
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

    _, _, alignment_tag = _resolve_caption_position(caption_position)
    lines = [_build_ass_header(font_name=font_style, hex_color=subtitle_color, caption_position=caption_position)]
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
        animation_directives = _build_caption_animation_override(
            caption_animation=caption_animation,
            chunk_duration=chunk_duration,
            caption_position=caption_position,
        )
        anim_prefix = "{" + alignment_tag + animation_directives + "}"
        lines.append(
            f"Dialogue: 0,{_format_ass_time(start)},{_format_ass_time(end)},Caption,,0,0,0,,{anim_prefix}{text}"
        )

    subtitle_path.write_text("\n".join(lines), encoding="utf-8")
    return subtitle_path


_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
_VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
DEFAULT_FFMPEG_COMMAND_TIMEOUT_SECONDS = 360.0
MIN_OVERRIDE_FFMPEG_TIMEOUT_SECONDS = 10.0


def _parse_positive_float_env(name: str, fallback: float, minimum: float) -> float:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return fallback
    try:
        parsed = float(raw)
    except Exception:
        return fallback
    if parsed <= 0:
        return fallback
    return max(minimum, parsed)


def _resolve_ffmpeg_timeout_seconds(override: float | None = None) -> float:
    if override is not None:
        try:
            return max(MIN_OVERRIDE_FFMPEG_TIMEOUT_SECONDS, float(override))
        except Exception:
            pass
    return _parse_positive_float_env(
        "FFMPEG_COMMAND_TIMEOUT_SECONDS",
        DEFAULT_FFMPEG_COMMAND_TIMEOUT_SECONDS,
        30.0,
    )


def _format_ffmpeg_process_error(args: list[str], proc: subprocess.CompletedProcess[str]) -> str:
    cmd_preview = " ".join(str(part) for part in args[:20])
    if len(args) > 20:
        cmd_preview += " ..."

    stderr_text = (proc.stderr or "").strip()
    stdout_text = (proc.stdout or "").strip()

    if stderr_text:
        if len(stderr_text) > 1600:
            err_excerpt = f"{stderr_text[:800]}\n...\n{stderr_text[-800:]}"
        else:
            err_excerpt = stderr_text
    else:
        err_excerpt = stdout_text[-400:] if stdout_text else "<no stderr/stdout output>"

    return f"ffmpeg failed (exit={proc.returncode}) cmd={cmd_preview} | {err_excerpt}"


def _prepare_ffmpeg_args(args: list[str]) -> list[str]:
    prepared = [str(part) for part in args]
    if not prepared:
        return prepared

    binary = Path(prepared[0]).name.lower()
    if binary in {"ffmpeg", "ffmpeg.exe"}:
        insert_at = 1
        if "-nostdin" not in prepared:
            prepared.insert(insert_at, "-nostdin")
            insert_at += 1
        if "-hide_banner" not in prepared:
            prepared.insert(insert_at, "-hide_banner")

        # Keep renders responsive on shared/low-CPU workers by default.
        if "-preset" not in prepared:
            for idx in range(len(prepared) - 1):
                if prepared[idx] == "-c:v" and str(prepared[idx + 1]).lower() == "libx264":
                    prepared.insert(idx + 2, "-preset")
                    prepared.insert(idx + 3, "veryfast")
                    break
    return prepared


def _run_ffmpeg(args: list[str], *, timeout_seconds: float | None = None) -> None:
    prepared_args = _prepare_ffmpeg_args(args)
    effective_timeout = _resolve_ffmpeg_timeout_seconds(timeout_seconds)

    # Diagnostic: check local-file -i arguments only (skip ffmpeg virtual/stream inputs).
    def _is_virtual_input(input_arg: str, arg_index: int) -> bool:
        raw = str(input_arg or "").strip().lower()
        if not raw:
            return True
        if raw in {"-", "pipe:0", "pipe:1", "pipe:2"}:
            return True
        if "://" in raw:
            return True
        if raw.startswith(("lavfi:", "concat:", "color=", "anullsrc", "testsrc", "sine=")):
            return True
        if (
            arg_index >= 2
            and prepared_args[arg_index - 2] == "-f"
            and str(prepared_args[arg_index - 1]).lower() == "lavfi"
        ):
            return True
        return False

    for i, arg in enumerate(prepared_args):
        if arg == "-i" and i + 1 < len(prepared_args):
            input_spec = str(prepared_args[i + 1])
            if _is_virtual_input(input_spec, i + 1):
                continue
            input_file = Path(input_spec)
            if not input_file.exists():
                raise RuntimeError(f"ffmpeg failed: Input file does not exist: {input_file}")
            if input_file.is_dir():
                raise RuntimeError(f"ffmpeg failed: Input path is a directory, not a file: {input_file}")

    try:
        proc = subprocess.run(
            prepared_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=effective_timeout,
        )
    except subprocess.TimeoutExpired as exc:
        cmd_preview = " ".join(str(part) for part in prepared_args[:20])
        if len(prepared_args) > 20:
            cmd_preview += " ..."
        stderr_excerpt = str((exc.stderr or exc.stdout or "")).strip()
        if len(stderr_excerpt) > 800:
            stderr_excerpt = f"{stderr_excerpt[:400]} ... {stderr_excerpt[-400:]}"
        raise RuntimeError(
            f"ffmpeg timed out after {int(effective_timeout)}s cmd={cmd_preview} | {stderr_excerpt or '<no output>'}"
        ) from exc

    if proc.returncode != 0:
        raise RuntimeError(_format_ffmpeg_process_error(prepared_args, proc))


def _probe_duration_seconds(path: Path) -> float:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
        )
        if proc.returncode != 0:
            return 0.0
        return float((proc.stdout or "").strip() or 0.0)
    except subprocess.TimeoutExpired:
        return 0.0
    except Exception:
        return 0.0


def _escape_subtitle_filter_path(path: Path) -> str:
    """
    Escape a filesystem path for ffmpeg filter syntax (NOT shell quoting).
    ffmpeg filter special chars: backslash, colon (drive letter only on Windows),
    brackets, commas, and single quotes within the value.
    """
    raw = str(path.resolve())
    raw = raw.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", raw):
        raw = raw[0] + r"\:" + raw[2:]
    raw = raw.replace("'", r"\'")
    raw = raw.replace("[", r"\[").replace("]", r"\]").replace(",", r"\,")
    return raw


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in _IMAGE_EXTS


def _is_video(path: Path) -> bool:
    return path.suffix.lower() in _VIDEO_EXTS


def _allocate_mixed_clip_durations(video_count: int, total_for_videos: float) -> list[float]:
    """
    Allocate per-clip durations with mixed values in [2, 8] seconds.
    """
    if video_count <= 0:
        return []
    base = [float(random.choice([2, 3, 4, 5, 6, 7, 8])) for _ in range(video_count)]
    base_sum = max(1.0, sum(base))
    scale = max(0.4, float(total_for_videos) / base_sum)
    scaled = [max(2.0, min(8.0, round(v * scale, 2))) for v in base]

    target = max(2.0 * video_count, float(total_for_videos))
    current = sum(scaled)
    idx = 0
    # Fine-tune to get closer to target while preserving 2..8 bounds.
    while abs(current - target) > 0.15 and idx < 400:
        i = idx % video_count
        if current < target and scaled[i] < 8.0:
            scaled[i] = round(min(8.0, scaled[i] + 0.1), 2)
            current += 0.1
        elif current > target and scaled[i] > 2.0:
            scaled[i] = round(max(2.0, scaled[i] - 0.1), 2)
            current -= 0.1
        idx += 1
    return scaled


def _burn_captions_drawtext(
    input_path: Path,
    output_path: Path,
    subtitle_path: Path,
    timeout_seconds: float,
) -> bool:
    """
    Fallback caption burning using ffmpeg drawtext filter (no libass required).
    Parses ASS dialogue lines and renders each line via drawtext.
    """
    try:
        ass_content = subtitle_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        print(f"[VideoCreator] drawtext: cannot read subtitle file: {exc}")
        return False

    lines_data: list[tuple[float, float, str]] = []
    for line in ass_content.splitlines():
        if not line.startswith("Dialogue:"):
            continue
        parts = line.split(",", 9)
        if len(parts) < 10:
            continue
        try:
            start_str = parts[1].strip()
            end_str = parts[2].strip()
            raw_text = parts[9].strip()
            clean_text = re.sub(r"\{[^}]*\}", "", raw_text).strip()
            clean_text = clean_text.replace(r"\N", " ").replace(r"\n", " ").strip()
            if not clean_text:
                continue

            def _parse_ass_t(t: str) -> float:
                p = t.split(":")
                return int(p[0]) * 3600 + int(p[1]) * 60 + float(p[2])

            lines_data.append((_parse_ass_t(start_str), _parse_ass_t(end_str), clean_text))
        except Exception:
            continue

    if not lines_data:
        print("[VideoCreator] drawtext: no parseable dialogue lines found")
        return False

    drawtext_filters: list[str] = []
    for start_s, end_s, text in lines_data:
        escaped = (
            text
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace(":", "\\:")
            .replace("%", "\\%")
        )
        drawtext_filters.append(
            (
                f"drawtext=text='{escaped}'"
                f":fontsize=52"
                f":fontcolor=white"
                f":bordercolor=black"
                f":borderw=3"
                f":x=(w-text_w)/2"
                f":y=h-text_h-140"
                f":enable='between(t,{start_s:.3f},{end_s:.3f})'"
            )
        )

    if not drawtext_filters:
        return False

    combined_filter = ",".join(drawtext_filters)
    try:
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-vf", combined_filter,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            str(output_path),
        ], timeout_seconds=timeout_seconds)
        return True
    except Exception as exc:
        print(f"[VideoCreator] drawtext filter failed: {str(exc)[:200]}")
        return False


def render_vertical_video(
    *,
    media_paths: list[Path],
    audio_path: Path,
    subtitle_path: Path | None,
    output_path: Path,
    target_duration_seconds: float,
    ffmpeg_timeout_seconds: float | None = None,
) -> Path:
    """
    Render a 1080x1920 mp4 video from mixed image/video inputs and merge narration audio.
    Stateless: all artifacts are temp/intermediate files under output directory.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1.0, float(target_duration_seconds))
    command_timeout_seconds = _resolve_ffmpeg_timeout_seconds(ffmpeg_timeout_seconds)

    def _stage_timeout(
        *,
        expected_duration_seconds: float | None,
        multiplier: float,
        cushion_seconds: float,
        floor_ratio: float,
        hard_ceiling_seconds: float | None = None,
    ) -> float:
        cap = max(5.0, float(command_timeout_seconds))
        candidate = cap
        if expected_duration_seconds is not None and expected_duration_seconds > 0:
            candidate = min(candidate, float(expected_duration_seconds) * multiplier + cushion_seconds)
        if hard_ceiling_seconds is not None and hard_ceiling_seconds > 0:
            candidate = min(candidate, float(hard_ceiling_seconds))
        adaptive_floor = max(12.0, cap * max(0.05, float(floor_ratio)))
        candidate = max(adaptive_floor, candidate)
        return min(cap, candidate)

    transition_timeout_seconds = _stage_timeout(
        expected_duration_seconds=duration,
        multiplier=1.8,
        cushion_seconds=16.0,
        floor_ratio=0.12,
        hard_ceiling_seconds=90.0,
    )

    finalize_timeout_seconds = _stage_timeout(
        expected_duration_seconds=duration,
        multiplier=2.1,
        cushion_seconds=20.0,
        floor_ratio=0.1,
        hard_ceiling_seconds=100.0,
    )

    print(
        (
            f"[VideoCreator] timeout profile command={int(command_timeout_seconds)}s "
            f"segment=adaptive transition={int(transition_timeout_seconds)}s "
            f"finalize={int(finalize_timeout_seconds)}s"
        ),
        flush=True,
    )

    print(
        (
            f"[VideoCreator] render start media_count={len(media_paths)} "
            f"target_duration={duration:.2f}s ffmpeg_timeout={int(command_timeout_seconds)}s"
        ),
        flush=True,
    )

    usable_media = [p for p in media_paths if p.exists() and (_is_image(p) or _is_video(p))]
    usable_images = sum(1 for p in usable_media if _is_image(p))
    usable_videos = sum(1 for p in usable_media if _is_video(p))
    print(
        f"[VideoCreator] input summary usable_media={len(usable_media)} clips={usable_videos} images={usable_images}",
        flush=True,
    )
    if not usable_media:
        # Fallback visual when no media is provided.
        visual_fallback = output_path.parent / "visual_fallback.mp4"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", "color=c=0x0B1020:s=1080x1920:r=30",
            "-t", f"{duration:.2f}",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(visual_fallback),
        ], timeout_seconds=command_timeout_seconds)
        usable_media = [visual_fallback]

    with tempfile.TemporaryDirectory(prefix="cf_render_", dir=str(output_path.parent)) as tmpdir:
        tmp = Path(tmpdir)
        image_count = sum(1 for p in usable_media if _is_image(p))
        video_count = sum(1 for p in usable_media if _is_video(p))
        image_duration = 3.0  # product requirement: each image stays for exactly 3 seconds
        reserved_for_images = image_count * image_duration
        remaining_for_videos = max(2.0 * max(1, video_count), duration - reserved_for_images)
        clip_durations = _allocate_mixed_clip_durations(video_count, remaining_for_videos)
        segments: list[Path] = []
        segment_durations: list[float] = []
        video_idx = 0

        for idx, media in enumerate(usable_media, start=1):
            seg = tmp / f"seg_{idx:04d}.mp4"
            try:
                print(
                    f"[VideoCreator] segment start {idx}/{len(usable_media)} file={media.name} type={'image' if _is_image(media) else 'video'}",
                    flush=True,
                )
                if _is_image(media):
                    seg_duration = image_duration
                    segment_timeout_seconds = min(
                        12.0,
                        _stage_timeout(
                            expected_duration_seconds=seg_duration,
                            multiplier=4.5,
                            cushion_seconds=8.0,
                            floor_ratio=0.08,
                            hard_ceiling_seconds=24.0,
                        )
                    )
                    frames = max(1, int(round(seg_duration * 30)))
                    zoom_speeds = [0.0006, 0.0008, 0.0010, 0.0012]
                    zoom_speed = random.choice(zoom_speeds)
                    zoom_mode = random.choice(["in", "out"])
                    if zoom_mode == "out":
                        zoom_expr = f"if(eq(on,1),1.18,max(1.00,zoom-{zoom_speed:.4f}))"
                    else:
                        zoom_expr = f"if(eq(on,1),1.00,min(1.20,zoom+{zoom_speed:.4f}))"
                    pan_x = random.choice(["iw/2-(iw/zoom/2)", "0", "iw-(iw/zoom)"])
                    pan_y = random.choice(["ih/2-(ih/zoom/2)", "0", "ih-(ih/zoom)"])
                    _run_ffmpeg([
                        "ffmpeg", "-y",
                        "-loop", "1",
                        "-t", f"{seg_duration:.2f}",
                        "-i", str(media),
                        "-vf",
                        (
                            f"scale=1200:2133:force_original_aspect_ratio=increase,"
                            f"zoompan=z='{zoom_expr}':x='{pan_x}':y='{pan_y}':"  # FIXED: Apply dynamic pan path instead of fixed center pan.
                            f"d={frames}:s=1080x1920:fps=30,"
                            "format=yuv420p"
                        ),
                        "-r", "30",
                        "-an",
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        str(seg),
                    ], timeout_seconds=segment_timeout_seconds)
                else:
                    seg_duration = clip_durations[video_idx] if video_idx < len(clip_durations) else 3.0
                    segment_timeout_seconds = min(
                        12.0,
                        _stage_timeout(
                            expected_duration_seconds=seg_duration,
                            multiplier=5.0,
                            cushion_seconds=10.0,
                            floor_ratio=0.08,
                            hard_ceiling_seconds=30.0,
                        )
                    )
                    video_idx += 1
                    _run_ffmpeg([
                        "ffmpeg", "-y",
                        "-stream_loop", "-1",
                        "-t", f"{seg_duration:.2f}",
                        "-i", str(media),
                        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
                        "-r", "30",
                        "-an",
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        str(seg),
                    ], timeout_seconds=segment_timeout_seconds)
            except Exception as exc:
                print(f"[VideoCreator] WARNING: skipping unusable media segment '{media.name}': {str(exc)[:240]}")
                continue

            if seg.exists():
                segments.append(seg)
                segment_durations.append(seg_duration)
                print(
                    f"[VideoCreator] segment ready {len(segments)}/{len(usable_media)} source={media.name} duration={seg_duration:.2f}s",
                    flush=True,
                )

        if not segments:
            emergency_segment = tmp / "seg_fallback_0001.mp4"
            _run_ffmpeg([
                "ffmpeg", "-y",
                "-f", "lavfi",
                "-i", "color=c=0x0B1020:s=1080x1920:r=30",
                "-t", f"{duration:.2f}",
                "-an",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(emergency_segment),
            ], timeout_seconds=command_timeout_seconds)
            segments = [emergency_segment]
            segment_durations = [duration]
            print("[VideoCreator] WARNING: all media segments failed; using emergency background segment.")

        print(f"[VideoCreator] segment prep completed segments={len(segments)}", flush=True)

        visual_track = tmp / "visual_track.mp4"
        if len(segments) == 1:
            _run_ffmpeg([
                "ffmpeg", "-y",
                "-i", str(segments[0]),
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(visual_track),
            ], timeout_seconds=finalize_timeout_seconds)
        else:
            # Join animation: cross-fade transitions between segments.
            transition_styles = [
                "fade",
                "slideleft",
                "slideright",
                "wipeleft",
                "wiperight",
                "smoothleft",
                "smoothright",
                "circlecrop",
            ]
            cmd = ["ffmpeg", "-y"]
            for seg in segments:
                cmd.extend(["-i", str(seg)])

            filters: list[str] = []
            previous_label = "[0:v]"
            cumulative = float(segment_durations[0])
            last_transition = ""
            for i in range(1, len(segments)):
                out_label = f"[v{i}]"
                prev_seg_duration = max(0.35, float(segment_durations[i - 1]))
                next_seg_duration = max(0.35, float(segment_durations[i]))
                max_safe_duration = min(prev_seg_duration, next_seg_duration) * 0.35
                transition_duration = max(0.18, min(0.42, max_safe_duration))

                style_pool = [style for style in transition_styles if style != last_transition] or transition_styles
                transition_name = random.choice(style_pool)
                offset = max(0.0, cumulative - transition_duration)
                filters.append(
                    f"{previous_label}[{i}:v]xfade=transition={transition_name}:duration={transition_duration:.2f}:offset={offset:.2f}{out_label}"
                )
                previous_label = out_label
                cumulative += float(segment_durations[i]) - transition_duration
                last_transition = transition_name

            filter_complex = ";".join(filters)
            cmd.extend([
                "-filter_complex", filter_complex,
                "-map", previous_label,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(visual_track),
            ])
            try:
                print(f"[VideoCreator] joining segments count={len(segments)} transitions={len(segments) - 1}", flush=True)
                _run_ffmpeg(cmd, timeout_seconds=transition_timeout_seconds)
            except Exception as exc:
                fallback_duration = max(duration, sum(segment_durations))
                print(
                    f"[VideoCreator] WARNING: xfade composition failed; using first segment loop fallback: {str(exc)[:220]}"
                )
                _run_ffmpeg([
                    "ffmpeg", "-y",
                    "-stream_loop", "-1",
                    "-t", f"{fallback_duration:.2f}",
                    "-i", str(segments[0]),
                    "-an",
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    str(visual_track),
                ], timeout_seconds=finalize_timeout_seconds)

        print("[VideoCreator] visual composition completed", flush=True)

        # Guarantee visual timeline is long enough; prevents accidental early cuts
        # when stock clips are fewer than target duration.
        audio_duration = _probe_duration_seconds(audio_path)
        final_duration = audio_duration if audio_duration > 0 else duration  # FIXED: Match render duration to measured audio duration exactly when available.
        visual_padded = tmp / "visual_padded.mp4"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-stream_loop", "-1",
            "-t", f"{final_duration:.2f}",
            "-i", str(visual_track),
            "-an",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(visual_padded),
        ], timeout_seconds=finalize_timeout_seconds)

        # Optional: blend background music under narration with sidechain ducking.
        final_audio_input = audio_path
        background_music_raw = str(os.getenv("BACKGROUND_MUSIC_PATH", "") or "").strip()
        if background_music_raw:
            background_music_path = Path(background_music_raw)
            if background_music_path.exists() and background_music_path.is_file():
                mixed_audio = tmp / "mixed_audio.wav"
                try:
                    bg_volume = float(os.getenv("BACKGROUND_MUSIC_VOLUME", "0.12") or 0.12)
                except Exception:
                    bg_volume = 0.12
                bg_volume = max(0.0, min(0.6, bg_volume))
                try:
                    print(f"[VideoCreator] background music mix enabled volume={bg_volume:.3f}", flush=True)
                    _run_ffmpeg([
                        "ffmpeg", "-y",
                        "-i", str(audio_path),
                        "-stream_loop", "-1",
                        "-i", str(background_music_path),
                        "-filter_complex",
                        (
                            f"[0:a]aresample=44100,volume=1.0[a_voice];"
                            f"[1:a]aresample=44100,atrim=0:{final_duration:.2f},volume={bg_volume:.3f}[a_bed];"
                            "[a_bed][a_voice]sidechaincompress=threshold=0.045:ratio=10:attack=15:release=220[ducked];"
                            "[ducked][a_voice]amix=inputs=2:weights=1 1:normalize=0[a_mix]"
                        ),
                        "-map", "[a_mix]",
                        "-t", f"{final_duration:.2f}",
                        "-c:a", "pcm_s16le",
                        str(mixed_audio),
                    ], timeout_seconds=finalize_timeout_seconds)
                    final_audio_input = mixed_audio
                except Exception:
                    final_audio_input = audio_path

        muxed_no_sub = tmp / "muxed_no_sub.mp4"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(visual_padded),
            "-i", str(final_audio_input),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-t", f"{final_duration:.2f}",  # FIXED: Trim/match output to audio duration without silence padding.
            str(muxed_no_sub),
        ], timeout_seconds=finalize_timeout_seconds)

        print(f"[VideoCreator] audio mux completed final_duration={final_duration:.2f}s", flush=True)

        if subtitle_path and subtitle_path.exists() and subtitle_path.suffix.lower() == ".ass":
            print("[VideoCreator] subtitle burn start", flush=True)
            escaped_subtitle_path = _escape_subtitle_filter_path(subtitle_path)
            # Try ass= first, then subtitles=, with quoted variants for paths with spaces.
            subtitle_filters = [
                f"ass={escaped_subtitle_path}",
                f"subtitles={escaped_subtitle_path}:charenc=UTF-8",
                f"ass='{escaped_subtitle_path}'",
                f"subtitles='{escaped_subtitle_path}':charenc=UTF-8",
            ]
            subtitle_burn_errors: list[str] = []
            subtitle_burned = False
            for subtitle_filter in subtitle_filters:
                try:
                    _run_ffmpeg([
                        "ffmpeg", "-y",
                        "-i", str(muxed_no_sub),
                        "-vf", subtitle_filter,
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "copy",
                        str(output_path),
                    ], timeout_seconds=finalize_timeout_seconds)
                    subtitle_burned = True
                    print("[VideoCreator] subtitle burn completed", flush=True)
                    return output_path
                except Exception as exc:
                    subtitle_burn_errors.append(f"[{subtitle_filter[:30]}]: {str(exc)[:100]}")
                    continue
            if not subtitle_burned:
                print(
                    f"[VideoCreator] WARNING: libass subtitle burn failed ({len(subtitle_burn_errors)} attempts). "
                    f"First error: {subtitle_burn_errors[0] if subtitle_burn_errors else 'unknown'}"
                )
                print("[VideoCreator] Trying drawtext fallback for captions...")
                if _burn_captions_drawtext(muxed_no_sub, output_path, subtitle_path, command_timeout_seconds):
                    print("[VideoCreator] drawtext caption fallback succeeded.")
                    return output_path
                print("[VideoCreator] All caption rendering methods failed - outputting video without captions.")

        shutil.copy2(muxed_no_sub, output_path)
        print(f"[VideoCreator] render completed output={output_path}", flush=True)
        return output_path
