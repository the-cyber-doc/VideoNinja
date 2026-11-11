"""The catalogue's proposed entries ("Other" in the technique picker) and what resolves
them (the Options page): rows of ryu, category, weapon, section and technique with
"proposed_at" set, renamed, moved, merged, deleted or validated. Table and column names
come from TABLES and the callers' constants (domain/proposals.py), never from input."""

import json
import sqlite3
from collections.abc import Mapping

from ..core import i18n
from .rows import one
from .users import DELETED_USER_ID

TABLES = ("ryu", "category", "weapon", "section", "technique")
# Where a technique is used: rows that keep its ID.
_USES = ("segment", "book_annotation", "comment")
# Each table's parent columns, as the catalogue shows them.
_PARENTS = {"section": ("ryu", "category", "weapon"), "technique": ("section",)}


def _table(table: str) -> str:
    if table not in TABLES:
        raise ValueError(table)  # a caller's mistake, never input
    return table


def entry(con: sqlite3.Connection, table: str, entry_id: str) -> sqlite3.Row | None:
    """ "id", "kanji", "romaji", "proposed_at", "description" and the parent columns."""
    columns = "".join(f', "{c}"' for c in _PARENTS.get(table, ()))
    return one(
        con.execute(
            f'SELECT "id", "kanji", "romaji", "proposed_at", "description"{columns}'  # nosec B608 - constant names
            f' FROM "{_table(table)}" WHERE "id" = ?',
            (entry_id,),
        )
    )


def exists(con: sqlite3.Connection, table: str, entry_id: str) -> bool:
    sql = f'SELECT 1 FROM "{_table(table)}" WHERE "id" = ?'  # nosec B608 - constant names
    return con.execute(sql, (entry_id,)).fetchone() is not None


def insert(
    con: sqlite3.Connection,
    table: str,
    entry_id: str,
    kanji: str,
    romaji: str,
    parents: Mapping[str, str | None],
    user_id: int,
    now: str,
) -> None:
    """A proposed entry (its parent columns: `parents`, those of _PARENTS[table])."""
    columns = ["id", "kanji", "romaji", *parents, "proposed_by", "proposed_at"]
    names = ", ".join(f'"{c}"' for c in columns)
    marks = ", ".join("?" for _ in columns)
    con.execute(
        f'INSERT INTO "{_table(table)}" ({names}) VALUES ({marks})',  # nosec B608 - constant names
        (entry_id, kanji, romaji, *parents.values(), user_id, now),
    )


def pending(con: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    """The proposed entries of `table`, oldest first: as `entry`, with "proposed_by" (the
    proposer's display name; None: deleted) and the description in every language."""
    columns = "".join(f', x."{c}"' for c in _PARENTS.get(table, ()))
    languages = "".join(f', t."{lang}" AS "description_{lang}"' for lang in i18n.LANGS)
    return con.execute(
        f'SELECT x."id", x."kanji", x."romaji", x."proposed_at"{columns}{languages},'  # nosec B608 - constant names
        ' COALESCE(u."name", u."username") AS "proposed_by"'
        f' FROM "{_table(table)}" x LEFT JOIN "translation" t ON t."id" = x."description"'
        ' LEFT JOIN "user" u ON u."id" = x."proposed_by" AND u."id" <> ?'
        ' WHERE x."proposed_at" IS NOT NULL ORDER BY datetime(x."proposed_at"), x.rowid',
        (DELETED_USER_ID,),
    ).fetchall()


def uses(con: sqlite3.Connection, technique_id: str) -> int:
    """Segments, book annotations and comments of the technique."""
    return sum(
        con.execute(f'SELECT count(*) FROM "{t}" WHERE "technique" = ?', (technique_id,)).fetchone()[0]  # nosec B608
        for t in _USES
    )


def children(con: sqlite3.Connection, column: str, value: str) -> list[sqlite3.Row]:
    """The sections (column ryu, category or weapon) or techniques (column section) under
    an entry: "id" and the parent columns, in catalogue order."""
    table = "technique" if column == "section" else "section"
    columns = "".join(f', "{c}"' for c in _PARENTS[table])
    if column not in _PARENTS[table]:
        raise ValueError(column)
    return con.execute(
        f'SELECT "id"{columns} FROM "{table}" WHERE "{column}" = ? ORDER BY rowid',  # nosec B608 - constant names
        (value,),
    ).fetchall()


def update(con: sqlite3.Connection, table: str, entry_id: str, changes: Mapping[str, str | None]) -> None:
    """Columns of one row (its ID among them: a rename; foreign keys deferred by the caller)."""
    for column in changes:
        if column not in ("id", "kanji", "romaji", "description", *_PARENTS.get(table, ())):
            raise ValueError(column)
    sets = ", ".join(f'"{c}" = ?' for c in changes)
    con.execute(
        f'UPDATE "{_table(table)}" SET {sets} WHERE "id" = ?',  # nosec B608 - constant names
        (*changes.values(), entry_id),
    )


def validate(con: sqlite3.Connection, table: str, entry_id: str) -> None:
    con.execute(
        f'UPDATE "{_table(table)}" SET "proposed_by" = NULL, "proposed_at" = NULL WHERE "id" = ?',  # nosec B608
        (entry_id,),
    )


def delete(con: sqlite3.Connection, table: str, entry_id: str) -> None:
    con.execute(f'DELETE FROM "{_table(table)}" WHERE "id" = ?', (entry_id,))  # nosec B608 - constant names


def move_uses(con: sqlite3.Connection, mapping: Mapping[str, str]) -> None:
    """Where segments, book annotations and comments use a technique of `mapping` (old → new):
    the new one (one statement per table)."""
    pairs = json.dumps(mapping)
    for t in _USES:
        con.execute(
            f'UPDATE "{t}" SET "technique" = (SELECT m."value" FROM json_each(?) m WHERE m."key" = "{t}"."technique")'  # nosec B608
            f' WHERE "technique" IN (SELECT "key" FROM json_each(?))',
            (pairs, pairs),
        )


def put_translation(con: sqlite3.Connection, translation_id: str, texts: Mapping[str, str | None]) -> None:
    """Insert or replace a translation row (every language column)."""
    columns = ", ".join(f'"{lang}"' for lang in i18n.LANGS)
    marks = ", ".join("?" for _ in i18n.LANGS)
    con.execute(
        f'INSERT OR REPLACE INTO "translation" ("id", {columns}) VALUES (?, {marks})',  # nosec B608 - constant names
        (translation_id, *(texts.get(lang) for lang in i18n.LANGS)),
    )


def rename_translation(con: sqlite3.Connection, old_id: str, new_id: str) -> None:
    con.execute('UPDATE "translation" SET "id" = ? WHERE "id" = ?', (new_id, old_id))


def delete_translation(con: sqlite3.Connection, translation_id: str) -> None:
    con.execute('DELETE FROM "translation" WHERE "id" = ?', (translation_id,))
