"""First-start setup wizard API. Disabled (404) once the database exists."""

import json
import logging
import secrets
import threading
from collections.abc import Iterator

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import db, security
from .validation import field

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/setup", tags=["setup"])
_setup_lock = threading.Lock()

def new_setup_token() -> str:
    token = secrets.token_urlsafe(24)
    log.warning("Video Ninja is not set up yet. Setup token: %s", token)
    return token


class TokenIn(BaseModel):
    token: str = field("setup_token")


class TotpIn(TokenIn):
    username: str = field("username")


class CompleteIn(TokenIn):
    username: str = field("username")
    name: str = field("display_name", default="")
    password: str = field("password")
    totp_secret: str = field("totp_secret")  # server-generated, sent back with the code
    totp_code: str = field("totp_code")


def _check_token(request: Request, token: str) -> None:
    if db.is_initialized():
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    expected = request.app.state.setup_token
    if not expected or not secrets.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid setup token")


@router.get("/status")
def setup_status() -> dict[str, bool]:
    return {"initialized": db.is_initialized()}


@router.post("/verify", status_code=status.HTTP_204_NO_CONTENT)
def verify_token(body: TokenIn, request: Request) -> None:
    _check_token(request, body.token)


@router.post("/totp")
def new_totp(body: TotpIn, request: Request) -> dict[str, str]:
    """A fresh TOTP secret and its QR code. Nothing is stored until /complete."""
    _check_token(request, body.token)
    return security.totp_enrollment(body.username)


@router.post("/complete")
def complete(body: CompleteIn, request: Request) -> StreamingResponse:
    """Create the database and the admin user. Streams one JSON line per completed step."""
    _check_token(request, body.token)
    if not security.verify_totp(body.totp_secret, body.totp_code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid TOTP code")
    pw_hash = security.hash_password(body.password)

    def progress() -> Iterator[str]:
        if not _setup_lock.acquire(blocking=False):
            yield json.dumps({"error": "Setup already running"}) + "\n"
            return
        try:
            if db.is_initialized():
                yield json.dumps({"error": "Already initialized"}) + "\n"
                return
            for step in db.create_database(
                body.username, body.name or body.username, pw_hash, body.totp_secret
            ):
                yield json.dumps({"step": step}) + "\n"
            request.app.state.setup_token = None
            log.warning("Setup complete: admin user %r created.", body.username)
        except Exception:
            log.exception("Setup failed")
            yield json.dumps({"error": "Setup failed, see server logs"}) + "\n"
        finally:
            _setup_lock.release()

    # Tell nginx not to buffer, so each step reaches the browser as it happens.
    return StreamingResponse(
        progress(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"}
    )
