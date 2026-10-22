"""User management (admin API): needs the "user_mgmt" access."""

import logging
import sqlite3
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import db, i18n, invites, queries
from .auth import require_access
from .validation import field

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/admin", tags=["users"])
admin = require_access("user_mgmt")


class UserRow(BaseModel):
    id: int
    username: str
    name: str | None
    role: str
    # registered: password + TOTP set. invited: valid invitation. expired: neither.
    status: Literal["registered", "invited", "expired"]


class RoleOut(BaseModel):
    id: str
    name: str


class CreateIn(BaseModel):
    username: str = field("username")
    role: str = field("role_id")


class InviteOut(BaseModel):
    token: str  # the link is <origin>/register#<token>
    expires_s: int


@router.get("/roles")
def roles(
    _: sqlite3.Row = Depends(admin),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> list[RoleOut]:
    """Every role, named in the request's language and sorted by that name."""
    out = [RoleOut(id=r["id"], name=i18n.pick(r, "name", lang, r["id"])) for r in queries.roles(con)]
    return sorted(out, key=lambda r: r.name.casefold())


@router.get("/users")
def list_users(_: sqlite3.Row = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> list[UserRow]:
    rows = queries.list_users(con, int(time.time()))
    return [
        UserRow(
            id=r["id"],
            username=r["username"],
            name=r["name"],
            role=r["role"],
            status="registered" if r["registered"] else "invited" if r["invited"] else "expired",
        )
        for r in rows
    ]


def _invite_out(con: sqlite3.Connection, user_id: int, token: str) -> InviteOut:
    return InviteOut(token=token, expires_s=queries.invite_expiry(con, user_id))


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    body: CreateIn, me: sqlite3.Row = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)
) -> InviteOut:
    """Create a user without credentials, and its invitation."""
    if not queries.role_exists(con, body.role):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown role")
    if queries.username_exists(con, body.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "This username already exists")
    with con:
        user_id = queries.insert_user(con, body.username, body.role)
        token = invites.create(con, user_id)
    log.warning("User management: user id %s created %r (%s)", me["id"], body.username, body.role)
    return _invite_out(con, user_id, token)


@router.get("/users/{user_id}/invite")
def get_invite(
    user_id: int, _: sqlite3.Row = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)
) -> InviteOut:
    """The current invitation, to copy the link again."""
    token = invites.token_of(con, user_id)
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No valid invitation")
    return _invite_out(con, user_id, token)


@router.post("/users/{user_id}/reset")
def reset_user(
    user_id: int, me: sqlite3.Row = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)
) -> InviteOut:
    """Issue a new invitation, then remove the password, TOTP and sessions.

    One transaction: either the user has a new link AND no old credentials, or
    nothing changed. The old password and authenticator can never be used again.
    """
    if user_id == me["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot reset your own account")
    if not queries.user_exists(con, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user")
    with con:
        token = invites.create(con, user_id)
        queries.clear_user_credentials(con, user_id)
        queries.delete_user_sessions(con, user_id)
    log.warning("User management: user id %s reset user id %s", me["id"], user_id)
    return _invite_out(con, user_id, token)
