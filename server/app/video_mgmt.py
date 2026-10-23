"""Video management: the published videos, and their annotation done again
(segments and tags of a video already on the server: nothing is uploaded).
Needs the "video_mgmt" access.

Saving replaces the video's annotation in one transaction: segments sent with
their ID are updated (IDs never change: the PWA caches clips by segment ID),
those without one are added, the others deleted. New and re-timed segments get
a new thumbnail, from the encoded video; deleted ones lose theirs.
"""

import logging
import os
import sqlite3
import tempfile
from datetime import tzinfo
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import db, encoder, paths, queries
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
) -> Annotations:
    video = _published(con, video_id)
    segment_tags: dict[int, list[sqlite3.Row]] = {}
    for r in queries.video_segment_tags(con, video_id):
        segment_tags.setdefault(r["segment"], []).append(r)
    return Annotations(
        all_segments_done=video["all_segments_done"],
        tags=_tags(queries.video_tags(con, video_id)),
        segments=[AnnotatedSegment(**dict(s), tags=_tags(segment_tags.get(s["id"], [])))
                  for s in queries.video_segments(con, video_id)],
    )


@router.put("/videos/{video_id}/annotations", dependencies=[Depends(rebuild_after_write)])
def save_annotations(
    video_id: int,
    body: Annotations,
    me: sqlite3.Row = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> Annotations:
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

    retimed: list[int] = []  # new or moved: their thumbnail must be made again
    removed = [i for i in existing if i not in sent_ids]
    with con:
        for segment_id in removed:
            queries.delete_segment(con, segment_id)
        for segment in body.segments:
            old = existing.get(segment.id)
            if old is None:
                segment_id = queries.insert_segment(
                    con, video_id, segment.technique, segment.begin_s, segment.end_s, segment.performer)
                retimed.append(segment_id)
            else:
                segment_id = segment.id
                queries.update_segment(con, segment_id, segment.technique, segment.begin_s, segment.end_s,
                                       segment.performer)
                queries.clear_segment_tags(con, segment_id)
                if (old["begin_s"], old["end_s"]) != (segment.begin_s, segment.end_s):
                    retimed.append(segment_id)
            for tag in segment.tags:
                queries.insert_segment_tag(con, segment_id, tag.id, tag.value)
        queries.clear_video_tags(con, video_id)
        for tag in body.tags:
            queries.insert_video_tag(con, video_id, tag.id, tag.value)
        queries.set_all_segments_done(con, video_id, body.all_segments_done)

    folder = paths.video_dir() / video["sha256sum"][:2] / video["sha256sum"]
    for segment_id in removed:
        (folder / f"segment-{segment_id}.jpg").unlink(missing_ok=True)
    _make_thumbnails(con, video, folder, retimed)
    log.info("Video %s annotated by user id %s: %d segments (%d removed)", video_id, me["id"],
             len(body.segments), len(removed))
    return get_annotations(video_id, me, con)


def _make_thumbnails(con: sqlite3.Connection, video: sqlite3.Row, folder: Path, segment_ids: list[int]) -> None:
    """In the middle of each segment, as when the video was published."""
    if not segment_ids:
        return
    times = {s["id"]: s for s in queries.video_segments(con, video["id"])}
    duration = video["duration_s"] or max(s["end_s"] for s in times.values())
    for segment_id in segment_ids:
        segment, name = times[segment_id], f"segment-{segment_id}.jpg"
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".", suffix=".jpg")
        os.close(fd)
        try:
            encoder.thumbnail(folder / "video.mp4", encoder.middle(segment["begin_s"], segment["end_s"], duration),
                              Path(tmp))
            os.replace(tmp, folder / name)  # whole or not at all
        except (OSError, encoder.JobError) as e:
            log.warning("Video %s: no thumbnail for segment %s: %s", video["id"], segment_id, e)
            continue
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        with con:
            queries.set_segment_thumbnail(con, segment_id, video["id"], name)
