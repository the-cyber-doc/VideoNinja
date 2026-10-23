import sqlite3
from datetime import timedelta
from zoneinfo import ZoneInfo

import pyotp
import pytest

from app import clock, db, security

from .conftest import PASSWORD


def login(client, secret, password=PASSWORD, code=None, zone=None):
    return client.post(
        "/api/auth/login",
        json={"username": "admin", "password": password, "totp_code": code or pyotp.TOTP(secret).now()},
        headers={"Time-Zone": zone} if zone else {},
    )


def test_login_before_setup(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 503
    assert not db.db_path().exists()  # a request must never create the database


def test_login_me_logout(client, admin_secret):
    assert client.get("/api/auth/me").status_code == 401

    r = login(client, admin_secret)
    assert r.status_code == 200
    assert r.json() == {"username": "admin", "name": "Admin", "role": "admin", "role_name": "Admin",
                        "access": ["annotate", "comment", "segment", "upload", "user_mgmt",
                                   "video_mgmt"]}
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
        con.execute("UPDATE session SET expires_at = ?", (clock.at(-1),))
    assert client.get("/api/auth/me").status_code == 401


def test_sliding_refresh(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    old = clock.now() - timedelta(days=2)
    with con:
        con.execute("UPDATE session SET created_at = ?, last_seen_at = ?, expires_at = ?",
                    (clock.text(old), clock.text(old), clock.text(old + timedelta(seconds=security.SESSION_IDLE_S))))
    assert client.get("/api/auth/me").status_code == 200
    last_seen, expires = con.execute("SELECT last_seen_at, expires_at FROM session").fetchone()
    assert clock.parse(last_seen) > old
    assert clock.parse(expires) >= clock.now() + timedelta(seconds=security.SESSION_IDLE_S - 5)


def test_absolute_cap(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    created = clock.now() - timedelta(seconds=security.SESSION_MAX_S - 3600)  # 1 h left before the cap
    with con:
        con.execute("UPDATE session SET created_at = ?, last_seen_at = ?",
                    (clock.text(created), clock.text(created)))
    client.get("/api/auth/me")
    (expires,) = con.execute("SELECT expires_at FROM session").fetchone()
    assert expires == clock.text(created + timedelta(seconds=security.SESSION_MAX_S))


def test_purge_expired(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE session SET expires_at = '1970-01-01T00:00:00Z'")
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


def test_dates_in_the_browser_timezone(client, admin_secret):
    """Dates (…_at) are UTF-8 text with the offset of the browser's timezone, which is saved."""
    import re
    login(client, admin_secret, zone="Asia/Tokyo")
    con = sqlite3.connect(db.db_path())
    assert con.execute("PRAGMA encoding").fetchone() == ("UTF-8",)
    row = con.execute("SELECT typeof(created_at), created_at, last_seen_at, expires_at"
                      " FROM session").fetchone()
    assert row[0] == "text"
    for value in row[1:]:
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00", value), value
    assert clock.parse(row[3]) - clock.parse(row[1]) == timedelta(seconds=security.SESSION_IDLE_S)

    def saved():
        return con.execute("SELECT time_zone FROM user").fetchone()[0]

    assert saved() == "Asia/Tokyo"

    # Another browser, another timezone: saved too. Unusable names are ignored.
    assert client.get("/api/auth/me", headers={"Time-Zone": "America/New_York"}).status_code == 200
    assert saved() == "America/New_York"
    for bad in ("Mars/Olympus_Mons", "../../etc/passwd", "/etc/localtime", "x" * 200):
        assert client.get("/api/auth/me", headers={"Time-Zone": bad}).status_code == 200
    assert saved() == "America/New_York"


@pytest.mark.parametrize("offset_s, zone, valid", [
    # Text comparison with the UTC "now" would give the opposite answer.
    (-3600, "Etc/GMT-14", False),  # expired an hour ago, written at +14:00
    (3600, "Etc/GMT+12", True),  # valid for an hour, written at -12:00
])
def test_expiry_compared_across_offsets(client, admin_secret, offset_s, zone, valid):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE session SET expires_at = ?", (clock.at(offset_s, ZoneInfo(zone)),))
    assert client.get("/api/auth/me").status_code == (200 if valid else 401)
