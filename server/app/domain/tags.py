"""Tags that can be put on videos and segments, defined by admins on the Options page
(api/options.py). A tag's format says what its value is: one of its fixed values
("list"), text matching its regular expression ("regexp"), any text ("free"), or
nothing (None). Text tags may carry input hints: a translated hint, a keyboard
(input_mode) and, numeric, bounds checked here too. Names and hints are translated;
text values are not. The frontend applies the same rules ($lib/tags.ts) from
/api/tags: they are data, never code that knows a tag."""

import re
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated, Literal, Self, TypedDict

from pydantic import AfterValidator, BaseModel, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from .. import queries
from ..core import i18n
from ..core.errors import ApiError
from ..core.validation import RULES, field

Format = Literal["list", "regexp", "free"]  # None: the tag takes no value
InputMode = Literal["text", "numeric"]
NUMBER = re.compile(r"-?[0-9]+")


def name_id(tag_id: str) -> str:
    return f"tag.{tag_id}.name"


def hint_id(tag_id: str) -> str:
    return f"tag.{tag_id}.hint"


def value_name_id(tag_id: str, value_id: str) -> str:
    return f"tag_value.{tag_id}.{value_id}.name"


# --- the rule a value follows ---


@dataclass(frozen=True)
class Rule:
    format: Format | None
    values: frozenset[str] = frozenset()  # "list": the fixed values' IDs
    regexp: str | None = None  # "regexp": the whole value matches it
    min: int | None = None  # bounds of a numeric value ("regexp", "free")
    max: int | None = None


def rule_of(row: sqlite3.Row, values: frozenset[str]) -> Rule:
    """A tag's rule from its row (queries.tags.tags) and its fixed values' IDs."""
    return Rule(row["value_format"], values, row["regexp"], row["min_value"], row["max_value"])


def tag_rules(con: sqlite3.Connection) -> dict[str, Rule]:
    values: dict[str, set[str]] = {}
    for v in queries.tags.tag_values(con):
        values.setdefault(v["tag"], set()).add(v["id"])
    return {r["id"]: rule_of(r, frozenset(values.get(r["id"], ()))) for r in queries.tags.tags(con)}


class TagErrorParams(TypedDict, total=False):
    """The params of a tag value's error (errors.py: tag.*), but the tag."""

    values: str
    pattern: str
    min: int | str
    max: int | str


def value_error(rule: Rule, value: str | None) -> tuple[str, TagErrorParams] | None:
    """Why `value` is not accepted by a tag with this rule (an error code of errors.py
    and its params, but the tag), or None."""
    if rule.format is None:
        return ("tag.no_value", {}) if value is not None else None
    if not value:
        return "tag.missing_value", {}
    if rule.format == "list":
        return None if value in rule.values else ("tag.value", {"values": ", ".join(sorted(rule.values))})
    if rule.regexp is not None and not re.fullmatch(rule.regexp, value):
        return "tag.pattern", {"pattern": rule.regexp}
    if rule.min is not None or rule.max is not None:
        number = int(value) if NUMBER.fullmatch(value) else None
        if (
            number is None
            or (rule.min is not None and number < rule.min)
            or (rule.max is not None and number > rule.max)
        ):
            return "tag.range", {
                "min": "…" if rule.min is None else rule.min,
                "max": "…" if rule.max is None else rule.max,
            }
    return None


def regexp_valid(pattern: str) -> bool:
    """Python can use it. The Options page also checks it with JavaScript's RegExp
    (the frontend matches values with it too)."""
    try:
        re.compile(pattern)
    except re.error:
        return False
    return True


# --- definitions, as the Options page edits them ---


def _every_language(texts: dict[str, str]) -> dict[str, str]:
    if set(texts) != set(i18n.LANGS):
        raise PydanticCustomError("translations", "A text is needed in every language")
    return texts


def _text(rule: str) -> StringConstraints:
    return StringConstraints(
        strip_whitespace=True, min_length=RULES[rule]["min_length"], max_length=RULES[rule]["max_length"]
    )


# A translated text: one non-blank text per language (i18n.LANGS).
Names = Annotated[dict[str, Annotated[str, _text("tag_name")]], AfterValidator(_every_language)]
Hints = Annotated[dict[str, Annotated[str, _text("tag_hint")]], AfterValidator(_every_language)]


class TagValueIn(BaseModel):
    id: str = field("tag_value_id")
    previous_id: str | None = field("tag_value_id", default=None)  # renamed: its ID until now
    names: Names


