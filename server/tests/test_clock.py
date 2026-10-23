from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from app import clock
from app.clock import server_zone  # the real one: conftest replaces clock.server_zone


def test_format_and_offsets(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 23, 10, 13, 38, tzinfo=UTC))
    assert clock.at(0, ZoneInfo("Europe/Zurich")) == "2026-10-23T12:13:38+02:00"
    assert clock.at(0, ZoneInfo("Asia/Kolkata")) == "2026-10-23T15:43:38+05:30"
    assert clock.at() == "2026-10-23T10:13:38+00:00"  # the server's timezone: TZ=UTC in the tests
    assert clock.parse("2026-10-23T12:13:38+02:00") == clock.now()


def test_exact_seconds_across_a_dst_change(monkeypatch):
    # Summer time ends in Zurich on 2026-10-25: two days later is 13:00 local, not 12:00.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 24, 10, 0, tzinfo=UTC))
    zurich = ZoneInfo("Europe/Zurich")
    assert clock.at(0, zurich) == "2026-10-24T12:00:00+02:00"
    assert clock.at(2 * 24 * 3600, zurich) == "2026-10-26T11:00:00+01:00"


def test_zone_names():
    assert clock.zone_named("America/Argentina/Buenos_Aires").key == "America/Argentina/Buenos_Aires"
    assert clock.zone_named("Etc/GMT+2").key == "Etc/GMT+2"
    for bad in (None, "", "Mars/Olympus_Mons", "../../etc/passwd", "/etc/localtime", "Europe/", "x" * 200):
        assert clock.zone_named(bad) is None, bad


def test_server_zone(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Paris")
    assert server_zone() == ZoneInfo("Europe/Paris")
