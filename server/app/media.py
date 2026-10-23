"""Media of segments, served by nginx after the app's check (X-Accel-Redirect).

The app computes the file path from the database; the client only names the
segment. Files: <media>/derived/<h2>/<sha256>/<file name> (nginx: /protected/,
aliased to /srv/media/derived/). Without nginx (development), the app serves
the file itself from the media folder (paths.py).
"""

import logging
import re
import sqlite3

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


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


@router.get("/segment/{segment_id}/thumbnail")
def segment_thumbnail(
    segment_id: int,
    _: sqlite3.Row = Depends(segment_access),
    con: sqlite3.Connection = Depends(db.get_db),
) -> Response:
    row = queries.segment_thumbnail(con, segment_id)
    if row is None or not row["thumbnail"] or not row["sha256sum"]:  # none, or not published yet
        raise _not_found()
    sha, name = row["sha256sum"], row["thumbnail"]
    if not (SHA256.fullmatch(sha) and FILE_NAME.fullmatch(name)):
        log.error("Segment %s: invalid media path %r / %r", segment_id, sha, name)
        raise _not_found()
    relative = f"{sha[:2]}/{sha}/{name}"

    if snapshot.x_accel():
        return Response(headers={"X-Accel-Redirect": f"{INTERNAL_PREFIX}/{relative}"})
    path = paths.media_dir() / "derived" / relative
    if not path.is_file():
        raise _not_found()
    return FileResponse(path, headers={"Cache-Control": "private, no-store"})
