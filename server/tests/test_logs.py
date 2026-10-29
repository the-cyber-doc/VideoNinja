"""Logging (app/logs.py): module loggers, text or JSON lines on standard error, the
settings checked."""

import json
import logging
import logging.config
import re
import subprocess  # the e2e script's own sed  # nosec B404

import pytest

from app import logs

TOKEN_SED = r"s/.*Setup token: \([A-Za-z0-9_-]*\).*/\1/p"  # tools/test-e2e-stack.sh


@pytest.fixture
def configured(monkeypatch):
    """Apply a configuration, then the default one again (the app's, at its import)."""
    def apply(**env):
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        logs.configure()

    yield apply
    monkeypatch.delenv("VIDEONINJA_LOG_FORMAT", raising=False)
    monkeypatch.delenv("VIDEONINJA_LOG_LEVEL", raising=False)
    logs.configure()


def last_line(capsys) -> str:
    return capsys.readouterr().err.strip().splitlines()[-1]


def test_json_line(configured, capsys):
    configured(VIDEONINJA_LOG_FORMAT="json")
    logging.getLogger("app.encoder").info("Video %s published", 3, extra={"video_id": 3})
    line = json.loads(last_line(capsys))
    assert line.keys() == {"ts", "level", "logger", "msg", "video_id"}
    assert (line["level"], line["logger"], line["msg"]) == ("INFO", "app.encoder", "Video 3 published")
    assert line["video_id"] == 3
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d", line["ts"])  # app/clock.py's format


def test_json_traceback(configured, capsys):
    configured(VIDEONINJA_LOG_FORMAT="json")
    try:
        raise ValueError("broken")
    except ValueError:
        logging.getLogger("app.snapshot").exception("Catalogue snapshot failed")
    line = json.loads(last_line(capsys))
    assert line["msg"] == "Catalogue snapshot failed"
    assert "ValueError: broken" in line["exc"]


def test_text_line(configured, capsys):
    configured(VIDEONINJA_LOG_FORMAT="text")
    logging.getLogger("app.db").warning("Database migrated to version %s", 3)
    assert re.fullmatch(r"\d\d:\d\d:\d\d WARNING +app\.db: Database migrated to version 3", last_line(capsys))


def test_level(configured, capsys):
    configured(VIDEONINJA_LOG_LEVEL="warning")  # case ignored
    logging.getLogger("app.db").info("hidden")
    logging.getLogger("app.db").warning("shown")
    assert "hidden" not in capsys.readouterr().err


def test_access_log_off_in_json_only(configured, capsys):
    configured(VIDEONINJA_LOG_FORMAT="json")
    logging.getLogger("uvicorn.access").info("GET /api/catalog 200")
    assert capsys.readouterr().err == ""
    configured(VIDEONINJA_LOG_FORMAT="text")
    logging.getLogger("uvicorn.access").info("GET /api/catalog 200")
    assert "GET /api/catalog 200" in capsys.readouterr().err


def test_uvicorn_through_the_same_handler(configured, capsys):
    configured(VIDEONINJA_LOG_FORMAT="json")
    logging.getLogger("uvicorn.error").info("Started server process [%d]", 1, extra={"color_message": "…"})
    line = json.loads(last_line(capsys))
    assert line == {**line, "logger": "uvicorn.error", "msg": "Started server process [1]"}
    assert "color_message" not in line


@pytest.mark.parametrize("name, value", [("VIDEONINJA_LOG_LEVEL", "verbose"), ("VIDEONINJA_LOG_FORMAT", "xml")])
def test_wrong_setting_refused(configured, name, value):
    with pytest.raises(RuntimeError, match=name):
        configured(**{name: value})


def test_modules_log_under_their_name(configured, capsys):
    """app.<module>, not uvicorn's logger: the setup token's line, as the e2e script reads it."""
    configured(VIDEONINJA_LOG_FORMAT="json")
    from app import setup
    token = setup.new_setup_token()
    line = last_line(capsys)
    assert json.loads(line)["logger"] == "app.setup"
    sed = subprocess.run(["sed", "-n", TOKEN_SED], input=line, capture_output=True, text=True, check=True)  # nosec
    assert sed.stdout.strip() == token
