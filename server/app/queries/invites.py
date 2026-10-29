"""Invitations (a token's SHA-256 for the lookup, the token encrypted)."""

import sqlite3

from .rows import one

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def replace_invite(con: sqlite3.Connection, user_id: int, token_hash: str, token: str, expires_at: str) -> None:
    con.execute(
        'INSERT OR REPLACE INTO "invite" ("user", "token_hash", "token", "expires_at") VALUES (?, ?, ?, ?)',
        (user_id, token_hash, token, expires_at),
    )


def invited_user(con: sqlite3.Connection, token_hash: str, now: str) -> sqlite3.Row | None:
    return one(
        con.execute(
            'SELECT u."id", u."username", u."name", u."role" FROM "invite" i JOIN "user" u ON u."id" = i."user"'
            ' WHERE i."token_hash" = ? AND datetime(i."expires_at") > datetime(?)',
            (token_hash, now),
        )
    )


def invite_token(con: sqlite3.Connection, user_id: int, now: str) -> str | None:
    """The user's unexpired invitation token, still encrypted."""
    row = con.execute(
        'SELECT "token" FROM "invite" WHERE "user" = ? AND datetime("expires_at") > datetime(?)', (user_id, now)
    ).fetchone()
    return row[0] if row else None


def invite_expiry(con: sqlite3.Connection, user_id: int) -> str:
    """The invitation's expiry (a date: app/core/clock.py's format)."""
    expires_at: str = con.execute('SELECT "expires_at" FROM "invite" WHERE "user" = ?', (user_id,)).fetchone()[0]
    return expires_at


def delete_invite(con: sqlite3.Connection, user_id: int) -> bool:
    """True if an invitation was deleted."""
    return con.execute('DELETE FROM "invite" WHERE "user" = ?', (user_id,)).rowcount == 1
