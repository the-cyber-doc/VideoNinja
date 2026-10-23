"""Tags that can be put on videos and segments. Tags are created by admins (no
page yet); a tag takes one of its fixed values, or text in its value format
(any text, or a year). Names (of tags and of fixed values) are translated; text
values are not."""

import re
import sqlite3
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import clock, db, i18n, queries
from .auth import require_access, user_zone

router = APIRouter(prefix="/api", tags=["tags"])
YEARS_BACK = 100  # a "year" tag: from this many years ago to this year
YEAR = re.compile(r"[0-9]{4}")

# What a tag takes: its fixed value IDs, "year", or None (any text).
Rule = list[str] | Literal["year"] | None


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


def year_range(zone: tzinfo) -> tuple[int, int]:
    """The years a "year" tag accepts, from the user's current year."""
    this_year = clock.now().astimezone(zone).year
    return this_year - YEARS_BACK, this_year


def tag_rules(con: sqlite3.Connection) -> dict[str, Rule]:
    rules: dict[str, Rule] = {r["id"]: r["value_format"] for r in queries.tags(con)}
    for v in queries.tag_values(con):
        rule = rules[v["tag"]]
        rules[v["tag"]] = [*(rule if isinstance(rule, list) else []), v["id"]]
    return rules


def value_error(rule: Rule, value: str | None, zone: tzinfo) -> str | None:
    """Why `value` is not accepted by a tag with this rule, or None."""
    if rule == "year":
        low, high = year_range(zone)
        if value is None or not YEAR.fullmatch(value) or not low <= int(value) <= high:
            return f"the value must be a year from {low} to {high}"
    elif rule is not None and value not in rule:
        return "the value must be one of " + ", ".join(rule)
    return None


@router.get("/tags", response_model_exclude_none=True)
def list_tags(
    _: sqlite3.Row = Depends(require_access("upload")),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
    zone: tzinfo = Depends(user_zone),
) -> list[Tag]:
    """Every tag, sorted by name in the request's language, and its values too."""
    values: dict[str, list[TagValue]] = {}
    for v in queries.tag_values(con):
        values.setdefault(v["tag"], []).append(TagValue(id=v["id"], name=i18n.pick(v, "name", lang, v["id"])))
    out = []
    for r in queries.tags(con):
        tag = Tag(id=r["id"], name=i18n.pick(r, "name", lang, r["id"]), format=r["value_format"])
        if r["id"] in values:
            tag.values = sorted(values[r["id"]], key=lambda v: i18n.sort_key(v.name))
        elif tag.format == "year":
            tag.min, tag.max = year_range(zone)
        out.append(tag)
    return sorted(out, key=lambda t: i18n.sort_key(t.name))
