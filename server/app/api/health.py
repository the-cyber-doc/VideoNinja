"""/health: the compose file's healthcheck, through nginx (so nginx too). Public:
only a state per component, no details. 200 if every component is ok (or the app
is not set up yet), else 503.

- database: answers a query, has this release's version, and its file passes a
  quick integrity check (PRAGMA quick_check reads the whole file: at the first call,
  then at most every INTEGRITY_EVERY_S, its result kept meanwhile).
- encoder: its heartbeat is recent (it runs in another container).
- tusd: takes uploads (tusd.available).
"""

import logging
import threading
import time
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .. import db, encoder, tusd

log = logging.getLogger(__name__)
router = APIRouter(tags=["health"])
State = Literal["ok", "failing", "not_set_up"]
INTEGRITY_EVERY_S = 3600
# Per database file: (monotonic time of the check, its result).
_integrity: dict[str, tuple[float, bool]] = {}
_integrity_lock = threading.Lock()


def _integrity_ok(con) -> bool:
    """The file's quick_check, run again once INTEGRITY_EVERY_S has passed."""
    key = str(db.db_path())
    with _integrity_lock:
        checked = _integrity.get(key)
        if checked and time.monotonic() - checked[0] < INTEGRITY_EVERY_S:
            return checked[1]
        ok = con.execute("PRAGMA quick_check(1)").fetchone()[0] == "ok"
        _integrity[key] = (time.monotonic(), ok)
    if not ok:
        log.error("Health: the database fails its integrity check")
    return ok


def _database() -> tuple[State, State]:
    """(database, encoder): the encoder's heartbeat is in the database."""
    if not db.is_initialized():
        return "not_set_up", "not_set_up"
    try:
        con = db.connect()
        try:
            con.execute("SELECT 1").fetchone()
            if db.version(con) != db.EXPECTED_VERSION:
                log.error("Health: database version %s, this release needs %s", db.version(con), db.EXPECTED_VERSION)
                return "failing", "failing"
            if not _integrity_ok(con):
                return "failing", "failing"
            return "ok", "ok" if encoder.healthy(con) else "failing"
        finally:
            con.close()
    except Exception:  # noqa: BLE001 - any error is a failing database
        log.exception("Health: database")
        return "failing", "failing"


@router.get("/health")
def health() -> JSONResponse:
    database, encoder_state = _database()
    states = {"database": database, "encoder": encoder_state, "tusd": "ok" if tusd.available() else "failing"}
    ok = all(s != "failing" for s in states.values())
    if not ok:
        log.warning("Health: %s", states)
    return JSONResponse({"status": "ok" if ok else "degraded", **states}, status_code=200 if ok else 503)
