"""Thumbnails: taking one (a video's middle, or a segment's), and making those of
segments added or re-timed on the Videos page again (the API marks the video,
video.thumbs_dirty; the API runs no ffmpeg), deleting those of removed segments."""

import logging
import os
import sqlite3
import threading
from pathlib import Path

from .. import queries
from ..core import db, limits, logs
from .checks import JobError, run

log = logging.getLogger(__name__)
THUMB_WIDTH = 320


def middle(begin_s: float, end_s: float, duration: float) -> float:
    """Where a thumbnail is taken: the middle of the video or segment. A segment
    may end up to 1 s after the video (rounded seconds): only its part inside counts."""
    return (begin_s + min(end_s, duration)) / 2


def thumbnail(video: Path, at_s: float, out: Path) -> None:
    """A JPEG of one of the app's own videos (encoded, MP4)."""
    common = ["-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "4", "-f", "image2", f"file:{out}"]
    source = [*limits.ffmpeg_input(own=True), "-i", f"file:{video}"]
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{max(at_s, 0):.3f}", *source, *common])
    if not out.is_file():  # -ss past the last frame writes nothing
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", *source, *common])


def refresh(videos: Path, stopping: threading.Event) -> bool:
    """Every video marked: a thumbnail for each segment without one, the files of
    removed segments deleted. True if one changed (the catalogue must follow)."""
    with db.transaction() as con:
        marked = queries.thumbnails.thumbs_dirty_videos(con)
    changed = False
    for video in marked:
        if stopping.is_set():
            break
        with logs.bind(video_id=video["id"]):
            refresh_video(videos, video)
        changed = True
    return changed


def refresh_video(videos: Path, video: sqlite3.Row) -> None:
    with db.transaction() as con:
        segments = queries.thumbnails.segment_thumbnails(con, video["id"])
    folder = videos / video["sha256sum"][:2] / video["sha256sum"]
    duration = video["duration_s"] or max((s["end_s"] for s in segments), default=0)
    for s in segments:
        if s["thumbnail"] is not None:
            continue
        name = f"segment-{s['id']}.jpg"
        tmp = folder / f".{name}"
        try:
            thumbnail(folder / "video.mp4", middle(s["begin_s"], s["end_s"], duration), tmp)
            os.replace(tmp, folder / name)  # whole or not at all
        except (OSError, JobError) as e:
            log.warning("Video %s: no thumbnail for segment %s: %s", video["id"], s["id"], e)
            continue
        finally:
            tmp.unlink(missing_ok=True)
        with db.transaction() as con:
            queries.thumbnails.set_new_segment_thumbnail(con, s, name)
    keep = {f"segment-{s['id']}.jpg" for s in segments}
    for path in folder.glob("segment-*.jpg"):
        if path.name not in keep:
            path.unlink(missing_ok=True)
    with db.transaction() as con:
        queries.thumbnails.clear_thumbs_dirty(con, video["id"], video["thumbs_dirty"])
    log.info("Video %s: segment thumbnails updated", video["id"])
