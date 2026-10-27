import base64
import os
from datetime import UTC

import pyotp
import pytest
from fastapi.testclient import TestClient

from app import clock, snapshot, throttle
from app.main import app

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def no_background_services(monkeypatch):
    """No tusd process, no encoding thread: tests drive the encoder themselves."""
    monkeypatch.setenv("VIDEONINJA_TUSD", "0")
    monkeypatch.setenv("VIDEONINJA_ENCODER", "0")


@pytest.fixture(autouse=True)
def server_zone_utc(monkeypatch):
    """The server's timezone (dates written without a browser request), whatever the host's.
    Not by setting TZ: the process keeps its own (pyotp's TOTP codes would be off)."""
    monkeypatch.setattr(clock, "server_zone", lambda: UTC)


@pytest.fixture(autouse=True)
def no_precompression(request, monkeypatch):
    """Brotli + Zopfli of the whole catalogue take about a second per snapshot: only
    the tests marked `compress` precompress (production always does)."""
    if not request.node.get_closest_marker("compress"):
        monkeypatch.setattr(snapshot, "_compress", lambda path: None)


@pytest.fixture(autouse=True)
def no_throttle_carried_over():
    """Credential failures are counted in memory, per address: each test starts at zero."""
    throttle.reset()
    yield
    throttle.reset()


@pytest.fixture(autouse=True)
def key_file(tmp_path, monkeypatch):
    path = tmp_path / "videoninja_key"
    path.write_text(base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("VIDEONINJA_DB_KEY_FILE", str(path))
    return path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    # https: the session cookie is Secure, so it is only sent back over https.
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def run_setup(client) -> str:
    """Complete the wizard; return the admin's TOTP secret."""
    token = client.app.state.setup_token
    secret = client.post("/api/setup/totp", json={"token": token, "username": "admin"}).json()["secret"]
    r = client.post(
        "/api/setup/complete",
        json={
            "token": token,
            "username": "admin",
            "name": "Admin",
            "password": PASSWORD,
            "totp_secret": secret,
            "totp_code": pyotp.TOTP(secret).now(),
        },
    )
    assert r.status_code == 200, r.text
    return secret


@pytest.fixture
def admin_secret(client) -> str:
    return run_setup(client)
