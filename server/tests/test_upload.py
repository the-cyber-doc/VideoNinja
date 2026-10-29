"""Upload flow: tusd hooks → submit → encoding queue → publish (encoding faked here,
real ffmpeg runs in test_encoder.py)."""

import threading
import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient

from app.api import videos
from app.core import clock, db, i18n
from app.domain import security, snapshot
from app.encoder import checks, heartbeat, queue

from .conftest import connect
from .test_auth import login
from .test_catalog import KOKU
from .test_users import USER_PASSWORD, create, register, user_login

ORIGINAL = "1" * 64
ENCODED = "e" * 64


def add_tags(con):
    """ "place": fixed values (one without French name: falls back to English); "note": free text."""
    con.executemany(
        "INSERT INTO translation (id, en, fr) VALUES (?, ?, ?)",
        [
            ("tag.place.name", "Place", "Lieu"),
            ("tag.note.name", "Note", "Remarque"),
            ("tag_value.place.dojo.name", "Dojo", "Dojo"),
            ("tag_value.place.outdoor.name", "Outdoor", "Extérieur"),
            ("tag_value.place.online.name", "Online", None),
        ],
    )
    con.executemany(
        "INSERT INTO tag (id, name) VALUES (?, ?)", [("place", "tag.place.name"), ("note", "tag.note.name")]
    )
    con.executemany(
        "INSERT INTO tag_value (tag, id, name) VALUES ('place', ?, ?)",
        [
            ("dojo", "tag_value.place.dojo.name"),
            ("outdoor", "tag_value.place.outdoor.name"),
            ("online", "tag_value.place.online.name"),
        ],
    )


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    con = connect()
    with con:
        con.execute("INSERT INTO performer (id, name) VALUES ('hatsumi', 'Hatsumi')")
        add_tags(con)
    return client


@pytest.fixture
def enc(client, tmp_path, monkeypatch):
    """An encoder whose encoding step is faked: it records the jobs and returns a result."""
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    e = queue.Encoder()
    e.uploads.mkdir(parents=True)
    e.work.mkdir(parents=True)
    e.jobs = []

    def fake(job, work):
        e.jobs.append(job)
        if e.on_job:
            e.on_job(job)
        return {
            "sha256": ENCODED,
            "duration_s": 30.0,
            "thumbnail": "thumb.jpg",
            "segment_thumbnails": {s["id"]: f"segment-{s['id']}.jpg" for s in job["segments"]},
        }

    e.on_job = None
    e.process_job = fake
    return e


def video_row(video_id):
    return (
        connect()
        .execute(
            "SELECT status, attempts, error, sha256sum, directory, thumbnail, upload FROM video WHERE id = ?",
            (video_id,),
        )
        .fetchone()
    )


def hook(client, type_, cookie=None, size=1000, sha=ORIGINAL, filename="kata.mov", tus_id="", offset=0, deferred=False):
    headers = {"Cookie": [f"{security.session_cookie()[0]}={cookie}"]} if cookie else {}
    return client.post(
        "/internal/tusd-hook",
        json={
            "Type": type_,
            "Event": {
                "Upload": {
                    "ID": tus_id,
                    "Size": size,
                    "SizeIsDeferred": deferred,
                    "Offset": offset,
                    "MetaData": {"original_sha256": sha, "filename": filename},
                },
                "HTTPRequest": {"Method": "POST", "URI": "/files/", "Header": headers},
            },
        },
    ).json()


def session(client):
    return client.cookies.get(security.session_cookie()[0])


def uploaded(client, sha=ORIGINAL, size=1000) -> str:
    """A finished tus upload of the logged-in user; returns its tus ID."""
    answer = hook(client, "pre-create", session(client), size=size, sha=sha)
    tus_id = answer["ChangeFileInfo"]["ID"]
    hook(client, "post-finish", tus_id=tus_id, size=size, offset=size)
    return tus_id


SEGMENT = {
    "begin_s": 12,
    "end_s": 27,
    "technique": KOKU,
    "performer": "hatsumi",
    "tags": [{"id": "place", "value": "dojo"}],
}


