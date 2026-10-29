"""A video's annotation as sent by the browser (segments and tags) and its checks,
shared by the upload page (videos.submit) and the Videos page
(video_mgmt.save_annotations). The checks read the database: call them inside the
write transaction that stores the annotation, so what they found still holds."""

import sqlite3
from collections.abc import Mapping, Sequence
from datetime import tzinfo

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, model_validator

from . import queries
from .tags import Rule, tag_rules, value_error
from .validation import field


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


class AnnotatedSegment(SegmentIn):
    id: int | None = None  # None: a new segment (Videos page; uploads only send new ones)


def unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def check(
    con: sqlite3.Connection,
    tags: Sequence[TagIn],
    segments: Sequence[SegmentIn],
    zone: tzinfo,
    *,
    existing: Mapping[int, object] | None = None,
    duration_s: float | None = None,
) -> None:
    """422 at the first problem: the video's tags, then each segment in order (its
    ID among `existing`, its technique, performer, end within `duration_s` (+1 s:
    whole seconds), its tags). The techniques and performers are looked up once
    for all segments, not once each."""
    rules = tag_rules(con)
    _check_tags(tags, rules, zone)
    ids = [s.id for s in segments if isinstance(s, AnnotatedSegment) and s.id is not None]
    if len(set(ids)) != len(ids):
        raise unprocessable("A segment is given twice")
    techniques = queries.known_techniques(con, {s.technique for s in segments})
    performers = queries.known_performers(con, {s.performer for s in segments})
    for segment in segments:
        segment_id = segment.id if isinstance(segment, AnnotatedSegment) else None
        if segment_id is not None and (existing is None or segment_id not in existing):
            raise unprocessable(f"Unknown segment of this video: {segment_id}")
        if segment.technique not in techniques:
            raise unprocessable(f"Unknown technique: {segment.technique}")
        if segment.performer not in performers:
            raise unprocessable(f"Unknown performer: {segment.performer}")
        if duration_s is not None and segment.end_s > duration_s + 1:
            raise unprocessable("A segment ends after the end of the video")
        _check_tags(segment.tags, rules, zone)


def _check_tags(tags: Sequence[TagIn], rules: dict[str, Rule], zone: tzinfo) -> None:
    if len({t.id for t in tags}) != len(tags):
        raise unprocessable("A tag is given twice")
    for tag in tags:
        if tag.id not in rules:
            raise unprocessable(f"Unknown tag: {tag.id}")
        if error := value_error(rules[tag.id], tag.value, zone):
            raise unprocessable(f"Tag {tag.id}: {error}")
