"""Catalogue entries proposed by users and their resolution.

A user annotating (a segment, a book annotation) whose technique is missing chooses
"Other" at some step of the picker (school > category > weapon > section > technique)
and names it (romaji, kanji optional): `propose` creates that entry and every one after
it, marked proposed (proposed_by, proposed_at), with readable IDs made from the romaji.
They are in the catalogue at once, like any other (the frontend shows "?" for their
emblem).

An admin (the Options page) then edits each one (its name, the last part of its ID; kanji,
romaji, parent, meanings), merges it into an existing entry, deletes it while unused, or
validates it (its parents first): then it is an ordinary entry.

IDs are hierarchical: section <ryu>.<category>[.<weapon>].<name>, technique <section>.<name>.
Renaming or moving an entry renames everything under it, the rows using its techniques
(segments, book annotations, comments) and its meanings' translation IDs, in the caller's
write (foreign keys deferred until it commits).
"""

import re
import sqlite3
import unicodedata
from typing import Literal, Self

from pydantic import BaseModel, field_validator, model_validator
from pydantic_core import PydanticCustomError

from .. import queries
from ..core import i18n
from ..core.errors import ApiError
from ..core.validation import RULES, field

Kind = Literal["school", "category", "weapon", "section", "technique"]
TABLE: dict[Kind, str] = {
    "school": "ryu",
    "category": "category",
    "weapon": "weapon",
    "section": "section",
    "technique": "technique",
}
# The section column naming each top entry.
COLUMN: dict[Kind, str] = {"school": "ryu", "category": "category", "weapon": "weapon"}
BUKI = "buki"
MAX_ID = RULES["catalog_id"]["max_length"]
NAME_MAX = RULES["catalog_name"]["max_length"]


def slug(text: str) -> str:
    """A readable ID part from a romaji name: "Kotō Ryū" → "koto_ryu" ("entry" when nothing is left)."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", plain).strip("_")[:NAME_MAX].strip("_") or "entry"


def section_id(ryu: str, category: str, weapon: str | None, name: str) -> str:
    return ".".join(p for p in (ryu, category, weapon, name) if p)


def name_of(entry_id: str) -> str:
    """The entry's own part of its ID (the last)."""
    return entry_id.rsplit(".", 1)[-1]


def description_id(table: str, entry_id: str) -> str:
    return f"{table}.{entry_id}.description"


# --- the picker's proposal ---


