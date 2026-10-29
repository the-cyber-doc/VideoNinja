"""First-start setup wizard API. Disabled (404) once the database exists."""

import json
import logging
import secrets
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import audit, db, encoder, errors, security, snapshot, throttle, tusd
from ..errors import ApiError
from ..validation import field

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/setup", tags=["setup"])
# A wrong setup token (403) counts as a credential failure.
token_guard = Depends(throttle.credential_guard(403))
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
        raise ApiError("not_found")
    expected = request.app.state.setup_token
    if not expected or not secrets.compare_digest(token.encode(), expected.encode()):
        raise ApiError("setup.invalid_token")


@router.get("/status")
def setup_status() -> dict[str, bool]:
    return {"initialized": db.is_initialized()}


@router.post("/verify", status_code=status.HTTP_204_NO_CONTENT, dependencies=[token_guard])
def verify_token(body: TokenIn, request: Request) -> None:
    _check_token(request, body.token)


@router.post("/totp", dependencies=[token_guard])
def new_totp(body: TotpIn, request: Request) -> dict[str, str]:
    """A fresh TOTP secret and its QR code. Nothing is stored until /complete."""
    _check_token(request, body.token)
    return security.totp_enrollment(body.username)


@router.post("/complete", dependencies=[token_guard])
def complete(body: CompleteIn, request: Request) -> StreamingResponse:
    """Create the database and the admin user. Streams one JSON line per completed step."""
    _check_token(request, body.token)
    if not security.verify_totp(body.totp_secret, body.totp_code):
        raise ApiError("totp.invalid_code")
    pw_hash = security.hash_password(body.password)

    def progress() -> Iterator[str]:
        if not _setup_lock.acquire(blocking=False):
            yield json.dumps({"error": errors.body("setup.running")}) + "\n"
            return
        try:
            if db.is_initialized():
                yield json.dumps({"error": errors.body("setup.done")}) + "\n"
                return
            for step in db.create_database(
                body.username, body.name or body.username, pw_hash, body.totp_secret
            ):
                yield json.dumps({"step": step}) + "\n"
            request.app.state.setup_token = None
            audit.event("setup.completed", admin=body.username)
            snapshot.schedule()  # first catalogue (failures logged; GET /api/catalog retries)
            tusd.start()
            encoder.start()
        except Exception:
            log.exception("Setup failed")
            yield json.dumps({"error": errors.body("setup.failed")}) + "\n"
        finally:
            _setup_lock.release()

    # Tell nginx not to buffer, so each step reaches the browser as it happens.
    return StreamingResponse(
        progress(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"}
    )
