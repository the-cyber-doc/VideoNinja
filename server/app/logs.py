"""Logging, the same for the API and the encoder: every module logs to
logging.getLogger(__name__) ("app.<module>"), uvicorn's loggers included, on
standard error.

VIDEONINJA_LOG_FORMAT: "text" (default, development: "12:13:38 INFO     app.db: …")
or "json" (the images: one object per line, for journald / jq):

    {"ts": "2026-10-23T12:13:38+02:00", "level": "INFO", "logger": "app.encoder", "msg": "…"}

plus the record's extra fields (logger.info(…, extra={"video_id": 3})) and "exc"
(the traceback) when there is one. "ts": the dates' one format (app/clock.py), in
the server's timezone.

VIDEONINJA_LOG_LEVEL: DEBUG, INFO (default), WARNING or ERROR. uvicorn's access
log (one line per request) is kept in text mode only: in the images nginx logs
every request already.

A wrong value of either refuses the start (RuntimeError).
"""

import json
import logging
import logging.config
import os
import sys
from datetime import UTC, datetime
from typing import Any

from . import clock

LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")
FORMATS = ("text", "json")
TEXT_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
# A record's own attributes: anything else was given as extra=.
_STANDARD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime", "taskName"}
_IGNORED = {"color_message"}  # uvicorn's copy of the message with terminal colours


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "ts": clock.text(datetime.fromtimestamp(record.created, UTC)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD and key not in _IGNORED and not key.startswith("_"):
                line[key] = value
        if record.exc_info:
            line["exc"] = self.formatException(record.exc_info)
        elif record.exc_text:
            line["exc"] = record.exc_text
        return json.dumps(line, ensure_ascii=False, default=str)


class StderrHandler(logging.StreamHandler):
    """Writes to sys.stderr as it is at each record (pytest and uvicorn's reloader
    replace it), not the one of the configuration's time."""

    def __init__(self) -> None:
        super().__init__(sys.stderr)

    @property  # type: ignore[override]
    def stream(self):
        return sys.stderr

    @stream.setter
    def stream(self, _value) -> None:
        pass


def _setting(name: str, default: str, allowed: tuple[str, ...], normalise) -> str:
    raw = os.environ.get(name, default)
    value = normalise(raw.strip().strip("\"'").strip())
    if value not in allowed:
        raise RuntimeError(f"{name}={raw!r}: must be one of {', '.join(allowed)}")
    return value


def level() -> str:
    return _setting("VIDEONINJA_LOG_LEVEL", "INFO", LEVELS, str.upper)


def log_format() -> str:
    return _setting("VIDEONINJA_LOG_FORMAT", "text", FORMATS, str.lower)


def config(level: str, log_format: str) -> dict[str, Any]:
    """The dictConfig of these settings."""
    formatter: dict[str, Any] = (
        {"()": JsonFormatter} if log_format == "json" else {"format": TEXT_FORMAT, "datefmt": "%H:%M:%S"}
    )
    # uvicorn's loggers keep their names but lose their own handlers: through the root's.
    uvicorn = {"handlers": [], "propagate": True}
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": formatter},
        "handlers": {"stderr": {"()": StderrHandler, "formatter": "default"}},
        "root": {"level": level, "handlers": ["stderr"]},
        "loggers": {
            "uvicorn": {**uvicorn, "level": level},
            "uvicorn.error": {**uvicorn, "level": level},
            "uvicorn.access": {**uvicorn, "level": level if log_format == "text" else "WARNING"},
        },
    }


def configure() -> None:
    """Apply VIDEONINJA_LOG_LEVEL and VIDEONINJA_LOG_FORMAT (RuntimeError if invalid)."""
    logging.config.dictConfig(config(level(), log_format()))