def submit(client, tus_id, segments=(SEGMENT,), **extra):
    body = {
        "original_filename": "kata.mov",
        "all_segments_done": True,
        "segments": list(segments),
        "tags": [{"id": "note", "value": "first try"}],
        **extra,
    }
    return client.post(f"/api/uploads/{tus_id}/submit", json=body)


# --- performers, tags, duplicate check ---


def test_performers(admin):
    seeded = {p["id"] for p in admin.get("/api/performers").json()}  # seed data + fixture
    r = admin.post("/api/performers", json={"name": "  Noguchi   Yukio "})
    assert r.status_code == 201
    assert r.json() == {"id": "noguchi-yukio", "name": "Noguchi Yukio"}
    assert admin.post("/api/performers", json={"name": "noguchi yukio"}).status_code == 409
    assert admin.post("/api/performers", json={"name": "Noguchi-Yukio"}).json()["id"] == "noguchi-yukio-2"
    assert admin.post("/api/performers", json={"name": "Él"}).json()["id"] == "el"
    performers = admin.get("/api/performers").json()
    assert [p["name"] for p in performers if p["id"] not in seeded] == ["Él", "Noguchi Yukio", "Noguchi-Yukio"]
    # The whole list sorted by name, ignoring case and accents ("Él" with the E's).
    names = [p["name"] for p in performers]
    assert names == sorted(names, key=i18n.sort_key)


def test_tags_translated(admin):
    """Sorted by name in the request's language, and their values too."""

    def ours(lang):
        tags = admin.get("/api/tags", headers={"Accept-Language": lang}).json()
        return [t for t in tags if t["id"] in ("place", "note")]  # not the seeded ones

    assert ours("en") == [
        {"id": "note", "name": "Note"},
        {
            "id": "place",
            "name": "Place",
            "values": [
                {"id": "dojo", "name": "Dojo"},
                {"id": "online", "name": "Online"},
                {"id": "outdoor", "name": "Outdoor"},
            ],
        },
    ]
    assert ours("fr") == [
        {
            "id": "place",
            "name": "Lieu",
            "values": [
                {"id": "dojo", "name": "Dojo"},
                {"id": "outdoor", "name": "Extérieur"},
                {"id": "online", "name": "Online"},
            ],
        },  # no French name: the English one
        {"id": "note", "name": "Remarque"},
    ]


def test_seeded_tags(admin, monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 23, tzinfo=UTC))
    seeded = ("location", "event", "year", "country", "source")
    for lang, names in [
        ("en", ["Country", "Event", "Location", "Source", "Year"]),
        ("fr", ["Année", "Événement", "Lieu", "Pays", "Source"]),
    ]:
        tags = {
            t["id"]: t for t in admin.get("/api/tags", headers={"Accept-Language": lang}).json() if t["id"] in seeded
        }
        assert [t["name"] for t in sorted(tags.values(), key=lambda t: i18n.sort_key(t["name"]))] == names
        countries = tags["country"]["values"]
        assert len(countries) == 249  # ISO 3166-1 alpha-3
        assert all(len(c["id"]) == 3 and c["id"].isupper() for c in countries)
        assert [c["name"] for c in countries] == sorted((c["name"] for c in countries), key=i18n.sort_key)
        assert tags["year"] == {
            "id": "year",
            "name": {"en": "Year", "fr": "Année"}[lang],
            "format": "year",
            "min": 1926,
            "max": 2026,
        }
    fr = {t["id"]: t for t in admin.get("/api/tags", headers={"Accept-Language": "fr"}).json()}
    assert fr["location"]["values"] == [{"id": "dojo", "name": "Dojo"}, {"id": "outdoor", "name": "Extérieur"}]
    assert fr["event"]["values"] == [
        {"id": "class", "name": "Cours"},
        {"id": "demo", "name": "Démonstration"},
        {"id": "seminar", "name": "Stage"},
    ]
    assert fr["source"]["values"] == [
        {"id": "kanninkan", "name": "Kanninkan"},
        {"id": "onmitsukage", "name": "Onmitsukage"},
        {"id": "youtube", "name": "YouTube"},
    ]
    country = {c["id"]: c["name"] for c in fr["country"]["values"]}
    assert (country["CHE"], country["JPN"], country["RUS"]) == ("Suisse", "Japon", "Russie")
    # Every country has its own French name (the same as English only where it really is).
    en = {c["id"]: c["name"] for t in admin.get("/api/tags").json() if t["id"] == "country" for c in t["values"]}
    assert sum(country[c] != en[c] for c in en) > 150


