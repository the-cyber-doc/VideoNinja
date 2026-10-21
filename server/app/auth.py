import logging
import sqlite3

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from . import crypto, db, security
from .security import SESSION_COOKIE

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)
    totp_code: str = Field(default="", max_length=6)


class UserOut(BaseModel):
    username: str
    name: str | None
    role: str


def current_user(
    con: sqlite3.Connection = Depends(db.get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> sqlite3.Row:
    """Dependency for every protected endpoint: 401 unless a valid session cookie is sent."""
    user = security.session_user(con, token) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user


def _totp_ok(user: sqlite3.Row | None, code: str) -> bool:
    if user is None:
        return False
    if not user["totp"]:
        return True
    try:
        secret = crypto.decrypt(user["totp"], crypto.totp_aad(user["id"]))
    except (InvalidTag, ValueError):
        # Wrong key, or the value was tampered with / copied from another row.
        log.error("Cannot decrypt the TOTP secret of user id %s", user["id"])
        return False
    return security.verify_totp(secret, code)


def _user_out(row: sqlite3.Row) -> UserOut:
    return UserOut(username=row["username"], name=row["name"], role=row["role"])


@router.post("/login")
def login(body: LoginIn, response: Response, con: sqlite3.Connection = Depends(db.get_db)) -> UserOut:
    user = con.execute(
        'SELECT "id", "username", "name", "pw_hash", "totp", "role" FROM "user" WHERE "username" = ?',
        (body.username,),
    ).fetchone()
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
    return _user_out(user)


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
def me(user: sqlite3.Row = Depends(current_user)) -> UserOut:
    return _user_out(user)
