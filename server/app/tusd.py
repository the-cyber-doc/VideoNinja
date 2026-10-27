"""Uploads through tusd (resumable uploads), decided by the app.

tusd runs in its own container in production (VIDEONINJA_TUSD=0, reached at
VIDEONINJA_TUSD_URL), and as a child of the app in development (Tusd below).

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
import logging
import os
import re
import secrets
import shutil
import sqlite3
import urllib.error
import urllib.request
from http.cookies import CookieError, SimpleCookie
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from . import clock, db, limits, paths, queries, security
from .auth import require_access
from .children import Child
from .validation import RULES

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/internal", tags=["internal"])
SHA256 = re.compile(RULES["sha256"]["pattern"])
FILENAME = re.compile(RULES["original_filename"]["pattern"])


def files_path() -> str:
    """tusd's -base-path: where the browser sends uploads, nginx forwarding it as is."""
    return f"{paths.base_path()}/files/"


def _reject(status_code: int, detail: str) -> dict[str, Any]:
    return {
        "RejectUpload": True,
        "HTTPResponse": {
            "StatusCode": status_code,
            "Body": json.dumps({"detail": detail}),
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
        return _reject(401, "Not logged in")
    if "upload" not in queries.role_access(con, user["role"]):
        log.warning("Upload denied: user id %s lacks access 'upload'", user["id"])
        return _reject(403, "Access denied")

    upload = event.get("Upload") or {}
    meta = upload.get("MetaData") or {}
    original_sha256 = meta.get("original_sha256", "")
    size = upload.get("Size")
    if upload.get("SizeIsDeferred") or not isinstance(size, int) or size <= 0:
        return _reject(400, "The file size must be known")
    if size > limits.max_upload_bytes():
        return _reject(413, "File too large")
    # "filename": the tus metadata convention (tus-js-client); stored as video.original_filename.
    if not SHA256.fullmatch(original_sha256) or not FILENAME.fullmatch(meta.get("filename", "")):
        return _reject(400, "Invalid metadata")
    if not limits.accepted_name(meta["filename"]):
        return _reject(415, "This type of file is not accepted")
    with con:
        if queries.video_known(con, original_sha256):
            return _reject(409, "This video already exists")
        tus_id = secrets.token_hex(16)  # the upload's file name in tusd's folder
        # The hook has no browser request: the user's saved timezone.
        queries.insert_upload(con, tus_id, user["id"], original_sha256, size, clock.at(0, clock.user_zone(user)))
    log.info("Upload %s accepted for user id %s (%d bytes)", tus_id, user["id"], size)
    return {"ChangeFileInfo": {"ID": tus_id}}


def _post_finish(con: sqlite3.Connection, event: dict[str, Any]) -> dict[str, Any]:
    upload = event.get("Upload") or {}
    tus_id = upload.get("ID", "")
    with con:
        row = queries.upload(con, tus_id)
        if row and row["state"] == "uploading" and upload.get("Offset") == row["size"]:
            queries.set_upload_state(con, tus_id, "finished")
    return {}


@router.post("/tusd-hook")
def tusd_hook(hook: dict[str, Any], con: sqlite3.Connection = Depends(db.get_db)) -> dict[str, Any]:
    """Always 200: a rejection is said in the JSON (an error status fails the upload as a 500)."""
    event = hook.get("Event") or {}
    match hook.get("Type"):
        case "pre-create":
            return _pre_create(con, event)
        case "post-finish":
            return _post_finish(con, event)
    return {}


@router.get("/upload-auth", status_code=status.HTTP_204_NO_CONTENT)
def upload_auth(
    x_original_uri: str = Header(default=""),
    x_original_method: str = Header(default=""),
    user: sqlite3.Row = Depends(require_access("upload")),
    con: sqlite3.Connection = Depends(db.get_db),
) -> None:
    """nginx auth_request for /files/…: 204 = forward to tusd; 401/403/404 = refuse."""
    path = x_original_uri.split("?", 1)[0]
    base = files_path()
    if not path.startswith(base):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    tus_id = path[len(base):].strip("/")
    if not tus_id:
        if x_original_method.upper() != "POST":  # only creation on the base path
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        return
    upload = queries.upload(con, tus_id)
    if upload is None or upload["user"] != user["id"] or upload["state"] == "deleted":
        log.warning("Upload %r refused to user id %s", tus_id, user["id"])
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


# --- the tusd process ---


class Tusd(Child):
    """tusd as a child process (children.py).

    Environment: VIDEONINJA_TUSD=0 (off), VIDEONINJA_TUSD_BIN (default: tusd on
    PATH; not found = no uploads, logged), VIDEONINJA_TUSD_HOST (default
    127.0.0.1: only nginx, in the same container, reaches it),
    VIDEONINJA_TUSD_PORT (1080), VIDEONINJA_APP_PORT (8000: where its hooks call).
    """

    name = "tusd"
    missing = "not found: uploads are not possible (set VIDEONINJA_TUSD_BIN)"

    def __init__(self) -> None:
        env = os.environ.get
        super().__init__(env("VIDEONINJA_TUSD_BIN") or shutil.which("tusd"))
        self.host = env("VIDEONINJA_TUSD_HOST", "127.0.0.1")
        self.port = env("VIDEONINJA_TUSD_PORT", "1080")
        self.app_port = env("VIDEONINJA_APP_PORT", "8000")

    def command(self) -> list[str]:
        return [
            self.binary, "-host", self.host, "-port", self.port,
            "-upload-dir", str(paths.upload_dir()), "-base-path", files_path(),
            "-behind-proxy", "-disable-download", "-max-size", str(limits.max_upload_bytes()),
            "-hooks-http", f"http://127.0.0.1:{self.app_port}/internal/tusd-hook",
            "-hooks-enabled-events", "pre-create,post-finish",
            "-hooks-http-forward-headers", "Cookie",
        ]

    def prepare(self) -> None:
        paths.upload_dir().mkdir(parents=True, exist_ok=True)

    def log_line(self, line: str) -> None:
        if "level=ERROR" in line or "level=WARN" in line:
            log.warning("tusd: %s", line)
        else:
            log.debug("tusd: %s", line)


process = Tusd()


def start() -> None:
    """Start tusd (app startup, or after setup). VIDEONINJA_TUSD=0: off."""
    global process
    if os.environ.get("VIDEONINJA_TUSD", "1") == "0" or (process.thread and process.thread.is_alive()):
        return
    process = Tusd()  # settings from the current environment
    process.start()


def stop() -> None:
    process.stop()


def available() -> bool:
    """Whether tusd takes uploads now. Its own container (VIDEONINJA_TUSD_URL): it
    answers a tus OPTIONS request. Run by the app: its process is running (False
    when the binary is missing, or it crashed and is restarting). Neither (tests,
    tusd run by hand): assumed up."""
    url = os.environ.get("VIDEONINJA_TUSD_URL")
    if url:
        return _answers(url.rstrip("/") + files_path())
    if os.environ.get("VIDEONINJA_TUSD", "1") == "0":
        return True
    return process.running()


def _answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="OPTIONS"), timeout=2) as r:
            return bool(r.headers.get("Tus-Version"))
    except (OSError, urllib.error.URLError):
        return False
