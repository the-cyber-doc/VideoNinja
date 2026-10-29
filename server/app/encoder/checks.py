"""What the encoder checks with ffprobe and on disk: an upload complete, its
duration, whether it needs encoding at all (needs_encoding, strip_metadata), the
result's format; and ffmpeg's progress. Every run through procs.py (own process
group, time limit) and limits.ffmpeg_input (local files of the allowed formats)."""

import hashlib
import json
import os
from pathlib import Path

from .. import limits, procs

# Longest keyframe interval accepted without encoding, needed by the nginx mp4 module's cuts.
# encode-videos.sh makes 1 s up to 30 fps, 0.5 s above (smoother seeking at high frame rates).
GOP_S = 1


class JobError(Exception):
    """The video cannot be published: its reason is stored (video.error)."""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def check_complete(original: Path, info: Path) -> None:
    """tusd's file store keeps the announced Size in <id>.info, but not the
    offset (it stays 0): the data received is the file's size on disk."""
    try:
        meta = json.loads(info.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise JobError("The uploaded file is missing") from None
    if not original.is_file() or original.stat().st_size != meta.get("Size"):
        raise JobError("The upload is incomplete")


def run(cmd: list[str]) -> str:
    """ffmpeg / ffprobe to the end (procs.run: own process group, time limit)."""
    try:
        result = procs.run(cmd)
    except procs.Timeout as e:
        raise JobError(str(e)) from None  # final: it would take as long again
    if result.returncode != 0:
        raise JobError(f"{cmd[0]} failed: {result.stderr.strip()[-500:]}")
    return result.stdout


def probe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(), "-show_entries", "format=duration:stream=codec_type",
               "-of", "json", f"file:{path}"])
    data = json.loads(out)
    if not any(s.get("codec_type") == "video" for s in data.get("streams", [])):
        raise JobError("No video in this file")
    try:
        return float(data["format"]["duration"])
    except (KeyError, ValueError):
        raise JobError("Unknown duration") from None


def check_encoded(path: Path) -> None:
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own=True),
               "-show_entries", "stream=codec_type,codec_name,codec_tag_string", "-of", "json", f"file:{path}"])
    streams = json.loads(out).get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    if len(videos) != 1 or videos[0].get("codec_name") != "hevc" or videos[0].get("codec_tag_string") != "hvc1":
        raise JobError("Encoded video is not HEVC/hvc1")
    if any(a.get("codec_name") != "aac" for a in audios):
        raise JobError("Encoded audio is not AAC")


def needs_encoding(path: Path, own: bool = False) -> str | None:
    """Why the original must be encoded, or None if its format is already what
    encode-videos.sh makes: MP4 with faststart, one H.265 Main 8-bit video
    (hvc1), SDR BT.709, progressive, a keyframe every GOP_S seconds, AAC mono or
    stereo (or no audio). Only the format counts: metadata (GPS location,
    dates…), chapters and other streams (data, subtitles) are ignored here.
    Such a file (e.g. a phone's recording, or encoded with the script before
    upload) is not encoded again, which would only lose quality and take the Pi
    minutes to hours: strip_metadata copies its streams. When unsure: encode."""
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own), "-show_entries",
               "format=format_name:stream=codec_type,codec_name,codec_tag_string,profile,pix_fmt,"
               "width,height,field_order,color_transfer,color_primaries,channels,avg_frame_rate"
               ":stream_side_data=side_data_type", "-of", "json", f"file:{path}"])
    data = json.loads(out)
    fmt = data.get("format", {})
    if "mp4" not in fmt.get("format_name", "").split(","):
        return "not an MP4 file"
    if not moov_first(path):
        return "no faststart (index after the media data)"
    streams = data.get("streams", [])
    v = [s for s in streams if s.get("codec_type") == "video"]
    a = [s for s in streams if s.get("codec_type") == "audio"]
    if len(v) != 1:
        return "no video" if not v else "more than one video stream"
    if len(a) > 1:
        return "more than one audio stream"
    v, a = v[0], a[0] if a else None
    if (v.get("codec_name"), v.get("codec_tag_string"), v.get("profile")) != ("hevc", "hvc1", "Main"):
        return f"video is {v.get('codec_name')}/{v.get('codec_tag_string')} {v.get('profile')}, not hevc/hvc1 Main"
    if v.get("pix_fmt") != "yuv420p":
        return f"pixel format {v.get('pix_fmt')}, not yuv420p"
    if v.get("width", 1) % 2 or v.get("height", 1) % 2:
        return "odd dimensions"
    if v.get("field_order") != "progressive":
        return f"field order {v.get('field_order', 'unknown')}, not progressive"
    for key in ("color_transfer", "color_primaries"):
        if v.get(key, "unknown") not in ("bt709", "unknown"):
            return f"{key} {v[key]}, not BT.709 (HDR?)"
    if any("DOVI" in d.get("side_data_type", "") for d in v.get("side_data_list", [])):
        return "Dolby Vision"
    if a is not None and ((a.get("codec_name"), a.get("profile")) != ("aac", "LC") or a.get("channels") not in (1, 2)):
        return (f"audio is {a.get('codec_name')} {a.get('profile')} with {a.get('channels')} channels,"
                " not AAC mono or stereo")
    return keyframe_problem(path, v.get("avg_frame_rate", "0/1"), own)


