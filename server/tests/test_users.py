import sqlite3

import pyotp
import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

from .test_auth import login

USER_PASSWORD = "kenji's long password"


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    return client


def create(admin, username="kenji", role="user"):
    r = admin.post("/api/admin/users", json={"username": username, "role": role})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def register(token, password=USER_PASSWORD) -> str:
    """Complete an invitation like the registration page; return the TOTP secret."""
    anon = TestClient(app, base_url="https://testserver")
    secret = anon.post("/api/register/totp", json={"token": token}).json()["secret"]
    r = anon.post("/api/register/complete", json={
        "token": token, "name": "Kenji", "password": password,
        "totp_secret": secret, "totp_code": pyotp.TOTP(secret).now()})
    assert r.status_code == 204, r.text
    return secret


def user_login(username, password, code) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.post("/api/auth/login", json={"username": username, "password": password, "totp_code": code})
    return c


def statuses(admin) -> dict[str, str]:
    return {u["username"]: u["status"] for u in admin.get("/api/admin/users").json()}


def expire_invites():
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE invite SET expires_at = '1970-01-01T00:00:00Z'")


def test_create_and_list(admin):
    create(admin)
    users = {u["username"]: u for u in admin.get("/api/admin/users").json()}
    assert users["admin"]["status"] == "registered"
    assert users["kenji"] == {"id": users["kenji"]["id"], "username": "kenji", "name": None,
                              "role": "user", "status": "invited"}
    roles = admin.get("/api/admin/roles").json()
    assert {r["id"] for r in roles} == {"admin", "editor", "uploader", "user"}


def test_create_checks(admin):
    create(admin)
    assert admin.post("/api/admin/users", json={"username": "kenji", "role": "user"}).status_code == 409
    assert admin.post("/api/admin/users", json={"username": "other", "role": "boss"}).status_code == 422
    assert admin.post("/api/admin/users", json={"username": "Bad Name", "role": "user"}).status_code == 422


def test_invite_token_not_stored_in_clear(admin):
    token = create(admin)
    row = sqlite3.connect(db.db_path()).execute("SELECT token_hash, token FROM invite").fetchone()
    assert token not in row[0] and token not in row[1]
    # ...but the admin can copy the link again.
    user_id = next(u["id"] for u in admin.get("/api/admin/users").json() if u["username"] == "kenji")
    assert admin.get(f"/api/admin/users/{user_id}/invite").json()["token"] == token


def test_unregistered_user_cannot_log_in(admin):
    create(admin)
    for password in ("", "anything at all"):
        r = admin.post("/api/auth/login", json={"username": "kenji", "password": password, "totp_code": "123456"})
        assert r.status_code == 401


def test_registration(admin):
    token = create(admin)
    anon = TestClient(app, base_url="https://testserver")
    assert anon.post("/api/register/verify", json={"token": token}).json() == {"username": "kenji"}

    secret = register(token)
    assert statuses(admin)["kenji"] == "registered"
    me = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now()).get("/api/auth/me").json()
    assert me == {"username": "kenji", "name": "Kenji", "role": "user", "role_name": "User",
                  "access": ["comment", "segment"]}

    # Single use.
    assert anon.post("/api/register/verify", json={"token": token}).status_code == 404


def test_registration_checks(admin):
    token = create(admin)
    anon = TestClient(app, base_url="https://testserver")
    secret = anon.post("/api/register/totp", json={"token": token}).json()["secret"]
    body = {"token": token, "password": USER_PASSWORD, "totp_secret": secret}
    wrong = "000000" if pyotp.TOTP(secret).now() != "000000" else "111111"
    assert anon.post("/api/register/complete", json={**body, "totp_code": wrong}).status_code == 400
    assert anon.post("/api/register/complete",
                     json={**body, "password": "short", "totp_code": pyotp.TOTP(secret).now()}).status_code == 422
    assert anon.post("/api/register/verify", json={"token": "made-up"}).status_code == 404
    assert statuses(admin)["kenji"] == "invited"  # nothing changed


def test_expired_invitation(admin):
    token = create(admin)
    expire_invites()
    assert statuses(admin)["kenji"] == "expired"
    anon = TestClient(app, base_url="https://testserver")
    assert anon.post("/api/register/verify", json={"token": token}).status_code == 404
    user_id = next(u["id"] for u in admin.get("/api/admin/users").json() if u["username"] == "kenji")
    assert admin.get(f"/api/admin/users/{user_id}/invite").status_code == 404

    new = admin.post(f"/api/admin/users/{user_id}/reset").json()["token"]
    assert new != token
    assert statuses(admin)["kenji"] == "invited"
    assert anon.post("/api/register/verify", json={"token": new}).status_code == 200


def test_reset_registered_user(admin):
    secret = register(create(admin))
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert kenji.get("/api/auth/me").status_code == 200

    user_id = next(u["id"] for u in admin.get("/api/admin/users").json() if u["username"] == "kenji")
    token = admin.post(f"/api/admin/users/{user_id}/reset").json()["token"]
    assert statuses(admin)["kenji"] == "invited"
    # Old credentials erased from the database, sessions gone, new invitation stored.
    con = sqlite3.connect(db.db_path())
    assert con.execute("SELECT pw_hash, totp FROM user WHERE id = ?", (user_id,)).fetchone() == (None, None)
    assert con.execute("SELECT count(*) FROM session WHERE user = ?", (user_id,)).fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM invite WHERE user = ?", (user_id,)).fetchone()[0] == 1
    assert kenji.get("/api/auth/me").status_code == 401  # logged out everywhere
    # Old password and authenticator no longer work.
    assert user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now()).get("/api/auth/me").status_code == 401

    register(token, password="a brand new password")
    assert statuses(admin)["kenji"] == "registered"


def test_cannot_reset_self(admin):
    admin_id = next(u["id"] for u in admin.get("/api/admin/users").json() if u["username"] == "admin")
    assert admin.post(f"/api/admin/users/{admin_id}/reset").status_code == 400
    assert admin.post("/api/admin/users/9999/reset").status_code == 404


def test_access_control(admin, client):
    secret = register(create(admin))
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    anon = TestClient(app, base_url="https://testserver")
    calls = [("get", "/api/admin/users", None), ("get", "/api/admin/roles", None),
             ("post", "/api/admin/users", {"username": "x" * 5, "role": "user"}),
             ("get", "/api/admin/users/1/invite", None), ("post", "/api/admin/users/1/reset", None)]
    for method, path, body in calls:
        assert getattr(anon, method)(path, **({"json": body} if body else {})).status_code == 401, path
        assert getattr(kenji, method)(path, **({"json": body} if body else {})).status_code == 403, path
    assert "xxxxx" not in statuses(admin)
