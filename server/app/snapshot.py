"""Catalogue snapshots: static files that nginx serves after the app's session check.

VIDEONINJA_CATALOG_DIR (default: "catalog" next to the database; in Docker
/srv/catalog, a volume mounted read-only into nginx):

    versions/<version>/catalog.<lang>.<hash>.json   + .br (brotli -q 11) and .gz (Zopfli)
    versions/<version>/manifest.json                {"catalog": {"<lang>": "<file name>"}}
    current -> versions/<version>                   swapped atomically

A version is complete before `current` points to it and never changes after.
X-Accel-Redirect names the versioned path, not `current`, so a request that
started before a swap still finds its file: the previous versions are kept
for a while (KEEP). An unchanged catalogue makes no new version, so the ETag
(from the file) stays and clients keep getting 304.

Rebuilt at startup, after setup, and after every write that changes the
catalogue, whoever makes it (admin or not): routers with such writes declare
`dependencies=[Depends(snapshot.rebuild_after_write)]`. Rebuilds are debounced:
a burst of edits makes one rebuild.
"""

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import threading
import time
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from . import catalog, db, i18n, procs
from .auth import current_user

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api", tags=["catalog"])
# Called by the encoder's container (no catalogue there). Never forwarded by nginx;
# a call from elsewhere only costs a rebuild (one at a time, no new version if nothing changed).
internal_router = APIRouter(prefix="/internal", tags=["internal"])

INTERNAL_PREFIX = "/protected-catalog"  # nginx internal location, aliased to versions/
KEEP = 3  # previous versions kept for requests in flight
DEBOUNCE_S = 2.0

_lock = threading.Lock()  # one rebuild at a time
_timer_lock = threading.Lock()
_timer: threading.Timer | None = None


def catalog_dir() -> Path:
    path = os.environ.get("VIDEONINJA_CATALOG_DIR")
    return Path(path) if path else db.db_path().parent / "catalog"


def x_accel() -> bool:
    """VIDEONINJA_X_ACCEL=1 (Docker image, behind nginx): answer with X-Accel-Redirect.
    Otherwise (development, no nginx): the app serves the file itself."""
    return os.environ.get("VIDEONINJA_X_ACCEL") == "1"


def current() -> tuple[str, dict] | None:
    """The current version and its manifest, or None before the first snapshot."""
    link = catalog_dir() / "current"
    try:
        version = os.path.basename(os.readlink(link))
        return version, json.loads((link / "manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def _compress(path: Path) -> None:
    """Write path.br and path.gz next to the file. A missing tool only logs a
    warning (nginx then serves another variant): the Docker image has both."""
    commands = {
        "brotli": ["brotli", "-q", "11", "-f", "-o", f"{path}.br", str(path)],
        "zopfli": ["zopfli", "--gzip", str(path)],  # writes path.gz
    }
    for tool, cmd in commands.items():
        if shutil.which(tool) is None:
            log.warning("%s not found: %s not precompressed", tool, path.name)
            continue
        result = procs.run(cmd, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"{tool} failed: {result.stderr.strip()[-500:]}")


def _files(con: sqlite3.Connection) -> dict[str, tuple[str, bytes]]:
    """{lang: (file name, content)} of every catalogue file."""
    out = {}
    for lang in i18n.LANGS:
        body = json.dumps(catalog.build(con, lang), ensure_ascii=False, separators=(",", ":")).encode()
        out[lang] = (f"catalog.{lang}.{hashlib.sha256(body).hexdigest()[:16]}.json", body)
    return out


def _prune(versions: Path, keep: str) -> None:
    """Delete unfinished versions and all but the KEEP newest previous ones."""
    old = []
    for d in versions.iterdir():
        if d.name.startswith("."):
            shutil.rmtree(d, ignore_errors=True)
        elif d.name != keep:
            old.append(d)
    old.sort(key=lambda d: int(d.name) if d.name.isdigit() else 0, reverse=True)
    for d in old[KEEP:]:
        shutil.rmtree(d, ignore_errors=True)


def rebuild() -> tuple[str, dict]:
    """Write a new version if the catalogue changed; return the current one."""
    with _lock:
        con = db.connect()
        try:
            files = _files(con)
        finally:
            con.close()
        manifest = {"catalog": {lang: name for lang, (name, _) in files.items()}}
        now = current()
        if now and now[1] == manifest:
            return now

        root = catalog_dir()
        versions = root / "versions"
        versions.mkdir(parents=True, exist_ok=True)
        version = str(time.time_ns())
        tmp = versions / f".tmp-{version}"
        tmp.mkdir()
        for name, body in files.values():
            (tmp / name).write_bytes(body)
            _compress(tmp / name)
        (tmp / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        tmp.rename(versions / version)

        # Atomic swap: a new symlink renamed over the old one.
        link = root / ".current.tmp"
        link.unlink(missing_ok=True)
        link.symlink_to(Path("versions") / version)
        link.replace(root / "current")
        _prune(versions, version)
        log.info("Catalogue snapshot %s written", version)
        return version, manifest


def _rebuild_logged() -> None:
    global _timer
    with _timer_lock:
        _timer = None
    try:
        rebuild()
    except Exception:
        log.exception("Catalogue snapshot failed")


def schedule() -> None:
    """Rebuild DEBOUNCE_S after the last call: a burst of writes makes one rebuild."""
    global _timer
    with _timer_lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(DEBOUNCE_S, _rebuild_logged)
        _timer.daemon = True
        _timer.start()


def rebuild_now() -> None:
    """Rebuild at once (errors logged), dropping a scheduled rebuild: a video just
    published must be in the catalogue the upload page fetches when it sees it."""
    global _timer
    with _timer_lock:
        timer, _timer = _timer, None
    if timer is not None:
        timer.cancel()
    _rebuild_logged()


def flush() -> None:
    """Run a scheduled rebuild now (shutdown, tests)."""
    global _timer
    with _timer_lock:
        timer, _timer = _timer, None
    if timer is not None:
        timer.cancel()
        _rebuild_logged()


def rebuild_after_write(request: Request) -> Iterator[None]:
    """Router dependency: schedule a rebuild after each successful write.

    Reads (GET, HEAD) are ignored. A failed request (exception, e.g.
    HTTPException) never gets past the yield, so it schedules nothing.
    """
    yield
    if request.method not in ("GET", "HEAD"):
        schedule()


@router.get("/catalog")
def get_catalog(
    _: sqlite3.Row = Depends(current_user),
    lang: str = Depends(i18n.language),
) -> Response:
    """The catalogue file of the request's language. Behind nginx: an empty answer
    with X-Accel-Redirect; nginx serves the file, its .br/.gz variant, ETag and
    Cache-Control (the app sends none)."""
    version, manifest = current() or rebuild()
    name = manifest["catalog"][lang]
    if x_accel():
        return Response(headers={"X-Accel-Redirect": f"{INTERNAL_PREFIX}/{version}/{name}"})
    path = catalog_dir() / "versions" / version / name
    if not path.is_file():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Catalogue not available")
    return FileResponse(
        path,
        media_type="application/json",
        headers={"Cache-Control": "private, no-cache", "Vary": "Accept-Language"},
    )


@internal_router.post("/catalog-changed", status_code=status.HTTP_204_NO_CONTENT)
def catalog_changed() -> None:
    """The encoder published a video or made thumbnails: rebuild the catalogue now
    (not debounced: publishing is rare, and the upload page fetches it at once)."""
    rebuild_now()