def strip_metadata(original: Path, out: Path) -> None:
    """The original's first video and audio streams, copied (no encoding) into a
    new MP4 without its metadata: no global or stream tags (GPS location, dates,
    device, encoder), no chapters, no other streams (data or GPS tracks,
    timecode, subtitles). The picture's rotation is side data, not metadata: it
    stays. Seconds, even for a long video: only the bytes are copied."""
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", *limits.ffmpeg_input(), "-i", f"file:{original}",
         "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
         "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
         "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
         "-tag:v", "hvc1", "-movflags", "+faststart", "-f", "mp4", f"file:{out}"])


def keyframe_problem(path: Path, frame_rate: str, own: bool = False) -> str | None:
    """None if the video starts with a keyframe and has one at least every GOP_S
    seconds (one frame of tolerance). Reads packet headers only: no decoding."""
    num, _, den = frame_rate.partition("/")
    frame_s = float(den or 1) / float(num) if float(num or 0) else 0.1
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own), "-select_streams", "v:0",
               "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", f"file:{path}"])
    keys = sorted(float(t) for t, _, flags in (line.partition(",") for line in out.splitlines())
                  if "K" in flags and t not in ("", "N/A"))
    if not keys or keys[0] > frame_s:
        return "does not start with a keyframe"
    gap = max((b - a for a, b in zip(keys, keys[1:])), default=0)
    if gap > GOP_S + frame_s:
        return f"keyframes up to {gap:.1f} s apart, not every {GOP_S} s"
    return None


def moov_first(path: Path) -> bool:
    """The MP4 index (moov box) comes before the media data (mdat): faststart,
    playback starts before the whole file is downloaded."""
    with path.open("rb") as f:
        while header := f.read(8):
            if len(header) < 8:
                return False
            size, box = int.from_bytes(header[:4]), header[4:]
            if box in (b"moov", b"mdat"):
                return box == b"moov"
            if size == 1:  # 64-bit size after the type
                size = int.from_bytes(f.read(8)) - 8
            if size < 8:  # 0 = up to the end of the file
                return False
            f.seek(size - 8, os.SEEK_CUR)
    return False


def out_time_s(progress_file: Path) -> float:
    """Last out_time_us of ffmpeg's -progress output, in seconds."""
    try:
        lines = progress_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0.0
    for line in reversed(lines):
        if line.startswith("out_time_us="):
            try:
                return max(int(line.split("=", 1)[1]), 0) / 1e6
            except ValueError:
                return 0.0
    return 0.0


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(4 << 20):
            digest.update(chunk)
    return digest.hexdigest()
