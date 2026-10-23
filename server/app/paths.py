"""Folders of uploads and media. Docker: /srv/uploads and /srv/media (volumes,
media read-only for nginx). Development default: next to the database."""

import os
import re
from pathlib import Path

from . import db


def _dir(variable: str, name: str) -> Path:
    path = os.environ.get(variable)
    return Path(path) if path else db.db_path().parent / name


def upload_dir() -> Path:
    """tusd's folder: <tus_id> (the original) + <tus_id>.info."""
    return _dir("VIDEONINJA_UPLOAD_DIR", "uploads")


def media_dir() -> Path:
    """video/ (video_dir) and, in development, clips/ (media.py)."""
    return _dir("VIDEONINJA_MEDIA_DIR", "media")


def video_dir() -> Path:
    """<h2>/<sha256>/{video.mp4, thumb.jpg, segment-<id>.jpg}: one folder per video,
    named after the encoded file's SHA-256 (the original would go alongside)."""
    return media_dir() / "video"


_BASE_PATH = re.compile(r"(/[A-Za-z0-9._~-]+)*")


def base_path() -> str:
    """VIDEONINJA_BASE_PATH: where the browser sees the app, e.g. "/videoninja"
    ("": the domain's root). nginx removes it before /api and /media reach the
    app; tusd's upload URLs and the session cookie's path include it."""
    value = os.environ.get("VIDEONINJA_BASE_PATH", "").rstrip("/")
    if not _BASE_PATH.fullmatch(value):
        raise RuntimeError(f"VIDEONINJA_BASE_PATH must look like /videoninja, not {value!r}")
    return value
