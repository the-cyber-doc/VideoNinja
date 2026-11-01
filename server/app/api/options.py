"""The Options page (admin API): the data the application offers to choose from, first
the tags (their rules: domain/tags.py). Needs the "options" access."""

import sqlite3

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from .. import queries
from ..core import db, i18n
from ..domain import audit, tags
from ..domain.tags import Format, InputMode, TagDefinitionIn
from ..queries.users import User
from .deps import require_access

router = APIRouter(prefix="/api/admin", tags=["options"])
options = require_access("options")


class TagValueDefinition(BaseModel):
    id: str
    names: dict[str, str]  # every language (empty where missing)
    used: int  # by how many videos and segments


class TagDefinition(BaseModel):
    id: str
    names: dict[str, str]  # every language (empty where missing)
    format: Format | None  # None: no value
    regexp: str | None
    hint: dict[str, str] | None  # every language, or none
    input_mode: InputMode
    min: int | None
    max: int | None
    values: list[TagValueDefinition]  # "list": sorted by name in the request's language
    used: int  # by how many videos and segments


def _definitions(con: sqlite3.Connection, lang: str) -> list[TagDefinition]:
    with db.read(con):
        rows, value_rows, usage = queries.tags.tags(con), queries.tags.tag_values(con), queries.tags.usage(con)
    used: dict[tuple[str, str | None], int] = {(r["tag"], r["value"]): r["used"] for r in usage}
    values: dict[str, list[TagValueDefinition]] = {}
    for v in sorted(value_rows, key=lambda v: i18n.sort_key(i18n.pick(v, "name", lang, v["id"]))):
        values.setdefault(v["tag"], []).append(
            TagValueDefinition(id=v["id"], names=tags.texts(v, "name"), used=used.get((v["tag"], v["id"]), 0))
        )
    out = [
        TagDefinition(
            id=r["id"],
            names=tags.texts(r, "name"),
            format=r["value_format"],
            regexp=r["regexp"],
            hint=tags.texts(r, "hint") if r["hint_en"] is not None else None,
            input_mode=r["input_mode"],
            min=r["min_value"],
            max=r["max_value"],
            values=values.get(r["id"], []),
            used=sum(n for (tag, _), n in used.items() if tag == r["id"]),
        )
        for r in rows
    ]
    return sorted(out, key=lambda t: i18n.sort_key(t.names[lang] or t.names[i18n.DEFAULT]))


def _definition(con: sqlite3.Connection, lang: str, tag_id: str) -> TagDefinition:
    return next(t for t in _definitions(con, lang) if t.id == tag_id)


@router.get("/tags")
def list_tag_definitions(
    _: User = Depends(options), con: sqlite3.Connection = Depends(db.get_db), lang: str = Depends(i18n.language)
) -> list[TagDefinition]:
    """Every tag as the Options page edits it, sorted by name in the request's language."""
    return _definitions(con, lang)


@router.post("/tags", status_code=status.HTTP_201_CREATED)
def create_tag(
    body: TagDefinitionIn,
    _: User = Depends(options),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> TagDefinition:
    with db.write(con):
        tags.save(con, None, body)
    audit.event("tag.created", tag_id=body.id)
    return _definition(con, lang, body.id)


@router.put("/tags/{tag_id}")
def save_tag(
    tag_id: str,
    body: TagDefinitionIn,
    _: User = Depends(options),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> TagDefinition:
    """The whole tag: a new ID renames it; values missing from `values` are deleted."""
    with db.write(con):
        tags.save(con, tag_id, body)
    audit.event("tag.saved", tag_id=body.id, previous_id=tag_id)
    return _definition(con, lang, body.id)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: str, _: User = Depends(options), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Only a tag no video or segment uses."""
    with db.write(con):
        tags.delete(con, tag_id)
    audit.event("tag.deleted", tag_id=tag_id)
