"""Comments on books' annotations: a thread each, read by book managers, written with the
"comment" access; each user changes their own, moderators anyone's (the author stays)."""

import pytest

from .test_book_annotations import REGION, annotate
from .test_books import logged_in, published, sql
from .test_upload import admin  # noqa: F401 (fixture)


@pytest.fixture
def annotation(admin):  # noqa: F811
    book_id = published(admin)
    return book_id, annotate(admin, book_id, REGION).json()["id"]


def comment(client, annotation_id, text="Seen in the dojo"):
    return client.post(f"/api/book-annotations/{annotation_id}/comments", json={"text": text, "lang": "en"})


def test_a_thread(admin, annotation, caplog):  # noqa: F811
    book_id, annotation_id = annotation
    r = comment(admin, annotation_id)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first == {
        "id": first["id"],
        "annotation": annotation_id,
        "user": "Admin",
        "created_at": first["created_at"],
        "modified_at": first["created_at"],
        "lang": "en",
        "text": "Seen in the dojo",
        "mine": True,
    }
    assert f"book_comment.created book_comment_id={first['id']} annotation_id={annotation_id}" in caplog.text
    aiko = logged_in(admin, "aiko", "book_mgmt")
    second = comment(aiko, annotation_id, "  And in the scroll  ").json()
    assert second["text"] == "And in the scroll"
    thread = admin.get(f"/api/book-annotations/{annotation_id}/comments").json()
    assert [(c["id"], c["user"], c["mine"]) for c in thread] == [
        (first["id"], "Admin", True),
        (second["id"], "Kenji", False),
    ]
    other = annotate(admin, book_id, REGION).json()["id"]
    comment(admin, other, "Elsewhere")
    whole = admin.get(f"/api/books/{book_id}/comments").json()
    assert [(c["annotation"], c["text"]) for c in whole] == [
        (annotation_id, "Seen in the dojo"),
        (annotation_id, "And in the scroll"),
        (other, "Elsewhere"),
    ]


def test_refused(admin, annotation):  # noqa: F811
    _, annotation_id = annotation
    assert comment(admin, 999).json()["code"] == "book_annotation.unknown"
    assert admin.get("/api/book-annotations/999/comments").json()["code"] == "book_annotation.unknown"
    assert admin.get("/api/books/999/comments").json()["code"] == "book.unknown"
    r = comment(admin, annotation_id, "   ")
    assert (r.status_code, r.json()["code"]) == (422, "validation.comment_empty")
    assert admin.patch("/api/book-comments/999", json={"text": "x", "lang": "en"}).json()["code"] == "comment.unknown"


def test_access(admin, annotation, caplog):  # noqa: F811
    _, annotation_id = annotation
    videos_only = logged_in(admin, "kenji", "video_mgmt")
    assert videos_only.get(f"/api/book-annotations/{annotation_id}/comments").status_code == 403
    assert comment(videos_only, annotation_id).status_code == 403
    sql("DELETE FROM role_has_access WHERE role = 'book_mgmt' AND access = 'comment'")
    reader = logged_in(admin, "ren", "book_mgmt")  # reads, may not write
    assert reader.get(f"/api/book-annotations/{annotation_id}/comments").status_code == 200
    r = comment(reader, annotation_id)
    assert (r.status_code, r.json()["code"]) == (403, "auth.access_denied")
    assert "access.denied access=comment" in caplog.text


def test_each_changes_their_own_a_moderator_any(admin, annotation, caplog):  # noqa: F811
    _, annotation_id = annotation
    aiko = logged_in(admin, "aiko", "book_mgmt")
    mine = comment(aiko, annotation_id).json()
    url = f"/api/book-comments/{mine['id']}"
    r = aiko.patch(url, json={"text": "Seen twice", "lang": "fr"})
    assert (r.status_code, r.json()["text"], r.json()["lang"]) == (200, "Seen twice", "fr")
    mei = logged_in(admin, "mei", "content_mgmt")
    for r in (mei.patch(url, json={"text": "x", "lang": "en"}), mei.delete(url)):
        assert (r.status_code, r.json()["code"]) == (403, "comment.not_author")
    assert f"comment.denied book_comment_id={mine['id']}" in caplog.text
    aiko_id = sql("SELECT id FROM user WHERE username = 'aiko'")[0][0]
    r = admin.patch(url, json={"text": "Moderated", "lang": "en"})
    assert (r.status_code, r.json()["user"], r.json()["mine"]) == (200, "Kenji", False)
    assert f"book_comment.edited book_comment_id={mine['id']} author_id={aiko_id}" in caplog.text
    assert admin.delete(url).status_code == 204
    assert f"book_comment.deleted book_comment_id={mine['id']} author_id={aiko_id}" in caplog.text
    assert admin.get(f"/api/book-annotations/{annotation_id}/comments").json() == []


def test_own_deleted_and_with_the_annotation(admin, annotation):  # noqa: F811
    _, annotation_id = annotation
    own = comment(admin, annotation_id).json()
    assert admin.delete(f"/api/book-comments/{own['id']}").status_code == 204
    comment(admin, annotation_id)
    assert admin.delete(f"/api/book-annotations/{annotation_id}").status_code == 204
    assert sql("SELECT count(*) FROM book_comment") == [(0,)]


def test_deleted_between_write_and_read(admin, annotation, monkeypatch):  # noqa: F811
    from app import queries

    _, annotation_id = annotation
    monkeypatch.setattr(queries.book_comments, "comment", lambda *_: None)
    assert comment(admin, annotation_id).json()["code"] == "comment.unknown"
