import sqlite3

import pyotp

from app import db

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
    folder = tmp_path / "media" / "derived" / "ab" / SHA
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
    con = sqlite3.connect(db.db_path())
    with con:  # a role without the "segment" access
        con.execute("INSERT INTO translation (id, en) VALUES ('role.guest.name', 'Guest')")
        con.execute("INSERT INTO role (id, name) VALUES ('guest', 'role.guest.name')")
        con.execute("UPDATE user SET role = 'guest' WHERE username = 'kenji'")
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    r = kenji.get("/media/segment/1/thumbnail")
    assert r.status_code == 403
    assert "x-accel-redirect" not in r.headers
