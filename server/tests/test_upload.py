"""Upload flow: tusd hooks → submit → encoding queue → publish (encoding faked here,
real ffmpeg runs in test_encoder.py)."""

import sqlite3
from datetime import timedelta

import pyotp
import pytest

from app import clock, db, encoder, i18n, snapshot
from app.security import SESSION_COOKIE

from .test_auth import login
from .test_users import USER_PASSWORD, create, register, user_login

ORIGINAL = "1" * 64
ENCODED = "e" * 64


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO performer (id, name) VALUES ('hatsumi', 'Hatsumi')")
        con.execute("INSERT INTO tag (id, fixed_values, list_of_values) VALUES ('place', 1, 'dojo, outdoor')")
        con.execute("INSERT INTO tag (id, fixed_values) VALUES ('note', 0)")
    return client


@pytest.fixture
def enc(client, tmp_path, monkeypatch):
    """An encoder whose encoding step is faked: it records the jobs and returns a result."""
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    e = encoder.Encoder()
    e.uploads.mkdir(parents=True)
    e.work.mkdir(parents=True)
    e.jobs = []

    def fake(job, work):
        e.jobs.append(job)
        if e.on_job:
            e.on_job(job)
        return {"sha256": ENCODED, "duration_s": 30.0, "thumbnail": "thumb.jpg",
                "segment_thumbnails": {s["id"]: f"segment-{s['id']}.jpg" for s in job["segments"]}}

    e.on_job = None
    e.process_job = fake
    return e


def video_row(video_id):
    return sqlite3.connect(db.db_path()).execute(
        "SELECT status, attempts, error, sha256sum, directory, thumbnail, upload FROM video WHERE id = ?",
        (video_id,)).fetchone()


def hook(client, type_, cookie=None, size=1000, sha=ORIGINAL, filename="kata.mov", tus_id="", offset=0,
         deferred=False):
    headers = {"Cookie": [f"{SESSION_COOKIE}={cookie}"]} if cookie else {}
    return client.post("/internal/tusd-hook", json={"Type": type_, "Event": {
        "Upload": {"ID": tus_id, "Size": size, "SizeIsDeferred": deferred, "Offset": offset,
                   "MetaData": {"original_sha256": sha, "filename": filename}},
        "HTTPRequest": {"Method": "POST", "URI": "/files/", "Header": headers}}}).json()


def session(client):
    return client.cookies.get(SESSION_COOKIE)


def uploaded(client, sha=ORIGINAL, size=1000) -> str:
    """A finished tus upload of the logged-in user; returns its tus ID."""
    answer = hook(client, "pre-create", session(client), size=size, sha=sha)
    tus_id = answer["ChangeFileInfo"]["ID"]
    hook(client, "post-finish", tus_id=tus_id, size=size, offset=size)
    return tus_id


SEGMENT = {"begin_s": 12, "end_s": 27, "technique": "gyokko.koku", "performer": "hatsumi",
           "tags": [{"id": "place", "value": "dojo"}]}


def submit(client, tus_id, segments=(SEGMENT,), **extra):
    body = {"original_filename": "kata.mov", "all_segments_done": True, "segments": list(segments),
            "tags": [{"id": "note", "value": "first try"}], **extra}
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


def test_tags(admin):
    assert admin.get("/api/tags").json() == [{"id": "note"}, {"id": "place", "values": ["dojo", "outdoor"]}]


def test_upload_apis_need_upload_access(client, admin):
    secret = register(create(admin))  # role "user": no upload access
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    for method, url in [("get", "/api/performers"), ("get", "/api/tags"), ("get", "/api/uploads/mine"),
                        ("get", "/api/uploads/available"),
                        ("get", f"/api/videos/exists?original_sha256={ORIGINAL}")]:
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
    monkeypatch.setenv("VIDEONINJA_MAX_UPLOAD_GB", "0.000001")
    assert status(cookie=token, size=2000) == 413


def test_pre_create_accepts_and_names_the_upload(admin):
    con = sqlite3.connect(db.db_path())
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


