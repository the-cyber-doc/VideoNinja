"""The dependencies of the routers: the session's user, its accesses, its timezone,
and the catalogue rebuild after a write."""

import sqlite3
from collections.abc import Iterator
from datetime import tzinfo
from zoneinfo import ZoneInfo

from fastapi import Depends, Request

from ..core import clock, db, logs
from ..domain import audit, security, snapshot
from ..core.errors import ApiError
from ..queries.users import User


def session_token(request: Request) -> str | None:
    """Dependency: the session cookie's value (its name depends on the base path)."""
    return request.cookies.get(security.session_cookie()[0])


def current_user(
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Depends(session_token),
    zone: ZoneInfo | None = Depends(clock.zone),
) -> User:
    """Dependency for every protected endpoint: 401 unless a valid session cookie is sent."""
    user = security.session_user(con, token, zone) if token else None
    if user is None:
        raise ApiError("auth.not_logged_in")
    logs.add(user_id=user.id)  # on this request's every line from now on
    return user


def user_zone(
    user: User = Depends(current_user), zone: ZoneInfo | None = Depends(clock.zone)
) -> tzinfo:
    """Dependency: the timezone to write this request's dates in (see clock.user_zone)."""
    return clock.user_zone(user.time_zone, zone)


def require_access(*accesses: str):
    """Dependency factory: 403 unless the logged-in user's role grants `access`
    (one of them, if several: e.g. performers for uploads and video management)."""

    def check(user: User = Depends(current_user)) -> User:
        if not set(accesses) & user.access:
            audit.event("access.denied", access=" or ".join(accesses))
            raise ApiError("auth.access_denied")
        return user

    return check


def rebuild_after_write(request: Request) -> Iterator[None]:
    """Router dependency: schedule a catalogue rebuild after each successful write.

    Reads (GET, HEAD) are ignored. A failed request (exception, e.g.
    HTTPException) never gets past the yield, so it schedules nothing.
    """
    yield
    if request.method not in ("GET", "HEAD"):
        snapshot.schedule()
