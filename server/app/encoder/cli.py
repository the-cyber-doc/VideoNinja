"""The encoder's own container: python -m app.encoder (__main__.py)."""

import logging
import signal
import threading

from .. import db, logs, settings
from . import heartbeat, queue

log = logging.getLogger(__name__)


def main(argv: list[str]) -> int:
    """The encoder's container. --health: exit 0 if the heartbeat is recent (healthcheck)."""
    logs.configure()
    if argv == ["--health"]:
        if not db.is_initialized():
            return 0  # before the setup there is nothing to encode
        con = db.connect()
        try:
            return 0 if heartbeat.healthy(con) else 1
        finally:
            con.close()
    settings.current()  # refuse to start with a wrong setting
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    # The API's setup wizard creates the database; at its start, the API migrates it.
    # Never on another version: its columns would not be the ones used here.
    while db.current_version() != db.EXPECTED_VERSION:
        if stopping.wait(queue.POLL_S):
            return 0
    queue.start()
    if not queue.running():
        return 1  # ffmpeg missing: logged by start()
    stopping.wait()
    log.info("Encoder stopping")
    queue.stop()  # the current encoding goes back to the queue
    return 0
