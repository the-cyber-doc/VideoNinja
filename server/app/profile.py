"""Own profile, for every logged-in user: display name, password, TOTP.

Users may only change their own account here. Changing a credential needs the
current password, and logs the user out of every other session.
"""

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import crypto, db, i18n, queries, security
from .auth import UserOut, current_user, session_token, user_out
from .validation import field

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/profile", tags=["profile"])


class NameIn(BaseModel):
    name: str = field("display_name")


class PasswordIn(BaseModel):
    current_password: str = field("password", max_only=True)
    new_password: str = field("password")


class TotpConfirmIn(BaseModel):
    current_password: str = field("password", max_only=True)
    totp_secret: str = field("totp_secret")
    totp_code: str = field("totp_code")


def _check_password(con: sqlite3.Connection, user: sqlite3.Row, password: str) -> None:
    if not security.verify_password(queries.user_pw_hash(con, user["id"]), password):
        log.warning("Profile: wrong current password for user id %s", user["id"])
        # 403, not 401: the session is still valid.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong current password")


@router.post("/name")
def set_name(
    body: NameIn,
    user: sqlite3.Row = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> UserOut:
    name = body.name.strip() or None
    with con:
        queries.set_user_name(con, user["id"], name)
    return user_out(con, {**user, "name": name}, lang)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def set_password(
    body: PasswordIn,
    user: sqlite3.Row = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    token: str = Depends(session_token),
) -> None:
    _check_password(con, user, body.current_password)
    with con:
        queries.set_user_pw_hash(con, user["id"], security.hash_password(body.new_password))
    security.delete_other_sessions(con, user["id"], token)
    log.warning("Profile: password changed for user id %s", user["id"])


@router.post("/totp")
def new_totp(user: sqlite3.Row = Depends(current_user)) -> dict[str, str]:
    """A fresh TOTP secret and its QR code. Nothing is stored until /totp/confirm."""
    return security.totp_enrollment(user["username"])


@router.post("/totp/confirm", status_code=status.HTTP_204_NO_CONTENT)
def confirm_totp(
    body: TotpConfirmIn,
    user: sqlite3.Row = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    token: str = Depends(session_token),
) -> None:
    """Replace the TOTP secret, once a code from the new one proves the app is set up."""
    _check_password(con, user, body.current_password)
    if not security.verify_totp(body.totp_secret, body.totp_code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid code for the new authenticator")
    with con:
        queries.set_user_totp(con, user["id"], crypto.encrypt(body.totp_secret, crypto.totp_aad(user["id"])))
    security.delete_other_sessions(con, user["id"], token)
    log.warning("Profile: authenticator replaced for user id %s", user["id"])
