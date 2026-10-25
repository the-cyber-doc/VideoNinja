"""Video management: the list of published videos, annotating one again, the whole video."""

import shutil
import sqlite3
from pathlib import Path

import pyotp
import pytest

from app import db, snapshot

from .test_auth import login
from .test_catalog import SHA, add_segments
from .test_users import USER_PASSWORD, create, register, user_login
from .test_catalog import KETO, KOKU

READY = Path(__file__).parent / "video_test_noneed_encoding.mp4"  # 20 s


def sql(query, *args):
    con = sqlite3.connect(db.db_path())
    with con:
        return con.execute(query, args).fetchall()


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    add_segments()  # video 1 (published): segments 1 (12-27) and 2 (40-55)
    sql("UPDATE video SET duration_s = 60.5")
    sql("INSERT INTO tag (id, name) VALUES ('place', 'tag.location.name')")
    return client


def add_video(id_, status="published", all_done=False, uploaded_at="2026-02-01T00:00:00+00:00"):
    sql("INSERT INTO video (id, sha256sum, original_sha256, original_filename, uploaded_at, status,"
        " all_segments_done, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?, 30)",
        id_, f"{id_:064x}" if status == "published" else None, f"{id_ + 100:064x}", f"v{id_}.mp4", uploaded_at,
        status, all_done)


def test_seeded_access_and_role(client, admin_secret):
    roles = {r: {a for (a,) in sql("SELECT access FROM role_has_access WHERE role = ?", r)}
             for (r,) in sql("SELECT id FROM role")}
    all_accesses = {a for (a,) in sql("SELECT id FROM access")}
    assert "video_mgmt" in all_accesses
    assert roles["video_mgmt"] == all_accesses - {"user_mgmt"}  # every access but user management
    assert roles["admin"] == all_accesses
    assert "video_mgmt" not in roles["user"] | roles["editor"] | roles["uploader"]
    names = sql("SELECT en, fr FROM translation WHERE id = 'role.video_mgmt.name'")
    assert names == [("Video manager", "Gestionnaire de vidéos")]


def test_needs_video_mgmt(admin):
    secret = register(create(admin))  # kenji, role "user"
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    for method, url in [("get", "/api/videos"), ("get", "/api/videos/1/annotations"),
                        ("put", "/api/videos/1/annotations"), ("get", "/media/video/1"),
                        ("get", "/media/video/1/thumbnail")]:
        r = getattr(kenji, method)(url, **({"json": {"all_segments_done": True}} if method == "put" else {}))
        assert r.status_code == 403, url
    # The video_mgmt role: performers and tags too (they were for uploaders only).
    sql("UPDATE user SET role = 'video_mgmt' WHERE username = 'kenji'")
    for url in ("/api/videos", "/api/performers", "/api/tags"):
        assert kenji.get(url).status_code == 200, url


def test_list_published_videos(admin):
    add_video(2, all_done=True, uploaded_at="2026-03-01T00:00:00+00:00")
    add_video(3, status="queued")  # not playable yet: not listed
    assert admin.get("/api/videos").json() == [
        {"id": 2, "original_filename": "v2.mp4", "uploaded_at": "2026-03-01T00:00:00+00:00", "duration_s": 30.0,
         "all_segments_done": True, "segment_count": 0},
        {"id": 1, "original_filename": "a.mp4", "uploaded_at": "2026-01-01T00:00:00Z", "duration_s": 60.5,
         "all_segments_done": False, "segment_count": 2},
    ]
    assert admin.get("/api/videos/3/annotations").status_code == 404


def test_get_annotations(admin):
    sql("INSERT INTO video_has_tags (video, tag, value) VALUES (1, 'place', 'dojo')")
    sql("INSERT INTO segment_has_tags (segment, tag, value) VALUES (2, 'place', 'outdoor')")
    sql("UPDATE video SET uploaded_by = 1")
    sql("UPDATE segment SET created_by = 1 WHERE id = 1")  # segment 2: author unknown
    assert admin.get("/api/videos/1/annotations").json() == {
        "all_segments_done": False,
        "original_filename": "a.mp4",
        "uploaded_by": "Admin",
        "tags": [{"id": "place", "value": "dojo"}],
        "segments": [
            {"id": 1, "begin_s": 12, "end_s": 27, "technique": KOKU, "performer": "hatsumi", "tags": [],
             "created_by": "Admin"},
            {"id": 2, "begin_s": 40, "end_s": 55, "technique": KOKU, "performer": "hatsumi",
             "tags": [{"id": "place", "value": "outdoor"}], "created_by": None},
        ],
    }


def test_authors_by_display_name(admin, tmp_path, monkeypatch):
    """A new segment is its creator's; an edited one keeps its author, whatever the client sends."""
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    (tmp_path / "media" / "video" / "ab" / SHA).mkdir(parents=True)
    monkeypatch.setattr("app.encoder.thumbnail", lambda video, at, out: out.write_bytes(b"jpg"))
    sql("UPDATE segment SET created_by = 1")
    sql("UPDATE user SET name = NULL WHERE id = 1")  # no display name: the username
    secret = register(create(admin, role="video_mgmt"))  # kenji, display name "Kenji"
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    body = {"all_segments_done": False, "segments": [
        {"id": 1, "begin_s": 12, "end_s": 28, "technique": KOKU, "performer": "hatsumi",
         "created_by": "Kenji"},  # read only: ignored
        {"begin_s": 30, "end_s": 35, "technique": KOKU, "performer": "hatsumi", "created_by": "admin"},
    ]}
    r = kenji.put("/api/videos/1/annotations", json=body)
    assert r.status_code == 200, r.text
    assert [(s["id"], s["created_by"]) for s in r.json()["segments"]] == [(1, "admin"), (3, "Kenji")]


