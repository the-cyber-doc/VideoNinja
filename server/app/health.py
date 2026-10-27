"""/health: the compose file's healthcheck, through nginx (so nginx too). Public:
only a state per component, no details. 200 if every component is ok (or the app
is not set up yet), else 503.

- database: answers a query, has this release's version, and its file passes a
  quick integrity check.
- encoder: its heartbeat is recent (it runs in another container).
- tusd: takes uploads (tusd.available).
"""

import logging
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import db, encoder, tusd

log = logging.getLogger("uvicorn.error")
router = APIRouter(tags=["health"])
State = Literal["ok", "failing", "not_set_up"]


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
            if con.execute("PRAGMA quick_check(1)").fetchone()[0] != "ok":
                log.error("Health: the database fails its integrity check")
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
