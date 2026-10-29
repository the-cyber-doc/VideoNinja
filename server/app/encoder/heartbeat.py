"""The encoder's liveness: a heartbeat row written every HEARTBEAT_S seconds, read
by /health (the API) and by the encoder container's healthcheck."""

import logging
import sqlite3
import threading
from datetime import datetime

from .. import clock, db, queries

log = logging.getLogger(__name__)
HEARTBEAT_S = 30
HEARTBEAT_MAX_AGE_S = 120  # older: the encoder is down (/health)


def beat() -> None:
    with db.transaction() as con:
        queries.config.set_heartbeat(con, "encoder", clock.at(0))


def run(stopping: threading.Event) -> None:
    """Until `stopping` is set (a thread of the encoder)."""
    while not stopping.wait(HEARTBEAT_S):
        try:
            beat()
        except Exception:  # noqa: BLE001 - try again at the next beat
            log.exception("Encoder heartbeat failed")


def healthy(con: sqlite3.Connection) -> bool:
    """Its heartbeat is recent (/health, and the encoder container's healthcheck)."""
    at = queries.config.heartbeat(con, "encoder")
    if at is None:
        return False
    return (clock.now() - datetime.fromisoformat(at)).total_seconds() < HEARTBEAT_MAX_AGE_S
