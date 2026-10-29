"""Sessions (only the SHA-256 of each token is stored)."""

import sqlite3
from dataclasses import dataclass

from .users import USER_COLUMNS, User


@dataclass(frozen=True)
class ActiveSession:
    user: User
    created_at: str
    last_seen_at: str

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def insert_session(
    con: sqlite3.Connection, session_id: str, user_id: int, now: str, expires_at: str
) -> None:
    con.execute(
        'INSERT INTO "session" ("id", "user", "created_at", "last_seen_at", "expires_at")'
        " VALUES (?, ?, ?, ?, ?)",
        (session_id, user_id, now, now, expires_at),
    )


def session_user(con: sqlite3.Connection, session_id: str, now: str) -> ActiveSession | None:
    """The unexpired session's times and its user, with what its role allows: every
    protected request needs both, in one query."""
    row = con.execute(
        f'SELECT s."created_at", s."last_seen_at", {USER_COLUMNS}'  # a constant, no input  # nosec B608
        ' FROM "session" s JOIN "user" u ON u."id" = s."user"'
        ' WHERE s."id" = ? AND datetime(s."expires_at") > datetime(?)',
        (session_id, now),
    ).fetchone()
    return ActiveSession(User.from_row(row), row["created_at"], row["last_seen_at"]) if row else None


def touch_session(con: sqlite3.Connection, session_id: str, now: str, expires_at: str) -> None:
    con.execute(
        'UPDATE "session" SET "last_seen_at" = ?, "expires_at" = ? WHERE "id" = ?',
        (now, expires_at, session_id),
    )


def delete_session(con: sqlite3.Connection, session_id: str) -> int | None:
    """The session's user, or None if there was no such session."""
    row = con.execute('DELETE FROM "session" WHERE "id" = ? RETURNING "user"', (session_id,)).fetchone()
    return row[0] if row else None


def delete_user_sessions(con: sqlite3.Connection, user_id: int, except_id: str | None = None) -> None:
    """All the user's sessions, except `except_id` if given."""
    if except_id is None:
        con.execute('DELETE FROM "session" WHERE "user" = ?', (user_id,))
    else:
        con.execute('DELETE FROM "session" WHERE "user" = ? AND "id" != ?', (user_id, except_id))


def delete_expired_sessions(con: sqlite3.Connection, now: str) -> None:
    con.execute('DELETE FROM "session" WHERE datetime("expires_at") <= datetime(?)', (now,))
