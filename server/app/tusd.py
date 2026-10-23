"""Uploads through tusd (resumable uploads), decided by the app.

tusd runs in the app's container, started and watched by the app (Tusd below).

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
import subprocess
import threading
import time
from http.cookies import CookieError, SimpleCookie
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from . import db, paths, queries, security
from .auth import require_access
from .security import SESSION_COOKIE
from .validation import RULES

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/internal", tags=["internal"])
SHA256 = re.compile(RULES["sha256"]["pattern"])
BASE_PATH = "/files/"  # tusd's -base-path, as nginx forwards it
FILENAME = re.compile(RULES["filename"]["pattern"])


def max_upload_bytes() -> int:
    return int(float(os.environ.get("VIDEONINJA_MAX_UPLOAD_GB", "20")) * 1024**3)


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
            if SESSION_COOKIE in cookie:
                return cookie[SESSION_COOKIE].value
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
    if size > max_upload_bytes():
        return _reject(413, "File too large")
    if not SHA256.fullmatch(original_sha256) or not FILENAME.fullmatch(meta.get("filename", "")):
        return _reject(400, "Invalid metadata")
    with con:
        if queries.original_known(con, original_sha256):
            return _reject(409, "This video was already uploaded")
        tus_id = secrets.token_hex(16)  # the upload's file name in tusd's folder
        queries.insert_upload(con, tus_id, user["id"], original_sha256, size, int(time.time()))
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
    if not path.startswith(BASE_PATH):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    tus_id = path[len(BASE_PATH):].strip("/")
    if not tus_id:
        if x_original_method.upper() != "POST":  # only creation on the base path
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        return
    upload = queries.upload(con, tus_id)
    if upload is None or upload["user"] != user["id"] or upload["state"] == "deleted":
        log.warning("Upload %r refused to user id %s", tus_id, user["id"])
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


# --- the tusd process ---


class Tusd:
    """tusd as a child process: restarted if it stops, stopped with the app.

    Environment: VIDEONINJA_TUSD=0 (off), VIDEONINJA_TUSD_BIN (default: tusd on
    PATH; not found = no uploads, logged), VIDEONINJA_TUSD_HOST (default
    127.0.0.1; the Docker image: 0.0.0.0, published to nginx only),
    VIDEONINJA_TUSD_PORT (1080), VIDEONINJA_APP_PORT (8000: where its hooks call).
    """

    MAX_BACKOFF_S = 30

    def __init__(self) -> None:
        env = os.environ.get
        self.binary = env("VIDEONINJA_TUSD_BIN") or shutil.which("tusd")
        self.host = env("VIDEONINJA_TUSD_HOST", "127.0.0.1")
        self.port = env("VIDEONINJA_TUSD_PORT", "1080")
        self.app_port = env("VIDEONINJA_APP_PORT", "8000")
        self.stopping = threading.Event()
        self.process: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None

    def command(self) -> list[str]:
        return [
            self.binary, "-host", self.host, "-port", self.port,
            "-upload-dir", str(paths.upload_dir()), "-base-path", BASE_PATH,
            "-behind-proxy", "-disable-download", "-max-size", str(max_upload_bytes()),
            "-hooks-http", f"http://127.0.0.1:{self.app_port}/internal/tusd-hook",
            "-hooks-enabled-events", "pre-create,post-finish",
            "-hooks-http-forward-headers", "Cookie",
        ]

    def start(self) -> None:
        if not self.binary:
            log.warning("tusd not found: uploads are not possible (set VIDEONINJA_TUSD_BIN)")
            return
        paths.upload_dir().mkdir(parents=True, exist_ok=True)
        self.thread = threading.Thread(target=self.run, name="tusd", daemon=True)
        self.thread.start()

    def run(self) -> None:
        backoff = 1.0
        while not self.stopping.is_set():
            started = time.monotonic()
            self.process = subprocess.Popen(
                self.command(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            )
            log.info("tusd started (pid %s, port %s)", self.process.pid, self.port)
            for line in self.process.stdout:  # until it exits
                line = line.rstrip()
                if "level=ERROR" in line or "level=WARN" in line:
                    log.warning("tusd: %s", line)
                else:
                    log.debug("tusd: %s", line)
            code = self.process.wait()
            if self.stopping.is_set():
                break
            if time.monotonic() - started > 60:
                backoff = 1.0  # it had been running fine: restart at once
            log.warning("tusd exited (code %s), restarting in %.0f s", code, backoff)
            self.stopping.wait(backoff)
            backoff = min(backoff * 2, self.MAX_BACKOFF_S)

    def stop(self) -> None:
        self.stopping.set()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.thread:
            self.thread.join(timeout=15)


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
    """False when the app should run tusd and it is not running (binary missing,
    crashed and restarting). VIDEONINJA_TUSD=0: tusd is run elsewhere, assumed up."""
    if os.environ.get("VIDEONINJA_TUSD", "1") == "0":
        return True
    return process.process is not None and process.process.poll() is None
