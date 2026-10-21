import hashlib
import secrets
import sqlite3
import time

import pyotp
import segno
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

SESSION_COOKIE = "__Host-session"
SESSION_IDLE_S = 30 * 24 * 3600  # sliding: each visit extends to 30 days from now
SESSION_MAX_S = 365 * 24 * 3600  # absolute cap, whatever the activity
SESSION_REFRESH_S = 24 * 3600  # rewrite last_seen at most once a day

_hasher = PasswordHasher()
# Verified against when the username is unknown, so both cases take the same time.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(pw_hash: str | None, password: str) -> bool:
    """pw_hash=None (unknown user) still runs a full verification, then fails."""
    try:
        _hasher.verify(pw_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return pw_hash is not None


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="Video Ninja")


def totp_enrollment(username: str) -> dict[str, str]:
    """A fresh TOTP secret with its URI and QR code (SVG data URI). Nothing is stored."""
    secret = new_totp_secret()
    uri = totp_uri(secret, username)
    return {"secret": secret, "uri": uri, "qr": segno.make(uri).svg_data_uri(scale=5, border=2)}


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


def _session_id(token: str) -> str:
    # Only the hash is stored: a leaked database or backup holds no usable session.
    return hashlib.sha256(token.encode()).hexdigest()


def purge_expired_sessions(con: sqlite3.Connection) -> None:
    with con:
        con.execute('DELETE FROM "session" WHERE "expires_s" <= ?', (int(time.time()),))


def create_session(con: sqlite3.Connection, user_id: int) -> str:
    """Store a new session and return the cookie token."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with con:
        con.execute(
            'INSERT INTO "session" ("id", "user", "created_s", "last_seen_s", "expires_s")'
            " VALUES (?, ?, ?, ?, ?)",
            (_session_id(token), user_id, now, now, now + SESSION_IDLE_S),
        )
    return token


def session_user(con: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """Return the session's user, or None. Extends the session (sliding expiry)."""
    now = int(time.time())
    sid = _session_id(token)
    row = con.execute(
        'SELECT s."created_s", s."last_seen_s", u."id", u."username", u."name", u."role"'
        ' FROM "session" s JOIN "user" u ON u."id" = s."user"'
        ' WHERE s."id" = ? AND s."expires_s" > ?',
        (sid, now),
    ).fetchone()
    if row is None:
        return None
    if now - row["last_seen_s"] >= SESSION_REFRESH_S:
        expires = min(now + SESSION_IDLE_S, row["created_s"] + SESSION_MAX_S)
        with con:
            con.execute(
                'UPDATE "session" SET "last_seen_s" = ?, "expires_s" = ? WHERE "id" = ?',
                (now, expires, sid),
            )
    return row


def delete_session(con: sqlite3.Connection, token: str) -> None:
    with con:
        con.execute('DELETE FROM "session" WHERE "id" = ?', (_session_id(token),))


def delete_other_sessions(con: sqlite3.Connection, user_id: int, token: str) -> None:
    """Log the user out everywhere else, e.g. after a credential change."""
    with con:
        con.execute(
            'DELETE FROM "session" WHERE "user" = ? AND "id" != ?', (user_id, _session_id(token))
        )
