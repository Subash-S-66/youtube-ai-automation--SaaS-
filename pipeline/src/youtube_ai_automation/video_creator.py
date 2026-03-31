from __future__ import annotations

from pathlib import Path
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


def _build_ass_header(font_name: str = "Anton", hex_color: str = "#FFFFFF", caption_position: str = "bottom") -> str:
    ass_color = _hex_to_ass_color(hex_color)
    alignment, margin_v, _ = _resolve_caption_position(caption_position)
    # FIXED: Tune ASS caption style for clearer bottom-center subtitles (size 58, ScaleX 105).
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
        f"Style: Caption,{font_name},58,{ass_color},&H0000FFFF,"
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
        fade_ms = min(150, int(chunk_duration * 100))
        anim_prefix = r"{\fad(" + str(fade_ms) + r",80)" + alignment_tag + r"}"
        lines.append(
            f"Dialogue: 0,{_format_ass_time(start)},{_format_ass_time(end)},Caption,,0,0,0,,{anim_prefix}{text}"
        )

    subtitle_path.write_text("\n".join(lines), encoding="utf-8")
    return subtitle_path


_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
_VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


def _run_ffmpeg(args: list[str]) -> None:
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
        if arg_index >= 2 and args[arg_index - 2] == "-f" and str(args[arg_index - 1]).lower() == "lavfi":
            return True
        return False

    for i, arg in enumerate(args):
        if arg == "-i" and i + 1 < len(args):
            input_spec = str(args[i + 1])
            if _is_virtual_input(input_spec, i + 1):
                continue
            input_file = Path(input_spec)
            if not input_file.exists():
                raise RuntimeError(f"ffmpeg failed: Input file does not exist: {input_file}")
            if input_file.is_dir():
                raise RuntimeError(f"ffmpeg failed: Input path is a directory, not a file: {input_file}")

    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-600:]}")


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
        )
        if proc.returncode != 0:
            return 0.0
        return float((proc.stdout or "").strip() or 0.0)
    except Exception:
        return 0.0


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in _IMAGE_EXTS


def _is_video(path: Path) -> bool:
    return path.suffix.lower() in _VIDEO_EXTS


def _allocate_mixed_clip_durations(video_count: int, total_for_videos: float) -> list[float]:
    """
    Allocate per-clip durations with mixed values in [2, 6] seconds.
    """
    if video_count <= 0:
        return []
    base = [float(random.choice([2, 3, 4, 5, 6])) for _ in range(video_count)]
    base_sum = max(1.0, sum(base))
    scale = max(0.4, float(total_for_videos) / base_sum)
    scaled = [max(2.0, min(6.0, round(v * scale, 2))) for v in base]

    target = max(2.0 * video_count, float(total_for_videos))
    current = sum(scaled)
    idx = 0
    # Fine-tune to get closer to target while preserving 2..6 bounds.
    while abs(current - target) > 0.15 and idx < 400:
        i = idx % video_count
        if current < target and scaled[i] < 6.0:
            scaled[i] = round(min(6.0, scaled[i] + 0.1), 2)
            current += 0.1
        elif current > target and scaled[i] > 2.0:
            scaled[i] = round(max(2.0, scaled[i] - 0.1), 2)
            current -= 0.1
        idx += 1
    return scaled


def render_vertical_video(
    *,
    media_paths: list[Path],
    audio_path: Path,
    subtitle_path: Path | None,
    output_path: Path,
    target_duration_seconds: float,
) -> Path:
    """
    Render a 1080x1920 mp4 video from mixed image/video inputs and merge narration audio.
    Stateless: all artifacts are temp/intermediate files under output directory.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1.0, float(target_duration_seconds))

    usable_media = [p for p in media_paths if p.exists() and (_is_image(p) or _is_video(p))]
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
        ])
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
            if _is_image(media):
                seg_duration = image_duration
                frames = max(1, int(round(seg_duration * 30)))
                zoom_speeds = [0.0006, 0.0008, 0.0010, 0.0012]  # FIXED: Expand Ken Burns zoom speed variety for image segments.
                zoom_speed = random.choice(zoom_speeds)  # FIXED: Randomize image zoom pacing per segment.
                zoom_expr = f"min(1.20,zoom+{zoom_speed:.4f})"  # FIXED: Allow slightly deeper zoom while capping for visual stability.
                pan_x = random.choice(["iw/2-(iw/zoom/2)", "0", "iw-(iw/zoom)"])  # FIXED: Vary horizontal pan direction for image motion diversity.
                pan_y = random.choice(["ih/2-(ih/zoom/2)", "0", "ih-(ih/zoom)"])  # FIXED: Vary vertical pan direction for image motion diversity.
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
                ])
            else:
                seg_duration = clip_durations[video_idx] if video_idx < len(clip_durations) else 3.0
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
                ])
            segments.append(seg)
            segment_durations.append(seg_duration)

        visual_track = tmp / "visual_track.mp4"
        if len(segments) == 1:
            _run_ffmpeg([
                "ffmpeg", "-y",
                "-i", str(segments[0]),
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(visual_track),
            ])
        else:
            # Join animation: cross-fade transitions between segments.
            TRANSITION_STYLES = [  # FIXED: Use richer, randomized transition palette with tuned per-style durations.
                ("fade", 0.35),
                ("slideleft", 0.30),
                ("slideright", 0.30),
                ("wipeleft", 0.30),
                ("wiperight", 0.30),
                ("fadeblack", 0.40),
                ("circlecrop", 0.35),
                ("smoothleft", 0.30),
            ]
            cmd = ["ffmpeg", "-y"]
            for seg in segments:
                cmd.extend(["-i", str(seg)])

            filters: list[str] = []
            previous_label = "[0:v]"
            cumulative = float(segment_durations[0])
            for i in range(1, len(segments)):
                out_label = f"[v{i}]"
                transition_name, transition_duration = random.choice(TRANSITION_STYLES)  # FIXED: Pick transition style/duration per segment boundary.
                # Offset is measured on current composed timeline.
                offset = max(0.0, cumulative - transition_duration)  # FIXED: Align transition start offset with selected transition duration.
                filters.append(
                    f"{previous_label}[{i}:v]xfade=transition={transition_name}:duration={transition_duration:.2f}:offset={offset:.2f}{out_label}"  # FIXED: Apply per-boundary transition style and duration.
                )
                previous_label = out_label
                cumulative += float(segment_durations[i]) - transition_duration  # FIXED: Keep timeline accumulation consistent with chosen transition duration.

            filter_complex = ";".join(filters)
            cmd.extend([
                "-filter_complex", filter_complex,
                "-map", previous_label,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(visual_track),
            ])
            _run_ffmpeg(cmd)

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
        ])

        muxed_no_sub = tmp / "muxed_no_sub.mp4"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(visual_padded),
            "-i", str(audio_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-t", f"{final_duration:.2f}",  # FIXED: Trim/match output to audio duration without silence padding.
            str(muxed_no_sub),
        ])

        if subtitle_path and subtitle_path.exists() and subtitle_path.suffix.lower() == ".ass":
            # Keep subtitles optional; if burn fails, return muxed video.
            try:
                _run_ffmpeg([
                    "ffmpeg", "-y",
                    "-i", str(muxed_no_sub),
                    "-vf", f"subtitles={subtitle_path.as_posix()}",
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "copy",
                    str(output_path),
                ])
                return output_path
            except Exception:
                pass

        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(muxed_no_sub),
            "-c", "copy",
            str(output_path),
        ])
        return output_path
