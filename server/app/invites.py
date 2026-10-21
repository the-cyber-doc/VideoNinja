"""Invitations: a one-week link with which a new (or reset) user sets a password and TOTP.

The link is /register#<token>: the token is in the fragment, so it is never sent
in a URL to the server, never logged and never leaked by a Referer. The database
stores its SHA-256 (lookup) and the token encrypted (the admin can copy the link
again), never the token in clear.
"""

import hashlib
import secrets
import sqlite3
import time

from . import crypto

INVITE_TTL_S = 7 * 24 * 3600


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aad(user_id: int) -> str:
    return f"user:{user_id}:invite"


def create(con: sqlite3.Connection, user_id: int) -> str:
    """Replace the user's invitation with a new one; return its token. Call inside a transaction."""
    token = secrets.token_urlsafe(32)
    con.execute(
        'INSERT OR REPLACE INTO "invite" ("user", "token_hash", "token", "expires_s") VALUES (?, ?, ?, ?)',
        (user_id, _hash(token), crypto.encrypt(token, _aad(user_id)), int(time.time()) + INVITE_TTL_S),
    )
    return token


def user_for(con: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """The invited user if the token is valid and not expired, else None."""
    return con.execute(
        'SELECT u."id", u."username", u."name", u."role" FROM "invite" i JOIN "user" u ON u."id" = i."user"'
        ' WHERE i."token_hash" = ? AND i."expires_s" > ?',
        (_hash(token), int(time.time())),
    ).fetchone()


def token_of(con: sqlite3.Connection, user_id: int) -> str | None:
    """The user's current, unexpired invitation token (to copy the link again), or None."""
    row = con.execute(
        'SELECT "token" FROM "invite" WHERE "user" = ? AND "expires_s" > ?', (user_id, int(time.time()))
    ).fetchone()
    return crypto.decrypt(row[0], _aad(user_id)) if row else None
