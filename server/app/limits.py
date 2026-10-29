"""What may be uploaded and how ffmpeg may read it: set once for all containers
(the compose file's shared environment), read and checked by settings.py.

- VIDEONINJA_MAX_UPLOAD_BYTES (default 20 GiB): the largest original. tusd's
  -max-size gets the same value.
- VIDEONINJA_INPUT_FORMATS: the ffmpeg demuxers allowed for uploads (by
  content, -format_whitelist), which also give the accepted file extensions.
- Every ffmpeg / ffprobe input is a local file (-protocol_whitelist file): no
  network, no data: URLs, no playlists pointing elsewhere.
"""

from pathlib import PurePath

from . import settings

# The app's own files (encoded, published): MP4 only.
OWN_FORMATS = "mov"


def extensions() -> list[str]:
    """The accepted files' extensions: those of VIDEONINJA_INPUT_FORMATS."""
    return [ext for name in settings.current().input_formats for ext in settings.INPUT_FORMATS[name]]


def accepted_name(filename: str) -> bool:
    return PurePath(filename).suffix.lower().removeprefix(".") in extensions()


def ffmpeg_input(own: bool = False) -> list[str]:
    """Options before an ffmpeg -i or an ffprobe input: local files of the allowed
    formats only. own: a file the app wrote (MP4)."""
    formats = OWN_FORMATS if own else ",".join(settings.current().input_formats)
    return ["-protocol_whitelist", "file", "-format_whitelist", formats]
