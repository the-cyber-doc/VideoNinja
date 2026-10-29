"""Settings (app/settings.py): read and checked in one place, every wrong one named
at once; the key never in them; nothing else reads the environment."""

import ast
from pathlib import Path

import pytest

from app.core import settings
from app.core.settings import Settings

APP = Path(__file__).resolve().parents[1] / "app"
README = Path(__file__).resolve().parents[2] / "README.md"


def test_defaults():
    s = Settings.from_env({})
    assert s.db == Path("/data/videoninja.db")
    assert s.catalog_dir == Path("/data/catalog")
    assert s.upload_dir == Path("/data/uploads")
    assert s.media_dir == Path("/data/media")
    assert (s.base_path, s.x_accel, s.tusd_url, s.api_url) == ("", False, None, None)
    assert (s.run_tusd, s.run_encoder, s.tusd_port, s.app_port) == (True, True, 1080, 8000)
    assert (s.x265_preset, s.max_upload_bytes) == ("medium", 20 * 1024**3)
    assert (s.ffmpeg_timeout_s, s.ffprobe_timeout_s) == (86400, 600)
    assert (s.argon2_concurrency, s.log_level, s.log_format) == (2, "INFO", "text")


def test_every_wrong_one_named_at_once():
    with pytest.raises(RuntimeError) as e:
        Settings.from_env({"VIDEONINJA_X265_PRESET": "p6", "VIDEONINJA_TUSD_URL": "file:///etc/passwd",
                           "VIDEONINJA_TUSD_PORT": "99999", "VIDEONINJA_ARGON2_CONCURRENCY": "0",
                           "VIDEONINJA_LOG_FORMAT": "xml", "VIDEONINJA_BASE_PATH": "videoninja"})
    message = str(e.value)
    for name in ("X265_PRESET='p6'", "TUSD_URL=", "TUSD_PORT='99999'", "ARGON2_CONCURRENCY='0'",
                 "LOG_FORMAT='xml'", "BASE_PATH='videoninja'"):
        assert f"VIDEONINJA_{name}" in message
    assert len(message.splitlines()) == 7  # a title, then one line each


def test_the_key_is_never_a_setting(monkeypatch):
    """crypto.py reads VIDEONINJA_DB_KEY once and removes it: never in an object
    that could be logged or shown."""
    assert "VIDEONINJA_DB_KEY" not in settings.VARIABLES
    monkeypatch.setenv("VIDEONINJA_DB_KEY", "c2VjcmV0")
    assert "c2VjcmV0" not in repr(settings.current())


def test_parsed_once_per_environment(monkeypatch):
    first = settings.current()
    assert settings.current() is first
    monkeypatch.setenv("VIDEONINJA_X265_PRESET", "fast")
    assert settings.current().x265_preset == "fast"  # a test's change is seen


def test_only_settings_and_crypto_read_the_environment():
    for path in APP.rglob("*.py"):
        if path.name in ("settings.py", "crypto.py"):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Attribute) and node.attr in ("environ", "getenv"):
                pytest.fail(f"{path.name}:{node.lineno}: os.{node.attr} (use settings.current())")


def test_readme_documents_every_variable():
    readme = README.read_text(encoding="utf-8")
    assert [name for name in settings.VARIABLES if f"`{name}`" not in readme] == []
