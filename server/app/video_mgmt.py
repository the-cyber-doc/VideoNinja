"""Video management: the published videos, and their annotation done again
(segments and tags of a video already on the server: nothing is uploaded).
Needs the "video_mgmt" access.

Saving replaces the video's annotation in one transaction: segments sent with
their ID are updated (IDs never change: the PWA caches clips by segment ID),
those without one are added, the others deleted. New and re-timed segments get
a new thumbnail and deleted ones lose theirs, by the encoder (the API runs no
ffmpeg and cannot write the media): the video is marked (video.thumbs_dirty) and
the segment shows its video's thumbnail meanwhile.
"""

import logging
import sqlite3
from datetime import tzinfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import db, queries
from .auth import require_access, user_zone
from .snapshot import rebuild_after_write
from .tags import tag_rules
from .videos import SegmentIn, TagIn, _check_tags, _unprocessable

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api", tags=["video management"])
manager = require_access("video_mgmt")


class VideoOut(BaseModel):
    id: int
    original_filename: str
    uploaded_at: str
    duration_s: float | None  # None: published before durations were kept
    all_segments_done: bool
    segment_count: int


class AnnotatedSegment(SegmentIn):
    id: int | None = None  # None: a new segment


class Annotations(BaseModel):
    all_segments_done: bool
    segments: list[AnnotatedSegment] = Field(default=[], max_length=500)
    tags: list[TagIn] = Field(default=[], max_length=50)


# Read only: who did what, by display name (never user IDs). None: user unknown.
class SegmentOut(AnnotatedSegment):
    created_by: str | None


class AnnotationsOut(Annotations):
    original_filename: str
    uploaded_by: str | None
    segments: list[SegmentOut]


def _published(con: sqlite3.Connection, video_id: int) -> sqlite3.Row:
    row = queries.published_video(con, video_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown video")
    return row


def _tags(rows) -> list[TagIn]:
    return [TagIn(id=r["tag"], value=r["value"]) for r in rows]


@router.get("/videos")
def list_videos(_: sqlite3.Row = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)) -> list[VideoOut]:
    """Every published video, newest upload first."""
    return [VideoOut(**dict(r)) for r in queries.published_videos(con)]


@router.get("/videos/{video_id}/annotations")
def get_annotations(
    video_id: int, _: sqlite3.Row = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)
) -> AnnotationsOut:
    video = _published(con, video_id)
    segment_tags: dict[int, list[sqlite3.Row]] = {}
    for r in queries.video_segment_tags(con, video_id):
        segment_tags.setdefault(r["segment"], []).append(r)
    return AnnotationsOut(
        all_segments_done=video["all_segments_done"],
        original_filename=video["original_filename"],
        uploaded_by=video["uploaded_by"],
        tags=_tags(queries.video_tags(con, video_id)),
        segments=[SegmentOut(**dict(s), tags=_tags(segment_tags.get(s["id"], [])))
                  for s in queries.video_segments(con, video_id)],
    )


@router.put("/videos/{video_id}/annotations", dependencies=[Depends(rebuild_after_write)])
def save_annotations(
    video_id: int,
    body: Annotations,
    me: sqlite3.Row = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> AnnotationsOut:
    video = _published(con, video_id)
    existing = {s["id"]: s for s in queries.video_segments(con, video_id)}
    known_tags = tag_rules(con)
    _check_tags(body.tags, known_tags, zone)
    sent_ids = [s.id for s in body.segments if s.id is not None]
    if len(set(sent_ids)) != len(sent_ids):
        raise _unprocessable("A segment is given twice")
    for segment in body.segments:
        if segment.id is not None and segment.id not in existing:
            raise _unprocessable(f"Unknown segment of this video: {segment.id}")
        if not queries.technique_exists(con, segment.technique):
            raise _unprocessable(f"Unknown technique: {segment.technique}")
        if not queries.performer_exists(con, segment.performer):
            raise _unprocessable(f"Unknown performer: {segment.performer}")
        if video["duration_s"] is not None and segment.end_s > video["duration_s"] + 1:
            raise _unprocessable("A segment ends after the end of the video")
        _check_tags(segment.tags, known_tags, zone)

    changed = False  # a segment added, moved or removed: thumbnails to make or delete
    removed = [i for i in existing if i not in sent_ids]
    with con:
        for segment_id in removed:
            queries.delete_segment(con, segment_id)
        for segment in body.segments:
            old = existing.get(segment.id)
            if old is None:
                segment_id = queries.insert_segment(
                    con, video_id, segment.technique, segment.begin_s, segment.end_s, segment.performer, me["id"])
                changed = True
            else:
                segment_id = segment.id
                queries.update_segment(con, segment_id, segment.technique, segment.begin_s, segment.end_s,
                                       segment.performer)
                queries.clear_segment_tags(con, segment_id)
                if (old["begin_s"], old["end_s"]) != (segment.begin_s, segment.end_s):
                    queries.clear_segment_thumbnail(con, segment_id)
                    changed = True
            for tag in segment.tags:
                queries.insert_segment_tag(con, segment_id, tag.id, tag.value)
        queries.clear_video_tags(con, video_id)
        for tag in body.tags:
            queries.insert_video_tag(con, video_id, tag.id, tag.value)
        queries.set_all_segments_done(con, video_id, body.all_segments_done)
        if changed or removed:
            queries.mark_thumbs_dirty(con, video_id)

    log.info("Video %s annotated by user id %s: %d segments (%d removed)", video_id, me["id"],
             len(body.segments), len(removed))
    return get_annotations(video_id, me, con)
