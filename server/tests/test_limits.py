"""Upload limits and the formats ffmpeg may read."""

import pytest

from app import limits

from .test_upload import admin  # noqa: F401 (fixture)


def test_defaults(monkeypatch):
    for name in ("VIDEONINJA_MAX_UPLOAD_BYTES", "VIDEONINJA_INPUT_FORMATS"):
        monkeypatch.delenv(name, raising=False)
    assert limits.max_upload_bytes() == 20 * 1024**3
    assert limits.input_formats() == ["mov", "matroska", "avi", "mpegts", "mpeg", "dv", "asf"]
    assert {"mp4", "mov", "mkv", "webm", "avi", "mts", "mpg", "vob", "dv", "wmv"} <= set(limits.extensions())
    assert limits.ffmpeg_input() == ["-protocol_whitelist", "file",
                                     "-format_whitelist", "mov,matroska,avi,mpegts,mpeg,dv,asf"]
    assert limits.ffmpeg_input(own=True) == ["-protocol_whitelist", "file", "-format_whitelist", "mov"]


@pytest.mark.parametrize("name, accepted", [
    ("kata.MP4", True), ("a.b.mkv", True), ("dvd.vob", True), ("x.jpg", False), ("mp4", False), ("x.mp4 ", False),
])
def test_accepted_names(name, accepted):
    assert limits.accepted_name(name) is accepted


def test_formats_setting(monkeypatch):
    monkeypatch.setenv("VIDEONINJA_INPUT_FORMATS", " MOV, matroska ")
    assert limits.input_formats() == ["mov", "matroska"]
    assert limits.extensions() == ["mp4", "mov", "m4v", "3gp", "3g2", "mkv", "webm"]


@pytest.mark.parametrize("variable, value", [
    ("VIDEONINJA_INPUT_FORMATS", "mov,hls"),  # a playlist format: never
    ("VIDEONINJA_INPUT_FORMATS", ""),
    ("VIDEONINJA_MAX_UPLOAD_BYTES", "20GB"),
    ("VIDEONINJA_MAX_UPLOAD_BYTES", "0"),
])
def test_invalid_settings_refuse_start(monkeypatch, variable, value):
    monkeypatch.setenv(variable, value)
    with pytest.raises(RuntimeError, match=variable):
        limits.check()


def test_the_upload_page_gets_them(admin, monkeypatch):  # noqa: F811
    monkeypatch.setenv("VIDEONINJA_MAX_UPLOAD_BYTES", "1000")
    monkeypatch.setenv("VIDEONINJA_INPUT_FORMATS", "matroska")
    assert admin.get("/api/uploads/limits").json() == {"max_bytes": 1000, "extensions": ["mkv", "webm"]}


def test_upload_limits_need_the_upload_access(client, admin_secret):
    assert client.get("/api/uploads/limits").status_code == 401
