"""Uploads through tusd, decided by the app (the tusd process: tusd.py).

- /internal/upload-auth: nginx asks it before forwarding ANY request to tusd
  (auth_request: create, every chunk, resume, cancel): session, "upload" access,
  and for an existing upload, that it is the user's own.
- /internal/tusd-hook: tusd's hooks. pre-create checks the request again (the
  forwarded session cookie) and the announced file, and names the upload;
  post-finish marks it complete.

nginx routes neither from outside (/internal/ is not proxied; the auth
subrequest is an internal location). The encoder checks every file (size,
SHA-256) before encoding it.
"""

import json
import re
import secrets
import sqlite3
from http.cookies import CookieError, SimpleCookie
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, status

from .. import queries
from ..core import clock, db, errors, logs, middleware, settings
from ..domain import audit, security, tusd
from ..core.errors import ApiError
from ..queries.users import User
from ..core.validation import RULES
from .deps import require_access
from ..core import limits

router = APIRouter(prefix="/internal", tags=["internal"])

SHA256 = re.compile(RULES["sha256"]["pattern"])

FILENAME = re.compile(RULES["original_filename"]["pattern"])


def _reject(code: str) -> dict[str, Any]:
    return {
        "RejectUpload": True,
        "HTTPResponse": {
            "StatusCode": errors.ERRORS[code][0],
            "Body": json.dumps(errors.body(code)),
            "Header": {"Content-Type": "application/json"},
        },
    }


def _session_token(headers: dict[str, list[str]]) -> str | None:
    for name, values in headers.items():
        if name.lower() != "cookie":
            continue
        for value in values:
            try:
                cookie = SimpleCookie(value)
            except CookieError:
                continue
            name = security.session_cookie()[0]
            if name in cookie:
                return cookie[name].value
    return None


def _pre_create(con: sqlite3.Connection, event: dict[str, Any]) -> dict[str, Any]:
    token = _session_token(event.get("HTTPRequest", {}).get("Header") or {})
    user = security.session_user(con, token) if token else None
    if user is None:
        return _reject("auth.not_logged_in")
    logs.add(user_id=user.id)
    if "upload" not in user.access:
        audit.event("access.denied", access="upload")
        return _reject("auth.access_denied")

    upload = event.get("Upload") or {}
    meta = upload.get("MetaData") or {}
    original_sha256 = meta.get("original_sha256", "")
    size = upload.get("Size")
    if upload.get("SizeIsDeferred") or not isinstance(size, int) or size <= 0:
        return _reject("upload.size_unknown")
    if size > settings.current().max_upload_bytes:
        return _reject("upload.too_large")
    # "filename": the tus metadata convention (tus-js-client); stored as video.original_filename.
    if not SHA256.fullmatch(original_sha256) or not FILENAME.fullmatch(meta.get("filename", "")):
        return _reject("upload.invalid_metadata")
    if not limits.accepted_name(meta["filename"]):
        return _reject("upload.type_refused")
    with db.write(con):
        if queries.videos.video_known(con, original_sha256):
            return _reject("video.exists")
        tus_id = secrets.token_hex(16)  # the upload's file name in tusd's folder
        # The hook has no browser request: the user's saved timezone.
        created = clock.at(0, clock.user_zone(user.time_zone))
        queries.uploads.insert_upload(con, tus_id, user.id, original_sha256, size, created)
    audit.event("upload.accepted", tus_id=tus_id, size=size)
    return {"ChangeFileInfo": {"ID": tus_id}}


def _post_finish(con: sqlite3.Connection, event: dict[str, Any]) -> dict[str, Any]:
    upload = event.get("Upload") or {}
    tus_id = upload.get("ID", "")
    with db.write(con):
        row = queries.uploads.upload(con, tus_id)
        if row and row["state"] == "uploading" and upload.get("Offset") == row["size"]:
            queries.uploads.set_upload_state(con, tus_id, "finished")
    return {}


@router.post("/tusd-hook")
def tusd_hook(hook: dict[str, Any], con: sqlite3.Connection = Depends(db.get_db)) -> dict[str, Any]:
    """Always 200: a rejection is said in the JSON (an error status fails the upload as a 500)."""
    event = hook.get("Event") or {}
    # tusd calls the app itself: the browser's request ID (nginx's) is in the event.
    browser_ids = (event.get("HTTPRequest", {}).get("Header") or {}).get("X-Request-Id") or []
    if browser_ids and middleware.VALID_ID.fullmatch(browser_ids[0].encode()):
        logs.add(request_id=browser_ids[0])
    match hook.get("Type"):
        case "pre-create":
            return _pre_create(con, event)
        case "post-finish":
            return _post_finish(con, event)
    return {}


@router.get("/upload-auth", status_code=status.HTTP_204_NO_CONTENT)
def upload_auth(
    request: Request,
    x_original_uri: str = Header(default=""),
    x_original_method: str = Header(default=""),
    user: User = Depends(require_access("upload")),
    con: sqlite3.Connection = Depends(db.get_db),
) -> None:
    """nginx auth_request for /files/…: 204 = forward to tusd; 401/403/404 = refuse.
    The subrequest carries the browser's headers: a write (create, chunk, cancel) from
    another origin is refused, as for the API (main.same_origin_writes)."""
    if x_original_method.upper() not in ("GET", "HEAD", "OPTIONS") and security.cross_site(request.headers):
        audit.event("request.cross_site", method=x_original_method, route="/files/")
        raise ApiError("cross_site")
    path = x_original_uri.split("?", 1)[0]
    base = tusd.files_path()
    if not path.startswith(base):
        raise ApiError("not_found")
    tus_id = path[len(base):].strip("/")
    if not tus_id:
        if x_original_method.upper() != "POST":  # only creation on the base path
            raise ApiError("not_found")
        return
    upload = queries.uploads.upload(con, tus_id)
    if upload is None or upload["user"] != user.id or upload["state"] == "deleted":
        audit.event("upload.denied", tus_id=tus_id)
        raise ApiError("not_found")
