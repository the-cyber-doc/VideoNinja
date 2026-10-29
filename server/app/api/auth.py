import sqlite3
from zoneinfo import ZoneInfo

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel

from .. import audit, clock, crypto, db, i18n, logs, queries, security, throttle
from ..errors import ApiError
from ..queries.users import Credentials, User
from ..validation import field
from .deps import session_token
from .deps import current_user

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


def _totp_ok(credentials: Credentials | None, code: str) -> bool:
    # TOTP is mandatory: a user without a secret cannot log in (an admin must set one).
    if credentials is None or not credentials.totp:
        return False
    user_id = credentials.user.id
    try:
        secret = crypto.decrypt(credentials.totp, crypto.totp_aad(user_id))
    except (InvalidTag, ValueError):
        # Wrong key, or the value was tampered with / copied from another row.
        audit.event("totp.undecryptable", target_user_id=user_id)
        return False
    return security.verify_totp(secret, code)


def user_out(con: sqlite3.Connection, user: User, lang: str) -> UserOut:
    return UserOut(
        username=user.username,
        name=user.name,
        role=user.role,
        role_name=i18n.pick(queries.users.role_name(con, user.role), "name", lang, user.role),
        access=sorted(user.access),
    )


@router.post("/login", dependencies=[Depends(throttle.credential_guard(401))])
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
    zone: ZoneInfo | None = Depends(clock.zone),
) -> UserOut:
    credentials = queries.users.user_for_login(con, body.username)
    password_ok = security.verify_password(credentials.pw_hash if credentials else None, body.password)
    totp_ok = _totp_ok(credentials, body.totp_code)
    # One error for every failure: don't reveal which part was wrong.
    if not (credentials and password_ok and totp_ok):
        audit.event("login.failed", client=throttle.client_key(request))
        raise ApiError("auth.invalid_credentials")

    user = credentials.user
    logs.add(user_id=user.id)
    audit.event("login.succeeded")
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
    if token and (user_id := security.delete_session(con, token)) is not None:
        audit.event("logout", user_id=user_id)  # no session check here: its user, from the row
    name, path = security.session_cookie()
    response.delete_cookie(name, path=path, secure=True, httponly=True, samesite="strict")


@router.get("/me")
def me(
    user: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> UserOut:
    return user_out(con, user, lang)