class NewEntry(BaseModel):
    kanji: str = field("catalog_kanji", default="")
    romaji: str = field("catalog_romaji")

    @field_validator("kanji", "romaji")
    @classmethod
    def stripped(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def named(self) -> Self:
        if not self.romaji:
            raise PydanticCustomError("missing", "A value is missing")
        return self


class Step(BaseModel):
    """One step of the picker: an existing entry (`id`) or a new one (`new`)."""

    id: str | None = field("catalog_id", default=None)
    new: NewEntry | None = None

    @model_validator(mode="after")
    def one(self) -> Self:
        if (self.id is None) == (self.new is None):
            raise PydanticCustomError("missing", "A value is missing")
        return self


class ProposalIn(BaseModel):
    school: Step
    category: Step
    weapon: Step | None = None  # only (and always) under Buki
    section: Step
    technique: Step


class Created(BaseModel):
    """An entry as the catalogue snapshot has it (the frontend adds it to its copy)."""

    kind: Kind
    id: str
    kanji: str
    romaji: str
    ryu: str | None = None
    category: str | None = None
    weapon: str | None = None
    section: str | None = None


def _free(con: sqlite3.Connection, table: str, base: str) -> str:
    """`base`, or base_2, base_3…: the first not taken in `table`."""
    candidate, n = base, 1
    while queries.proposals.exists(con, table, candidate):
        n += 1
        candidate = f"{base}_{n}"
    if len(candidate) > MAX_ID:
        raise ApiError("catalog.id_too_long", id=candidate)
    return candidate


def propose(con: sqlite3.Connection, body: ProposalIn, user_id: int, now: str) -> tuple[str, list[Created]]:
    """Create the new entries of `body` (inside the caller's write): the technique's ID and
    what was created, in order. 422 when an existing step does not fit the ones before it."""
    created: list[Created] = []

    def existing(kind: Kind, entry_id: str) -> sqlite3.Row:
        row = queries.proposals.entry(con, TABLE[kind], entry_id)
        if row is None:
            raise ApiError("catalog.unknown", kind=kind, id=entry_id)
        return row

    def new(kind: Kind, entry_id: str, entry: NewEntry, **parents: str | None) -> str:
        queries.proposals.insert(con, TABLE[kind], entry_id, entry.kanji, entry.romaji, parents, user_id, now)
        created.append(Created(kind=kind, id=entry_id, kanji=entry.kanji, romaji=entry.romaji, **parents))
        return entry_id

    def top(kind: Kind, step: Step) -> str:
        if step.id is not None:
            return str(existing(kind, step.id)["id"])
        assert step.new is not None  # nosec B101 - Step.one
        return new(kind, _free(con, TABLE[kind], slug(step.new.romaji)), step.new)

    ryu = top("school", body.school)
    category = top("category", body.category)
    if (category == BUKI) != (body.weapon is not None):
        raise ApiError("catalog.weapon")
    weapon = top("weapon", body.weapon) if body.weapon is not None else None

    if body.section.id is not None:
        row = existing("section", body.section.id)
        if (row["ryu"], row["category"], row["weapon"]) != (ryu, category, weapon):
            raise ApiError("catalog.mismatch", kind="section", id=body.section.id)
        section = str(row["id"])
    else:
        assert body.section.new is not None  # nosec B101 - Step.one
        base = section_id(ryu, category, weapon, slug(body.section.new.romaji))
        section = new(
            "section", _free(con, "section", base), body.section.new, ryu=ryu, category=category, weapon=weapon
        )

    if body.technique.id is not None:
        row = existing("technique", body.technique.id)
        if row["section"] != section:
            raise ApiError("catalog.mismatch", kind="technique", id=body.technique.id)
        return str(row["id"]), created
    assert body.technique.new is not None  # nosec B101 - Step.one
    base = f"{section}.{slug(body.technique.new.romaji)}"
    return new("technique", _free(con, "technique", base), body.technique.new, section=section), created


# --- the Options page ---


class Parents(BaseModel):
    """A section's school, category and weapon, or a technique's section (the others: none)."""

    ryu: str | None = field("catalog_id", default=None)
    category: str | None = field("catalog_id", default=None)
    weapon: str | None = field("catalog_id", default=None)
    section: str | None = field("catalog_id", default=None)


class EntryEdit(BaseModel):
    name: str = field("catalog_name")  # the last part of its ID
    kanji: str = field("catalog_kanji", default="")
    romaji: str = field("catalog_romaji")
    parents: Parents = Parents()
    # Its meaning in each language ("" or missing: none); English needed when any is given.
    descriptions: dict[str, str] = {}

    @field_validator("descriptions")
    @classmethod
    def known(cls, value: dict[str, str]) -> dict[str, str]:
        limit = RULES["catalog_description"]["max_length"]
        for lang, text in value.items():
            if lang not in i18n.LANGS:
                raise PydanticCustomError("unknown_language", "Unknown language")
            if len(text) > limit:
                raise PydanticCustomError("too_long", "A value is too long", {"max_length": limit})
        return {lang: text.strip() for lang, text in value.items()}


def _proposed(con: sqlite3.Connection, kind: Kind, entry_id: str) -> sqlite3.Row:
    row = queries.proposals.entry(con, TABLE[kind], entry_id)
    if row is None:
        raise ApiError("catalog.not_found", kind=kind, id=entry_id)
    if row["proposed_at"] is None:
        raise ApiError("catalog.not_proposed", id=entry_id)
    return row


def _check_id(con: sqlite3.Connection, table: str, old: str, new: str) -> None:
    if len(new) > MAX_ID:
        raise ApiError("catalog.id_too_long", id=new)
    if new != old and queries.proposals.exists(con, table, new):
        raise ApiError("catalog.id_taken", id=new)


def _rename_row(con: sqlite3.Connection, table: str, old: str, new: str, **parents: str | None) -> None:
    """The row's ID (and parents), its meaning's translation ID with it."""
    row = queries.proposals.entry(con, table, old)
    assert row is not None  # nosec B101 - the callers' own rows
    changes: dict[str, str | None] = {"id": new, **parents}
    if new != old and row["description"]:
        queries.proposals.rename_translation(con, row["description"], description_id(table, new))
        changes["description"] = description_id(table, new)
    queries.proposals.update(con, table, old, changes)


def _move_technique(con: sqlite3.Connection, old: str, new: str, section: str) -> None:
    _check_id(con, "technique", old, new)
    _rename_row(con, "technique", old, new, section=section)
    if new != old:
        queries.proposals.move_uses(con, {old: new})


def _move_section(con: sqlite3.Connection, old: str, ryu: str, category: str, weapon: str | None, name: str) -> str:
    new = section_id(ryu, category, weapon, name)
    _check_id(con, "section", old, new)
    techniques = queries.proposals.children(con, "section", old)
    _rename_row(con, "section", old, new, ryu=ryu, category=category, weapon=weapon)
    for t in techniques:
        _move_technique(con, t["id"], f"{new}.{name_of(t['id'])}", new)
    return new


def _parents_of(row: sqlite3.Row) -> dict[str, str | None]:
    return {"ryu": row["ryu"], "category": row["category"], "weapon": row["weapon"]}


def _move_top(con: sqlite3.Connection, kind: Kind, old: str, new: str) -> None:
    _check_id(con, TABLE[kind], old, new)
    sections = queries.proposals.children(con, COLUMN[kind], old)
    _rename_row(con, TABLE[kind], old, new)
    for s in sections:
        parents = {**_parents_of(s), COLUMN[kind]: new}
        _move_section(con, s["id"], str(parents["ryu"]), str(parents["category"]), parents["weapon"], name_of(s["id"]))


def _section_parents(con: sqlite3.Connection, parents: Parents) -> tuple[str, str, str | None]:
    for kind, table, value in (("school", "ryu", parents.ryu), ("category", "category", parents.category)):
        if value is None or not queries.proposals.exists(con, table, value):
            raise ApiError("catalog.unknown", kind=kind, id=value or "")
    assert parents.ryu is not None and parents.category is not None  # nosec B101 - checked above
    if (parents.category == BUKI) != (parents.weapon is not None):
        raise ApiError("catalog.weapon")
    if parents.weapon is not None and not queries.proposals.exists(con, "weapon", parents.weapon):
        raise ApiError("catalog.unknown", kind="weapon", id=parents.weapon)
    return parents.ryu, parents.category, parents.weapon


def _describe(con: sqlite3.Connection, table: str, entry_id: str, texts: dict[str, str]) -> None:
    """Its meanings: written (English needed), or none (every one empty)."""
    row = queries.proposals.entry(con, table, entry_id)
    assert row is not None  # nosec B101 - just renamed
    translation = description_id(table, entry_id)
    if not any(texts.values()):
        if row["description"]:
            queries.proposals.update(con, table, entry_id, {"description": None})
            queries.proposals.delete_translation(con, row["description"])
        return
    if not texts.get("en"):
        raise ApiError("validation.missing")
    queries.proposals.put_translation(con, translation, {k: v or None for k, v in texts.items()})
    queries.proposals.update(con, table, entry_id, {"description": translation})


def edit(con: sqlite3.Connection, kind: Kind, entry_id: str, body: EntryEdit) -> str:
    """A proposed entry corrected (inside the caller's write, foreign keys deferred): its new ID."""
    _proposed(con, kind, entry_id)
    table = TABLE[kind]
    if kind == "section":
        ryu, category, weapon = _section_parents(con, body.parents)
        new = _move_section(con, entry_id, ryu, category, weapon, body.name)
    elif kind == "technique":
        section = body.parents.section
        if section is None or not queries.proposals.exists(con, "section", section):
            raise ApiError("catalog.unknown", kind="section", id=section or "")
        new = f"{section}.{body.name}"
        _move_technique(con, entry_id, new, section)
    else:
        new = body.name
        _move_top(con, kind, entry_id, new)
    queries.proposals.update(con, table, new, {"kanji": body.kanji.strip(), "romaji": body.romaji.strip()})
    _describe(con, table, new, body.descriptions)
    return new


def validate(con: sqlite3.Connection, kind: Kind, entry_id: str) -> None:
    """Now an ordinary entry; its parents must be validated already."""
    row = _proposed(con, kind, entry_id)
    parents: list[tuple[Kind, str | None]] = []
    if kind == "section":
        parents = [("school", row["ryu"]), ("category", row["category"]), ("weapon", row["weapon"])]
    elif kind == "technique":
        parents = [("section", row["section"])]
    for parent_kind, parent in parents:
        if parent is None:
            continue
        found = queries.proposals.entry(con, TABLE[parent_kind], parent)
        if found is not None and found["proposed_at"] is not None:
            raise ApiError("catalog.parent_proposed", parent=parent)
    queries.proposals.validate(con, TABLE[kind], entry_id)


def _drop(con: sqlite3.Connection, table: str, entry_id: str) -> None:
    row = queries.proposals.entry(con, table, entry_id)
    assert row is not None  # nosec B101 - the callers' own rows
    queries.proposals.delete(con, table, entry_id)
    if row["description"]:
        queries.proposals.delete_translation(con, row["description"])


def _merge_technique(con: sqlite3.Connection, old: str, into: str) -> None:
    queries.proposals.move_uses(con, {old: into})
    _drop(con, "technique", old)


def _merge_section(con: sqlite3.Connection, old: str, into: str) -> None:
    for t in queries.proposals.children(con, "section", old):
        target = f"{into}.{name_of(t['id'])}"
        if queries.proposals.exists(con, "technique", target):
            _merge_technique(con, t["id"], target)
        else:
            _move_technique(con, t["id"], target, into)
    _drop(con, "section", old)


def merge(con: sqlite3.Connection, kind: Kind, entry_id: str, into: str) -> None:
    """Everything that uses or sits under the proposed entry goes to `into` (an entry of the same
    kind; those under it with the same name are merged in turn), then it is deleted."""
    _proposed(con, kind, entry_id)
    if into == entry_id:
        raise ApiError("catalog.merge_self")
    if not queries.proposals.exists(con, TABLE[kind], into):
        raise ApiError("catalog.unknown", kind=kind, id=into)
    if kind == "technique":
        _merge_technique(con, entry_id, into)
        return
    if kind == "section":
        _merge_section(con, entry_id, into)
        return
    sections = queries.proposals.children(con, COLUMN[kind], entry_id)
    if kind == "category" and sections and into == BUKI:
        raise ApiError("catalog.weapon")  # its sections have no weapon
    for s in sections:
        parents = {**_parents_of(s), COLUMN[kind]: into}
        target = section_id(str(parents["ryu"]), str(parents["category"]), parents["weapon"], name_of(s["id"]))
        if queries.proposals.exists(con, "section", target):
            _merge_section(con, s["id"], target)
        else:
            _move_section(
                con, s["id"], str(parents["ryu"]), str(parents["category"]), parents["weapon"], name_of(s["id"])
            )
    _drop(con, TABLE[kind], entry_id)


def usage(con: sqlite3.Connection, kind: Kind, entry_id: str) -> tuple[int, int]:
    """(uses, entries under it): a technique's segments, book annotations and comments; the
    sections or techniques under the others."""
    if kind == "technique":
        return queries.proposals.uses(con, entry_id), 0
    column = "section" if kind == "section" else COLUMN[kind]
    return 0, len(queries.proposals.children(con, column, entry_id))


def delete(con: sqlite3.Connection, kind: Kind, entry_id: str) -> None:
    """A proposed entry nothing uses nor sits under (409 otherwise)."""
    _proposed(con, kind, entry_id)
    used, under = usage(con, kind, entry_id)
    if used:
        raise ApiError("catalog.in_use", id=entry_id, count=used)
    if under:
        raise ApiError("catalog.has_children", id=entry_id, count=under)
    _drop(con, TABLE[kind], entry_id)
