"""Own profile, for every logged-in user: display name, password, TOTP.

Users may only change their own account here. Changing a credential needs the
current password, and logs the user out of every other session.
"""

import dataclasses
import sqlite3

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from .. import audit, crypto, db, i18n, queries, security, throttle
from ..errors import ApiError
from ..queries.users import User
from ..validation import field
from .auth import UserOut, user_out
from .deps import current_user, session_token

router = APIRouter(prefix="/api/profile", tags=["profile"])
# A wrong current password (403) counts as a credential failure.
password_guard = Depends(throttle.credential_guard(403))


class NameIn(BaseModel):
    name: str = field("display_name")


class PasswordIn(BaseModel):
    current_password: str = field("password", max_only=True)
    new_password: str = field("password")


class TotpConfirmIn(BaseModel):
    current_password: str = field("password", max_only=True)
    totp_secret: str = field("totp_secret")
    totp_code: str = field("totp_code")


def _check_password(con: sqlite3.Connection, user: User, password: str) -> None:
    if not security.verify_password(queries.users.user_pw_hash(con, user.id), password):
        audit.event("password.wrong")
        # 403, not 401: the session is still valid.
        raise ApiError("profile.wrong_password")


@router.post("/name")
def set_name(
    body: NameIn,
    user: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    lang: str = Depends(i18n.language),
) -> UserOut:
    name = body.name.strip() or None
    with db.write(con):
        queries.users.set_user_name(con, user.id, name)
    return user_out(con, dataclasses.replace(user, name=name), lang)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[password_guard])
def set_password(
    body: PasswordIn,
    user: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    token: str = Depends(session_token),
) -> None:
    _check_password(con, user, body.current_password)
    pw_hash = security.hash_password(body.new_password)  # slow: before the write lock
    with db.write(con):
        queries.users.set_user_pw_hash(con, user.id, pw_hash)
        security.delete_other_sessions(con, user.id, token)
    audit.event("password.changed")


@router.post("/totp")
def new_totp(user: User = Depends(current_user)) -> dict[str, str]:
    """A fresh TOTP secret and its QR code. Nothing is stored until /totp/confirm."""
    return security.totp_enrollment(user.username)


@router.post("/totp/confirm", status_code=status.HTTP_204_NO_CONTENT, dependencies=[password_guard])
def confirm_totp(
    body: TotpConfirmIn,
    user: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
    token: str = Depends(session_token),
) -> None:
    """Replace the TOTP secret, once a code from the new one proves the app is set up."""
    _check_password(con, user, body.current_password)
    if not security.verify_totp(body.totp_secret, body.totp_code):
        raise ApiError("totp.invalid_code")
    with db.write(con):
        queries.users.set_user_totp(con, user.id, crypto.encrypt(body.totp_secret, crypto.totp_aad(user.id)))
        security.delete_other_sessions(con, user.id, token)
    audit.event("totp.replaced")
