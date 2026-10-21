import base64
import os
import sqlite3

import pyotp
import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient

from app import crypto, db
from app.main import app

from .conftest import PASSWORD


@pytest.fixture
def key(key_file):
    crypto.load_key()


def test_roundtrip(key):
    token = crypto.encrypt("JBSWY3DPEHPK3PXP", "user:1:totp")
    assert token.startswith("v1:") and "JBSWY3DPEHPK3PXP" not in token
    assert crypto.decrypt(token, "user:1:totp") == "JBSWY3DPEHPK3PXP"


def test_fresh_nonce_each_time(key):
    assert crypto.encrypt("same", "ad") != crypto.encrypt("same", "ad")


def test_other_row_fails(key):
    token = crypto.encrypt("secret", crypto.totp_aad(1))
    with pytest.raises(InvalidTag):
        crypto.decrypt(token, crypto.totp_aad(2))


def test_tampering_fails(key):
    version, nonce, ct = crypto.encrypt("secret", "ad").split(":")
    raw = bytearray(base64.urlsafe_b64decode(ct))
    raw[0] ^= 1
    with pytest.raises(InvalidTag):
        crypto.decrypt(f"{version}:{nonce}:{base64.urlsafe_b64encode(bytes(raw)).decode()}", "ad")


def test_wrong_key_fails(key, key_file):
    token = crypto.encrypt("secret", "ad")
    key_file.write_text(base64.b64encode(os.urandom(32)).decode())
    crypto.load_key()
    with pytest.raises(InvalidTag):
        crypto.decrypt(token, "ad")


@pytest.mark.parametrize("content, message", [(None, "not found"), ("not base64!", "base64"),
                                              (base64.b64encode(b"short").decode(), "32 bytes")])
def test_bad_key_file_refuses_start(key_file, tmp_path, monkeypatch, content, message):
    if content is None:
        key_file.unlink()
    else:
        key_file.write_text(content)
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    with pytest.raises(RuntimeError, match=message):
        with TestClient(app):
            pass


def test_login_refused_if_secret_moved_to_other_row(client, admin_secret):
    """A ciphertext copied onto another user's row must not decrypt there."""
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE user SET id = 7 WHERE id = 1")
    code = pyotp.TOTP(admin_secret).now()  # a valid code: only the row binding can refuse it
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp_code": code})
    assert r.status_code == 401
    with con:
        con.execute("UPDATE user SET id = 1 WHERE id = 7")
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp_code": code})
    assert r.status_code == 200
