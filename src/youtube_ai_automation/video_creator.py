"""
Scene-based Shorts editor:
- prepares vertical clips
- applies subtle motion and fades
- burns styled captions
- mixes optional background music
"""

from __future__ import annotations

from pathlib import Path
import logging
import random
import re
import subprocess
from typing import Iterable

LOGGER = logging.getLogger(__name__)


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode == 0:
        return
    stderr = (result.stderr or "").strip()
    stdout = (result.stdout or "").strip()
    details = stderr or stdout or "no output"
    LOGGER.debug("Command failed: %s", " ".join(cmd))
    raise RuntimeError(f"ffmpeg command failed: {details[-1200:]}")


def _escape_ffmpeg_subtitle_path(path: Path) -> str:
    value = path.resolve().as_posix()
    if len(value) > 1 and value[1] == ":":
        value = f"{value[0]}\\:{value[2:]}"
    return value.replace("'", r"\'")


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


def _probe_duration(media_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def probe_media_duration(media_path: Path) -> float:
    """
    Public duration probe helper (seconds).
    """
    return _probe_duration(media_path)


def _chunk_words(words: list[str], chunk_size: int) -> list[list[str]]:
    return [words[i : i + chunk_size] for i in range(0, len(words), chunk_size)]


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
    max_rows = 4
    max_words_per_line = max(4, max_words)
    max_chars_per_line = 32
    for idx, line in enumerate(raw_lines):
        line_words = line.split()
        if not line_words:
            continue
        # If the final line is very short (<=2 words), try to keep it on the previous page.
        if idx == len(raw_lines) - 1 and len(line_words) <= 2 and chunks:
            combined = chunks[-1] + line_words
            combined_lines = _build_wrapped_lines(
                words=combined,
                max_words_per_line=max_words_per_line,
                max_chars_per_line=max_chars_per_line,
                max_rows=max_rows,
                limit_rows=False,
            )
            if len(combined_lines) <= max_rows:
                chunks[-1] = combined
                continue
        full_lines = _build_wrapped_lines(
            words=line_words,
            max_words_per_line=max_words_per_line,
            max_chars_per_line=max_chars_per_line,
            max_rows=max_rows,
            limit_rows=False,
        )
        line_count = len(full_lines)
        if line_count <= max_rows:
            chunks.append(line_words)
            continue

        if line_count <= max_rows * 2:
            target_first_lines = min(max_rows, (line_count + 1) // 2)
            first_words, rest_words = _split_words_by_line_target(
                words=line_words,
                target_lines=target_first_lines,
                max_words_per_line=max_words_per_line,
                max_chars_per_line=max_chars_per_line,
            )
            if first_words:
                chunks.append(first_words)
            if rest_words:
                chunks.append(rest_words)
            continue

        pages = _split_words_into_pages(
            words=line_words,
            max_words_per_line=max_words_per_line,
            max_chars_per_line=max_chars_per_line,
            max_rows=max_rows,
        )
        chunks.extend(pages)
    return chunks


def _normalize_token(token: str) -> str:
    return re.sub(r"[^a-z0-9]", "", token.lower())


def _inject_highlight_ass(text: str, highlight_words: set[str]) -> str:
    if not highlight_words:
        return text
    lines = text.split(r"\N")
    out_lines: list[str] = []
    for line in lines:
        out_tokens: list[str] = []
        for token in line.split():
            base = _normalize_token(token)
            if base and base in highlight_words:
                # Yellow-gold highlight with bold for emphasis (no scale-up to avoid overflow)
                out_tokens.append(r"{\c&H00CCFF&\b1}" + token + r"{\rCaption}")
            else:
                out_tokens.append(token)
        out_lines.append(" ".join(out_tokens))
    return r"\N".join(out_lines)


def _wrap_caption_text(text: str, max_words_per_line: int, max_rows: int = 4) -> str:
    if max_words_per_line <= 0:
        return text
    words = text.split()
    if not words:
        return text
    lines = _build_wrapped_lines(
        words=words,
        max_words_per_line=max_words_per_line,
        max_chars_per_line=32,
        max_rows=max_rows,
    )
    return r"\N".join(lines)


def _build_wrapped_lines(
    words: list[str],
    max_words_per_line: int,
    max_chars_per_line: int,
    max_rows: int,
    limit_rows: bool = True,
) -> list[str]:
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = (" ".join(current + [word])).strip()
        if (
            current
            and (len(current) >= max_words_per_line or len(candidate) > max_chars_per_line)
        ):
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    if max_rows > 0 and limit_rows:
        return lines[:max_rows]
    return lines


def _split_words_into_pages(
    words: list[str],
    max_words_per_line: int,
    max_chars_per_line: int,
    max_rows: int,
) -> list[list[str]]:
    pages: list[list[str]] = []
    current_page: list[str] = []
    current_lines: list[str] = []

    def flush_page() -> None:
        nonlocal current_page, current_lines
        if current_page:
            pages.append(current_page)
        current_page = []
        current_lines = []

    for word in words:
        tentative_page = current_page + [word]
        lines = _build_wrapped_lines(
            words=tentative_page,
            max_words_per_line=max_words_per_line,
            max_chars_per_line=max_chars_per_line,
            max_rows=max_rows if max_rows > 0 else 1000,
            limit_rows=False,
        )
        if max_rows > 0 and len(lines) > max_rows:
            flush_page()
            current_page = [word]
            current_lines = _build_wrapped_lines(
                words=current_page,
                max_words_per_line=max_words_per_line,
                max_chars_per_line=max_chars_per_line,
                max_rows=max_rows if max_rows > 0 else 1000,
                limit_rows=False,
            )
        else:
            current_page = tentative_page
            current_lines = lines

    flush_page()
    return pages


def _split_words_by_line_target(
    words: list[str],
    target_lines: int,
    max_words_per_line: int,
    max_chars_per_line: int,
) -> tuple[list[str], list[str]]:
    if not words or target_lines <= 0:
        return [], words

    current: list[str] = []
    last_good_index = 0
    for idx, word in enumerate(words, start=1):
        current.append(word)
        lines = _build_wrapped_lines(
            words=current,
            max_words_per_line=max_words_per_line,
            max_chars_per_line=max_chars_per_line,
            max_rows=target_lines,
            limit_rows=False,
        )
        if len(lines) <= target_lines:
            last_good_index = idx
        else:
            break

    if last_good_index <= 0:
        return words, []

    return words[:last_good_index], words[last_good_index:]


def _build_ass_header() -> str:
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
        "Style: Caption,Arial,44,&H00FFFFFF,&H0000FFFF,&H00000000,&HC0000000,"
        "1,0,0,0,100,100,0.5,0,1,2.5,1,2,100,100,520,1\n\n"
        "[Events]\n"
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )


def create_subtitles_from_script(
    script: str,
    audio_path: Path,
    subtitle_path: Path,
    max_words: int = 4,
    highlight_words: Iterable[str] | None = None,
    line_mode: bool = True,
) -> Path:
    """
    Create TikTok-style ASS captions.
    If .srt is requested, write a plain SRT fallback.
    """
    words = script.split()
    if not words:
        raise ValueError("Script is empty. Cannot create subtitles.")

    duration = _probe_duration(audio_path)
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

    lines = [_build_ass_header()]
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
        # Add fade-in and pop-up animation for each caption line
        fade_ms = min(150, int(chunk_duration * 100))
        anim_prefix = r"{\fad(" + str(fade_ms) + r",80)\an2}"
        lines.append(
            f"Dialogue: 0,{_format_ass_time(start)},{_format_ass_time(end)},Caption,,0,0,0,,{anim_prefix}{text}"
        )

    subtitle_path.write_text("\n".join(lines), encoding="utf-8")
    return subtitle_path


def _allocate_caption_durations(
    chunks: list[list[str]],
    total_words: int,
    duration: float,
    line_mode: bool,
) -> list[float]:
    if not chunks or duration <= 0 or total_words <= 0:
        return []

    if not line_mode:
        return [duration * (len(chunk) / total_words) for chunk in chunks]

    weights = [max(1, len(chunk)) for chunk in chunks]
    total_weight = sum(weights)
    allocations = [duration * (weight / total_weight) for weight in weights]

    # Ensure the last line reaches the audio end.
    drift = duration - sum(allocations)
    if allocations:
        allocations[-1] += drift
    return allocations


def _scene_duration_plan(
    clip_count: int,
    scene_duration: float,
    target_duration: float,
) -> list[float]:
    if clip_count <= 0:
        return []
    plan = [scene_duration] * clip_count
    current = sum(plan)
    if current > target_duration:
        excess = current - target_duration
        index = clip_count - 1
        while excess > 0.01 and index >= 0:
            reducible = max(0.0, plan[index] - 2.0)
            delta = min(reducible, excess)
            plan[index] -= delta
            excess -= delta
            index -= 1
    elif current < target_duration:
        plan[-1] += target_duration - current
    return [max(2.0, value) for value in plan]


def _prepare_scene_clip(
    source: Path,
    output: Path,
    duration: float,
    width: int,
    height: int,
    fps: int,
) -> None:
    # Randomize motion parameters for each scene to create visual variety
    wiggle_x = random.uniform(0.3, 1.0)
    wiggle_y = random.uniform(0.2, 0.9)

    # Alternate between zoom-in and zoom-out for visual dynamism
    zoom_direction = random.choice(["in", "out"])
    zoom_step = random.uniform(0.0008, 0.0018)
    if zoom_direction == "out":
        zoom_expr = f"z='max(zoom-{zoom_step:.4f},1.0)'"
        zoom_init = "1.12"
    else:
        zoom_expr = f"z='min(zoom+{zoom_step:.4f},1.15)'"
        zoom_init = "1.0"

    # Smooth fade durations scaled to scene length
    fade_in_dur = min(0.30, duration * 0.12)
    fade_out_dur = min(0.35, duration * 0.14)
    fade_out_start = max(0.0, duration - fade_out_dur)

    vf = (
        f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,"
        f"crop={width * 2}:{height * 2}:"
        f"x='(in_w-out_w)/2+((in_w-out_w)/8)*sin({wiggle_x:.2f}*t)':"
        f"y='(in_h-out_h)/2+((in_h-out_h)/8)*cos({wiggle_y:.2f}*t)',"
        f"zoompan={zoom_expr}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height}:fps={fps},"
        f"format=yuv420p,"
        f"fade=t=in:st=0:d={fade_in_dur:.2f},"
        f"fade=t=out:st={fade_out_start:.2f}:d={fade_out_dur:.2f}"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        str(output),
    ]
    _run(cmd)


def _build_concat_file(files: list[Path], concat_file: Path) -> Path:
    concat_file.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"file '{file.as_posix()}'" for file in files]
    concat_file.write_text("\n".join(lines), encoding="utf-8")
    return concat_file


