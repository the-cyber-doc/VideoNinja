"""Dates and times: UTF-8 ISO 8601 text with the UTC offset, in one format
everywhere (database, Python, JSON, TypeScript): "2026-10-23T12:13:38+02:00".

Written in the user's timezone: the browser sends its IANA zone on every API
call (Time-Zone header, `zone` dependency) and the app saves it on the user
(user.time_zone) for writes without a browser request (tusd hooks). Without
either (background jobs, invitations), the server's timezone (TZ, else UTC).

The offset makes every value an exact moment, but values with different offsets
do not sort as text: SQL always compares and orders them through datetime(),
which converts to UTC. Columns and fields holding a date end in _at. Durations
stay plain seconds (…_S constants, segment begin_s / end_s).
"""

import os
import re
import sqlite3
from datetime import UTC, datetime, timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Header

# IANA names: "Europe/Zurich", "America/Argentina/Buenos_Aires", "Etc/GMT+2", "UTC".
_ZONE_NAME = re.compile(r"[A-Za-z0-9_+\-]{1,32}(/[A-Za-z0-9_+\-]{1,32}){0,2}")


def zone_named(name: str | None) -> ZoneInfo | None:
    """The IANA zone called `name`, or None if the name is missing or unknown."""
    if not name or not _ZONE_NAME.fullmatch(name):
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def server_zone() -> tzinfo:
    """TZ (an IANA name), else the system's timezone: UTC in the container by default."""
    return zone_named(os.environ.get("TZ")) or datetime.now().astimezone().tzinfo or UTC


def zone(time_zone: str | None = Header(default=None)) -> ZoneInfo | None:
    """FastAPI dependency: the browser's timezone (Time-Zone header), None if unusable."""
    return zone_named(time_zone)


def user_zone(user: sqlite3.Row, request_zone: tzinfo | None = None) -> tzinfo:
    """The timezone to write the user's dates in: the request's, the saved one, the server's."""
    return request_zone or zone_named(user["time_zone"]) or server_zone()


def now() -> datetime:
    """The current time in UTC (whole seconds). Tests replace it to move time.
    Compute in UTC and convert when writing: with a ZoneInfo, Python adds
    timedeltas to the wall-clock time, which is an hour off across a DST change."""
    return datetime.now(UTC).replace(microsecond=0)


def text(moment: datetime, zone: tzinfo | None = None) -> str:
    """`moment` as text, in `zone` (default: the server's timezone)."""
    return moment.astimezone(zone or server_zone()).isoformat(timespec="seconds")


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def at(offset_s: float = 0, zone: tzinfo | None = None) -> str:
    """Now plus offset_s seconds (negative: in the past), as text in `zone`."""
    return text(now() + timedelta(seconds=offset_s), zone)
