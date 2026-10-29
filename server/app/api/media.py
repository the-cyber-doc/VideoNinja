"""Media of segments, served by nginx after the app's check (X-Accel-Redirect).

The app computes the file path and the clip's times from the database; the
client only names the segment. Files: <media>/video/<h2>/<sha256>/<file name>
(nginx: /protected/, aliased to /srv/media/video/).

- /media/segment/<id>: the segment's clip. nginx's mp4 module cuts it from
  video.mp4 (?start=&end=, from the keyframe at or before the start: one every
  second): only the clip's bytes are sent, index first, so it plays while it
  downloads, with Range requests (206) for seeking.
  One clip download per user at a time: the internal URI carries the user's ID
  (/protected-clip/<user id>/…), nginx counts the transfers in progress per ID
  (limit_conn) and answers 429 to a second one.
- /media/segment/<id>/thumbnail: its picture.
- /media/video/<id> and /media/video/<id>/thumbnail: a whole published video and
  its picture, for annotating it again (video_mgmt access only). Whole videos:
  /protected-video/<user id>/…, at most 3 transfers per user (the editor plays
  the file with three video elements: player, frame measurement, film strip).
  Thumbnails are not limited.

Without nginx (development), the app serves the files itself from the media
folder (paths.py), without download limits; it cuts each clip once with ffmpeg
(stream copy, the same keyframe rule) into <media>/clips/.
"""

import logging
import os
import re
import sqlite3
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse

from .. import queries
from ..core import db, limits, paths, procs, settings
from ..core.errors import ApiError
from ..queries.users import User
from .deps import require_access

log = logging.getLogger(__name__)
router = APIRouter(prefix="/media", tags=["media"])
segment_access = require_access("segment")

INTERNAL_PREFIX = "/protected"
CLIP_PREFIX = "/protected-clip"  # + /<user id>: one transfer per user (nginx limit_conn)
VIDEO_PREFIX = "/protected-video"  # + /<user id>: three per user
SHA256 = re.compile(r"[0-9a-f]{64}")
FILE_NAME = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*")  # no path, no leading dot
NO_STORE = {"Cache-Control": "private, no-store"}  # as nginx for /protected/


def _not_found() -> ApiError:
    return ApiError("not_found")


def _published(con: sqlite3.Connection, segment_id: int) -> sqlite3.Row:
    """The segment, if published; else 404."""
    row = queries.catalog.segment_media(con, segment_id)
    if row is None or not row["sha256sum"]:  # no such segment, or not published yet
        raise _not_found()
    if not SHA256.fullmatch(row["sha256sum"]):
        log.error("Segment %s: invalid SHA-256 %r", segment_id, row["sha256sum"])
        raise _not_found()
    return row


# HEAD too: the player asks it after a failed load (429 = another clip still downloading).


@router.get("/segment/{segment_id}")
@router.head("/segment/{segment_id}")  # its own route: one operation ID each (OpenAPI)
def segment_clip(
    segment_id: int,
    user: User = Depends(segment_access),
    con: sqlite3.Connection = Depends(db.get_db),
) -> Response:
    row = _published(con, segment_id)
    sha, begin, end = row["sha256sum"], row["begin_s"], row["end_s"]
    if settings.current().x_accel:
        return Response(
            headers={"X-Accel-Redirect": f"{CLIP_PREFIX}/{user.id}/{sha[:2]}/{sha}/video.mp4?start={begin}&end={end}"}
        )
    video = paths.video_dir() / sha[:2] / sha / "video.mp4"
    if not video.is_file():
        raise _not_found()
    return FileResponse(_dev_clip(video, sha, begin, end), media_type="video/mp4", headers=NO_STORE)


def _dev_clip(video: Path, sha: str, begin: int, end: int) -> Path:
    """Development only: the clip, cut once (stream copy) and kept in <media>/clips/."""
    clip = paths.media_dir() / "clips" / f"{sha}-{begin}-{end}.mp4"
    if clip.is_file():
        return clip
    clip.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=clip.parent, suffix=".part.mp4")
    os.close(fd)
    try:
        result = procs.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-ss",
                str(begin),
                "-to",
                str(end),
                *limits.ffmpeg_input(own=True),
                "-i",
                f"file:{video}",
                "-map",
                "0",
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                f"file:{tmp}",
            ]
        )
        if result.returncode != 0:
            raise OSError(result.stderr.strip()[-500:])
        os.replace(tmp, clip)  # complete or absent, also with requests in parallel
    except (OSError, procs.Timeout) as e:
        log.error("Segment clip %s %s-%s: %s", sha, begin, end, e)
        raise _not_found() from None
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return clip


@router.get("/segment/{segment_id}/thumbnail")
def segment_thumbnail(
    segment_id: int,
    _: User = Depends(segment_access),
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

    if settings.current().x_accel:
        return Response(headers={"X-Accel-Redirect": f"{INTERNAL_PREFIX}/{relative}"})
    path = paths.video_dir() / relative
    if not path.is_file():
        raise _not_found()
    return FileResponse(path, headers=NO_STORE)


# --- whole videos (video management: annotating a published video) ---

video_access = require_access("video_mgmt")


def _video_file(con: sqlite3.Connection, video_id: int, name: str | None, prefix: str = INTERNAL_PREFIX) -> Response:
    row = queries.videos.published_video(con, video_id)
    if row is None or not name or not SHA256.fullmatch(row["sha256sum"]) or not FILE_NAME.fullmatch(name):
        raise _not_found()
    relative = f"{row['sha256sum'][:2]}/{row['sha256sum']}/{name}"
    if settings.current().x_accel:  # no start/end: nginx sends the whole file, with Range requests
        return Response(headers={"X-Accel-Redirect": f"{prefix}/{relative}"})
    path = paths.video_dir() / relative
    if not path.is_file():
        raise _not_found()
    return FileResponse(path, headers=NO_STORE)


@router.get("/video/{video_id}")
def whole_video(
    video_id: int, user: User = Depends(video_access), con: sqlite3.Connection = Depends(db.get_db)
) -> Response:
    return _video_file(con, video_id, "video.mp4", f"{VIDEO_PREFIX}/{user.id}")


@router.get("/video/{video_id}/thumbnail")
def video_thumbnail(
    video_id: int, _: User = Depends(video_access), con: sqlite3.Connection = Depends(db.get_db)
) -> Response:
    row = queries.videos.published_video(con, video_id)
    return _video_file(con, video_id, row["thumbnail"] if row else None)
