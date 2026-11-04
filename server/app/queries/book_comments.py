"""Comments on the annotations of books."""

import json
import sqlite3

from .rows import inserted, one
from .users import DELETED_USER_ID

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().

_COLUMNS = (
    'c."id", c."annotation", COALESCE(u."name", u."username") AS "user", c."created_at", c."modified_at",'
    ' c."lang", c."text", c."user" = ? AS "mine"'
)
_FROM = 'FROM "book_comment" c LEFT JOIN "user" u ON u."id" = c."user" AND u."id" <> ?'
_ORDER = 'ORDER BY datetime(c."created_at"), c."id"'  # a thread: oldest first


def annotation_comments(con: sqlite3.Connection, annotation_id: int, user_id: int) -> list[sqlite3.Row]:
    """An annotation's thread, oldest first, with the author's display name (else username; None:
    the deleted user) and "mine": written by `user_id`."""
    return con.execute(
        f'SELECT {_COLUMNS} {_FROM} WHERE c."annotation" = ? {_ORDER}',  # nosec B608 - constant parts
        (user_id, DELETED_USER_ID, annotation_id),
    ).fetchall()


def book_comments(con: sqlite3.Connection, book_id: int, user_id: int) -> list[sqlite3.Row]:
    """Every thread of a book's annotations, as annotation_comments."""
    return con.execute(
        f'SELECT {_COLUMNS} {_FROM} JOIN "book_annotation" a ON a."id" = c."annotation"'  # nosec B608 - constant parts
        f' WHERE a."book" = ? {_ORDER}',
        (user_id, DELETED_USER_ID, book_id),
    ).fetchall()


def comment(con: sqlite3.Connection, comment_id: int, user_id: int) -> sqlite3.Row | None:
    """One comment, as in annotation_comments, with its author's ID ("author")."""
    return one(
        con.execute(
            f'SELECT {_COLUMNS}, c."user" AS "author" {_FROM} WHERE c."id" = ?',  # nosec B608 - constant parts
            (user_id, DELETED_USER_ID, comment_id),
        )
    )


def insert_comment(con: sqlite3.Connection, annotation_id: int, user_id: int, lang: str, text: str, now: str) -> int:
    return inserted(
        con.execute(
            'INSERT INTO "book_comment" ("annotation", "user", "lang", "text", "created_at", "modified_at")'
            " VALUES (?, ?, ?, ?, ?, ?)",
            (annotation_id, user_id, lang, text, now, now),
        )
    )


def update_comment(con: sqlite3.Connection, comment_id: int, lang: str, text: str, now: str) -> None:
    con.execute(
        'UPDATE "book_comment" SET "lang" = ?, "text" = ?, "modified_at" = ? WHERE "id" = ?',
        (lang, text, now, comment_id),
    )


def delete_comment(con: sqlite3.Connection, comment_id: int) -> None:
    con.execute('DELETE FROM "book_comment" WHERE "id" = ?', (comment_id,))


def comments_of(con: sqlite3.Connection, annotation_ids: list[int], user_id: int) -> list[sqlite3.Row]:
    """The threads of these annotations, in one query (the IDs as one JSON parameter)."""
    return con.execute(
        f"SELECT {_COLUMNS} {_FROM}"  # nosec B608 - constant parts
        f' WHERE c."annotation" IN (SELECT "value" FROM json_each(?)) {_ORDER}',
        (user_id, DELETED_USER_ID, json.dumps(annotation_ids)),
    ).fetchall()
