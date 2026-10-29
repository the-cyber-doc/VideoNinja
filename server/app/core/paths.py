"""Folders of uploads and media (settings.py: VIDEONINJA_UPLOAD_DIR, VIDEONINJA_MEDIA_DIR;
Docker: /srv/uploads and /srv/media, media read-only for nginx; development:
next to the database)."""

from pathlib import Path

from . import settings


def upload_dir() -> Path:
    """tusd's folder: <tus_id> (the original) + <tus_id>.info."""
    return settings.current().upload_dir


def media_dir() -> Path:
    """video/ (video_dir) and, in development, clips/ (media.py)."""
    return settings.current().media_dir


def video_dir() -> Path:
    """<h2>/<sha256>/{video.mp4, thumb.jpg, segment-<id>.jpg}: one folder per video,
    named after the encoded file's SHA-256 (the original would go alongside)."""
    return media_dir() / "video"
