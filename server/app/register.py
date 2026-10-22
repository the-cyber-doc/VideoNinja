"""Registration of an invited user (public, the invitation token is the credential)."""

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import crypto, db, invites, queries, security
from .validation import field

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/register", tags=["register"])


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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid or expired invitation")
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid TOTP code")
    with con:
        # Deleting the invitation first makes the link single-use, even under concurrent requests.
        if not queries.delete_invite(con, user["id"]):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid or expired invitation")
        queries.set_user_registration(
            con,
            user["id"],
            body.name.strip() or None,
            security.hash_password(body.password),
            crypto.encrypt(body.totp_secret, crypto.totp_aad(user["id"])),
        )
    log.warning("Registered: user id %s (%r)", user["id"], user["username"])
