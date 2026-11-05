"""The catalogue's content, in one language: schools, categories (Taijutsu, Muto Dori,
Buki), weapons, sections (a school's scrolls and groups), techniques, segments (with
their tags), the segments' performers, and every tag with its fixed values (names for
the segments', videos' and books' tags; the client's search indexes every language's).

Written to static files by `snapshot`, which also serves it. Same IDs as the
database, nulls omitted, names stored once and referenced by ID.
"""

import sqlite3
from typing import Any

from .. import queries
from ..core import i18n


def _named(row: sqlite3.Row, lang: str) -> dict[str, Any]:
    out = {"id": row["id"], "kanji": row["kanji"], "romaji": row["romaji"]}
    description = i18n.pick(row, "description", lang)
    if description:
        out["description"] = description
    return out


def _segments(con: sqlite3.Connection) -> list[dict[str, Any]]:
    tagged: dict[int, list[dict[str, str]]] = {}
    for r in queries.catalog.segment_tags(con):
        tagged.setdefault(r["segment"], []).append({"id": r["tag"], **({"value": r["value"]} if r["value"] else {})})
    return [
        {**dict(r), **({"tags": tagged[r["id"]]} if r["id"] in tagged else {})} for r in queries.catalog.segments(con)
    ]


def _tags(con: sqlite3.Connection, lang: str) -> list[dict[str, Any]]:
    values: dict[str, list[dict[str, str]]] = {}
    for r in queries.tags.tag_values(con):
        values.setdefault(r["tag"], []).append({"id": r["id"], "name": i18n.pick(r, "name", lang, r["id"])})
    return [
        {
            "id": r["id"],
            "name": i18n.pick(r, "name", lang, r["id"]),
            **({"values": sorted(values[r["id"]], key=lambda v: v["id"])} if r["id"] in values else {}),
        }
        for r in sorted(queries.tags.tags(con), key=lambda r: r["id"])
    ]


def build(con: sqlite3.Connection, lang: str) -> dict[str, Any]:
    return {
        "schools": [_named(r, lang) for r in queries.catalog.schools(con)],
        "categories": [_named(r, lang) for r in queries.catalog.categories(con)],
        "weapons": [_named(r, lang) for r in queries.catalog.weapons(con)],
        "sections": [
            {
                **_named(r, lang),
                "ryu": r["ryu"],
                "category": r["category"],
                **({"weapon": r["weapon"]} if r["weapon"] else {}),
            }
            for r in queries.catalog.sections(con)
        ],
        "techniques": [{**_named(r, lang), "section": r["section"]} for r in queries.catalog.techniques(con)],
        "segments": _segments(con),
        "performers": [dict(r) for r in queries.catalog.segment_performers(con)],
        "tags": _tags(con, lang),
    }
