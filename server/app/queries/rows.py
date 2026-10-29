"""Typed results of a cursor (sqlite3's are Any): the query modules' helpers."""

import sqlite3


def one(cursor: sqlite3.Cursor) -> sqlite3.Row | None:
    """The first row, or None."""
    row: sqlite3.Row | None = cursor.fetchone()
    return row


def inserted(cursor: sqlite3.Cursor) -> int:
    """The new row's ID (an INSERT into a table with an INTEGER PRIMARY KEY)."""
    if cursor.lastrowid is None:
        raise RuntimeError("No row inserted")
    return cursor.lastrowid
