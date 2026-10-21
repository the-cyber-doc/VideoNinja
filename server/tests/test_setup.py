import json
import sqlite3

import pyotp

from app import crypto, db

from .conftest import PASSWORD


def test_status_before_setup(client):
    assert client.get("/api/setup/status").json() == {"initialized": False}
    assert not db.db_path().exists()


def test_wrong_token_rejected(client):
    assert client.post("/api/setup/verify", json={"token": "nope"}).status_code == 403
    assert client.post("/api/setup/totp", json={"token": "nope", "username": "admin"}).status_code == 403


def test_right_token_accepted(client):
    r = client.post("/api/setup/verify", json={"token": client.app.state.setup_token})
    assert r.status_code == 204


def test_totp_returns_qr(client):
    r = client.post("/api/setup/totp", json={"token": client.app.state.setup_token, "username": "admin"})
    body = r.json()
    assert body["uri"].startswith("otpauth://totp/Video%20Ninja:admin?")
    assert body["qr"].startswith("data:image/svg+xml")


def test_wrong_totp_code_rejected(client):
    token = client.app.state.setup_token
    secret = pyotp.random_base32()
    r = client.post(
        "/api/setup/complete",
        json={"token": token, "username": "admin", "password": PASSWORD,
              "totp_secret": secret, "totp_code": "000000" if pyotp.TOTP(secret).now() != "000000" else "111111"},
    )
    assert r.status_code == 400
    assert not db.db_path().exists()


def test_short_password_rejected(client):
    token = client.app.state.setup_token
    secret = pyotp.random_base32()
    r = client.post(
        "/api/setup/complete",
        json={"token": token, "username": "admin", "password": "short",
              "totp_secret": secret, "totp_code": pyotp.TOTP(secret).now()},
    )
    assert r.status_code == 422


def test_complete_streams_steps_and_creates_db(client):
    token = client.app.state.setup_token
    secret = pyotp.random_base32()
    r = client.post(
        "/api/setup/complete",
        json={"token": token, "username": "admin", "name": "Admin", "password": PASSWORD,
              "totp_secret": secret, "totp_code": pyotp.TOTP(secret).now()},
    )
    assert r.headers["x-accel-buffering"] == "no"
    steps = [json.loads(line) for line in r.text.splitlines()]
    assert steps == [{"step": "schema"}, {"step": "data"}, {"step": "admin"}, {"step": "done"}]

    con = sqlite3.connect(db.db_path())
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert con.execute("SELECT value FROM config WHERE name = 'db_version'").fetchone()[0] == "1"
    assert con.execute("SELECT count(*) FROM ryu").fetchone()[0] == 9
    user = con.execute("SELECT username, role, totp, pw_hash FROM user").fetchall()
    assert len(user) == 1
    assert user[0][:2] == ("admin", "admin")
    # TOTP secret encrypted at rest, bound to the user's row
    assert user[0][2].startswith("v1:") and secret not in user[0][2]
    assert crypto.decrypt(user[0][2], crypto.totp_aad(1)) == secret
    assert user[0][3].startswith("$argon2id$") and PASSWORD not in user[0][3]
    assert not db.db_path().with_name("videoninja.db.tmp").exists()


def test_setup_closed_after_completion(client, admin_secret):
    assert client.get("/api/setup/status").json() == {"initialized": True}
    assert client.app.state.setup_token is None
    assert client.post("/api/setup/verify", json={"token": "x"}).status_code == 404
    assert client.post("/api/setup/totp", json={"token": "x", "username": "admin"}).status_code == 404


def test_latest_scripts_picks_highest_complete_pair(tmp_path, monkeypatch):
    for name in ("db_v1.sql", "db_v1_init.sql", "db_v2.sql", "db_v2_init.sql", "db_v3.sql"):
        (tmp_path / name).write_text("")
    monkeypatch.setattr(db, "SQL_DIR", tmp_path)
    version, schema, seed = db.latest_scripts()
    assert (version, schema.name, seed.name) == (2, "db_v2.sql", "db_v2_init.sql")
