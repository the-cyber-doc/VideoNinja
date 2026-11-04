"""User management (admin API): needs the "user_mgmt" access."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from .. import queries
from ..core import clock, db, i18n
from ..core.errors import ApiError
from ..core.validation import field
from ..domain import audit, invites
from ..queries.users import User
from .deps import require_access

router = APIRouter(prefix="/api/admin", tags=["users"])
admin = require_access("user_mgmt")


Status = Literal["registered", "invited", "expired", "deactivated"]


class UserRow(BaseModel):
    id: int
    username: str
    name: str | None
    role: str
    # registered: password + TOTP set. invited: valid invitation. expired: an expired
    # invitation. deactivated: neither credentials nor invitation (a reset reactivates).
    status: Status


class RoleOut(BaseModel):
    id: str
    name: str


class CreateIn(BaseModel):
    username: str = field("username")
    role: str = field("role_id")


class RoleIn(BaseModel):
    role: str = field("role_id")


class InviteOut(BaseModel):
    token: str  # the link is <origin>/register#<token>
    expires_at: str  # e.g. "2026-10-30T12:13:38+01:00" (app/clock.py)


@router.get("/roles")
def roles(
    _: User = Depends(admin),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> list[RoleOut]:
    """Every role, named in the request's language and sorted by that name."""
    out = [RoleOut(id=r["id"], name=i18n.pick(r, "name", lang, r["id"])) for r in queries.users.roles(con)]
    return sorted(out, key=lambda r: i18n.sort_key(r.name))


def _status(row: sqlite3.Row) -> Status:
    if row["registered"]:
        return "registered"
    if row["invited"]:
        return "invited"
    return "deactivated" if row["deactivated"] else "expired"


@router.get("/users")
def list_users(_: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> list[UserRow]:
    rows = queries.users.list_users(con, clock.at())
    return [
        UserRow(
            id=r["id"],
            username=r["username"],
            name=r["name"],
            role=r["role"],
            status=_status(r),
        )
        for r in rows
    ]


def _invite_out(con: sqlite3.Connection, user_id: int, token: str) -> InviteOut:
    return InviteOut(token=token, expires_at=queries.invites.invite_expiry(con, user_id))


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(body: CreateIn, me: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> InviteOut:
    """Create a user without credentials, and its invitation."""
    with db.write(con):  # checked and created at once: two admins, one username
        if not queries.users.role_exists(con, body.role):
            raise ApiError("user.unknown_role")
        if queries.users.username_exists(con, body.username):
            raise ApiError("user.exists")
        user_id = queries.users.insert_user(con, body.username, body.role)
        token = invites.create(con, user_id)
    audit.event("user.invited", target_user_id=user_id, role=body.role)
    return _invite_out(con, user_id, token)


@router.get("/users/{user_id}/invite")
def get_invite(user_id: int, _: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> InviteOut:
    """The current invitation, to copy the link again."""
    token = invites.token_of(con, user_id)
    if token is None:
        raise ApiError("user.no_invite")
    audit.event("invite.shown", target_user_id=user_id)
    return _invite_out(con, user_id, token)


@router.post("/users/{user_id}/reset")
def reset_user(user_id: int, me: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> InviteOut:
    """Issue a new invitation, then remove the password, TOTP and sessions.

    One transaction: either the user has a new link AND no old credentials, or
    nothing changed. The old password and authenticator can never be used again.
    """
    if user_id == me.id:
        raise ApiError("user.reset_self")
    with db.write(con):
        if not queries.users.user_exists(con, user_id):
            raise ApiError("user.unknown")
        token = invites.create(con, user_id)
        queries.users.clear_user_credentials(con, user_id)
        queries.sessions.delete_user_sessions(con, user_id)
    audit.event("user.reset", target_user_id=user_id)
    return _invite_out(con, user_id, token)


@router.put("/users/{user_id}/role", status_code=status.HTTP_204_NO_CONTENT)
def set_role(
    user_id: int, body: RoleIn, me: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    """Give the user another role. Their sessions stay: a session reads its user's role on
    every request, so the new accesses apply at their next one. Never one's own (an admin
    would lose User Management)."""
    if user_id == me.id:
        raise ApiError("user.role_self")
    with db.write(con):
        if not queries.users.user_exists(con, user_id):
            raise ApiError("user.unknown")
        if not queries.users.role_exists(con, body.role):
            raise ApiError("user.unknown_role")
        before = queries.users.role_of(con, user_id)
        queries.users.set_user_role(con, user_id, body.role)
    if before != body.role:
        audit.event("user.role_changed", target_user_id=user_id, role=body.role, previous_role=before)


@router.post("/users/{user_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: int, me: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Remove the password, TOTP, sessions and any invitation: the user can no longer log in
    nor register. A reset (a new invitation) reactivates them."""
    if user_id == me.id:
        raise ApiError("user.deactivate_self")
    with db.write(con):
        if not queries.users.user_exists(con, user_id):
            raise ApiError("user.unknown")
        queries.users.clear_user_credentials(con, user_id)
        queries.sessions.delete_user_sessions(con, user_id)
        queries.invites.delete_invite(con, user_id)
    audit.event("user.deactivated", target_user_id=user_id)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, me: User = Depends(admin), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Delete the user (sessions and invitation too). Their comments, segments, videos and
    uploads are kept, given to the generic deleted user. One transaction."""
    if user_id == me.id:
        raise ApiError("user.delete_self")
    with db.write(con):
        if not queries.users.user_exists(con, user_id):
            raise ApiError("user.unknown")
        queries.users.give_to_deleted_user(con, user_id)
        queries.users.delete_user(con, user_id)
    audit.event("user.deleted", target_user_id=user_id)
