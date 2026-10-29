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

import sqlite3
from datetime import tzinfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import queries
from ..core import db
from ..domain import audit, segments
from ..core.errors import ApiError
from ..queries.users import User
from ..domain.segments import AnnotatedSegment, TagIn
from .deps import rebuild_after_write
from .deps import require_access, user_zone

router = APIRouter(prefix="/api", tags=["video management"])
manager = require_access("video_mgmt")


class VideoOut(BaseModel):
    id: int
    original_filename: str
    uploaded_at: str
    duration_s: float | None  # None: published before durations were kept
    all_segments_done: bool
    segment_count: int


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
    row = queries.videos.published_video(con, video_id)
    if row is None:
        raise ApiError("video.unknown")
    return row


def _tags(rows) -> list[TagIn]:
    return [TagIn(id=r["tag"], value=r["value"]) for r in rows]


@router.get("/videos")
def list_videos(_: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)) -> list[VideoOut]:
    """Every published video, newest upload first."""
    return [VideoOut(**dict(r)) for r in queries.videos.published_videos(con)]


@router.get("/videos/{video_id}/annotations")
def get_annotations(
    video_id: int, _: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)
) -> AnnotationsOut:
    with db.read(con):  # segments and their tags from the same save
        video = _published(con, video_id)
        segment_tags: dict[int, list[sqlite3.Row]] = {}
        for r in queries.segments.video_segment_tags(con, video_id):
            segment_tags.setdefault(r["segment"], []).append(r)
        return AnnotationsOut(
            all_segments_done=video["all_segments_done"],
            original_filename=video["original_filename"],
            uploaded_by=video["uploaded_by"],
            tags=_tags(queries.videos.video_tags(con, video_id)),
            segments=[SegmentOut(**dict(s), tags=_tags(segment_tags.get(s["id"], [])))
                      for s in queries.segments.video_segments(con, video_id)],
        )


@router.put("/videos/{video_id}/annotations", dependencies=[Depends(rebuild_after_write)])
def save_annotations(
    video_id: int,
    body: Annotations,
    me: User = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> AnnotationsOut:
    # One write transaction from the first read: two editors saving the same video
    # at once are applied one after the other, never mixed.
    with db.write(con):
        video = _published(con, video_id)
        existing = {s["id"]: s for s in queries.segments.video_segments(con, video_id)}
        segments.check(con, body.tags, body.segments, zone, existing=existing, duration_s=video["duration_s"])
        sent_ids = {s.id for s in body.segments if s.id is not None}

        changed = False  # a segment added, moved or removed: thumbnails to make or delete
        removed = [i for i in existing if i not in sent_ids]
        for segment_id in removed:
            queries.segments.delete_segment(con, segment_id)
        for segment in body.segments:
            old = existing.get(segment.id)
            if old is None:
                segment_id = queries.segments.insert_segment(
                    con, video_id, segment.technique, segment.begin_s, segment.end_s, segment.performer, me.id)
                changed = True
            else:
                segment_id = segment.id
                queries.segments.update_segment(con, segment_id, segment.technique, segment.begin_s,
                                                segment.end_s, segment.performer)
                queries.segments.clear_segment_tags(con, segment_id)
                if (old["begin_s"], old["end_s"]) != (segment.begin_s, segment.end_s):
                    queries.thumbnails.clear_segment_thumbnail(con, segment_id)
                    changed = True
            for tag in segment.tags:
                queries.segments.insert_segment_tag(con, segment_id, tag.id, tag.value)
        queries.videos.clear_video_tags(con, video_id)
        for tag in body.tags:
            queries.videos.insert_video_tag(con, video_id, tag.id, tag.value)
        queries.videos.set_all_segments_done(con, video_id, body.all_segments_done)
        if changed or removed:
            queries.thumbnails.mark_thumbs_dirty(con, video_id)

    audit.event("annotations.saved", video_id=video_id, segments=len(body.segments), removed=len(removed))
    return get_annotations(video_id, me, con)
