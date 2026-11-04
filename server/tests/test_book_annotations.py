"""Books once published: one book, its reference and tags edited, a new first page; its
annotations (each user's own, moderators any), their crops published by the encoder,
the crops no annotation uses deleted."""

import json
import threading

import pytest

from app.core import clock, paths
from app.encoder import books

from .conftest import connect
from .test_books import (
    PDF_SHA,
    REFERENCE,
    finished,
    jpeg,
    logged_in,
    media,  # noqa: F401 (fixture)
    needs_ffmpeg,
    published,
    sql,
    store,
    submit,
    without_nulls,
)
from .test_catalog import KOKU
from .test_upload import admin  # noqa: F401 (fixture)

TARGET = json.dumps({"type": 9, "id": "a1", "pageIndex": 2, "rect": {"origin": {"x": 1, "y": 2}}})
HIGHLIGHT = {"page": 3, "kind": "text", "target": TARGET, "quote": "Togakure-ryū", "color": "#FFCD45"}
REGION = {"page": 1, "kind": "region", "target": TARGET, "note": "The scroll's seal", "technique": KOKU}


def annotate(client, book_id, body=None):
    return client.post(f"/api/books/{book_id}/annotations", json=body or HIGHLIGHT)


# --- one book, edited ---


def test_one_book(admin):  # noqa: F811
    book_id = submit(admin, finished(admin)).json()["id"]
    r = admin.get(f"/api/books/{book_id}")
    assert r.status_code == 200
    assert without_nulls(r.json()["reference"]) == REFERENCE
    assert r.json()["tags"] == [{"id": "note", "value": "scan"}]
    assert admin.get("/api/books/99").json()["code"] == "book.unknown"


def test_reference_and_tags_edited_by_any_book_manager(admin, caplog):  # noqa: F811
    book_id = submit(admin, finished(admin)).json()["id"]
    aiko = logged_in(admin, "aiko", "book_mgmt")
    reference = {**REFERENCE, "title": "Ninjutsu, revised", "edition": "2"}
    r = aiko.put(f"/api/books/{book_id}", json={"reference": reference, "tags": [{"id": "rain"}]})
    assert r.status_code == 200, r.text
    assert (without_nulls(r.json()["reference"]), r.json()["tags"]) == (reference, [{"id": "rain", "value": None}])
    assert json.loads(sql("SELECT reference FROM book")[0][0]) == reference
    assert f"book.edited book_id={book_id}" in caplog.text
    r = aiko.put(f"/api/books/{book_id}", json={"reference": reference, "tags": [{"id": "nope"}]})
    assert (r.status_code, r.json()["code"]) == (422, "tag.unknown")
    assert aiko.put("/api/books/99", json={"reference": reference}).json()["code"] == "book.unknown"


def test_a_new_first_page_for_a_published_book(admin):  # noqa: F811
    queued = submit(admin, finished(admin)).json()["id"]
    picture = finished(admin, "image")
    assert admin.put(f"/api/books/{queued}/thumbnail", json={"upload": picture}).json()["code"] == "book.unknown"
    sql("DELETE FROM book")
    book_id = published(admin)
    assert admin.put(f"/api/books/{book_id}/thumbnail", json={"upload": picture}).status_code == 204
    again = finished(admin, "image")
    assert admin.put(f"/api/books/{book_id}/thumbnail", json={"upload": again}).status_code == 204
    assert sql("SELECT thumbnail_upload FROM book") == [(again,)]
    assert sql("SELECT state FROM upload WHERE tus_id = ?", picture) == [("deleted",)]  # replaced
    pdf = finished(admin, sha="7" * 64)  # a book's upload is not a picture
    assert admin.put(f"/api/books/{book_id}/thumbnail", json={"upload": pdf}).json()["code"] == "upload.unknown"


# --- annotations ---


def test_annotate_list_change_delete(admin, caplog):  # noqa: F811
    book_id = published(admin)
    r = annotate(admin, book_id)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created == {
        "id": created["id"],
        "page": 3,
        "kind": "text",
        "target": TARGET,
        "quote": "Togakure-ryū",
        "color": "#FFCD45",
        "note": None,
        "technique": None,
        "has_image": False,
        "created_by": "Admin",
        "created_at": created["created_at"],
        "modified_at": created["created_at"],
        "mine": True,
    }
    assert f"book_annotation.created book_id={book_id} annotation_id={created['id']}" in caplog.text
    region = annotate(admin, book_id, REGION).json()
    assert [a["id"] for a in admin.get(f"/api/books/{book_id}/annotations").json()] == [region["id"], created["id"]]

    r = admin.patch(f"/api/book-annotations/{created['id']}", json={"note": "Key point", "technique": KOKU})
    assert (r.status_code, r.json()["note"], r.json()["technique"], r.json()["quote"]) == (
        200,
        "Key point",
        KOKU,
        "Togakure-ryū",
    )
    r = admin.patch(f"/api/book-annotations/{created['id']}", json={"technique": None, "page": 4})
    assert (r.json()["technique"], r.json()["page"], r.json()["note"]) == (None, 4, "Key point")

    assert admin.delete(f"/api/book-annotations/{created['id']}").status_code == 204
    assert f"book_annotation.deleted annotation_id={created['id']}" in caplog.text
    assert [a["id"] for a in admin.get(f"/api/books/{book_id}/annotations").json()] == [region["id"]]


