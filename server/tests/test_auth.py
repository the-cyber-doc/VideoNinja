import sqlite3
import time

import pyotp

from app import db, security

from .conftest import PASSWORD


def login(client, secret, password=PASSWORD, code=None):
    return client.post(
        "/api/auth/login",
        json={"username": "admin", "password": password, "totp_code": code or pyotp.TOTP(secret).now()},
    )


def test_login_before_setup(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 503
    assert not db.db_path().exists()  # a request must never create the database


def test_login_me_logout(client, admin_secret):
    assert client.get("/api/auth/me").status_code == 401

    r = login(client, admin_secret)
    assert r.status_code == 200
    assert r.json() == {"username": "admin", "name": "Admin", "role": "admin", "access": ["segment", "user_mgmt"]}
    cookie = r.headers["set-cookie"]
    for attr in ("__Host-session=", "HttpOnly", "Secure", "SameSite=strict", "Path=/"):
        assert attr in cookie

    assert client.get("/api/auth/me").json()["username"] == "admin"

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    con = sqlite3.connect(db.db_path())
    assert con.execute("SELECT count(*) FROM session").fetchone()[0] == 0


def test_bad_password(client, admin_secret):
    assert login(client, admin_secret, password="wrong password!").status_code == 401


def test_bad_or_missing_totp(client, admin_secret):
    wrong = "000000" if pyotp.TOTP(admin_secret).now() != "000000" else "111111"
    assert login(client, admin_secret, code=wrong).status_code == 401
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 401


def test_unknown_user(client, admin_secret):
    r = client.post("/api/auth/login", json={"username": "ghost", "password": PASSWORD, "totp_code": "123456"})
    assert r.status_code == 401


def test_session_stores_only_hash(client, admin_secret):
    login(client, admin_secret)
    token = client.cookies.get("__Host-session")
    con = sqlite3.connect(db.db_path())
    (sid,) = con.execute("SELECT id FROM session").fetchone()
    assert sid != token and len(sid) == 64


def test_expired_session_refused(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE session SET expires_s = ?", (int(time.time()) - 1,))
    assert client.get("/api/auth/me").status_code == 401


def test_sliding_refresh(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    old = int(time.time()) - 2 * 24 * 3600
    with con:
        con.execute("UPDATE session SET created_s = ?, last_seen_s = ?, expires_s = ?",
                    (old, old, old + security.SESSION_IDLE_S))
    assert client.get("/api/auth/me").status_code == 200
    last_seen, expires = con.execute("SELECT last_seen_s, expires_s FROM session").fetchone()
    assert last_seen > old
    assert expires >= int(time.time()) + security.SESSION_IDLE_S - 5


def test_absolute_cap(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    created = int(time.time()) - security.SESSION_MAX_S + 3600  # 1 h left before the cap
    with con:
        con.execute("UPDATE session SET created_s = ?, last_seen_s = ?", (created, created))
    client.get("/api/auth/me")
    (expires,) = con.execute("SELECT expires_s FROM session").fetchone()
    assert expires == created + security.SESSION_MAX_S


def test_purge_expired(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE session SET expires_s = 0")
    login(client, admin_secret)  # login purges expired rows
    assert con.execute("SELECT count(*) FROM session").fetchone()[0] == 1


def test_user_without_totp_cannot_log_in(client, admin_secret):
    # TOTP is mandatory: a missing secret must never mean "no code needed".
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE user SET totp = NULL")
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 401
    assert login(client, admin_secret).status_code == 401
