"""tools/make-dev-db.py: a database the app accepts, with its fixed admin."""

import os
import runpy
import subprocess
import sys
from pathlib import Path

import pyotp
from fastapi.testclient import TestClient

from app.main import app

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "make-dev-db.py"
TOOL = runpy.run_path(str(SCRIPT))  # its USERNAME, PASSWORD, TOTP_SECRET


def make(*args: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("VIDEONINJA_")}
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env)


def test_admin_logs_in_with_the_fixed_credentials(tmp_path, key_file, monkeypatch):
    database = tmp_path / "dev.db"
    result = make("--db", str(database), "--key", str(key_file))
    assert result.returncode == 0, result.stderr

    monkeypatch.setenv("VIDEONINJA_DB", str(database))
    with TestClient(app, base_url="https://testserver") as client:
        r = client.post(
            "/api/auth/login",
            json={
                "username": TOOL["USERNAME"],
                "password": TOOL["PASSWORD"],
                "totp_code": pyotp.TOTP(TOOL["TOTP_SECRET"]).now(),
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "admin"


def test_missing_key_refused(tmp_path):
    result = make("--db", str(tmp_path / "dev.db"), "--key", str(tmp_path / "none.key"))
    assert result.returncode != 0
    assert "no encryption key" in result.stderr
    assert not (tmp_path / "dev.db").exists()


def test_existing_database_kept_unless_forced(tmp_path, key_file):
    database = tmp_path / "dev.db"
    assert make("--db", str(database), "--key", str(key_file)).returncode == 0
    database.with_name("dev.db-wal").write_bytes(b"")

    result = make("--db", str(database), "--key", str(key_file))
    assert result.returncode != 0 and "--force" in result.stderr

    assert make("--db", str(database), "--key", str(key_file), "--force").returncode == 0
    assert database.exists() and not database.with_name("dev.db-wal").exists()
