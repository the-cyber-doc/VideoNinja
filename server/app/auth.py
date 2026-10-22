import logging
import sqlite3

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel

from . import crypto, db, queries, security
from .security import SESSION_COOKIE
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
    access: list[str]  # what the role allows, e.g. "user_mgmt": the UI shows matching menus


def current_user(
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> sqlite3.Row:
    """Dependency for every protected endpoint: 401 unless a valid session cookie is sent."""
    user = security.session_user(con, token) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user


def require_access(access: str):
    """Dependency factory: 403 unless the logged-in user's role grants `access`."""

    def check(
        user: sqlite3.Row = Depends(current_user),
        con: sqlite3.Connection = Depends(db.get_db),
    ) -> sqlite3.Row:
        if access not in queries.role_access(con, user["role"]):
            log.warning("Denied: user id %s lacks access %r", user["id"], access)
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")
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


def user_out(con: sqlite3.Connection, row: sqlite3.Row) -> UserOut:
    return UserOut(
        username=row["username"],
        name=row["name"],
        role=row["role"],
        access=queries.role_access(con, row["role"]),
    )


@router.post("/login")
def login(body: LoginIn, response: Response, con: sqlite3.Connection = Depends(db.get_db)) -> UserOut:
    user = queries.user_for_login(con, body.username)
    password_ok = security.verify_password(user["pw_hash"] if user else None, body.password)
    totp_ok = _totp_ok(user, body.totp_code)
    # One error for every failure: don't reveal which part was wrong.
    if not (password_ok and totp_ok):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username, password or code")

    security.purge_expired_sessions(con)
    token = security.create_session(con, user["id"])
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=security.SESSION_MAX_S,  # the server enforces the 30-day idle expiry
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return user_out(con, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> None:
    if token:
        security.delete_session(con, token)
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")


@router.get("/me")
def me(
    user: sqlite3.Row = Depends(current_user), con: sqlite3.Connection = Depends(db.get_db)
) -> UserOut:
    return user_out(con, user)
