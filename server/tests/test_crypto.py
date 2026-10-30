import base64
import os

import pyotp
import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient

from app.core import crypto
from app.main import app

from .conftest import PASSWORD, connect


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


@pytest.mark.parametrize(
    "content, message",
    [(None, "not found"), ("not base64!", "base64"), (base64.b64encode(b"short").decode(), "32 bytes")],
)
def test_bad_key_file_refuses_start(key_file, tmp_path, monkeypatch, content, message):
    if content is None:
        key_file.unlink()
    else:
        key_file.write_text(content)
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    with pytest.raises(RuntimeError, match=message), TestClient(app):
        pass


@pytest.mark.skipif(os.getuid() == 0, reason="root reads any file")
def test_unreadable_key_file_says_how_to_fix(key_file):
    key_file.chmod(0)
    with pytest.raises(RuntimeError, match=rf"not readable by this user \(UID {os.getuid()}\).*chown {os.getuid()}"):
        crypto.load_key()


def test_key_from_environment(key_file, monkeypatch):
    """VIDEONINJA_DB_KEY instead of the file; removed from the environment the children inherit."""
    crypto.load_key()
    token = crypto.encrypt("secret", "ad")
    monkeypatch.delenv("VIDEONINJA_DB_KEY_FILE")
    monkeypatch.setenv("VIDEONINJA_DB_KEY", f" {key_file.read_text()}\n")
    key_file.unlink()
    crypto.load_key()
    assert "VIDEONINJA_DB_KEY" not in os.environ
    assert crypto.decrypt(token, "ad") == "secret"


@pytest.mark.parametrize(
    "value, message",
    [(None, "Both"), ("not base64!", "base64: VIDEONINJA_DB_KEY$"), ("", "32 bytes, got 0: VIDEONINJA_DB_KEY$")],
)
def test_bad_key_variable_refuses_start(key_file, tmp_path, monkeypatch, value, message):
    if value is None:
        value = key_file.read_text()  # valid, but VIDEONINJA_DB_KEY_FILE is set too
    else:
        monkeypatch.delenv("VIDEONINJA_DB_KEY_FILE")
    monkeypatch.setenv("VIDEONINJA_DB_KEY", value)
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    with pytest.raises(RuntimeError, match=message), TestClient(app):
        pass


def test_login_refused_if_secret_moved_to_other_row(client, admin_secret):
    """A ciphertext copied onto another user's row must not decrypt there."""
    con = connect()
    with con:
        con.execute("UPDATE user SET id = 7 WHERE id = 1")
    code = pyotp.TOTP(admin_secret).now()  # a valid code: only the row binding can refuse it
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp_code": code})
    assert r.status_code == 401
    with con:
        con.execute("UPDATE user SET id = 1 WHERE id = 7")
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp_code": code})
    assert r.status_code == 200


def test_no_key_loaded(monkeypatch):
    monkeypatch.setattr(crypto, "_aead", None)
    with pytest.raises(RuntimeError, match="not loaded"):
        crypto.encrypt("secret", "user:1")


def test_unknown_version_refused(key):
    """A token of another key version (v1: the only one so far)."""
    token = crypto.encrypt("secret", "user:1")
    with pytest.raises(ValueError, match="v9"):
        crypto.decrypt("v9" + token[2:], "user:1")
