"""The catalogue's content: schools, levels, techniques and segments, in one language.

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
        "schools": [_named(r, lang) for r in queries.schools(con)],
        "levels": [_named(r, lang) for r in queries.levels(con)],
        "techniques": [
            {**_named(r, lang), "ryu": r["ryu"], "level": r["level"]} for r in queries.techniques(con)
        ],
        "segments": [dict(r) for r in queries.segments(con)],
    }
