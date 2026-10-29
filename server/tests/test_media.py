import shutil
from pathlib import Path

import pyotp
import pytest

from app.encoder import checks

from .conftest import connect
from .test_auth import login
from .test_catalog import SHA, add_segments
from .test_users import USER_PASSWORD, create, register, user_login

THUMBS = f"/protected/ab/{SHA}"


def test_x_accel_redirect(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments()
    r = client.get("/media/segment/1/thumbnail")
    assert r.status_code == 200
    assert r.content == b""
    assert r.headers["x-accel-redirect"] == f"{THUMBS}/seg1.jpg"
    # Without its own thumbnail, a segment shows its video's.
    assert client.get("/media/segment/2/thumbnail").headers["x-accel-redirect"] == f"{THUMBS}/thumb.jpg"


def test_not_found(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments(segment_thumbnail=None, video_thumbnail=None)
    assert client.get("/media/segment/1/thumbnail").status_code == 404  # no thumbnail
    assert client.get("/media/segment/99/thumbnail").status_code == 404  # no segment


def test_invalid_file_name_never_served(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments(segment_thumbnail="../../../etc/passwd")
    r = client.get("/media/segment/1/thumbnail")
    assert r.status_code == 404
    assert "x-accel-redirect" not in r.headers


def test_served_by_the_app_without_nginx(client, admin_secret, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    login(client, admin_secret)
    add_segments()
    folder = tmp_path / "media" / "video" / "ab" / SHA
    folder.mkdir(parents=True)
    (folder / "seg1.jpg").write_bytes(b"\xff\xd8 jpeg")
    r = client.get("/media/segment/1/thumbnail")
    assert r.status_code == 200
    assert r.content == b"\xff\xd8 jpeg"
    assert client.get("/media/segment/2/thumbnail").status_code == 404  # thumb.jpg missing


def test_needs_segment_access(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    assert client.get("/media/segment/1/thumbnail").status_code == 401
    admin = client
    login(admin, admin_secret)
    add_segments()
    secret = register(create(admin))
    con = connect()
    with con:  # a role without the "segment" access
        con.execute("INSERT INTO translation (id, en) VALUES ('role.guest.name', 'Guest')")
        con.execute("INSERT INTO role (id, name) VALUES ('guest', 'role.guest.name')")
        con.execute("UPDATE user SET role = 'guest' WHERE username = 'kenji'")
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    r = kenji.get("/media/segment/1/thumbnail")
    assert r.status_code == 403
    assert "x-accel-redirect" not in r.headers


# --- clips ---


def test_clip_cut_by_nginx(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments()
    # The app sets the times from the database; nginx's mp4 module cuts the clip.
    r = client.get("/media/segment/1")
    assert r.status_code == 200 and r.content == b""
    # /protected-clip/<user id>/…: nginx allows one clip transfer per user at a time.
    assert r.headers["x-accel-redirect"] == f"/protected-clip/1/ab/{SHA}/video.mp4?start=12&end=27"
    assert client.get("/media/segment/2").headers["x-accel-redirect"].endswith("?start=40&end=55")
    # HEAD as well (the player's check after a failed load): through nginx's limit too.
    assert client.head("/media/segment/1").headers["x-accel-redirect"].startswith("/protected-clip/1/")


def test_clip_not_published_or_unknown(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments()
    with connect() as con:
        con.execute("UPDATE video SET sha256sum = NULL, status = 'queued'")
    assert client.get("/media/segment/1").status_code == 404
    assert client.get("/media/segment/99").status_code == 404


def test_clip_needs_login(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    login(client, admin_secret)
    add_segments()
    client.post("/api/auth/logout")
    r = client.get("/media/segment/1")
    assert r.status_code == 401
    assert "x-accel-redirect" not in r.headers


READY = Path(__file__).parent / "video_test_noneed_encoding.mp4"  # 20 s, a keyframe every second


@pytest.mark.skipif(not (shutil.which("ffmpeg") and READY.is_file()), reason="ffmpeg or sample missing")
def test_clip_cut_by_the_app_without_nginx(client, admin_secret, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    login(client, admin_secret)
    add_segments()
    with connect() as con:
        con.execute("UPDATE segment SET begin_s = 5, end_s = 15 WHERE id = 1")
    folder = tmp_path / "media" / "video" / "ab" / SHA
    folder.mkdir(parents=True)
    (folder / "video.mp4").symlink_to(READY)

    r = client.get("/media/segment/1")
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"
    assert r.headers["accept-ranges"] == "bytes"  # without it, browsers cannot seek in a 200 answer
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(r.content)
    assert 9.5 < checks.probe_duration(clip) < 11.5  # from the keyframe at or before 5 s
    assert len(r.content) < READY.stat().st_size * 0.7  # only the clip, not the whole video
    # Range requests (seeking, Safari): 206 with the asked bytes.
    part = client.get("/media/segment/1", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and part.content == r.content[:100]
    assert part.headers["content-range"] == f"bytes 0-99/{len(r.content)}"
    # Cut once, then served from the cache folder.
    assert [p.name for p in (tmp_path / "media" / "clips").iterdir()] == [f"{SHA}-5-15.mp4"]