@pytest.mark.parametrize(
    "value, ok",
    [
        ("1926", True),
        ("2026", True),
        ("1999", True),
        ("1925", False),
        ("2027", False),
        ("99", False),
        ("20x6", False),
        ("２０２０", False),  # noqa: RUF001 - fullwidth digits on purpose
        (None, False),
    ],
)
def test_year_tag(admin, monkeypatch, value, ok):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 23, tzinfo=UTC))
    tag = {"id": "year"} if value is None else {"id": "year", "value": value}
    r = submit(admin, uploaded(admin), tags=[tag])
    assert r.status_code == (201 if ok else 422), r.text
    if not ok:
        assert "a year from 1926 to 2026" in r.text


def test_year_in_the_user_timezone(admin, monkeypatch):
    # New Year's Eve 23:30 UTC: already 2026 in Tokyo. (A past date: the session stays valid.)
    monkeypatch.setattr(clock, "now", lambda: datetime(2025, 12, 31, 23, 30, tzinfo=UTC))
    body = {"original_filename": "kata.mov", "all_segments_done": False, "tags": [{"id": "year", "value": "2026"}]}
    for zone, sha, status in [("Europe/London", "a" * 64, 422), ("Asia/Tokyo", "b" * 64, 201)]:
        r = admin.post(f"/api/uploads/{uploaded(admin, sha=sha)}/submit", json=body, headers={"Time-Zone": zone})
        assert r.status_code == status, zone


def test_tag_values_stored_by_id_free_text_as_typed(admin):
    tus_id = uploaded(admin)
    by_name = {**SEGMENT, "tags": [{"id": "place", "value": "Extérieur"}]}  # a name, not the ID
    assert submit(admin, tus_id, [by_name]).status_code == 422
    segment = {**SEGMENT, "tags": [{"id": "place", "value": "outdoor"}]}
    assert submit(admin, tus_id, [segment], tags=[{"id": "note", "value": "Très bien, 二回目"}]).status_code == 201
    con = connect()
    assert con.execute("SELECT tag, value FROM segment_has_tags").fetchall() == [("place", "outdoor")]
    assert con.execute("SELECT tag, value FROM video_has_tags").fetchall() == [("note", "Très bien, 二回目")]


def test_upload_apis_need_upload_access(client, admin):
    secret = register(create(admin))  # role "user": no upload access
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    for method, url in [
        ("get", "/api/performers"),
        ("get", "/api/tags"),
        ("get", "/api/uploads/mine"),
        ("get", "/api/uploads/available"),
        ("get", f"/api/videos/exists?original_sha256={ORIGINAL}"),
    ]:
        assert getattr(kenji, method)(url).status_code == 403, url
    assert hook(kenji, "pre-create", session(kenji))["HTTPResponse"]["StatusCode"] == 403


def test_exists(admin):
    url = f"/api/videos/exists?original_sha256={ORIGINAL}"
    assert admin.get(url).json() == {"exists": False}
    submit(admin, uploaded(admin))
    assert admin.get(url).json() == {"exists": True}
    assert admin.get("/api/videos/exists?original_sha256=xyz").status_code == 422


# --- tusd hooks ---


def test_pre_create_refusals(admin, monkeypatch):
    token = session(admin)
    status = lambda **kw: hook(admin, "pre-create", **kw).get("HTTPResponse", {}).get("StatusCode")  # noqa: E731
    assert status() == 401  # no cookie
    assert status(cookie="forged") == 401
    assert status(cookie=token, deferred=True) == 400
    assert status(cookie=token, sha="not-a-hash") == 400
    assert status(cookie=token, filename="../x") == 400
    # Only the accepted video formats, by extension (the content is checked by ffprobe).
    for name in ("photo.jpg", "notes.txt", "clip.mp4.exe", "noextension"):
        assert status(cookie=token, filename=name) == 415, name
    monkeypatch.setenv("VIDEONINJA_INPUT_FORMATS", "matroska")
    assert status(cookie=token, filename="a.mp4") == 415
    assert status(cookie=token, filename="a.MKV") is None  # accepted
    monkeypatch.setenv("VIDEONINJA_MAX_UPLOAD_BYTES", "1999")
    assert status(cookie=token, size=2000) == 413


