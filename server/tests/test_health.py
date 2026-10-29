"""/health: the database, the encoder (its heartbeat) and tusd, each ok or failing."""

import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from app import clock, db, settings
from app.encoder import cli, heartbeat
from app.main import app

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


@pytest.mark.parametrize("seconds_ago", [None, heartbeat.HEARTBEAT_MAX_AGE_S + 1])
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
    assert cli.main(["--health"]) == 1
    beat()
    assert cli.main(["--health"]) == 0


def test_database_on_another_version(client, admin_secret):
    """Not migrated (an encoder or API of another release on it): failing, not ok."""
    beat()
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE config SET value = '1' WHERE name = 'db_version'")
    con.close()
    r = client.get("/health")
    assert r.status_code == 503 and r.json()["database"] == "failing"


@pytest.mark.parametrize("value", ["file:///etc/passwd", "ftp://tusd/", "tusd:1080", "http://"])
def test_service_urls_are_http_only(monkeypatch, value):
    """urllib would open file: and ftp: URLs too: another container's address is http(s)."""
    monkeypatch.setenv("VIDEONINJA_TUSD_URL", value)
    with pytest.raises(RuntimeError, match="VIDEONINJA_TUSD_URL"):
        settings.current()
    with pytest.raises(RuntimeError), TestClient(app):
        pass  # the API does not start with it


def test_service_url_without_trailing_slash(monkeypatch):
    monkeypatch.setenv("VIDEONINJA_API_URL", "https://api:8000/")
    assert settings.current().api_url == "https://api:8000"
    monkeypatch.delenv("VIDEONINJA_API_URL")
    assert settings.current().api_url is None


def test_integrity_checked_hourly_not_on_every_call(client, admin_secret, tusd_server, monkeypatch):
    """quick_check reads the whole file: once, then again only after INTEGRITY_EVERY_S."""
    from app.api import health
    checks = []
    connect = db.connect

    def traced(*args, **kwargs):
        con = connect(*args, **kwargs)
        con.set_trace_callback(lambda sql: checks.append(sql) if "quick_check" in sql else None)
        return con

    monkeypatch.setattr(db, "connect", traced)
    now = [1000.0]
    monkeypatch.setattr(health.time, "monotonic", lambda: now[0])
    beat()
    for _ in range(3):
        assert client.get("/health").json()["database"] == "ok"
    assert len(checks) == 1
    now[0] += health.INTEGRITY_EVERY_S
    assert client.get("/health").json()["database"] == "ok"
    assert len(checks) == 2


def test_integrity_failure_kept_until_checked_again(tmp_path, monkeypatch, caplog):
    from app.api import health

    class Corrupt:
        def execute(self, sql):
            assert "quick_check" in sql
            return self

        def fetchone(self):
            return ("*** in database main *** Page 7 is never used",)

    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "corrupt.db"))
    assert health._integrity_ok(Corrupt()) is False
    assert "fails its integrity check" in caplog.text
    assert health._integrity_ok(None) is False  # kept: not checked again within the hour
