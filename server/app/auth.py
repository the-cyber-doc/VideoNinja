import logging
import sqlite3
from datetime import tzinfo
from zoneinfo import ZoneInfo

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel

from . import clock, crypto, db, i18n, queries, security, throttle
from .errors import ApiError
from .validation import field

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    # Maximum lengths only: login checks existing data, not the creation rules.
    username: str = field("username", max_only=True)
    password: str = field("password", max_only=True)
    totp_code: str = field("totp_code", max_only=True, default="")


class UserOut(BaseModel):
    username: str
    name: str | None
    role: str
    role_name: str  # in the request's language
    access: list[str]  # what the role allows, e.g. "user_mgmt": the UI shows matching menus


def session_token(request: Request) -> str | None:
    """Dependency: the session cookie's value (its name depends on the base path)."""
    return request.cookies.get(security.session_cookie()[0])


def current_user(
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Depends(session_token),
    zone: ZoneInfo | None = Depends(clock.zone),
) -> sqlite3.Row:
    """Dependency for every protected endpoint: 401 unless a valid session cookie is sent."""
    user = security.session_user(con, token, zone) if token else None
    if user is None:
        raise ApiError("auth.not_logged_in")
    return user


def user_zone(
    user: sqlite3.Row = Depends(current_user), zone: ZoneInfo | None = Depends(clock.zone)
) -> tzinfo:
    """Dependency: the timezone to write this request's dates in (see clock.user_zone)."""
    return clock.user_zone(user, zone)


def require_access(*accesses: str):
    """Dependency factory: 403 unless the logged-in user's role grants `access`
    (one of them, if several: e.g. performers for uploads and video management)."""

    def check(user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
        if not set(accesses) & security.accesses(user):
            log.warning("Denied: user id %s lacks access %s", user["id"], " or ".join(map(repr, accesses)))
            raise ApiError("auth.access_denied")
        return user

    return check


def _totp_ok(user: sqlite3.Row | None, code: str) -> bool:
    # TOTP is mandatory: a user without a secret cannot log in (an admin must set one).
    if user is None or not user["totp"]:
        return False
    try:
        secret = crypto.decrypt(user["totp"], crypto.totp_aad(user["id"]))
    except (InvalidTag, ValueError):
        # Wrong key, or the value was tampered with / copied from another row.
        log.error("Cannot decrypt the TOTP secret of user id %s", user["id"])
        return False
    return security.verify_totp(secret, code)


def user_out(con: sqlite3.Connection, row: sqlite3.Row, lang: str) -> UserOut:
    return UserOut(
        username=row["username"],
        name=row["name"],
        role=row["role"],
        role_name=i18n.pick(queries.role_name(con, row["role"]), "name", lang, row["role"]),
        access=queries.role_access(con, row["role"]),
    )


@router.post("/login", dependencies=[Depends(throttle.credential_guard(401))])
def login(
    body: LoginIn,
    response: Response,
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
    zone: ZoneInfo | None = Depends(clock.zone),
) -> UserOut:
    user = queries.user_for_login(con, body.username)
    password_ok = security.verify_password(user["pw_hash"] if user else None, body.password)
    totp_ok = _totp_ok(user, body.totp_code)
    # One error for every failure: don't reveal which part was wrong.
    if not (password_ok and totp_ok):
        raise ApiError("auth.invalid_credentials")

    security.purge_expired_sessions(con)
    token = security.create_session(con, user, zone)
    name, path = security.session_cookie()
    response.set_cookie(
        name,
        token,
        max_age=security.SESSION_MAX_S,  # the server enforces the 30-day idle expiry
        path=path,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return user_out(con, user, lang)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Depends(session_token),
) -> None:
    if token:
        security.delete_session(con, token)
    name, path = security.session_cookie()
    response.delete_cookie(name, path=path, secure=True, httponly=True, samesite="strict")


@router.get("/me")
def me(
    user: sqlite3.Row = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> UserOut:
    return user_out(con, user, lang)
