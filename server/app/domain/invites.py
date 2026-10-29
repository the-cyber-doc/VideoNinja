"""Invitations: a one-week link with which a new (or reset) user sets a password and TOTP.

The link is /register#<token>: the token is in the fragment, so it is never sent
in a URL to the server, never logged and never leaked by a Referer. The database
stores its SHA-256 (lookup) and the token encrypted (the admin can copy the link
again), never the token in clear.
"""

import hashlib
import secrets
import sqlite3

from .. import queries
from ..core import clock, crypto

INVITE_TTL_S = 7 * 24 * 3600


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aad(user_id: int) -> str:
    return f"user:{user_id}:invite"


def create(con: sqlite3.Connection, user_id: int) -> str:
    """Replace the user's invitation with a new one; return its token. Call inside a transaction."""
    token = secrets.token_urlsafe(32)
    # In the server's timezone: the invitee's is not known yet.
    queries.invites.replace_invite(
        con, user_id, _hash(token), crypto.encrypt(token, _aad(user_id)), clock.at(INVITE_TTL_S)
    )
    return token


def user_for(con: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """The invited user if the token is valid and not expired, else None."""
    return queries.invites.invited_user(con, _hash(token), clock.at())


def token_of(con: sqlite3.Connection, user_id: int) -> str | None:
    """The user's current, unexpired invitation token (to copy the link again), or None."""
    token = queries.invites.invite_token(con, user_id, clock.at())
    return crypto.decrypt(token, _aad(user_id)) if token else None