def test_save_keeps_ids_adds_and_removes(admin, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    folder = tmp_path / "media" / "video" / "ab" / SHA
    folder.mkdir(parents=True)
    (folder / "segment-2.jpg").write_bytes(b"old")
    made = []
    monkeypatch.setattr("app.encoder.thumbnail", lambda video, at, out: (made.append(at), out.write_bytes(b"jpg")))
    body = {"all_segments_done": True, "tags": [{"id": "place", "value": "outdoor"}], "segments": [
        {"id": 1, "begin_s": 12, "end_s": 27, "technique": KETO, "performer": "masaaki-hatsumi",
         "tags": [{"id": "place", "value": "dojo"}]},  # same times: same thumbnail
        {"begin_s": 30, "end_s": 40, "technique": KOKU, "performer": "hatsumi"},  # new
    ]}  # segment 2: removed
    r = admin.put("/api/videos/1/annotations", json=body)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert [(s["id"], s["technique"], s["begin_s"]) for s in saved["segments"]] == [
        (1, KETO, 12), (3, KOKU, 30)]
    assert saved["segments"][0]["tags"] == [{"id": "place", "value": "dojo"}]
    assert saved["all_segments_done"] is True and saved["tags"] == [{"id": "place", "value": "outdoor"}]
    assert sql("SELECT count(*) FROM segment_has_tags WHERE segment = 2") == [(0,)]
    assert made == [35]  # only the new segment's thumbnail, in its middle
    assert (folder / "segment-3.jpg").read_bytes() == b"jpg"
    assert not (folder / "segment-2.jpg").exists()  # removed with its segment
    assert sql("SELECT thumbnail FROM segment WHERE id = 3") == [("segment-3.jpg",)]

    # Re-timed: a new thumbnail, same ID.
    body["segments"] = [{**saved["segments"][1], "begin_s": 2, "end_s": 6}]
    r = admin.put("/api/videos/1/annotations", json=body)
    assert [s["id"] for s in r.json()["segments"]] == [3] and made[-1] == 4

    snapshot.flush()  # the catalogue follows
    assert [(s["id"], s["begin_s"]) for s in admin.get("/api/catalog").json()["segments"]] == [(3, 2)]


@pytest.mark.parametrize("segment, error", [
    ({"id": 99, "begin_s": 1, "end_s": 2, "technique": KOKU, "performer": "hatsumi"}, "Unknown segment"),
    ({"begin_s": 1, "end_s": 2, "technique": "nope", "performer": "hatsumi"}, "Unknown technique"),
    ({"begin_s": 1, "end_s": 2, "technique": KOKU, "performer": "nope"}, "Unknown performer"),
    ({"begin_s": 50, "end_s": 70, "technique": KOKU, "performer": "hatsumi"}, "after the end"),
    ({"begin_s": 5, "end_s": 5, "technique": KOKU, "performer": "hatsumi"}, "end after it begins"),
    ({"begin_s": 1, "end_s": 2, "technique": KOKU, "performer": "hatsumi",
      "tags": [{"id": "nope"}]}, "Unknown tag"),
])
def test_save_validation(admin, segment, error):
    r = admin.put("/api/videos/1/annotations", json={"all_segments_done": False, "segments": [segment]})
    assert r.status_code == 422 and error in r.text, r.text
    assert len(sql("SELECT id FROM segment WHERE video = 1")) == 2  # nothing changed


def test_same_segment_twice(admin):
    seg = {"id": 1, "begin_s": 1, "end_s": 2, "technique": KOKU, "performer": "hatsumi"}
    r = admin.put("/api/videos/1/annotations", json={"all_segments_done": False, "segments": [seg, seg]})
    assert r.status_code == 422


def test_another_videos_segment_refused(admin):
    add_video(2)
    sql("INSERT INTO segment (video, technique, begin_s, end_s, performer) VALUES (2, ?, 1, 2, 'hatsumi')", KOKU)
    seg = {"id": 3, "begin_s": 1, "end_s": 2, "technique": KOKU, "performer": "hatsumi"}
    r = admin.put("/api/videos/1/annotations", json={"all_segments_done": False, "segments": [seg]})
    assert r.status_code == 422


def test_whole_video_by_nginx(admin, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    r = admin.get("/media/video/1")
    # No start/end: the whole file. /protected-video/<user id>/…: three transfers per user.
    assert r.headers["x-accel-redirect"] == f"/protected-video/1/ab/{SHA}/video.mp4"
    assert admin.get("/media/video/1/thumbnail").headers["x-accel-redirect"] == f"/protected/ab/{SHA}/thumb.jpg"
    assert admin.get("/media/video/99").status_code == 404


@pytest.mark.skipif(not (shutil.which("ffmpeg") and READY.is_file()), reason="ffmpeg or sample missing")
def test_real_thumbnails_and_video(admin, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    folder = tmp_path / "media" / "video" / "ab" / SHA
    folder.mkdir(parents=True)
    (folder / "video.mp4").symlink_to(READY)
    sql("UPDATE video SET duration_s = 20.05")
    sql("DELETE FROM segment")
    body = {"all_segments_done": False, "segments": [
        {"begin_s": 4, "end_s": 10, "technique": KOKU, "performer": "hatsumi"}]}
    assert admin.put("/api/videos/1/annotations", json=body).status_code == 200
    thumb = next(folder.glob("segment-*.jpg"))
    assert thumb.read_bytes()[:2] == b"\xff\xd8"  # a JPEG
    r = admin.get("/media/video/1", headers={"Range": "bytes=0-99"})  # development: the app sends it
    assert r.status_code == 206 and r.headers["content-range"].endswith(f"/{READY.stat().st_size}")