def _compose_video_and_audio(
    video_track: Path,
    audio_path: Path,
    output_path: Path,
    background_music_path: Path | None = None,
    bg_music_volume: float = 0.12,
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if background_music_path and background_music_path.exists():
        filter_complex = (
            f"[2:a]volume={bg_music_volume:.3f}[bg];"
            "[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_track),
            "-i",
            str(audio_path),
            "-stream_loop",
            "-1",
            "-i",
            str(background_music_path),
            "-filter_complex",
            filter_complex,
            "-map",
            "0:v:0",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
    else:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_track),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
    _run(cmd)
    return output_path


def _burn_subtitles(video_in: Path, subtitle_path: Path, output_path: Path, fps: int) -> Path:
    escaped_subtitle = _escape_ffmpeg_subtitle_path(subtitle_path)
    vf = f"subtitles='{escaped_subtitle}'"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_in),
        "-vf",
        vf,
        "-r",
        str(fps),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        str(output_path),
    ]
    _run(cmd)
    return output_path


def create_scene_based_video(
    videos: list[Path],
    audio_path: Path,
    subtitle_path: Path,
    output_path: Path,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
    scene_duration: float = 4.0,
    min_video_length: int = 20,
    max_video_length: int = 40,
    background_music_path: Path | None = None,
    bg_music_volume: float = 0.12,
    shuffle_scenes: bool = True,
) -> Path:
    """
    Build a vertical short from scene clips and voice audio.
    """
    if not videos:
        raise ValueError("No videos provided for scene-based creation.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    audio_duration = _probe_duration(audio_path)
    target_duration = max(min_video_length, min(max_video_length, audio_duration))

    clip_pool = list(videos)
    if shuffle_scenes:
        random.shuffle(clip_pool)

    desired_clips = max(1, int(round(target_duration / max(2.5, scene_duration))))
    selected = clip_pool[:desired_clips] if len(clip_pool) >= desired_clips else clip_pool
    if len(selected) < desired_clips and clip_pool:
        while len(selected) < desired_clips:
            selected.append(random.choice(clip_pool))

    durations = _scene_duration_plan(
        clip_count=len(selected),
        scene_duration=scene_duration,
        target_duration=target_duration,
    )

    temp_dir = output_path.parent / "tmp_scenes"
    temp_dir.mkdir(parents=True, exist_ok=True)
    prepared: list[Path] = []
    for idx, (clip, dur) in enumerate(zip(selected, durations), start=1):
        prepared_clip = temp_dir / f"scene_{idx:02d}.mp4"
        _prepare_scene_clip(
            source=clip,
            output=prepared_clip,
            duration=dur,
            width=width,
            height=height,
            fps=fps,
        )
        prepared.append(prepared_clip)

    concat_file = output_path.parent / "scenes_concat.txt"
    _build_concat_file(prepared, concat_file)
    scenes_video = output_path.parent / "scenes_track.mp4"
    _run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            str(scenes_video),
        ]
    )

    with_audio = output_path.parent / "short_with_audio.mp4"
    _compose_video_and_audio(
        video_track=scenes_video,
        audio_path=audio_path,
        output_path=with_audio,
        background_music_path=background_music_path,
        bg_music_volume=bg_music_volume,
    )
    _burn_subtitles(video_in=with_audio, subtitle_path=subtitle_path, output_path=output_path, fps=fps)
    return output_path


def create_vertical_video(
    images: list[Path],
    audio_path: Path,
    subtitle_path: Path,
    output_path: Path,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
) -> Path:
    """
    Backward-compatible entrypoint for older image workflows.
    """
    return create_scene_based_video(
        videos=images,
        audio_path=audio_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        width=width,
        height=height,
        fps=fps,
        scene_duration=4.0,
        min_video_length=20,
        max_video_length=40,
        background_music_path=None,
        bg_music_volume=0.0,
        shuffle_scenes=False,
    )


def create_vertical_video_from_clips(
    videos: list[Path],
    audio_path: Path,
    subtitle_path: Path,
    output_path: Path,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
) -> Path:
    """
    Backward-compatible clip entrypoint.
    """
    return create_scene_based_video(
        videos=videos,
        audio_path=audio_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        width=width,
        height=height,
        fps=fps,
        scene_duration=4.0,
        min_video_length=20,
        max_video_length=40,
        background_music_path=None,
        bg_music_volume=0.0,
        shuffle_scenes=True,
    )

