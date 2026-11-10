"""What the books say about a technique, on its page: every logged-in user sees the
annotations of published books about it, with their book's reference; only
book managers get the book's ID."""

from .test_book_annotations import HIGHLIGHT, REGION, annotate
from .test_books import REFERENCE, logged_in, published, sql, without_nulls
from .test_catalog import KOKU
from .test_upload import admin  # noqa: F401 (fixture)

URL = f"/api/techniques/{KOKU}/book-notes"


def test_a_techniques_notes(admin):  # noqa: F811
    book_id = published(admin)
    region = annotate(admin, book_id, REGION).json()  # about KOKU
    text = annotate(admin, book_id, {**HIGHLIGHT, "technique": KOKU, "note": "Key point"}).json()
    annotate(admin, book_id, HIGHLIGHT)  # about no technique

    notes = admin.get(URL).json()
    assert [n["id"] for n in notes] == [region["id"], text["id"]]  # by page
    first, second = notes
    assert without_nulls(first["reference"]) == REFERENCE
    assert first == {
        **first,
        "book_id": book_id,
        "page": 1,
        "kind": "region",
        "quote": None,
        "note": "The scroll's seal",
        "has_image": False,
        "created_by": "Admin",
    }
    assert (second["page"], second["quote"], second["note"]) == (3, "Togakure-ryū", "Key point")
    assert "comments" not in second


def test_every_user_sees_them_without_the_book(admin):  # noqa: F811
    book_id = published(admin)
    annotate(admin, book_id, REGION)
    plain = logged_in(admin, "kenji", "user")
    [note] = plain.get(URL).json()
    assert note["book_id"] is None
    assert plain.get(f"/api/books/{book_id}").status_code == 403  # the book stays the managers'


def test_only_published_books(admin):  # noqa: F811
    book_id = published(admin)
    annotate(admin, book_id, REGION)
    sql("UPDATE book SET status = 'failed'")
    assert admin.get(URL).json() == []


def test_unknown_technique(admin):  # noqa: F811
    r = admin.get("/api/techniques/nope.nope/book-notes")
    assert (r.status_code, r.json()["code"]) == (404, "technique.unknown")
