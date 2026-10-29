"""Logging, the same for the API and the encoder: every module logs to
logging.getLogger(__name__) ("app.<module>"), uvicorn's loggers included, on
standard error.

VIDEONINJA_LOG_FORMAT: "text" (default, development: "12:13:38 INFO     app.db: …")
or "json" (the images: one object per line, for journald / jq):

    {"ts": "2026-10-23T12:13:38+02:00", "level": "INFO", "logger": "app.encoder", "msg": "…"}

plus the record's extra fields (logger.info(…, extra={"video_id": 3})), the
context's (bind(): the request's "request_id" and "user_id", the encoder's
"video_id"), and "exc" (the traceback) when there is one. In text, the context
follows the message: "… [request_id=3f2a… user_id=1]". "ts": the dates' one format (app/clock.py), in
the server's timezone.

VIDEONINJA_LOG_LEVEL: DEBUG, INFO (default), WARNING or ERROR. uvicorn's access
log is off: the app logs its own line per request, with its ID (app/middleware.py).

A wrong value of either refuses the start (RuntimeError).
"""

import json
import logging
import logging.config
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from . import clock, settings

TEXT_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
# A record's own attributes: anything else was given as extra=.
_STANDARD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime", "taskName"}
_IGNORED = {"color_message"}  # uvicorn's copy of the message with terminal colours


# The fields every record gets while they are bound (a request, an encoding job). One
# dict per request or job, changed in place by add(): FastAPI runs each dependency in
# a copy of the context, where a new value set would not reach the endpoint.
_context: ContextVar[dict[str, Any] | None] = ContextVar("log_context", default=None)


@contextmanager
def bind(**fields: Any) -> Iterator[dict[str, Any]]:
    """Add `fields` to every record logged inside (this thread or task, and the
    threads it starts its work in: FastAPI's thread pool copies the context)."""
    fields = {**(_context.get() or {}), **fields}
    token = _context.set(fields)
    try:
        yield fields
    finally:
        _context.reset(token)


def start(**fields: Any) -> dict[str, Any]:
    """Bind `fields` for the rest of this task, without an end: a request (uvicorn runs
    each in its own task, whose context is its own copy) until its very last line,
    uvicorn's traceback of an unhandled exception included."""
    _context.set(fields := dict(fields))
    return fields


def add(**fields: Any) -> None:
    """Add fields to the bound context, e.g. the user once the session is checked.
    Nothing outside a bind()."""
    context = _context.get()
    if context is not None:
        context.update(fields)


def context() -> dict[str, Any]:
    return dict(_context.get() or {})


class ContextFilter(logging.Filter):
    """Copies the bound fields onto the record (an extra= of the call wins)."""

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in (_context.get() or {}).items():
            if not hasattr(record, key):
                setattr(record, key, value)
        record._context_keys = tuple(_context.get() or ())
        return True


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        keys = getattr(record, "_context_keys", ())
        if not keys:
            return text
        fields = " ".join(f"{key}={getattr(record, key)}" for key in keys)
        first, newline, rest = text.partition("\n")  # after the message, before a traceback
        return f"{first} [{fields}]{newline}{rest}"


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


def config(level: str, log_format: str) -> dict[str, Any]:
    """The dictConfig of these settings."""
    formatter: dict[str, Any] = (
        {"()": JsonFormatter} if log_format == "json"
        else {"()": TextFormatter, "fmt": TEXT_FORMAT, "datefmt": "%H:%M:%S"}
    )
    # uvicorn's loggers keep their names but lose their own handlers: through the root's.
    uvicorn = {"handlers": [], "propagate": True}
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": formatter},
        "filters": {"context": {"()": ContextFilter}},
        "handlers": {"stderr": {"()": StderrHandler, "formatter": "default", "filters": ["context"]}},
        "root": {"level": level, "handlers": ["stderr"]},
        "loggers": {
            "uvicorn": {**uvicorn, "level": level},
            "uvicorn.error": {**uvicorn, "level": level},
            "uvicorn.access": {**uvicorn, "level": "WARNING"},  # app/middleware.py logs each request
        },
    }


def configure() -> None:
    """Apply VIDEONINJA_LOG_LEVEL and VIDEONINJA_LOG_FORMAT (settings.py: RuntimeError if
    a setting is wrong)."""
    current = settings.current()
    logging.config.dictConfig(config(current.log_level, current.log_format))
