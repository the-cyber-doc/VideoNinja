"""Books: tusd hooks (kinds book and image), submit, list, delete, media, and the
encoder's book step (real ffmpeg for the thumbnail)."""

import hashlib
import json
import shutil
import subprocess
import threading

import pyotp
import pytest

from app.core import clock, limits, paths
from app.domain.references import Reference
from app.encoder import books, checks, queue
from app.encoder.checks import JobError

from .conftest import connect
from .test_upload import admin, hook, session  # noqa: F401 (fixture)
from .test_users import USER_PASSWORD, create, register, user_login

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
PDF_SHA = hashlib.sha256(PDF).hexdigest()
IMAGE_SHA = "2" * 64
REFERENCE = {
    "type": "book",
    "title": "Ninjutsu: History and Tradition",
    "author": [{"family": "Hatsumi", "given": "Masaaki"}],
    "publisher": "Unique Publications",
    "publisher-place": "Burbank",
    "issued": {"date-parts": [[1981]]},
}
needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")


def without_nulls(value):
    if isinstance(value, dict):
        return {k: without_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [without_nulls(v) for v in value]
    return value


def sql(query, *args):
    con = connect()
    with con:
        return con.execute(query, args).fetchall()


def book_upload(client, sha=PDF_SHA):
    size, filename = len(PDF), "densho.pdf"
    return hook(client, "pre-create", session(client), size=size, sha=sha, filename=filename, kind="book")


def finished(client, kind="book", size=None, sha=None, filename=None) -> str:
    """A finished tus upload of the logged-in user (a PDF or a JPEG); its tus ID."""
    size = size or (len(PDF) if kind == "book" else 100)
    sha = sha or (PDF_SHA if kind == "book" else IMAGE_SHA)
    filename = filename or ("densho.pdf" if kind == "book" else "thumb.jpg")
    answer = hook(client, "pre-create", session(client), size=size, sha=sha, filename=filename, kind=kind)
    tus_id = answer["ChangeFileInfo"]["ID"]
    hook(client, "post-finish", tus_id=tus_id, size=size, offset=size)
    return tus_id


def submit(client, tus_id, thumbnail=None, **extra):
    body = {
        "upload": tus_id,
        "thumbnail_upload": thumbnail,
        "original_filename": "densho.pdf",
        "pages": 12,
        "reference": REFERENCE,
        "tags": [{"id": "note", "value": "scan"}],
        **extra,
    }
    return client.post("/api/books", json=body)


def logged_in(admin, username, role):  # noqa: F811
    secret = register(create(admin, username, role))
    return user_login(username, USER_PASSWORD, pyotp.TOTP(secret).now())


# --- tusd hooks ---


def test_a_book_upload_needs_book_mgmt(admin):  # noqa: F811
    videos_only = logged_in(admin, "kenji", "video_mgmt")
    assert book_upload(videos_only)["HTTPResponse"]["StatusCode"] == 403
    answer = book_upload(admin)
    assert "ChangeFileInfo" in answer
    assert sql("SELECT kind FROM upload") == [("book",)]


@pytest.mark.parametrize(
    "kind, change, code",
    [
        ("book", {"filename": "kata.mov"}, "upload.type_refused"),
        ("book", {"size": limits.BOOK_MAX_BYTES + 1}, "upload.too_large"),
        ("image", {"filename": "densho.pdf"}, "upload.type_refused"),
        ("image", {"size": limits.IMAGE_MAX_BYTES + 1}, "upload.too_large"),
        ("music", {}, "upload.invalid_metadata"),
    ],
)
def test_book_and_image_uploads_refused(admin, kind, change, code):  # noqa: F811
    args = {"size": 100, "sha": IMAGE_SHA, "filename": "a.pdf" if kind != "image" else "a.jpg", **change}
    answer = hook(admin, "pre-create", session(admin), kind=kind, **args)
    assert json.loads(answer["HTTPResponse"]["Body"])["code"] == code


def test_a_known_book_is_refused_at_creation(admin):  # noqa: F811
    assert submit(admin, finished(admin)).status_code == 201
    answer = book_upload(admin)
    assert json.loads(answer["HTTPResponse"]["Body"])["code"] == "book.exists"
    # A picture may be uploaded any number of times (its SHA-256 is not a book's).
    assert "ChangeFileInfo" in hook(admin, "pre-create", session(admin), filename="t.jpg", kind="image", size=10)


# --- submit, list, delete ---


def test_exists(admin):  # noqa: F811
    assert admin.get(f"/api/books/exists?sha256={PDF_SHA}").json() == {"exists": False}
    submit(admin, finished(admin))
    assert admin.get(f"/api/books/exists?sha256={PDF_SHA}").json() == {"exists": True}


def test_submit_then_list(admin, caplog):  # noqa: F811
    tus_id, thumb = finished(admin), finished(admin, "image")
    r = submit(admin, tus_id, thumb)
    assert r.status_code == 201, r.text
    book_id = r.json()["id"]
    assert f"book.submitted book_id={book_id}" in caplog.text
    assert sql("SELECT sha256sum, status, pages, upload, thumbnail_upload FROM book") == [
        (PDF_SHA, "queued", 12, tus_id, thumb)
    ]
    assert json.loads(sql("SELECT reference FROM book")[0][0]) == REFERENCE  # CSL names, nothing empty
    [listed] = admin.get("/api/books").json()
    listed["reference"] = without_nulls(listed["reference"])  # absent fields answered as null
    assert listed == {
        "id": book_id,
        "original_filename": "densho.pdf",
        "status": "queued",
        "error": None,
        "pages": 12,
        "reference": REFERENCE,
        "uploaded_at": listed["uploaded_at"],
        "uploaded_by": "Admin",
        "has_thumbnail": False,
        "tags": [{"id": "note", "value": "scan"}],
    }
    assert submit(admin, finished(admin, sha="3" * 64)).status_code == 201  # newest first
    assert [b["id"] for b in admin.get("/api/books").json()] == [book_id + 1, book_id]


def test_submit_refused(admin):  # noqa: F811
    tus_id = finished(admin)
    video = hook(admin, "pre-create", session(admin), size=10, sha="4" * 64)["ChangeFileInfo"]["ID"]
    hook(admin, "post-finish", tus_id=video, size=10, offset=10)
    unfinished = book_upload(admin, sha="5" * 64)["ChangeFileInfo"]["ID"]
    cases = [
        (submit(admin, "f" * 32), 404, "upload.unknown"),
        (submit(admin, video), 404, "upload.unknown"),  # a video's upload is not a book
        (submit(admin, tus_id, video), 404, "upload.unknown"),  # nor a picture
        (submit(admin, unfinished), 409, "upload.not_finished"),
        (submit(admin, tus_id, tags=[{"id": "nope"}]), 422, "tag.unknown"),
        (submit(admin, tus_id, reference={"type": "book"}), 422, "validation.missing"),
        (submit(admin, tus_id, reference={**REFERENCE, "author": [{"given": "x"}]}), 422, "validation.reference_name"),
        (
            submit(admin, tus_id, reference={**REFERENCE, "issued": {"date-parts": [[1981, 13]]}}),
            422,
            "validation.reference_date",
        ),
        (submit(admin, tus_id, reference={**REFERENCE, "URL": "ftp://x"}), 422, "validation.pattern"),
        (submit(admin, tus_id, upload="../x"), 422, "validation.too_short"),
    ]
    for r, code_status, code in cases:
        assert (r.status_code, r.json()["code"]) == (code_status, code)
    assert submit(admin, tus_id).status_code == 201
    r = submit(admin, tus_id)  # the same file again
    assert (r.status_code, r.json()["code"]) == (409, "book.exists")


def test_submit_waits_for_the_finish_hook(admin, monkeypatch):  # noqa: F811
    """tusd answers the last chunk before its post-finish hook: the submit waits for it."""
    from app.api import books as api

    monkeypatch.setattr(api, "FINISH_WAIT_S", 0.3)
    tus_id = book_upload(admin)["ChangeFileInfo"]["ID"]
    timer = threading.Timer(0.1, lambda: hook(admin, "post-finish", tus_id=tus_id, size=len(PDF), offset=len(PDF)))
    timer.start()
    assert submit(admin, tus_id).status_code == 201
    timer.join()


def test_another_users_upload_is_unknown(admin):  # noqa: F811
    aiko = logged_in(admin, "aiko", "book_mgmt")
    r = submit(aiko, finished(admin))
    assert (r.status_code, r.json()["code"]) == (404, "upload.unknown")


def test_books_need_book_mgmt(admin):  # noqa: F811
    videos_only = logged_in(admin, "kenji", "video_mgmt")
    for method, url in [
        ("get", "/api/books"),
        ("get", f"/api/books/exists?sha256={PDF_SHA}"),
        ("post", "/api/books"),
        ("delete", "/api/books/1"),
        ("get", "/media/book/1"),
        ("get", "/media/book/1/thumbnail"),
    ]:
        assert getattr(videos_only, method)(url).status_code == 403, url


def test_delete(admin, caplog):  # noqa: F811
    aiko = logged_in(admin, "aiko", "book_mgmt")
    tus_id, thumb = finished(aiko), finished(aiko, "image")
    book_id = submit(aiko, tus_id, thumb).json()["id"]
    mei = logged_in(admin, "mei", "content_mgmt")
    assert mei.delete(f"/api/books/{book_id}").json()["code"] == "book.unknown"  # not hers
    assert aiko.delete(f"/api/books/{book_id}").status_code == 204
    assert f"book.deleted book_id={book_id}" in caplog.text
    assert sql("SELECT count(*) FROM book") == [(0,)]
    assert sql("SELECT state FROM upload ORDER BY id") == [("deleted",), ("deleted",)]
    assert aiko.delete(f"/api/books/{book_id}").json()["code"] == "book.unknown"

    other = submit(aiko, finished(aiko)).json()["id"]  # an admin deletes anyone's (no thumbnail here)
    sql("UPDATE book SET status = 'failed' WHERE id = ?", other)
    assert admin.delete(f"/api/books/{other}").status_code == 204

    published = submit(aiko, finished(aiko)).json()["id"]
    sql("UPDATE book SET status = 'published' WHERE id = ?", published)
    r = aiko.delete(f"/api/books/{published}")
    assert (r.status_code, r.json()["code"]) == (409, "book.not_deletable")


def test_old_uploads_waiting_for_a_book_are_kept(admin):  # noqa: F811
    from app import queries

    tus_id, thumb = finished(admin), finished(admin, "image")
    submit(admin, tus_id, thumb)
    stray = finished(admin, "image")
    con = connect()
    with con:
        queries.uploads.expire_uploads(con, clock.at(3600))  # every upload is "old"
    assert sql("SELECT tus_id, state FROM upload ORDER BY id") == [
        (tus_id, "finished"),
        (thumb, "finished"),
        (stray, "deleted"),
    ]


def test_a_video_submit_refuses_a_book_upload(admin):  # noqa: F811
    r = admin.post(
        f"/api/uploads/{finished(admin)}/submit",
        json={"original_filename": "kata.mov", "all_segments_done": False, "segments": [], "tags": []},
    )
    assert (r.status_code, r.json()["code"]) == (404, "upload.unknown")


# --- media ---


def published(admin, thumbnail="thumb.jpg"):  # noqa: F811
    book_id = submit(admin, finished(admin)).json()["id"]
    sql(
        "UPDATE book SET status = 'published', directory = ?, thumbnail = ? WHERE id = ?",
        f"{PDF_SHA[:2]}/{PDF_SHA}",
        thumbnail,
        book_id,
    )
    return book_id


def test_media_through_nginx(admin, monkeypatch):  # noqa: F811
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    book_id = published(admin)
    user_id = sql("SELECT id FROM user WHERE username = 'admin'")[0][0]
    r = admin.get(f"/media/book/{book_id}")
    assert r.headers["X-Accel-Redirect"] == f"/protected-book/{user_id}/{PDF_SHA[:2]}/{PDF_SHA}/book.pdf"
    r = admin.get(f"/media/book/{book_id}/thumbnail")
    assert r.headers["X-Accel-Redirect"] == f"/protected-book-image/{PDF_SHA[:2]}/{PDF_SHA}/thumb.jpg"


def test_media_without_nginx(admin):  # noqa: F811
    book_id = published(admin)
    assert admin.get(f"/media/book/{book_id}").status_code == 404  # no file yet
    folder = paths.book_dir() / PDF_SHA[:2] / PDF_SHA
    folder.mkdir(parents=True)
    (folder / "book.pdf").write_bytes(PDF)
    (folder / "thumb.jpg").write_bytes(b"jpeg")
    r = admin.get(f"/media/book/{book_id}")
    assert (r.content, r.headers["content-type"], r.headers["content-disposition"]) == (
        PDF,
        "application/pdf",
        "attachment",
    )
    assert admin.get(f"/media/book/{book_id}/thumbnail").content == b"jpeg"


def test_media_of_unpublished_or_pictureless_books(admin):  # noqa: F811
    queued = submit(admin, finished(admin)).json()["id"]
    assert admin.get(f"/media/book/{queued}").status_code == 404
    assert admin.get(f"/media/book/{queued}/thumbnail").status_code == 404
    sql("DELETE FROM book")
    no_picture = published(admin, thumbnail=None)
    assert admin.get(f"/media/book/{no_picture}/thumbnail").status_code == 404
    sql("UPDATE book SET sha256sum = 'bad' WHERE id = ?", no_picture)
    assert admin.get(f"/media/book/{no_picture}").status_code == 404


# --- references ---


def test_a_reference_keeps_only_what_is_given():
    r = Reference.model_validate({**REFERENCE, "editor": [{"literal": "Bujinkan"}], "original-date": None})
    assert json.loads(r.to_json()) == {**REFERENCE, "editor": [{"literal": "Bujinkan"}]}


@pytest.mark.parametrize(
    "name",
    [{}, {"given": "Masaaki"}, {"literal": "Bujinkan", "given": "x"}, {"literal": "x", "family": "y"}],
)
def test_a_name_has_one_form(name):
    with pytest.raises(ValueError, match="family name"):
        Reference.model_validate({**REFERENCE, "author": [name]})


@pytest.mark.parametrize("parts", [[], [1981, 2, 30, 1], [1981, 13], [1981, 2, 32], [0]])
def test_a_date_is_a_year_a_month_a_day(parts):
    with pytest.raises(ValueError):
        Reference.model_validate({**REFERENCE, "issued": {"date-parts": [parts]}})


# --- the encoder's book step ---


@pytest.fixture
def media(client, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    paths.upload_dir().mkdir(parents=True)
    return tmp_path


def store(tus_id, data):
    """tusd's files for an upload: the data and its .info (the announced size)."""
    (paths.upload_dir() / tus_id).write_bytes(data)
    (paths.upload_dir() / f"{tus_id}.info").write_text(json.dumps({"Size": len(data)}))


def jpeg(path, width=800):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=red:s={width}x400", "-frames:v", "1", str(path)],
        check=True,
    )
    return path.read_bytes()


def queued_book(admin, pdf=PDF, image=None):  # noqa: F811
    sha = hashlib.sha256(pdf).hexdigest()
    tus_id = finished(admin, size=len(pdf), sha=sha)
    thumb = finished(admin, "image", size=len(image)) if image is not None else None
    store(tus_id, pdf)
    if image is not None:
        store(thumb, image)
    book_id = submit(admin, tus_id, thumb).json()["id"]
    return book_id, sha


def book_row(book_id):
    return sql("SELECT status, error, directory, thumbnail, upload, attempts FROM book WHERE id = ?", book_id)[0]


@needs_ffmpeg
def test_a_book_published_with_its_thumbnail(admin, media, tmp_path):  # noqa: F811
    book_id, sha = queued_book(admin, image=jpeg(tmp_path / "page.jpg"))
    assert books.run_once(threading.Event())
    assert book_row(book_id) == ("published", None, f"{sha[:2]}/{sha}", "thumb.jpg", None, 1)
    folder = paths.book_dir() / sha[:2] / sha
    assert (folder / "book.pdf").read_bytes() == PDF  # never rewritten
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=width,codec_name",
            "-of",
            "csv=p=0",
            str(folder / "thumb.jpg"),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert probe.stdout.strip() == f"mjpeg,{books.THUMB_WIDTH}"
    assert sql("SELECT DISTINCT state FROM upload") == [("deleted",)]  # the encoder deletes them
    assert not (paths.book_dir() / ".work" / str(book_id)).exists()
    assert not books.run_once(threading.Event())  # nothing else waits


@needs_ffmpeg
def test_a_small_picture_is_not_enlarged(admin, media, tmp_path):  # noqa: F811
    _, sha = queued_book(admin, image=jpeg(tmp_path / "page.jpg", width=200))
    books.run_once(threading.Event())
    out = paths.book_dir() / sha[:2] / sha / "thumb.jpg"
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", str(out)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert probe.stdout.strip() == "200"


@needs_ffmpeg
def test_a_bad_thumbnail_leaves_the_book_without_one(admin, media, caplog):  # noqa: F811
    book_id, _ = queued_book(admin, image=b"not a jpeg at all")
    books.run_once(threading.Event())
    assert book_row(book_id)[:4] == ("published", None, book_row(book_id)[2], None)
    assert "published without a thumbnail" in caplog.text


def test_a_book_without_thumbnail(admin, media):  # noqa: F811
    book_id, _ = queued_book(admin)
    books.run_once(threading.Event())
    assert book_row(book_id)[0::3] == ("published", None)


@pytest.mark.parametrize(
    "pdf, error",
    [
        (b"<html>%%EOF</html>", "Not a PDF file"),
        (b"%PDF-1.7\n" + b"x" * 5000, "Not a PDF file"),  # cut: no trailer at the end
    ],
)
def test_not_a_pdf_fails_for_good(admin, media, pdf, error):  # noqa: F811
    book_id, _ = queued_book(admin, pdf=pdf)
    books.run_once(threading.Event())
    assert book_row(book_id)[:2] == ("failed", error)
    assert sql("SELECT DISTINCT state FROM upload") == [("deleted",)]


def test_the_file_must_be_the_one_announced(admin, media):  # noqa: F811
    book_id, _ = queued_book(admin)
    (paths.upload_dir() / sql("SELECT upload FROM book")[0][0]).write_bytes(PDF.replace(b"1.4", b"1.5"))
    books.run_once(threading.Event())
    assert book_row(book_id)[:2] == ("failed", "The uploaded file is not the one announced (SHA-256 differs)")


def test_a_missing_upload_fails(admin, media):  # noqa: F811
    book_id, _ = queued_book(admin)
    (paths.upload_dir() / f"{sql('SELECT upload FROM book')[0][0]}.info").unlink()
    books.run_once(threading.Event())
    assert book_row(book_id)[:2] == ("failed", "The uploaded file is missing")


def test_unexpected_errors_retried_then_failed(admin, media, monkeypatch, caplog):  # noqa: F811
    book_id, _ = queued_book(admin)

    def broken(*_):
        raise OSError("disk full")

    monkeypatch.setattr(books, "check_pdf", broken)
    for attempt in range(1, books.MAX_ATTEMPTS):
        books.run_once(threading.Event())
        assert book_row(book_id)[0::5] == ("queued", attempt)
    books.run_once(threading.Event())
    assert book_row(book_id)[:2] == ("failed", "Unexpected error: disk full")
    assert "Book 1: unexpected error" in caplog.text


def test_deleted_while_being_published(admin, media, monkeypatch):  # noqa: F811
    book_id, sha = queued_book(admin)
    process = books.process

    def then_deleted(row, work):
        thumbnail = process(row, work)
        sql("DELETE FROM book WHERE id = ?", book_id)
        return thumbnail

    monkeypatch.setattr(books, "process", then_deleted)
    books.run_once(threading.Event())
    assert not (paths.book_dir() / sha[:2] / sha).exists()


def test_nothing_when_stopping(admin, media):  # noqa: F811
    book_id, _ = queued_book(admin)
    stopping = threading.Event()
    stopping.set()
    assert not books.run_once(stopping)
    assert book_row(book_id)[0] == "queued"


def test_invalid_upload_ids():
    for tus_id in ("", "../etc", ".hidden"):
        with pytest.raises(JobError, match="Invalid upload ID"):
            checks.upload_files(paths.upload_dir(), tus_id)


def test_books_before_videos(media, monkeypatch):
    """The encoder's loop: a waiting book first, the next video only when none waits."""
    calls = []
    enc = queue.Encoder()
    monkeypatch.setattr(enc, "housekeeping", lambda: None)
    answers = iter([True, False])

    def book_step(stopping):
        calls.append("book")
        return next(answers)

    def video_step():
        calls.append("video")
        enc.stopping.set()
        return False

    monkeypatch.setattr(books, "run_once", book_step)
    monkeypatch.setattr(enc, "run_once", video_step)
    enc.run()
    assert calls == ["book", "book", "video"]


def test_ffmpeg_writing_no_picture(tmp_path, monkeypatch):
    monkeypatch.setattr(checks, "run", lambda cmd: "")
    with pytest.raises(JobError, match="No picture"):
        books.reencode_jpeg(tmp_path / "in", tmp_path / "out.jpg")