def test_pre_create_accepts_and_names_the_upload(admin, monkeypatch):
    monkeypatch.setattr(videos, "FINISH_WAIT_S", 0.2)  # the incomplete upload below: no long wait
    con = connect()
    with con:  # saved from an earlier browser request
        con.execute("UPDATE user SET time_zone = 'Asia/Kolkata'")
    answer = hook(admin, "pre-create", session(admin))
    tus_id = answer["ChangeFileInfo"]["ID"]
    assert len(tus_id) == 32 and "RejectUpload" not in answer
    row = con.execute("SELECT state, size, created_at FROM upload WHERE tus_id = ?", (tus_id,)).fetchone()
    assert row[:2] == ("uploading", 1000)
    assert row[2].endswith("+05:30")  # no browser request: the user's saved timezone

    hook(admin, "post-finish", tus_id=tus_id, offset=999)  # incomplete: not finished
    assert submit(admin, tus_id).status_code == 409
    hook(admin, "post-finish", tus_id=tus_id, offset=1000)
    assert submit(admin, tus_id).status_code == 201


def test_submit_waits_for_the_post_finish_hook(admin, monkeypatch):
    """tusd answers the last chunk before its post-finish hook has run: the page's
    submit, sent at once, waits for it (FINISH_WAIT_S at most)."""
    tus_id = hook(admin, "pre-create", session(admin))["ChangeFileInfo"]["ID"]
    finisher = TestClient(admin.app, base_url="https://testserver")  # tusd's own call
    timer = threading.Timer(0.5, lambda: hook(finisher, "post-finish", tus_id=tus_id, offset=1000))
    timer.start()
    try:
        assert submit(admin, tus_id).status_code == 201
    finally:
        timer.join()
    monkeypatch.setattr(videos, "FINISH_WAIT_S", 0.3)
    never = hook(admin, "pre-create", session(admin), sha="b" * 64)["ChangeFileInfo"]["ID"]
    started = time.monotonic()
    assert submit(admin, never).status_code == 409  # the hook never came
    assert time.monotonic() - started < 2


# --- submit ---


def test_submit_checks(admin):
    tus_id = uploaded(admin)
    bad = [
        {**SEGMENT, "technique": "nope"},
        {**SEGMENT, "performer": "nope"},
        {**SEGMENT, "end_s": 12},
        {**SEGMENT, "tags": [{"id": "place", "value": "moon"}]},
        {**SEGMENT, "tags": [{"id": "nope"}]},
        {**SEGMENT, "tags": [{"id": "note", "value": "a"}, {"id": "note", "value": "b"}]},
    ]
    for segment in bad:
        assert submit(admin, tus_id, [segment]).status_code == 422, segment
    assert submit(admin, "unknown").status_code == 404
    r = submit(admin, tus_id)
    assert r.status_code == 201
    assert submit(admin, tus_id).status_code == 409  # already submitted


