"""A video's annotation as sent by the browser (segments and tags) and its checks,
shared by the upload page (videos.submit) and the Videos page
(video_mgmt.save_annotations). The checks read the database: call them inside the
write transaction that stores the annotation, so what they found still holds."""

import sqlite3
from collections.abc import Mapping, Sequence
from datetime import tzinfo


from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from . import queries
from .errors import ApiError
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
            raise PydanticCustomError("segment_order", "A segment must end after it begins")
        return self


class AnnotatedSegment(SegmentIn):
    id: int | None = None  # None: a new segment (Videos page; uploads only send new ones)


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
        raise ApiError("segment.duplicate")
    techniques = queries.known_techniques(con, {s.technique for s in segments})
    performers = queries.known_performers(con, {s.performer for s in segments})
    for segment in segments:
        segment_id = segment.id if isinstance(segment, AnnotatedSegment) else None
        if segment_id is not None and (existing is None or segment_id not in existing):
            raise ApiError("segment.unknown", id=segment_id)
        if segment.technique not in techniques:
            raise ApiError("segment.unknown_technique", technique=segment.technique)
        if segment.performer not in performers:
            raise ApiError("segment.unknown_performer", performer=segment.performer)
        if duration_s is not None and segment.end_s > duration_s + 1:
            raise ApiError("segment.after_end")
        _check_tags(segment.tags, rules, zone)


def _check_tags(tags: Sequence[TagIn], rules: dict[str, Rule], zone: tzinfo) -> None:
    if len({t.id for t in tags}) != len(tags):
        raise ApiError("tag.duplicate")
    for tag in tags:
        if tag.id not in rules:
            raise ApiError("tag.unknown", tag=tag.id)
        if error := value_error(rules[tag.id], tag.value, zone):
            code, params = error
            raise ApiError(code, tag=tag.id, **params)
