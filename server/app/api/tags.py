"""The tags an upload or the Videos page may use, names in the request's language,
and the rule each value follows (checked again by domain/tags.py)."""

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import queries
from ..core import db, i18n
from ..domain.tags import Format, InputMode
from ..queries.users import User
from .deps import require_access

router = APIRouter(prefix="/api", tags=["tags"])
annotator = require_access("upload", "video_mgmt")  # the upload and Videos pages


class TagValue(BaseModel):
    id: str  # what is stored in video_has_tags / segment_has_tags
    name: str  # in the request's language


class Tag(BaseModel):
    id: str
    name: str  # in the request's language
    format: Format | None = None  # None: no value
    values: list[TagValue] | None = None  # "list": its values, sorted by name
    regexp: str | None = None  # "regexp": the whole value matches it
    hint: str | None = None  # "regexp", "free": placeholder and help, in the request's language
    input_mode: InputMode = "text"  # the keyboard
    min: int | None = None  # numeric: bounds of the number
    max: int | None = None


@router.get("/tags", response_model_exclude_none=True)
def list_tags(
    _: User = Depends(annotator),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> list[Tag]:
    """Every tag, sorted by name in the request's language, with its rule."""
    values: dict[str, list[TagValue]] = {}
    for v in queries.tags.tag_values(con):
        values.setdefault(v["tag"], []).append(TagValue(id=v["id"], name=i18n.pick(v, "name", lang, v["id"])))
    out = []
    for r in queries.tags.tags(con):
        tag = Tag(
            id=r["id"],
            name=i18n.pick(r, "name", lang, r["id"]),
            format=r["value_format"],
            regexp=r["regexp"],
            hint=i18n.pick(r, "hint", lang),
            input_mode=r["input_mode"],
            min=r["min_value"],
            max=r["max_value"],
        )
        if tag.format == "list":
            tag.values = sorted(values.get(r["id"], []), key=lambda v: i18n.sort_key(v.name))
        out.append(tag)
    return sorted(out, key=lambda t: i18n.sort_key(t.name))
