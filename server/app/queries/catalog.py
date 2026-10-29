"""The catalogue: schools → categories → weapons → sections → techniques, and the published segments."""

import json
import sqlite3


# rowid order = insertion order (the seed lists everything in its traditional order).
# Each row with its description in each language ("description_en", "description_fr").
def _named(con: sqlite3.Connection, table: str, *columns: str) -> list[sqlite3.Row]:
    # Table and columns: this module's own names (the callers below), never input.
    names = "".join(f', x."{c}"' for c in ("id", "kanji", "romaji", *columns))[2:]
    sql = f'SELECT {names}, t."en" AS "description_en", t."fr" AS "description_fr" FROM "{table}" x'  # nosec B608
    return con.execute(sql + ' LEFT JOIN "translation" t ON t."id" = x."description" ORDER BY x.rowid').fetchall()


def schools(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "ryu")


def categories(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Taijutsu, Muto Dori, Buki (weapons)."""
    return _named(con, "category")


def weapons(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "weapon")


def sections(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """A school's scrolls and groups: "ryu", "category", "weapon" (None but under Buki)."""
    return _named(con, "section", "ryu", "category", "weapon")


def techniques(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "technique", "section")


def technique_exists(con: sqlite3.Connection, technique_id: str) -> bool:
    return con.execute('SELECT 1 FROM "technique" WHERE "id" = ?', (technique_id,)).fetchone() is not None


def known_techniques(con: sqlite3.Connection, technique_ids: set[str]) -> set[str]:
    """Those of `technique_ids` that exist, in one query (the list as one JSON parameter)."""
    rows = con.execute(
        'SELECT "id" FROM "technique" WHERE "id" IN (SELECT "value" FROM json_each(?))',
        (json.dumps(sorted(technique_ids)),),
    )
    return {r[0] for r in rows}


def segments(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Segments of published videos only: the others are not encoded yet."""
    return con.execute(
        'SELECT s."id", s."video", s."technique", s."begin_s", s."end_s", s."performer"'
        ' FROM "segment" s JOIN "video" v ON v."id" = s."video"'
        " WHERE v.\"status\" = 'published' ORDER BY s.\"id\""
    ).fetchall()


def segment_media(con: sqlite3.Connection, segment_id: int) -> sqlite3.Row | None:
    """The encoded video's SHA-256 (NULL until published), the segment's times and
    its thumbnail file name: the segment's own, else its video's."""
    return con.execute(
        'SELECT v."sha256sum", s."begin_s", s."end_s", COALESCE(s."thumbnail", v."thumbnail") AS "thumbnail"'
        ' FROM "segment" s JOIN "video" v ON v."id" = s."video" WHERE s."id" = ?',
        (segment_id,),
    ).fetchone()
