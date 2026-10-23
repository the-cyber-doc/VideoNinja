"""Folders of uploads and media. Docker: /srv/uploads and /srv/media (volumes,
media read-only for nginx). Development default: next to the database."""

import os
from pathlib import Path

from . import db


def _dir(variable: str, name: str) -> Path:
    path = os.environ.get(variable)
    return Path(path) if path else db.db_path().parent / name


def upload_dir() -> Path:
    """tusd's folder: <tus_id> (the original) + <tus_id>.info."""
    return _dir("VIDEONINJA_UPLOAD_DIR", "uploads")


def media_dir() -> Path:
    """derived/<h2>/<sha256>/{video.mp4, thumb.jpg, segment-<id>.jpg}."""
    return _dir("VIDEONINJA_MEDIA_DIR", "media")
