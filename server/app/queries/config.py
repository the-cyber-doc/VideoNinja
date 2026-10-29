"""The config table, and the encoder's heartbeat."""

import sqlite3


def config_value(con: sqlite3.Connection, name: str) -> str | None:
    row = con.execute('SELECT "value" FROM "config" WHERE "name" = ?', (name,)).fetchone()
    return row["value"] if row else None


def set_heartbeat(con: sqlite3.Connection, name: str, at: str) -> None:
    con.execute(
        'INSERT INTO "heartbeat" ("name", "at") VALUES (?, ?) ON CONFLICT ("name") DO UPDATE SET "at" = excluded."at"',
        (name, at),
    )


def heartbeat(con: sqlite3.Connection, name: str) -> str | None:
    row = con.execute('SELECT "at" FROM "heartbeat" WHERE "name" = ?', (name,)).fetchone()
    return row["at"] if row else None
