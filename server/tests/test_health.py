"""/health: the database, the encoder (its heartbeat) and tusd, each ok or failing."""

import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app import clock, db, encoder

from .test_auth import login

ALL_OK = {"status": "ok", "database": "ok", "encoder": "ok", "tusd": "ok"}


def beat(seconds_ago=0):
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT OR REPLACE INTO heartbeat (name, at) VALUES ('encoder', ?)", (clock.at(-seconds_ago),))
    con.close()


@pytest.fixture
def tusd_server(monkeypatch):
    """A fake tusd answering the tus OPTIONS request (or not, with answer=False)."""
    state = {"answer": True}

    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):  # noqa: N802 - http.server's naming
            self.send_response(204 if state["answer"] else 404)
            if state["answer"]:
                self.send_header("Tus-Version", "1.0.0")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("VIDEONINJA_TUSD_URL", f"http://127.0.0.1:{server.server_port}")
    yield state
    server.shutdown()


def test_before_setup_is_healthy(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "not_set_up", "encoder": "not_set_up", "tusd": "ok"}


def test_everything_ok(client, admin_secret, tusd_server):
    beat()
    r = client.get("/health")
    assert (r.status_code, r.json()) == (200, ALL_OK)


@pytest.mark.parametrize("seconds_ago", [None, encoder.HEARTBEAT_MAX_AGE_S + 1])
def test_encoder_down(client, admin_secret, seconds_ago):
    """No heartbeat yet, or too old (its container stopped or stuck): 503."""
    if seconds_ago is not None:
        beat(seconds_ago)
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json() == {**ALL_OK, "status": "degraded", "encoder": "failing"}


def test_tusd_down(client, admin_secret, tusd_server):
    beat()
    tusd_server["answer"] = False
    assert client.get("/health").json()["tusd"] == "failing"
    tusd_server["answer"] = True
    assert client.get("/health").json()["tusd"] == "ok"


def test_tusd_unreachable(client, admin_secret, monkeypatch):
    beat()
    monkeypatch.setenv("VIDEONINJA_TUSD_URL", "http://127.0.0.1:9")  # nothing listens there
    r = client.get("/health")
    assert r.status_code == 503 and r.json()["tusd"] == "failing"
    # The upload page's check says so too, before any work is lost.
    assert login(client, admin_secret).status_code == 200
    assert client.get("/api/uploads/available").json() == {"available": False}


def test_database_failing(client, admin_secret, monkeypatch):
    beat()

    def broken(*args, **kwargs):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(db, "connect", broken)
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "database": "failing", "encoder": "failing", "tusd": "ok"}


def test_encoder_container_healthcheck(client, admin_secret):
    """python -m app.encoder --health: exit status from the heartbeat."""
    assert encoder.main(["--health"]) == 1
    beat()
    assert encoder.main(["--health"]) == 0
