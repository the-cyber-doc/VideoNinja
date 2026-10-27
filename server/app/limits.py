"""What may be uploaded and how ffmpeg may read it: set once for all containers
(the compose file's shared environment), checked at startup.

- VIDEONINJA_MAX_UPLOAD_BYTES (default 20 GiB): the largest original. tusd's
  -max-size gets the same value.
- VIDEONINJA_INPUT_FORMATS: the ffmpeg demuxers allowed for uploads (by
  content, -format_whitelist), which also give the accepted file extensions.
- Every ffmpeg / ffprobe input is a local file (-protocol_whitelist file): no
  network, no data: URLs, no playlists pointing elsewhere.
"""

import os
from pathlib import PurePath

DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024**3
# ffmpeg demuxer → the extensions of its files (lower case, without the dot).
FORMATS = {
    "mov": ("mp4", "mov", "m4v", "3gp", "3g2"),  # phones, cameras, encode-videos.sh
    "matroska": ("mkv", "webm"),
    "avi": ("avi",),
    "mpegts": ("mts", "m2ts", "ts"),  # AVCHD camcorders
    "mpeg": ("mpg", "mpeg", "vob"),  # MPEG-PS, DVDs
    "dv": ("dv",),
    "asf": ("wmv", "asf"),
}
DEFAULT_INPUT_FORMATS = ",".join(FORMATS)
# The app's own files (encoded, published): MP4 only.
OWN_FORMATS = "mov"


def max_upload_bytes() -> int:
    value = os.environ.get("VIDEONINJA_MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))
    if not value.strip().isdigit() or int(value) <= 0:
        raise RuntimeError(f"VIDEONINJA_MAX_UPLOAD_BYTES={value!r}: must be a positive number of bytes")
    return int(value)


def input_formats() -> list[str]:
    value = os.environ.get("VIDEONINJA_INPUT_FORMATS", DEFAULT_INPUT_FORMATS)
    names = [n.strip().lower() for n in value.split(",") if n.strip()]
    unknown = [n for n in names if n not in FORMATS]
    if not names or unknown:
        raise RuntimeError(f"VIDEONINJA_INPUT_FORMATS={value!r}: must list some of {DEFAULT_INPUT_FORMATS}")
    return names


def extensions() -> list[str]:
    return [ext for name in input_formats() for ext in FORMATS[name]]


def accepted_name(filename: str) -> bool:
    return PurePath(filename).suffix.lower().removeprefix(".") in extensions()


def ffmpeg_input(own: bool = False) -> list[str]:
    """Options before an ffmpeg -i or an ffprobe input: local files of the allowed
    formats only. own: a file the app wrote (MP4)."""
    formats = OWN_FORMATS if own else ",".join(input_formats())
    return ["-protocol_whitelist", "file", "-format_whitelist", formats]


def check() -> None:
    """At startup: refuse to start with a wrong setting."""
    max_upload_bytes()
    input_formats()
