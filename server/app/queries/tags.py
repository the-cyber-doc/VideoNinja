"""Tags, their fixed values, their translations, and where videos and segments use them."""

import json
import sqlite3
from collections.abc import Mapping

from .rows import one

# A tag's columns, with its name and hint in each language ("name_en", "hint_fr"…).
_TAG = (
    'SELECT g."id", g."value_format", g."regexp", g."input_mode", g."min_value", g."max_value",'
    ' n."en" AS "name_en", n."fr" AS "name_fr", h."en" AS "hint_en", h."fr" AS "hint_fr"'
    ' FROM "tag" g JOIN "translation" n ON n."id" = g."name" LEFT JOIN "translation" h ON h."id" = g."hint"'
)
# Every (tag, value) put on a video, a segment or a book.
_USED = (
    'SELECT "tag", "value" FROM "video_has_tags" UNION ALL SELECT "tag", "value" FROM "segment_has_tags"'
    ' UNION ALL SELECT "tag", "value" FROM "book_has_tags"'
)


def tags(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every tag: its format, input hints, name and hint in each language."""
    return con.execute(_TAG).fetchall()


def tag(con: sqlite3.Connection, tag_id: str) -> sqlite3.Row | None:
    return one(con.execute(_TAG + ' WHERE g."id" = ?', (tag_id,)))


def tag_values(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every fixed value of every tag, with its name in each language."""
    return con.execute(
        'SELECT v."tag", v."id", t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "tag_value" v JOIN "translation" t ON t."id" = v."name"'
    ).fetchall()


def value_ids(con: sqlite3.Connection, tag_id: str) -> list[str]:
    return [r[0] for r in con.execute('SELECT "id" FROM "tag_value" WHERE "tag" = ?', (tag_id,))]


def usage(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """How many videos and segments carry each (tag, value): "tag", "value", "used"."""
    return con.execute(
        f'SELECT "tag", "value", count(*) AS "used" FROM ({_USED}) GROUP BY "tag", "value"'  # nosec B608 - constant SQL
    ).fetchall()


def tag_usage(con: sqlite3.Connection, tag_id: str) -> list[sqlite3.Row]:
    """The values videos and segments carry for this tag, and how many each: "value", "used"."""
    return con.execute(
        f'SELECT "value", count(*) AS "used" FROM ({_USED}) WHERE "tag" = ? GROUP BY "value"',  # nosec B608 - constant SQL
        (tag_id,),
    ).fetchall()


def defer_foreign_keys(con: sqlite3.Connection) -> None:
    """Foreign keys checked at the commit, not at each statement (until the end of the
    transaction): a tag and its translations can then be renamed in any order."""
    con.execute("PRAGMA defer_foreign_keys = ON")


def insert_translation(con: sqlite3.Connection, translation_id: str, texts: Mapping[str, str]) -> None:
    con.execute(
        'INSERT INTO "translation" ("id", "en", "fr") VALUES (?, ?, ?)',
        (translation_id, texts["en"], texts.get("fr")),
    )


def delete_translations(con: sqlite3.Connection, translation_ids: list[str]) -> None:
    con.execute(
        'DELETE FROM "translation" WHERE "id" IN (SELECT "value" FROM json_each(?))', (json.dumps(translation_ids),)
    )


def insert_tag(
    con: sqlite3.Connection,
    tag_id: str,
    name: str,
    value_format: str | None,
    regexp: str | None,
    hint: str | None,
    input_mode: str,
    min_value: int | None,
    max_value: int | None,
) -> None:
    con.execute(
        'INSERT INTO "tag" ("id", "name", "value_format", "regexp", "hint", "input_mode", "min_value", "max_value")'
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (tag_id, name, value_format, regexp, hint, input_mode, min_value, max_value),
    )


def delete_tag(con: sqlite3.Connection, tag_id: str) -> None:
    """The tag and its fixed values (not their translations, nor where it is used)."""
    con.execute('DELETE FROM "tag_value" WHERE "tag" = ?', (tag_id,))
    con.execute('DELETE FROM "tag" WHERE "id" = ?', (tag_id,))


def insert_value(con: sqlite3.Connection, tag_id: str, value_id: str, name: str) -> None:
    con.execute('INSERT INTO "tag_value" ("tag", "id", "name") VALUES (?, ?, ?)', (tag_id, value_id, name))


def rename_used(con: sqlite3.Connection, old_id: str, new_id: str, values: Mapping[str, str]) -> None:
    """Where videos, segments and books use tag `old_id`: now `new_id`, and its values renamed
    (`values`: old → new, swaps included: one statement each)."""
    mapping = json.dumps(values)
    for table in ("video_has_tags", "segment_has_tags", "book_has_tags"):
        # Table names are constants (never input).
        con.execute(
            f'UPDATE "{table}" SET "tag" = ?,'  # nosec B608 - constant table names
            f' "value" = coalesce((SELECT m."value" FROM json_each(?) m WHERE m."key" = "{table}"."value"), "value")'
            ' WHERE "tag" = ?',
            (new_id, mapping, old_id),
        )
