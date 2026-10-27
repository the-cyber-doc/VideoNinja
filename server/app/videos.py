"""Uploading videos (the user's side): duplicate check, submit, status, retry, delete.

The file itself goes to tusd (see tusd.py) and is encoded by the app's queue
(see encoder.py). A submitted video waits in the queue and is published when
encoded; until then its segments are not in the catalogue.
"""

import sqlite3
import time
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator

from . import clock, db, limits, queries, tusd
from .auth import require_access, user_zone
from .snapshot import rebuild_after_write
from .tags import Rule, tag_rules, value_error
from .validation import RULES, field

router = APIRouter(prefix="/api", tags=["videos"])
uploader = require_access("upload")
RECENT_S = 7 * 24 * 3600  # published videos stay in "my uploads" for a week
# tusd answers the last chunk before its post-finish hook has marked the upload
# finished: a submit sent at once waits for it, this long at most.
FINISH_WAIT_S = 5.0


class TagIn(BaseModel):
    id: str = field("catalog_id")
    value: str | None = field("tag_value", default=None)


class SegmentIn(BaseModel):
    begin_s: int = Field(ge=0)
    end_s: int = Field(gt=0)
    technique: str = field("catalog_id")
    performer: str = field("catalog_id")
    tags: list[TagIn] = []

    @model_validator(mode="after")
    def ordered(self):
        if self.end_s <= self.begin_s:
            raise ValueError("A segment must end after it begins")
        return self


class SubmitIn(BaseModel):
    original_filename: str = field("original_filename")
    all_segments_done: bool
    segments: list[SegmentIn] = Field(default=[], max_length=500)
    tags: list[TagIn] = Field(default=[], max_length=50)


class UploadStatus(BaseModel):
    id: int
    original_filename: str
    status: Literal["queued", "encoding", "published", "failed"]
    progress: int
    error: str | None
    uploaded_at: str  # e.g. "2026-10-23T12:13:38+02:00" (app/clock.py)
    queue_position: int | None  # 1 = next to be encoded


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _check_tags(tags: list[TagIn], known: dict[str, Rule], zone: tzinfo) -> None:
    if len({t.id for t in tags}) != len(tags):
        raise _unprocessable("A tag is given twice")
    for tag in tags:
        if tag.id not in known:
            raise _unprocessable(f"Unknown tag: {tag.id}")
        if error := value_error(known[tag.id], tag.value, zone):
            raise _unprocessable(f"Tag {tag.id}: {error}")


def _may_manage(con: sqlite3.Connection, me: sqlite3.Row, video: sqlite3.Row | None) -> sqlite3.Row:
    """The video, if `me` uploaded it or is an admin (user_mgmt access); else 404."""
    if video is None or (
        video["uploaded_by"] != me["id"] and "user_mgmt" not in queries.role_access(con, me["role"])
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown video")
    return video


@router.get("/uploads/available")
def uploads_available(_: sqlite3.Row = Depends(uploader)) -> dict[str, bool]:
    """Can the server receive uploads now? The page warns before work is lost."""
    return {"available": tusd.available()}


@router.get("/videos/exists")
def exists(
    original_sha256: str = Query(**RULES["sha256"]),
    _: sqlite3.Row = Depends(uploader),
    con: sqlite3.Connection = Depends(db.get_db),
) -> dict[str, bool]:
    """True if a video (published, pending or failed) has this original or this encoded file."""
    return {"exists": queries.video_known(con, original_sha256)}


@router.post(
    "/uploads/{tus_id}/submit",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rebuild_after_write)],
)
def submit(
    tus_id: str,
    body: SubmitIn,
    me: sqlite3.Row = Depends(uploader),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> dict[str, int]:
    """Queue a finished upload for encoding, with its segments and tags."""
    known_tags = tag_rules(con)
    _check_tags(body.tags, known_tags, zone)
    for segment in body.segments:
        if not queries.technique_exists(con, segment.technique):
            raise _unprocessable(f"Unknown technique: {segment.technique}")
        if not queries.performer_exists(con, segment.performer):
            raise _unprocessable(f"Unknown performer: {segment.performer}")
        _check_tags(segment.tags, known_tags, zone)

    _wait_finished(con, tus_id)
    with con:
        upload = queries.upload(con, tus_id)
        if upload is None or upload["user"] != me["id"] or upload["state"] == "deleted":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown upload")
        if upload["state"] != "finished":
            raise HTTPException(status.HTTP_409_CONFLICT, "The upload is not finished")
        if queries.video_known(con, upload["original_sha256"]):
            raise HTTPException(status.HTTP_409_CONFLICT, "This video already exists")
        video_id = queries.insert_video(
            con, upload["original_sha256"], body.original_filename, body.all_segments_done,
            me["id"], clock.at(0, zone), tus_id,
        )
        for tag in body.tags:
            queries.insert_video_tag(con, video_id, tag.id, tag.value)
        for segment in body.segments:
            segment_id = queries.insert_segment(
                con, video_id, segment.technique, segment.begin_s, segment.end_s, segment.performer, me["id"]
            )
            for tag in segment.tags:
                queries.insert_segment_tag(con, segment_id, tag.id, tag.value)
    return {"id": video_id}


class UploadLimits(BaseModel):
    max_bytes: int
    extensions: list[str]  # lower case, without the dot


@router.get("/uploads/limits")
def upload_limits(_: sqlite3.Row = Depends(uploader)) -> UploadLimits:
    """What the upload page may send (checked again by the pre-create hook, and the
    content by ffprobe before encoding): the page refuses other files at once."""
    return UploadLimits(max_bytes=limits.max_upload_bytes(), extensions=limits.extensions())


def _wait_finished(con: sqlite3.Connection, tus_id: str) -> None:
    """Until tusd's post-finish hook has marked the upload (outside a transaction:
    each read sees the hook's commit), or FINISH_WAIT_S."""
    end = time.monotonic() + FINISH_WAIT_S
    while (upload := queries.upload(con, tus_id)) and upload["state"] == "uploading" and time.monotonic() < end:
        time.sleep(0.1)


@router.get("/uploads/mine")
def my_uploads(me: sqlite3.Row = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> list[UploadStatus]:
    """My videos waiting, being encoded or failed, and those published this week."""
    rows = queries.user_videos(con, me["id"], clock.at(-RECENT_S))
    return [UploadStatus(**dict(r)) for r in rows]


@router.post("/videos/{video_id}/retry", status_code=status.HTTP_204_NO_CONTENT)
def retry(video_id: int, me: sqlite3.Row = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Queue a failed video again (its original is still on the server)."""
    with con:
        _may_manage(con, me, queries.video(con, video_id))
        if not queries.retry_video(con, video_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed video can be retried")


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(video_id: int, me: sqlite3.Row = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Drop a video that is not published yet. The encoder deletes its original."""
    with con:
        video = _may_manage(con, me, queries.video(con, video_id))
        if video["status"] in ("published", "encoding"):
            raise HTTPException(status.HTTP_409_CONFLICT, "Published or encoding videos cannot be deleted here")
        queries.delete_video(con, video_id)
        if video["upload"]:
            queries.set_upload_state(con, video["upload"], "deleted")
