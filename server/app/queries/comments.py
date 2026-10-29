"""Comments on techniques."""

import sqlite3

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def technique_comments(con: sqlite3.Connection, technique_id: str, user_id: int) -> list[sqlite3.Row]:
    """Last modified first, with the author's display name (else username) and
    "mine": written by `user_id`."""
    return con.execute(
        'SELECT c."id", COALESCE(u."name", u."username") AS "user", c."created_at", c."modified_at",'
        ' c."lang", c."text", c."user" = ? AS "mine"'
        ' FROM "comment" c JOIN "user" u ON u."id" = c."user"'
        ' WHERE c."technique" = ? ORDER BY datetime(c."modified_at") DESC, c."id" DESC',
        (user_id, technique_id),
    ).fetchall()


def comment(con: sqlite3.Connection, comment_id: int, user_id: int) -> sqlite3.Row | None:
    """One comment, as in technique_comments, with its author's ID ("author")."""
    return con.execute(
        'SELECT c."id", COALESCE(u."name", u."username") AS "user", c."created_at", c."modified_at",'
        ' c."lang", c."text", c."user" = ? AS "mine", c."user" AS "author"'
        ' FROM "comment" c JOIN "user" u ON u."id" = c."user" WHERE c."id" = ?',
        (user_id, comment_id),
    ).fetchone()


def insert_comment(con: sqlite3.Connection, technique_id: str, user_id: int, lang: str, text: str, now: str) -> int:
    return con.execute(
        'INSERT INTO "comment" ("technique", "user", "lang", "text", "created_at", "modified_at")'
        " VALUES (?, ?, ?, ?, ?, ?)",
        (technique_id, user_id, lang, text, now, now),
    ).lastrowid


def update_comment(con: sqlite3.Connection, comment_id: int, lang: str, text: str, now: str) -> None:
    con.execute(
        'UPDATE "comment" SET "lang" = ?, "text" = ?, "modified_at" = ? WHERE "id" = ?',
        (lang, text, now, comment_id),
    )


def delete_comment(con: sqlite3.Connection, comment_id: int) -> None:
    con.execute('DELETE FROM "comment" WHERE "id" = ?', (comment_id,))
