"""Registration of an invited user (public, the invitation token is the credential)."""

import logging
import sqlite3

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from . import crypto, db, invites, queries, security, throttle
from .errors import ApiError
from .validation import field

log = logging.getLogger("uvicorn.error")
# An unknown invitation token (404) counts as a credential failure.
router = APIRouter(prefix="/api/register", tags=["register"],
                   dependencies=[Depends(throttle.credential_guard(404))])


class TokenIn(BaseModel):
    token: str = field("invite_token")


class CompleteIn(TokenIn):
    name: str = field("display_name", default="")
    password: str = field("password")
    totp_secret: str = field("totp_secret")
    totp_code: str = field("totp_code")


def _invited(con: sqlite3.Connection, token: str) -> sqlite3.Row:
    user = invites.user_for(con, token)
    if user is None:
        # Same answer for unknown, used and expired links.
        raise ApiError("invite.invalid")
    return user


@router.post("/verify")
def verify(body: TokenIn, con: sqlite3.Connection = Depends(db.get_db)) -> dict[str, str]:
    """The username the invitation is for."""
    return {"username": _invited(con, body.token)["username"]}


@router.post("/totp")
def new_totp(body: TokenIn, con: sqlite3.Connection = Depends(db.get_db)) -> dict[str, str]:
    """A fresh TOTP secret and its QR code. Nothing is stored until /complete."""
    return security.totp_enrollment(_invited(con, body.token)["username"])


@router.post("/complete", status_code=status.HTTP_204_NO_CONTENT)
def complete(body: CompleteIn, con: sqlite3.Connection = Depends(db.get_db)) -> None:
    user = _invited(con, body.token)
    if not security.verify_totp(body.totp_secret, body.totp_code):
        raise ApiError("totp.invalid_code")
    pw_hash = security.hash_password(body.password)  # slow: before the write lock
    with db.write(con):
        # Deleting the invitation first makes the link single-use, even under concurrent requests.
        if not queries.delete_invite(con, user["id"]):
            raise ApiError("invite.invalid")
        queries.set_user_registration(
            con,
            user["id"],
            body.name.strip() or None,
            pw_hash,
            crypto.encrypt(body.totp_secret, crypto.totp_aad(user["id"])),
        )
    log.warning("Registered: user id %s (%r)", user["id"], user["username"])
