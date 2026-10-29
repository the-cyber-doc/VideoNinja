"""The tags an upload or the Videos page may use, names in the request's language
(the rules a value must follow: tags.py)."""

import sqlite3
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import queries
from ..core import db, i18n
from ..queries.users import User
from ..domain.tags import year_range
from .deps import require_access, user_zone

router = APIRouter(prefix="/api", tags=["tags"])


class TagValue(BaseModel):
    id: str  # what is stored in video_has_tags / segment_has_tags
    name: str  # in the request's language


class Tag(BaseModel):
    id: str
    name: str  # in the request's language
    values: list[TagValue] | None = None  # fixed values, sorted by name
    format: Literal["year"] | None = None  # without values: None = any text
    min: int | None = None  # format "year": the range accepted
    max: int | None = None


@router.get("/tags", response_model_exclude_none=True)
def list_tags(
    _: User = Depends(require_access("upload", "video_mgmt")),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
    zone: tzinfo = Depends(user_zone),
) -> list[Tag]:
    """Every tag, sorted by name in the request's language, and its values too."""
    values: dict[str, list[TagValue]] = {}
    for v in queries.tags.tag_values(con):
        values.setdefault(v["tag"], []).append(TagValue(id=v["id"], name=i18n.pick(v, "name", lang, v["id"])))
    out = []
    for r in queries.tags.tags(con):
        tag = Tag(id=r["id"], name=i18n.pick(r, "name", lang, r["id"]), format=r["value_format"])
        if r["id"] in values:
            tag.values = sorted(values[r["id"]], key=lambda v: i18n.sort_key(v.name))
        elif tag.format == "year":
            tag.min, tag.max = year_range(zone)
        out.append(tag)
    return sorted(out, key=lambda t: i18n.sort_key(t.name))