def test_without_segments(admin):
    r = submit(admin, uploaded(admin), segments=[], all_segments_done=False)  # "define segments later"
    assert r.status_code == 201
    row = sqlite3.connect(db.db_path()).execute("SELECT all_segments_done, status FROM video").fetchone()
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
    assert sqlite3.connect(db.db_path()).execute("SELECT thumbnail FROM segment WHERE id = 1").fetchone() \
        == ("segment-1.jpg",)
    snapshot.flush()
    assert [s["id"] for s in admin.get("/api/catalog").json()["segments"]] == [1]

    # The original is deleted by the next housekeeping.
    tus_id = job["tus_id"]
    for name in (tus_id, f"{tus_id}.info"):
        (enc.uploads / name).write_text("x")
    enc.housekeeping()
    assert not list(enc.uploads.iterdir())
    assert sqlite3.connect(db.db_path()).execute("SELECT count(*) FROM upload WHERE tus_id = ?",
                                                 (tus_id,)).fetchone() == (0,)

    enc.on_job = None
    assert enc.run_once() is True and enc.jobs[1]["video"] == second
    assert enc.run_once() is False  # queue empty


def test_failures_retry_then_fail(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]

    def boom(job):
        raise encoder.JobError(f"boom {len(enc.jobs)}", retryable=True)

    enc.on_job = boom
    for _ in range(encoder.MAX_ATTEMPTS):
        enc.run_once()
    status = admin.get("/api/uploads/mine").json()[0]
    assert (status["status"], status["error"]) == ("failed", "boom 3")
    assert enc.run_once() is False

    assert admin.post(f"/api/videos/{video}/retry").status_code == 204
    assert admin.get("/api/uploads/mine").json()[0]["status"] == "queued"
    assert admin.post(f"/api/videos/{video}/retry").status_code == 409  # not failed


def test_final_failure(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    enc.on_job = lambda job: (_ for _ in ()).throw(encoder.JobError("Not a video"))
    enc.run_once()
    assert video_row(video)[:3] == ("failed", 1, "Not a video")


def test_shutdown_puts_the_job_back(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    enc.on_job = lambda job: (_ for _ in ()).throw(encoder.Stopped())
    enc.run_once()
    assert video_row(video)[:2] == ("queued", 0)  # attempt not counted


def test_interrupted_jobs_requeued_at_startup(admin, enc):
    a = submit(admin, uploaded(admin, sha="1" * 64)).json()["id"]
    b = submit(admin, uploaded(admin, sha="2" * 64)).json()["id"]
    con = sqlite3.connect(db.db_path())
    with con:  # as left by a crash during encoding
        con.execute("UPDATE video SET status = 'encoding', attempts = 1 WHERE id = ?", (a,))
        con.execute("UPDATE video SET status = 'encoding', attempts = ? WHERE id = ?", (encoder.MAX_ATTEMPTS, b))
    with encoder.transaction() as c:
        encoder.queries.requeue_interrupted(c, encoder.MAX_ATTEMPTS)
    assert video_row(a)[0] == "queued"
    assert video_row(b)[:3] == ("failed", encoder.MAX_ATTEMPTS, "Encoding interrupted too many times")


def test_deleted_before_publishing(admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    folder = enc.derived / ENCODED[:2] / ENCODED

    def gone(job):
        folder.mkdir(parents=True)
        (folder / "video.mp4").write_text("x")
        con = sqlite3.connect(db.db_path())
        with con:
            con.execute("DELETE FROM segment WHERE video = ?", (video,))
            con.execute("DELETE FROM video WHERE id = ?", (video,))

    enc.on_job = gone
    enc.run_once()
    assert not folder.exists()  # its files did not stay


def test_delete(client, admin, enc):
    video = submit(admin, uploaded(admin)).json()["id"]
    tus_id = sqlite3.connect(db.db_path()).execute("SELECT upload FROM video").fetchone()[0]
    secret = register(create(admin, username="hana", role="uploader"))
    hana = user_login("hana", USER_PASSWORD, pyotp.TOTP(secret).now())
    assert hana.delete(f"/api/videos/{video}").status_code == 404  # not hers

    (enc.uploads / tus_id).write_text("original")
    assert admin.delete(f"/api/videos/{video}").status_code == 204
    con = sqlite3.connect(db.db_path())
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

    later = clock.now() + timedelta(seconds=encoder.UPLOAD_EXPIRY_S + 1)
    monkeypatch.setattr(clock, "now", lambda: later)
    enc.housekeeping()
    assert [p.name for p in enc.uploads.iterdir()] == [queued]
    # Their owner can no longer continue them.
    assert submit(admin, not_submitted).status_code == 404