@pytest.mark.parametrize(
    "body, code",
    [
        ({**HIGHLIGHT, "target": "[1, 2]"}, "validation.annotation_target"),
        ({**HIGHLIGHT, "target": "{not json"}, "validation.annotation_target"),
        ({**HIGHLIGHT, "color": "rouge"}, "validation.pattern"),
        ({**HIGHLIGHT, "page": 0}, "validation.too_small"),
        ({**HIGHLIGHT, "kind": "ink"}, "validation.invalid"),
    ],
)
def test_annotations_refused(admin, body, code):  # noqa: F811
    assert annotate(admin, published(admin), body).json()["code"] == code


def test_changes_refused(admin):  # noqa: F811
    book_id = published(admin)
    created = annotate(admin, book_id).json()
    url = f"/api/book-annotations/{created['id']}"
    for body, code in [
        ({"page": None}, "validation.missing"),
        ({"target": None}, "validation.missing"),
        ({"target": "33"}, "validation.annotation_target"),
        ({"technique": "nope.nope"}, "technique.unknown"),
    ]:
        assert admin.patch(url, json=body).json()["code"] == code, body
    assert annotate(admin, book_id, {**HIGHLIGHT, "technique": "nope.nope"}).json()["code"] == "technique.unknown"
    assert admin.patch("/api/book-annotations/99", json={}).json()["code"] == "book_annotation.unknown"


def test_only_a_published_book(admin):  # noqa: F811
    queued = submit(admin, finished(admin)).json()["id"]
    assert annotate(admin, queued).json()["code"] == "book.unknown"
    assert admin.get(f"/api/books/{queued}/annotations").json()["code"] == "book.unknown"


def test_each_changes_their_own_a_moderator_any(admin, caplog):  # noqa: F811
    book_id = published(admin)
    aiko = logged_in(admin, "aiko", "book_mgmt")
    mine = annotate(aiko, book_id).json()
    [listed] = admin.get(f"/api/books/{book_id}/annotations").json()
    assert (listed["created_by"], listed["mine"]) == ("Kenji", False)  # register()'s display name
    ren = logged_in(admin, "ren", "content_mgmt")
    url = f"/api/book-annotations/{mine['id']}"
    for r in (ren.patch(url, json={"note": "x"}), ren.delete(url)):
        assert (r.status_code, r.json()["code"]) == (403, "book_annotation.not_author")
    assert "book_annotation.denied" in caplog.text
    aiko_id = sql("SELECT id FROM user WHERE username = 'aiko'")[0][0]
    r = admin.patch(url, json={"note": "Moderated"})
    assert (r.status_code, r.json()["created_by"]) == (200, "Kenji")  # the author stays
    assert f"author_id={aiko_id}" in caplog.text
    assert admin.delete(url).status_code == 204


def test_annotations_need_book_mgmt(admin):  # noqa: F811
    book_id = published(admin)
    videos_only = logged_in(admin, "kenji", "video_mgmt")
    for method, url, body in [
        ("get", f"/api/books/{book_id}/annotations", None),
        ("post", f"/api/books/{book_id}/annotations", HIGHLIGHT),
        ("patch", "/api/book-annotations/1", {}),
        ("delete", "/api/book-annotations/1", None),
        ("put", "/api/book-annotations/1/image", {"upload": "0" * 32}),
        ("put", f"/api/books/{book_id}", {"reference": REFERENCE}),
        ("put", f"/api/books/{book_id}/thumbnail", {"upload": "0" * 32}),
        ("get", f"/api/books/{book_id}", None),
    ]:
        kwargs = {"json": body} if body is not None else {}
        assert getattr(videos_only, method)(url, **kwargs).status_code == 403, url


# --- crops ---


def test_a_region_gets_its_crop(admin):  # noqa: F811
    book_id = published(admin)
    text = annotate(admin, book_id).json()
    region = annotate(admin, book_id, REGION).json()
    crop = finished(admin, "image")
    r = admin.put(f"/api/book-annotations/{text['id']}/image", json={"upload": crop})
    assert (r.status_code, r.json()["code"]) == (409, "book_annotation.not_region")
    assert admin.put(f"/api/book-annotations/{region['id']}/image", json={"upload": crop}).status_code == 204
    again = finished(admin, "image")
    assert admin.put(f"/api/book-annotations/{region['id']}/image", json={"upload": again}).status_code == 204
    assert sql("SELECT state FROM upload WHERE tus_id = ?", crop) == [("deleted",)]
    # Not "old": an upload waiting for its annotation is kept.
    from app import queries

    con = connect()
    with con:
        queries.uploads.expire_uploads(con, clock.at(3600))
    assert sql("SELECT state FROM upload WHERE tus_id = ?", again) == [("finished",)]
    # Deleted with its annotation: the upload goes too.
    assert admin.delete(f"/api/book-annotations/{region['id']}").status_code == 204
    assert sql("SELECT state FROM upload WHERE tus_id = ?", again) == [("deleted",)]


