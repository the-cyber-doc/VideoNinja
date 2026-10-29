"""The catalogue's content, in one language: schools, categories (Taijutsu, Muto Dori,
Buki), weapons, sections (a school's scrolls and groups), techniques and segments.

Written to static files by `snapshot`, which also serves it. Same IDs as the
database, nulls omitted, names stored once and referenced by ID.
"""

import sqlite3
from typing import Any

from . import i18n, queries


def _named(row: sqlite3.Row, lang: str) -> dict[str, Any]:
    out = {"id": row["id"], "kanji": row["kanji"], "romaji": row["romaji"]}
    description = i18n.pick(row, "description", lang)
    if description:
        out["description"] = description
    return out


def build(con: sqlite3.Connection, lang: str) -> dict[str, Any]:
    return {
        "schools": [_named(r, lang) for r in queries.catalog.schools(con)],
        "categories": [_named(r, lang) for r in queries.catalog.categories(con)],
        "weapons": [_named(r, lang) for r in queries.catalog.weapons(con)],
        "sections": [
            {**_named(r, lang), "ryu": r["ryu"], "category": r["category"],
             **({"weapon": r["weapon"]} if r["weapon"] else {})}
            for r in queries.catalog.sections(con)
        ],
        "techniques": [{**_named(r, lang), "section": r["section"]} for r in queries.catalog.techniques(con)],
        "segments": [dict(r) for r in queries.catalog.segments(con)],
    }