class TagDefinitionIn(BaseModel):
    id: str = field("tag_id")
    names: Names
    format: Format | None = None
    regexp: str | None = field("tag_regexp", default=None)
    hint: Hints | None = None
    input_mode: InputMode = "text"
    min: int | None = None
    max: int | None = None
    values: list[TagValueIn] = []

    @model_validator(mode="after")
    def only_its_format(self) -> Self:
        """The fields of other formats are dropped (kept empty in the database)."""
        if self.format != "regexp":
            self.regexp = None
        if self.format != "list":
            self.values = []
        if self.format not in ("regexp", "free"):
            self.hint, self.input_mode = None, "text"
        if self.input_mode != "numeric":
            self.min = self.max = None
        return self


def save(con: sqlite3.Connection, old_id: str | None, tag: TagDefinitionIn) -> None:
    """Create (`old_id` None) or replace tag `old_id` with `tag`, inside the caller's
    write. A new ID renames it everywhere (its values, translations, and where videos
    and segments use it), as does a value's. Refused: an ID taken, a removed value in
    use, or values already stored that the new rule refuses."""
    if tag.format == "regexp" and (tag.regexp is None or not regexp_valid(tag.regexp)):
        raise ApiError("tag.regexp_invalid")
    if tag.min is not None and tag.max is not None and tag.min > tag.max:
        raise ApiError("tag.range_invalid")
    if old_id is not None and queries.tags.tag(con, old_id) is None:
        raise ApiError("tag.not_found", tag=old_id)
    if tag.id != old_id and queries.tags.tag(con, tag.id) is not None:
        raise ApiError("tag.exists", tag=tag.id)

    existing = set(queries.tags.value_ids(con, old_id)) if old_id is not None else set()
    renamed: dict[str, str] = {}  # old value ID → new
    claimed = {v.previous_id for v in tag.values if v.previous_id}  # an ID renamed away is free again
    seen: set[str] = set()
    for value in tag.values:
        if value.id in seen:
            raise ApiError("tag.duplicate_value", value=value.id)
        seen.add(value.id)
        source = value.previous_id or (value.id if value.id in existing and value.id not in claimed else None)
        if source is not None:
            if source not in existing or source in renamed:
                raise ApiError("tag.value_unknown", tag=tag.id, value=source)
            renamed[source] = value.id
    used = {r["value"]: r["used"] for r in queries.tags.tag_usage(con, old_id)} if old_id is not None else {}
    for value_id in sorted(existing - renamed.keys()):
        if used.get(value_id):
            raise ApiError("tag.value_in_use", tag=old_id or tag.id, value=value_id, count=used[value_id])

    rule = Rule(tag.format, frozenset(seen), tag.regexp, tag.min, tag.max)
    failing = sum(count for value, count in used.items() if value_error(rule, renamed.get(value, value)))
    if failing:
        raise ApiError("tag.format_conflict", tag=tag.id, count=failing)

    queries.tags.defer_foreign_keys(con)
    if old_id is not None:
        _delete(con, old_id, existing)
        queries.tags.rename_used(con, old_id, tag.id, {old: new for old, new in renamed.items() if old != new})
    queries.tags.insert_translation(con, name_id(tag.id), tag.names)
    if tag.hint is not None:
        queries.tags.insert_translation(con, hint_id(tag.id), tag.hint)
    queries.tags.insert_tag(
        con,
        tag.id,
        name_id(tag.id),
        tag.format,
        tag.regexp,
        hint_id(tag.id) if tag.hint is not None else None,
        tag.input_mode,
        tag.min,
        tag.max,
    )
    for value in tag.values:
        queries.tags.insert_translation(con, value_name_id(tag.id, value.id), value.names)
        queries.tags.insert_value(con, tag.id, value.id, value_name_id(tag.id, value.id))


def delete(con: sqlite3.Connection, tag_id: str) -> None:
    """Delete a tag no video or segment uses, with its values and translations,
    inside the caller's write."""
    if queries.tags.tag(con, tag_id) is None:
        raise ApiError("tag.not_found", tag=tag_id)
    if used := sum(r["used"] for r in queries.tags.tag_usage(con, tag_id)):
        raise ApiError("tag.in_use", tag=tag_id, count=used)
    queries.tags.defer_foreign_keys(con)
    _delete(con, tag_id, set(queries.tags.value_ids(con, tag_id)))


def _delete(con: sqlite3.Connection, tag_id: str, value_ids: set[str]) -> None:
    queries.tags.delete_tag(con, tag_id)
    queries.tags.delete_translations(
        con, [name_id(tag_id), hint_id(tag_id), *(value_name_id(tag_id, v) for v in sorted(value_ids))]
    )


def texts(row: Mapping[str, str | None] | sqlite3.Row, key: str) -> dict[str, str]:
    """A translated text of a row, every language (empty where missing)."""
    return {lang: row[f"{key}_{lang}"] or "" for lang in i18n.LANGS}