def test_submit_only_own_upload(client, admin):
    tus_id = uploaded(admin)
    secret = register(create(admin, username="hana", role="uploader"))
    hana = user_login("hana", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert submit(hana, tus_id).status_code == 404


def test_upload_date_in_the_browser_timezone(admin):
    tus_id = uploaded(admin)
    body = {"original_filename": "kata.mov", "all_segments_done": False}
    r = admin.post(f"/api/uploads/{tus_id}/submit", json=body, headers={"Time-Zone": "America/Sao_Paulo"})
    assert r.status_code == 201
    (mine,) = admin.get("/api/uploads/mine").json()
    assert mine["uploaded_at"].endswith("-03:00")


def test_segments_created_by_the_uploader(admin):
    assert submit(admin, uploaded(admin)).status_code == 201
    con = connect()
    assert con.execute(
        "SELECT s.created_by, u.username FROM segment s JOIN user u ON u.id = s.created_by"
    ).fetchall() == [(1, "admin")]


def test_without_segments(admin):
    r = submit(admin, uploaded(admin), segments=[], all_segments_done=False)  # "define segments later"
    assert r.status_code == 201
    row = connect().execute("SELECT all_segments_done, status FROM video").fetchone()
    assert row == (0, "queued")


# --- encoding queue, publish ---


def test_queue_encode_publish(admin, enc):
    first = submit(admin, uploaded(admin, sha="1" * 64)).json()["id"]
    second = submit(admin, uploaded(admin, sha="2" * 64), segments=[]).json()["id"]
    mine = {v["id"]: v for v in admin.get("/api/uploads/mine").json()}
    assert (mine[first]["status"], mine[first]["queue_position"]) == ("queued", 1)
    assert mine[second]["queue_position"] == 2

    def during(job):  # while the first one is being encoded
        enc.progress(job["video"], 40)
        now = {v["id"]: v for v in admin.get("/api/uploads/mine").json()}
        assert (now[first]["status"], now[first]["progress"]) == ("encoding", 40)
        assert now[second]["queue_position"] == 1
        snapshot.rebuild()
        assert admin.get("/api/catalog").json()["segments"] == []  # not published yet

    enc.on_job = during
    assert enc.run_once() is True
    job = enc.jobs[0]
    assert (job["video"], job["original_sha256"]) == (first, "1" * 64)
    assert job["segments"] == [{"id": 1, "begin_s": 12, "end_s": 27}]
    assert video_row(first)[:2] == ("published", 1)
    assert video_row(first)[3:] == (ENCODED, f"ee/{ENCODED}", "thumb.jpg", None)
    assert connect().execute("SELECT thumbnail FROM segment WHERE id = 1").fetchone() == ("segment-1.jpg",)
    snapshot.flush()
    assert [s["id"] for s in admin.get("/api/catalog").json()["segments"]] == [1]

    # The original is deleted by the next housekeeping.
    tus_id = job["tus_id"]
    for name in (tus_id, f"{tus_id}.info"):
        (enc.uploads / name).write_text("x")
    enc.housekeeping()
    assert not list(enc.uploads.iterdir())
    assert connect().execute("SELECT count(*) FROM upload WHERE tus_id = ?", (tus_id,)).fetchone() == (0,)

    enc.on_job = None
    assert enc.run_once() is True and enc.jobs[1]["video"] == second
    assert enc.run_once() is False  # queue empty


def test_failures_retry_then_fail(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]

    def boom(job):
        raise checks.JobError(f"boom {len(enc.jobs)}", retryable=True)

    enc.on_job = boom
    for _ in range(queue.MAX_ATTEMPTS):
        enc.run_once()
    status = admin.get("/api/uploads/mine").json()[0]
    assert (status["status"], status["error"]) == ("failed", "boom 3")
    assert enc.run_once() is False

    assert admin.post(f"/api/videos/{video}/retry").status_code == 204
    assert admin.get("/api/uploads/mine").json()[0]["status"] == "queued"
    assert admin.post(f"/api/videos/{video}/retry").status_code == 409  # not failed


def test_final_failure(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    enc.on_job = lambda job: (_ for _ in ()).throw(checks.JobError("Not a video"))
    enc.run_once()
    assert video_row(video)[:3] == ("failed", 1, "Not a video")


def test_shutdown_puts_the_job_back(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    enc.on_job = lambda job: (_ for _ in ()).throw(queue.Stopped())
    enc.run_once()
    assert video_row(video)[:2] == ("queued", 0)  # attempt not counted


def test_interrupted_jobs_requeued_at_startup(admin, enc, monkeypatch):
    monkeypatch.setattr(queue.shutil, "which", lambda name: f"/usr/bin/{name}")  # ffmpeg "installed"
    a = submit(admin, uploaded(admin, sha="1" * 64)).json()["id"]
    b = submit(admin, uploaded(admin, sha="2" * 64)).json()["id"]
    con = connect()
    with con:  # as left by a crash during encoding
        con.execute("UPDATE video SET status = 'encoding', attempts = 1 WHERE id = ?", (a,))
        con.execute("UPDATE video SET status = 'encoding', attempts = ? WHERE id = ?", (queue.MAX_ATTEMPTS, b))
    enc.stopping.set()  # no job taken: only the start's own work
    enc.start()  # the worker's real start: requeue, heartbeat, its threads
    try:
        assert video_row(a)[0] == "queued"
        assert video_row(b)[:3] == ("failed", queue.MAX_ATTEMPTS, "Encoding interrupted too many times")
        con = db.connect()
        try:
            assert heartbeat.healthy(con)  # beaten at once, not after HEARTBEAT_S
        finally:
            con.close()
        assert [t.name for t in (enc.thread, *enc.helpers)] == ["encoder", "thumbnails", "heartbeat"]
    finally:
        enc.stop()
    assert not any(t.is_alive() for t in (enc.thread, *enc.helpers))


def test_deleted_before_publishing(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    folder = enc.videos / ENCODED[:2] / ENCODED

    def gone(job):
        folder.mkdir(parents=True)
        (folder / "video.mp4").write_text("x")
        con = connect()
        with con:
            con.execute("DELETE FROM segment WHERE video = ?", (video,))
            con.execute("DELETE FROM video WHERE id = ?", (video,))

    enc.on_job = gone
    enc.run_once()
    assert not folder.exists()  # its files did not stay


def test_delete(client, admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    tus_id = connect().execute("SELECT upload FROM video").fetchone()[0]
    secret = register(create(admin, username="hana", role="uploader"))
    hana = user_login("hana", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert hana.delete(f"/api/videos/{video}").status_code == 404  # not hers

    (enc.uploads / tus_id).write_text("original")
    assert admin.delete(f"/api/videos/{video}").status_code == 204
    con = connect()
    assert con.execute("SELECT count(*) FROM video").fetchone() == (0,)
    assert con.execute("SELECT count(*) FROM segment").fetchone() == (0,)
    enc.housekeeping()
    assert not (enc.uploads / tus_id).exists()

    # Encoding or published: not deletable here.
    video = submit(admin, uploaded(admin, sha="3" * 64)).json()["id"]
    enc.on_job = lambda job: setattr(enc, "answer", admin.delete(f"/api/videos/{video}").status_code)
    enc.run_once()
    assert enc.answer == 409
    assert admin.delete(f"/api/videos/{video}").status_code == 409


# --- nginx auth_request before every tusd request ---


def auth(client, uri, method="PATCH"):
    return client.get("/internal/upload-auth", headers={"X-Original-URI": uri, "X-Original-Method": method})


def test_upload_auth(client, admin):
    tus_id = uploaded(admin)
    assert auth(admin, "/files/", "POST").status_code == 204  # create
    assert auth(admin, "/files/", "GET").status_code == 404
    assert auth(admin, f"/files/{tus_id}").status_code == 204  # own upload: chunk, resume, cancel
    assert auth(admin, f"/files/{tus_id}?x=1", "HEAD").status_code == 204
    assert auth(admin, "/files/unknown").status_code == 404
    assert auth(admin, "/elsewhere").status_code == 404

    secret = register(create(admin, username="hana", role="uploader"))
    hana = user_login("hana", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert auth(hana, "/files/", "POST").status_code == 204
    assert auth(hana, f"/files/{tus_id}").status_code == 404  # not hers

    secret = register(create(admin, username="kenji", role="user"))
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert auth(kenji, "/files/", "POST").status_code == 403  # no upload access
    anon = client.__class__(client.app, base_url="https://testserver")
    assert auth(anon, "/files/", "POST").status_code == 401


def test_abandoned_uploads_expire(admin, enc, monkeypatch):
    abandoned = hook(admin, "pre-create", session(admin), sha="4" * 64)["ChangeFileInfo"]["ID"]
    not_submitted = uploaded(admin, sha="5" * 64)
    queued = uploaded(admin, sha="6" * 64)
    submit(admin, queued)
    for tus_id in (abandoned, not_submitted, queued):
        (enc.uploads / tus_id).write_text("x")
    enc.housekeeping()
    assert len(list(enc.uploads.iterdir())) == 3  # all recent

    later = clock.now() + timedelta(seconds=queue.UPLOAD_EXPIRY_S + 1)
    monkeypatch.setattr(clock, "now", lambda: later)
    enc.housekeeping()
    assert [p.name for p in enc.uploads.iterdir()] == [queued]
    # Their owner can no longer continue them.
    assert submit(admin, not_submitted).status_code == 404
