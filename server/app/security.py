import hashlib
import json
import os
import secrets
import sqlite3
import threading
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import timedelta, tzinfo
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import pyotp
import segno
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from . import clock, db, paths, queries

SESSION_IDLE_S = 30 * 24 * 3600  # sliding: each visit extends to 30 days from now
SESSION_MAX_S = 365 * 24 * 3600  # absolute cap, whatever the activity
SESSION_REFRESH_S = 24 * 3600  # rewrite last_seen at most once a day

_hasher = PasswordHasher()
# Verified against when the username is unknown, so both cases take the same time.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))

# Each Argon2 hash takes 64 MiB and a CPU core for a moment: a burst of logins (or of
# wrong passwords, each still hashed) would exhaust the container's memory. At most
# VIDEONINJA_ARGON2_CONCURRENCY at a time (default 2); the others wait their turn up
# to ARGON2_WAIT_S, then get 503 (main.py: Busy).
ARGON2_WAIT_S = 10.0
_argon2 = threading.BoundedSemaphore(max(1, int(os.environ.get("VIDEONINJA_ARGON2_CONCURRENCY", "2"))))


class Busy(Exception):
    """Too many password checks at once: try again in a moment."""


@contextmanager
def _argon2_slot() -> Iterator[None]:
    if not _argon2.acquire(timeout=ARGON2_WAIT_S):
        raise Busy()
    try:
        yield
    finally:
        _argon2.release()


def hash_password(password: str) -> str:
    with _argon2_slot():
        return _hasher.hash(password)


def verify_password(pw_hash: str | None, password: str) -> bool:
    """pw_hash=None (unknown user) still runs a full verification, then fails."""
    with _argon2_slot():
        try:
            _hasher.verify(pw_hash or _DUMMY_HASH, password)
        except (VerificationError, InvalidHashError):
            return False
    return pw_hash is not None


# --- Cross-site requests ---
# Writes are refused unless the browser says they come from this origin: the session
# cookie is SameSite=Strict already; this also stops a site of the same domain
# (another subdomain is "same-site", not "same-origin").


def cross_site(headers: Mapping[str, str]) -> bool:
    """True if a state-changing request does not come from a page of this origin.
    Sec-Fetch-Site (every current browser) decides; else Origin must name this
    host (older browsers); neither (tools, server calls, tests): not a browser's."""
    site = headers.get("sec-fetch-site")
    if site is not None:
        return site != "same-origin"
    origin = headers.get("origin")
    if origin is None:
        return False
    host = headers.get("x-forwarded-host") or headers.get("host") or ""
    # nginx forwards the host without its port ($host): compare host names only.
    return urlsplit(origin).hostname != urlsplit(f"//{host}").hostname


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


def session_cookie() -> tuple[str, str]:
    """The session cookie's name and path.

    At the domain's root: "__Host-session", Path=/ (the browser then enforces
    Secure, no Domain, Path=/). Under a base path, the app shares its origin with
    the domain's other sites: "__Secure-session" with Path=<base path>, so that
    their servers never receive it (a __Host- cookie must have Path=/)."""
    base = paths.base_path()
    return ("__Secure-session", base) if base else ("__Host-session", "/")


def _session_id(token: str) -> str:
    # Only the hash is stored: a leaked database or backup holds no usable session.
    return hashlib.sha256(token.encode()).hexdigest()


def purge_expired_sessions(con: sqlite3.Connection) -> None:
    with db.write(con):
        queries.delete_expired_sessions(con, clock.at())


def create_session(con: sqlite3.Connection, user: sqlite3.Row, zone: tzinfo | None = None) -> str:
    """Store a new session and return the cookie token. `zone`: the browser's timezone."""
    token = secrets.token_urlsafe(32)
    tz = clock.user_zone(user, zone)
    with db.write(con):
        remember_zone(con, user, zone)
        queries.insert_session(con, _session_id(token), user["id"], clock.at(0, tz), clock.at(SESSION_IDLE_S, tz))
    return token


def remember_zone(con: sqlite3.Connection, user: sqlite3.Row, zone: ZoneInfo | None) -> None:
    """Save the browser's timezone on the user, for writes without a browser request."""
    if zone is not None and zone.key != user["time_zone"]:
        queries.set_user_time_zone(con, user["id"], zone.key)


def session_user(con: sqlite3.Connection, token: str, zone: ZoneInfo | None = None) -> sqlite3.Row | None:
    """Return the session's user, or None. Extends the session (sliding expiry).
    `zone`: the browser's timezone (None: the user's saved one)."""
    now = clock.now()
    sid = _session_id(token)
    row = queries.session_user(con, sid, clock.text(now))
    if row is None:
        return None
    new_zone = zone is not None and zone.key != row["time_zone"]
    refresh = now - clock.parse(row["last_seen_at"]) >= timedelta(seconds=SESSION_REFRESH_S)
    if new_zone or refresh:  # every request reads this: the write lock only when something changes
        with db.write(con):
            remember_zone(con, row, zone)
            if refresh:
                expires = min(now + timedelta(seconds=SESSION_IDLE_S),
                              clock.parse(row["created_at"]) + timedelta(seconds=SESSION_MAX_S))
                tz = clock.user_zone(row, zone)
                queries.touch_session(con, sid, clock.text(now, tz), clock.text(expires, tz))
    return row


def accesses(user: sqlite3.Row) -> frozenset[str]:
    """What the user's role allows, from the session_user() row (no other query)."""
    return frozenset(json.loads(user["access"]))


def delete_session(con: sqlite3.Connection, token: str) -> int | None:
    """End the session; its user's ID, or None if it did not exist (expired, already ended)."""
    with db.write(con):
        return queries.delete_session(con, _session_id(token))


def delete_other_sessions(con: sqlite3.Connection, user_id: int, token: str) -> None:
    """Log the user out everywhere else, e.g. after a credential change: call inside
    the transaction that changes the credential, so both happen or neither."""
    queries.delete_user_sessions(con, user_id, except_id=_session_id(token))
