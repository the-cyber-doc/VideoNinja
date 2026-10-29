"""Credential failures throttled per client address (app/throttle.py)."""

import pyotp
import pytest
from fastapi.testclient import TestClient

from app.domain import throttle
from app.main import app

from .conftest import PASSWORD
from .test_auth import login
from .test_profile import logged_in  # noqa: F401 (fixture)
from .test_users import admin, create  # noqa: F401 (fixture)


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(throttle, "_now", lambda: now[0])
    return now


def from_address(address: str) -> TestClient:
    return TestClient(app, base_url="https://testserver", client=(address, 50000))


def fail_logins(client, secret, times):
    for _ in range(times):
        assert login(client, secret, password="wrong password").status_code == 401


def test_login_throttled_after_ten_failures(client, admin_secret, clock):
    fail_logins(client, admin_secret, 10)
    r = login(client, admin_secret)  # the right password: refused all the same
    assert r.status_code == 429
    assert r.json()["code"] == "throttled"
    assert r.json()["params"] == {"minutes": -(-int(r.headers["Retry-After"]) // 60)}
    assert r.headers["Retry-After"] == str(throttle.WINDOW_S + 1)

    clock[0] += 60  # the oldest failure still in the window
    assert int(login(client, admin_secret).headers["Retry-After"]) == throttle.WINDOW_S - 60 + 1
    clock[0] += throttle.WINDOW_S - 60  # gone: one more try
    assert login(client, admin_secret).status_code == 200


def test_sliding_window(client, admin_secret, clock):
    fail_logins(client, admin_secret, 5)
    clock[0] += 600
    fail_logins(client, admin_secret, 5)
    assert login(client, admin_secret).status_code == 429
    clock[0] += throttle.WINDOW_S - 600  # the first five left the window
    fail_logins(client, admin_secret, 4)
    assert login(client, admin_secret, password="wrong password").status_code == 401  # tenth again
    assert login(client, admin_secret).status_code == 429


def test_success_does_not_reset(client, admin_secret):
    fail_logins(client, admin_secret, 9)
    assert login(client, admin_secret).status_code == 200
    fail_logins(client, admin_secret, 1)
    assert login(client, admin_secret).status_code == 429


def test_per_address(admin_secret):
    attacker = from_address("203.0.113.5")
    fail_logins(attacker, admin_secret, 10)
    assert login(attacker, admin_secret).status_code == 429
    assert login(from_address("203.0.113.6"), admin_secret).status_code == 200
    # IPv6: the whole /64 is one client.
    for i in range(10):
        assert login(from_address(f"2001:db8:1:2::{i + 1}"), admin_secret, password="x").status_code == 401
    assert login(from_address("2001:db8:1:2:ffff::1"), admin_secret).status_code == 429
    assert login(from_address("2001:db8:1:3::1"), admin_secret).status_code == 200


def test_client_key():
    class Request:
        def __init__(self, host):
            self.client = type("Client", (), {"host": host})

    assert throttle.client_key(Request("198.51.100.7")) == "198.51.100.7"
    assert throttle.client_key(Request("::ffff:198.51.100.7")) == "198.51.100.7"
    assert throttle.client_key(Request("2001:db8::1")) == "2001:db8::/64"
    assert throttle.client_key(Request("testclient")) == "testclient"


def test_other_401_and_403_never_count(client, admin_secret):
    for _ in range(20):
        assert client.get("/api/auth/me").status_code == 401  # no session
        assert client.get("/api/admin/users").status_code == 401
    assert login(client, admin_secret).status_code == 200


def test_profile_wrong_current_password(client, logged_in):  # noqa: F811
    body = {"current_password": "wrong password", "new_password": "another long passphrase"}
    for _ in range(10):
        assert client.post("/api/profile/password", json=body).status_code == 403
    assert client.post("/api/profile/password", json={**body, "current_password": PASSWORD}).status_code == 429
    secret = pyotp.random_base32()
    confirm = {"current_password": PASSWORD, "totp_secret": secret, "totp_code": pyotp.TOTP(secret).now()}
    assert client.post("/api/profile/totp/confirm", json=confirm).status_code == 429
    assert client.post("/api/profile/name", json={"name": "Sensei"}).status_code == 200  # not a credential


def test_setup_token(client):
    for _ in range(10):
        assert client.post("/api/setup/verify", json={"token": "x" * 32}).status_code == 403
    token = client.app.state.setup_token
    assert client.post("/api/setup/verify", json={"token": token}).status_code == 429
    assert client.post("/api/setup/totp", json={"token": token, "username": "admin"}).status_code == 429


def test_invitation_token(admin):  # noqa: F811
    token = create(admin)
    other = from_address("203.0.113.9")
    for _ in range(10):
        assert other.post("/api/register/verify", json={"token": "x" * 43}).status_code == 404
    assert other.post("/api/register/verify", json={"token": token}).status_code == 429
    assert admin.post("/api/register/verify", json={"token": token}).status_code == 200


def test_bounded_memory(monkeypatch):
    monkeypatch.setattr(throttle, "MAX_KEYS", 3)
    for i in range(5):
        throttle.failed(f"192.0.2.{i}")
    assert list(throttle._failures) == ["192.0.2.2", "192.0.2.3", "192.0.2.4"]
