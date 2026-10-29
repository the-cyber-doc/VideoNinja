import pyotp
import pytest
from fastapi.testclient import TestClient

from app.core import crypto
from app.main import app

from .conftest import PASSWORD, connect
from .test_auth import login

NEW_PASSWORD = "another long passphrase"


@pytest.fixture
def logged_in(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    return admin_secret


def second_session(secret, password=PASSWORD) -> TestClient:
    other = TestClient(app, base_url="https://testserver")
    assert login(other, secret, password=password).status_code == 200
    return other


@pytest.mark.parametrize(
    "path", ["/api/profile/name", "/api/profile/password", "/api/profile/totp", "/api/profile/totp/confirm"]
)
def test_needs_session(client, admin_secret, path):
    assert client.post(path, json={}).status_code == 401


def test_set_name(client, logged_in):
    r = client.post("/api/profile/name", json={"name": "  Sensei  "})
    assert r.json()["name"] == "Sensei" and r.json()["username"] == "admin"
    assert client.get("/api/auth/me").json()["name"] == "Sensei"

    assert client.post("/api/profile/name", json={"name": ""}).json()["name"] is None
    assert client.post("/api/profile/name", json={"name": "x" * 65}).status_code == 422


def test_username_cannot_change(client, logged_in):
    client.post("/api/profile/name", json={"name": "N", "username": "root"})
    assert client.get("/api/auth/me").json()["username"] == "admin"


def test_change_password(client, logged_in):
    other = second_session(logged_in)
    r = client.post("/api/profile/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert r.status_code == 204

    assert client.get("/api/auth/me").status_code == 200  # this session stays
    assert other.get("/api/auth/me").status_code == 401  # others are logged out
    assert login(client, logged_in).status_code == 401
    assert login(client, logged_in, password=NEW_PASSWORD).status_code == 200


def test_change_password_checks(client, logged_in):
    r = client.post("/api/profile/password", json={"current_password": "wrong password!", "new_password": NEW_PASSWORD})
    assert r.status_code == 403
    r = client.post("/api/profile/password", json={"current_password": PASSWORD, "new_password": "short"})
    assert r.status_code == 422
    assert login(client, logged_in).status_code == 200  # unchanged


def test_replace_totp(client, logged_in):
    other = second_session(logged_in)
    new = client.post("/api/profile/totp").json()
    assert set(new) == {"secret", "uri", "qr"} and new["secret"] != logged_in

    body = {"current_password": PASSWORD, "totp_secret": new["secret"], "totp_code": pyotp.TOTP(new["secret"]).now()}
    assert client.post("/api/profile/totp/confirm", json=body).status_code == 204

    assert other.get("/api/auth/me").status_code == 401
    assert login(client, logged_in, code=pyotp.TOTP(new["secret"]).now()).status_code == 200
    old = pyotp.TOTP(logged_in).now()
    if old != pyotp.TOTP(new["secret"]).now():
        assert login(client, logged_in, code=old).status_code == 401

    # Stored encrypted, bound to the user's row.
    stored = connect().execute("SELECT id, totp FROM user").fetchone()
    assert crypto.decrypt(stored[1], crypto.totp_aad(stored[0])) == new["secret"]


def test_replace_totp_checks(client, logged_in):
    secret = client.post("/api/profile/totp").json()["secret"]
    wrong = "000000" if pyotp.TOTP(secret).now() != "000000" else "111111"
    r = client.post(
        "/api/profile/totp/confirm", json={"current_password": PASSWORD, "totp_secret": secret, "totp_code": wrong}
    )
    assert r.status_code == 400
    r = client.post(
        "/api/profile/totp/confirm",
        json={"current_password": "wrong password!", "totp_secret": secret, "totp_code": pyotp.TOTP(secret).now()},
    )
    assert r.status_code == 403
    assert login(client, logged_in).status_code == 200  # old authenticator still works
