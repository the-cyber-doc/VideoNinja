"""Media of segments, served by nginx after the app's check (X-Accel-Redirect).

The app computes the file path and the clip's times from the database; the
client only names the segment. Files: <media>/video/<h2>/<sha256>/<file name>
(nginx: /protected/, aliased to /srv/media/video/).

- /media/segment/<id>: the segment's clip. nginx's mp4 module cuts it from
  video.mp4 (?start=&end=, from the keyframe at or before the start: one every
  second): only the clip's bytes are sent, index first, so it plays while it
  downloads, with Range requests (206) for seeking.
- /media/segment/<id>/thumbnail: its picture.

Without nginx (development), the app serves the files itself from the media
folder (paths.py); it cuts each clip once with ffmpeg (stream copy, the same
keyframe rule) into <media>/clips/.
"""

import logging
import os
import re
import sqlite3
import subprocess
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse

from . import db, paths, queries, snapshot
from .auth import require_access

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/media", tags=["media"])
segment_access = require_access("segment")

INTERNAL_PREFIX = "/protected"
SHA256 = re.compile(r"[0-9a-f]{64}")
FILE_NAME = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*")  # no path, no leading dot
NO_STORE = {"Cache-Control": "private, no-store"}  # as nginx for /protected/


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


def _published(con: sqlite3.Connection, segment_id: int) -> sqlite3.Row:
    """The segment, if published; else 404."""
    row = queries.segment_media(con, segment_id)
    if row is None or not row["sha256sum"]:  # no such segment, or not published yet
        raise _not_found()
    if not SHA256.fullmatch(row["sha256sum"]):
        log.error("Segment %s: invalid SHA-256 %r", segment_id, row["sha256sum"])
        raise _not_found()
    return row


@router.get("/segment/{segment_id}")
def segment_clip(
    segment_id: int,
    _: sqlite3.Row = Depends(segment_access),
    con: sqlite3.Connection = Depends(db.get_db),
) -> Response:
    row = _published(con, segment_id)
    sha, begin, end = row["sha256sum"], row["begin_s"], row["end_s"]
    if snapshot.x_accel():
        return Response(headers={
            "X-Accel-Redirect": f"{INTERNAL_PREFIX}/{sha[:2]}/{sha}/video.mp4?start={begin}&end={end}"})
    video = paths.video_dir() / sha[:2] / sha / "video.mp4"
    if not video.is_file():
        raise _not_found()
    return FileResponse(_dev_clip(video, sha, begin, end), media_type="video/mp4", headers=NO_STORE)


def _dev_clip(video, sha: str, begin: int, end: int):
    """Development only: the clip, cut once (stream copy) and kept in <media>/clips/."""
    clip = paths.media_dir() / "clips" / f"{sha}-{begin}-{end}.mp4"
    if clip.is_file():
        return clip
    clip.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=clip.parent, suffix=".part.mp4")
    os.close(fd)
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", str(begin), "-to", str(end),
                        "-i", f"file:{video}", "-map", "0", "-c", "copy", "-movflags", "+faststart",
                        "-f", "mp4", f"file:{tmp}"], check=True, capture_output=True)
        os.replace(tmp, clip)  # complete or absent, also with requests in parallel
    except (OSError, subprocess.CalledProcessError) as e:
        log.error("Segment clip %s %s-%s: %s", sha, begin, end, e)
        raise _not_found() from None
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return clip


@router.get("/segment/{segment_id}/thumbnail")
def segment_thumbnail(
    segment_id: int,
    _: sqlite3.Row = Depends(segment_access),
    con: sqlite3.Connection = Depends(db.get_db),
) -> Response:
    row = _published(con, segment_id)
    sha, name = row["sha256sum"], row["thumbnail"]
    if not name:
        raise _not_found()
    if not FILE_NAME.fullmatch(name):
        log.error("Segment %s: invalid media path %r / %r", segment_id, sha, name)
        raise _not_found()
    relative = f"{sha[:2]}/{sha}/{name}"

    if snapshot.x_accel():
        return Response(headers={"X-Accel-Redirect": f"{INTERNAL_PREFIX}/{relative}"})
    path = paths.video_dir() / relative
    if not path.is_file():
        raise _not_found()
    return FileResponse(path, headers=NO_STORE)