def published_in_folder(admin):  # noqa: F811
    book_id = published(admin)
    (paths.book_dir() / PDF_SHA[:2] / PDF_SHA).mkdir(parents=True, exist_ok=True)
    return book_id


@needs_ffmpeg
def test_the_encoder_publishes_crops_and_first_pages(admin, media, tmp_path):  # noqa: F811
    book_id = published_in_folder(admin)
    region = annotate(admin, book_id, REGION).json()
    crop, page = finished(admin, "image", size=10), finished(admin, "image", size=11)
    store(crop, jpeg(tmp_path / "crop.jpg"))
    store(page, jpeg(tmp_path / "page.jpg", width=300))
    # (the sizes announced differ from the files': store() rewrites the .info with the real size)
    admin.put(f"/api/book-annotations/{region['id']}/image", json={"upload": crop})
    admin.put(f"/api/books/{book_id}/thumbnail", json={"upload": page})

    assert books.run_pictures(threading.Event())  # the first page first
    assert sql("SELECT thumbnail, thumbnail_upload FROM book") == [("thumb.jpg", None)]
    assert books.run_pictures(threading.Event())
    folder = paths.book_dir() / PDF_SHA[:2] / PDF_SHA
    assert (folder / f"note-{region['id']}.jpg").is_file()
    assert sql("SELECT image, image_upload FROM book_annotation") == [(f"note-{region['id']}.jpg", None)]
    assert sql("SELECT DISTINCT state FROM upload WHERE kind = 'image'") == [("deleted",)]
    assert admin.get(f"/api/books/{book_id}/annotations").json()[0]["has_image"] is True
    assert not books.run_pictures(threading.Event())


@needs_ffmpeg
def test_not_a_picture_is_refused(admin, media, caplog):  # noqa: F811
    book_id = published_in_folder(admin)
    region = annotate(admin, book_id, REGION).json()
    crop, page = finished(admin, "image"), finished(admin, "image")
    store(crop, b"not a jpeg")
    store(page, b"not a jpeg either")
    admin.put(f"/api/book-annotations/{region['id']}/image", json={"upload": crop})
    admin.put(f"/api/books/{book_id}/thumbnail", json={"upload": page})
    assert books.run_pictures(threading.Event()) and books.run_pictures(threading.Event())
    assert sql("SELECT thumbnail, thumbnail_upload FROM book") == [("thumb.jpg", None)]  # the old one kept
    assert sql("SELECT image, image_upload FROM book_annotation") == [(None, None)]
    assert "not published" in caplog.text


def test_no_picture_while_stopping(admin, media):  # noqa: F811
    stopping = threading.Event()
    stopping.set()
    assert not books.run_pictures(stopping)


def test_crops_no_annotation_uses_are_deleted(admin, media, monkeypatch):  # noqa: F811
    book_id = published_in_folder(admin)
    kept = annotate(admin, book_id, REGION).json()
    sql("UPDATE book_annotation SET image = ? WHERE id = ?", f"note-{kept['id']}.jpg", kept["id"])
    folder = paths.book_dir() / PDF_SHA[:2] / PDF_SHA
    for name in (f"note-{kept['id']}.jpg", "note-999.jpg", "thumb.jpg", "note-x.jpg"):
        (folder / name).write_bytes(b"jpeg")
    monkeypatch.setattr(books, "_swept_at", 0.0)
    books.sweep_orphans(now=books.SWEEP_EVERY_S - 1)  # too soon after the last
    assert (folder / "note-999.jpg").exists()
    books.sweep_orphans(now=books.SWEEP_EVERY_S)
    assert sorted(p.name for p in folder.iterdir()) == sorted(["note-x.jpg", f"note-{kept['id']}.jpg", "thumb.jpg"])


# --- the crop, for every user ---


def test_the_crop_served_to_every_user(admin, media, monkeypatch):  # noqa: F811
    book_id = published_in_folder(admin)
    region = annotate(admin, book_id, REGION).json()
    plain = logged_in(admin, "kenji", "user")
    url = f"/media/book-annotation/{region['id']}/image"
    assert plain.get(url).status_code == 404  # no crop yet
    sql("UPDATE book_annotation SET image = ? WHERE id = ?", f"note-{region['id']}.jpg", region["id"])
    assert plain.get(url).status_code == 404  # no file
    (paths.book_dir() / PDF_SHA[:2] / PDF_SHA / f"note-{region['id']}.jpg").write_bytes(b"jpeg")
    assert plain.get(url).content == b"jpeg"
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    r = plain.get(url)
    assert r.headers["X-Accel-Redirect"] == f"/protected-book-image/{PDF_SHA[:2]}/{PDF_SHA}/note-{region['id']}.jpg"
    assert plain.get("/media/book-annotation/99/image").status_code == 404
