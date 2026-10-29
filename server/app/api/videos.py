"""Uploading videos (the user's side): duplicate check, submit, status, retry, delete.

The file itself goes to tusd (see tusd.py) and is encoded by the app's queue
(see encoder.py). A submitted video waits in the queue and is published when
encoded; until then its segments are not in the catalogue.
"""

import sqlite3
import time
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from .. import queries
from ..core import clock, db, limits, settings
from ..core.errors import ApiError
from ..core.validation import RULES, field
from ..domain import audit, segments, tusd
from ..domain.segments import SegmentIn, TagIn
from ..queries.users import User
from .deps import rebuild_after_write, require_access, user_zone

router = APIRouter(prefix="/api", tags=["videos"])
uploader = require_access("upload")
RECENT_S = 7 * 24 * 3600  # published videos stay in "my uploads" for a week
# tusd answers the last chunk before its post-finish hook has marked the upload
# finished: a submit sent at once waits for it, this long at most.
FINISH_WAIT_S = 5.0


class SubmitIn(BaseModel):
    original_filename: str = field("original_filename")
    all_segments_done: bool
    segments: list[SegmentIn] = Field(default=[], max_length=500)
    tags: list[TagIn] = Field(default=[], max_length=50)


class AvailabilityOut(BaseModel):
    available: bool  # False: the server cannot receive uploads now (tusd not running)


class ExistsOut(BaseModel):
    exists: bool  # a video (published, waiting or failed) has this original or encoded file


class SubmittedOut(BaseModel):
    id: int  # the new video's


class UploadStatus(BaseModel):
    id: int
    original_filename: str
    status: Literal["queued", "encoding", "published", "failed"]
    progress: int
    error: str | None
    uploaded_at: str  # e.g. "2026-10-23T12:13:38+02:00" (app/clock.py)
    queue_position: int | None  # 1 = next to be encoded


def _may_manage(me: User, video: sqlite3.Row | None) -> sqlite3.Row:
    """The video, if `me` uploaded it or is an admin (user_mgmt access); else 404."""
    if video is None or (video["uploaded_by"] != me.id and "user_mgmt" not in me.access):
        raise ApiError("video.unknown")
    return video


@router.get("/uploads/available")
def uploads_available(_: User = Depends(uploader)) -> AvailabilityOut:
    """Can the server receive uploads now? The page warns before work is lost."""
    return AvailabilityOut(available=tusd.available())


@router.get("/videos/exists")
def exists(
    original_sha256: str = Query(**RULES["sha256"]),
    _: User = Depends(uploader),
    con: sqlite3.Connection = Depends(db.get_db),
) -> ExistsOut:
    """True if a video (published, pending or failed) has this original or this encoded file."""
    return ExistsOut(exists=queries.videos.video_known(con, original_sha256))


@router.post(
    "/uploads/{tus_id}/submit",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rebuild_after_write)],
)
def submit(
    tus_id: str,
    body: SubmitIn,
    me: User = Depends(uploader),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> SubmittedOut:
    """Queue a finished upload for encoding, with its segments and tags."""
    # Before waiting for the upload: a wrong annotation is refused at once. Outside the
    # write: techniques, tags and performers are never deleted (the foreign keys would
    # refuse the insert anyway).
    segments.check(con, body.tags, body.segments, zone)

    _wait_finished(con, tus_id)
    with db.write(con):
        upload = queries.uploads.upload(con, tus_id)
        if upload is None or upload["user"] != me.id or upload["state"] == "deleted":
            raise ApiError("upload.unknown")
        if upload["state"] != "finished":
            raise ApiError("upload.not_finished")
        if queries.videos.video_known(con, upload["original_sha256"]):
            raise ApiError("video.exists")
        video_id = queries.videos.insert_video(
            con,
            upload["original_sha256"],
            body.original_filename,
            body.all_segments_done,
            me.id,
            clock.at(0, zone),
            tus_id,
        )
        for tag in body.tags:
            queries.videos.insert_video_tag(con, video_id, tag.id, tag.value)
        for segment in body.segments:
            segment_id = queries.segments.insert_segment(
                con, video_id, segment.technique, segment.begin_s, segment.end_s, segment.performer, me.id
            )
            for tag in segment.tags:
                queries.segments.insert_segment_tag(con, segment_id, tag.id, tag.value)
    audit.event("video.submitted", video_id=video_id, tus_id=tus_id, segments=len(body.segments))
    return SubmittedOut(id=video_id)


class UploadLimits(BaseModel):
    max_bytes: int
    extensions: list[str]  # lower case, without the dot


@router.get("/uploads/limits")
def upload_limits(_: User = Depends(uploader)) -> UploadLimits:
    """What the upload page may send (checked again by the pre-create hook, and the
    content by ffprobe before encoding): the page refuses other files at once."""
    return UploadLimits(max_bytes=settings.current().max_upload_bytes, extensions=limits.extensions())


def _wait_finished(con: sqlite3.Connection, tus_id: str) -> None:
    """Until tusd's post-finish hook has marked the upload (outside a transaction:
    each read sees the hook's commit), or FINISH_WAIT_S."""
    end = time.monotonic() + FINISH_WAIT_S
    while (upload := queries.uploads.upload(con, tus_id)) and upload["state"] == "uploading" and time.monotonic() < end:
        time.sleep(0.1)


@router.get("/uploads/mine")
def my_uploads(me: User = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> list[UploadStatus]:
    """My videos waiting, being encoded or failed, and those published this week."""
    rows = queries.videos.user_videos(con, me.id, clock.at(-RECENT_S))
    return [UploadStatus(**dict(r)) for r in rows]


@router.post("/videos/{video_id}/retry", status_code=status.HTTP_204_NO_CONTENT)
def retry(video_id: int, me: User = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Queue a failed video again (its original is still on the server)."""
    with db.write(con):
        _may_manage(me, queries.videos.video(con, video_id))
        if not queries.videos.retry_video(con, video_id):
            raise ApiError("video.not_failed")
    audit.event("video.retried", video_id=video_id)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(video_id: int, me: User = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Drop a video that is not published yet. The encoder deletes its original."""
    with db.write(con):
        video = _may_manage(me, queries.videos.video(con, video_id))
        if video["status"] in ("published", "encoding"):
            raise ApiError("video.not_deletable")
        queries.videos.delete_video(con, video_id)
        if video["upload"]:
            queries.uploads.set_upload_state(con, video["upload"], "deleted")
    audit.event("video.deleted", video_id=video_id)
