"""Performers (who performs a segment)."""

import json
import sqlite3


def performers(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute('SELECT "id", "name" FROM "performer"').fetchall()


def performer_exists(con: sqlite3.Connection, performer_id: str) -> bool:
    return con.execute('SELECT 1 FROM "performer" WHERE "id" = ?', (performer_id,)).fetchone() is not None


def known_performers(con: sqlite3.Connection, performer_ids: set[str]) -> set[str]:
    """Those of `performer_ids` that exist, in one query."""
    rows = con.execute(
        'SELECT "id" FROM "performer" WHERE "id" IN (SELECT "value" FROM json_each(?))',
        (json.dumps(sorted(performer_ids)),),
    )
    return {r[0] for r in rows}


def performer_name_exists(con: sqlite3.Connection, name: str) -> bool:
    return con.execute('SELECT 1 FROM "performer" WHERE "name" = ? COLLATE NOCASE', (name,)).fetchone() is not None


def insert_performer(con: sqlite3.Connection, performer_id: str, name: str) -> None:
    con.execute('INSERT INTO "performer" ("id", "name") VALUES (?, ?)', (performer_id, name))
