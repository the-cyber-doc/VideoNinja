"""The search's full text: the books' page text sent by the browser, and /api/search over
pages, book annotations and comments (FTS5, trigram), each user getting what they may open."""

import pytest

from app.domain import search

from .test_book_annotations import HIGHLIGHT, REGION, annotate
from .test_book_comments import comment
from .test_books import finished as finished_upload
from .test_books import logged_in, published, sql, submit
from .test_catalog import KOKU
from .test_upload import admin  # noqa: F401 (fixture)

M, E = search.START, search.END


def send(client, book_id, pages, first=1, last=True):
    return client.put(f"/api/books/{book_id}/text", json={"first": first, "pages": pages, "last": last})


def find(client, q):
    r = client.get("/api/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()


# --- the query and the snippets ---


def test_parse():
    assert search.parse("   ") is None
    q = search.parse('Dōjō ka 100% ka "x" _b')
    assert q is not None
    assert q.match == '"Dōjō" "100%" """x"""'  # quoted: never FTS5 syntax
    assert q.likes == ("%ka%", "%\\_b%")  # shorter than 3: LIKE, escaped; duplicates dropped
    assert q.terms == ("dojo", "ka", "100%", '"x"', "_b")
    assert len(search.parse(" ".join(f"w{i:02}" for i in range(20))).terms) == search.MAX_TERMS


def test_clean():
    assert search.clean(" a\x00b\x02c\x03\nd\te ") == "a b c \nd\te"


def test_snippet():
    long = "start " + "word " * 30 + "Le Dōjō de Kamae " + "word " * 30 + "end"
    out = search.snippet(long, ("dojo", "kamae"))
    assert out.startswith("…") and out.endswith("…")
    assert f"{M}Dōjō{E} de {M}Kamae{E}" in out
    assert len(out) < 2 * search.SNIPPET_WIDTH + 30
    assert search.snippet("Kamae kamae", ("kamae",)) == f"{M}Kamae{E} {M}kamae{E}"
    assert search.snippet("Straße", ("ss",)) == f"Stra{M}ß{E}e"  # one character folded into two
    assert search.snippet("aaaa", ("aa", "aaa")) == f"{M}aa{E}{M}aa{E}"  # overlaps skipped
    assert search.snippet("no\n\n match  here", ("zz",)) == "no match here"  # none: the start
    assert search.snippet("x" * 200, ("zz",)).endswith("…")
    assert search.snippet("ab " * 40 + "far", ("ab", "far")).count(M) < 41  # outside the window: not marked


# --- the page text ---


def test_text_sent_in_batches(admin):  # noqa: F811
    book_id = published(admin)
    assert admin.get(f"/api/books/{book_id}").json()["has_text"] is False
    assert send(admin, book_id, ["Page one", "", "Kamae"], last=False).status_code == 204
    assert admin.get(f"/api/books/{book_id}").json()["has_text"] is False  # not all of it yet
    assert send(admin, book_id, ["Twelve\x02"], first=12).status_code == 204
    assert sql("SELECT page, text FROM book_page ORDER BY page") == [(1, "Page one"), (3, "Kamae"), (12, "Twelve")]
    assert sql("SELECT text_pages FROM book") == [(3,)]
    assert admin.get("/api/books").json()[0]["has_text"] is True
    # Sent again: replaces it all.
    assert send(admin, book_id, ["Other"]).status_code == 204
    assert sql("SELECT page, text FROM book_page") == [(1, "Other")]
    # A scanned book: no text, but sent.
    assert send(admin, book_id, ["", ""]).status_code == 204
    assert sql("SELECT text_pages FROM book") == [(0,)]


def test_text_refused(admin):  # noqa: F811
    book_id = published(admin)
    r = send(admin, book_id, ["x"] * 3, first=11)
    assert (r.status_code, r.json()["code"], r.json()["params"]) == (422, "book.text_pages", {"pages": 12})
    assert send(admin, 999, ["x"]).json()["code"] == "book.unknown"
    sql("UPDATE book SET status = 'failed'")
    assert send(admin, book_id, ["x"]).json()["code"] == "book.unknown"
    assert send(admin, book_id, ["x"], first=0).status_code == 422
    plain = logged_in(admin, "kenji", "user")
    assert send(plain, book_id, ["x"]).status_code == 403


def test_text_of_a_queued_book_and_of_one_without_a_page_count(admin):  # noqa: F811
    """At the upload (queued); a book whose page count is unknown takes any page."""
    book_id = submit(admin, finished_upload(admin), pages=None).json()["id"]
    assert send(admin, book_id, ["Late page"], first=500).status_code == 204
    assert sql("SELECT page FROM book_page") == [(500,)]


# --- /api/search ---


@pytest.fixture
def library(admin):  # noqa: F811
    book_id = published(admin)
    send(admin, book_id, ["Intro", "Le dōjō de Takamatsu", "Kamae: Ichimonji no kamae"])
    text = annotate(admin, book_id, {**HIGHLIGHT, "quote": "Ichimonji", "note": "Takamatsu sensei"}).json()
    region = annotate(admin, book_id, {**REGION, "note": "Seal of Takamatsu"}).json()  # about KOKU
    comment(admin, text["id"], "Takamatsu wrote it")
    admin.post(f"/api/techniques/{KOKU}/comments", json={"text": "Takamatsu's way", "lang": "en"})
    return book_id, text["id"], region["id"]


def test_everything_for_a_book_manager(admin, library):  # noqa: F811
    book_id, text_id, region_id = library
    out = find(admin, "takamatsu")
    assert out["pages"] == [{"book": book_id, "page": 2, "snippet": f"Le dōjō de {M}Takamatsu{E}"}]
    assert {a["id"] for a in out["annotations"]} == {text_id, region_id}
    assert all(a["book"] == book_id for a in out["annotations"])
    [c] = out["comments"]
    assert (c["technique"], c["user"], c["snippet"]) == (KOKU, "Admin", f"{M}Takamatsu{E}'s way")
    [bc] = out["book_comments"]
    assert (bc["annotation"], bc["book"], bc["user"]) == (text_id, book_id, "Admin")


def test_parts_of_words_accents_every_term(admin, library):  # noqa: F811
    assert [p["page"] for p in find(admin, "DOJO")["pages"]] == [2]  # accents and case ignored
    assert [p["page"] for p in find(admin, "monji kamae")["pages"]] == [3]  # any part of a word, every term
    assert find(admin, "kamae nowhere")["pages"] == []
    assert [p["page"] for p in find(admin, "no kamae")["pages"]] == [3]  # a short term: LIKE
    only_short = find(admin, "le")  # no term of 3 characters: LIKE alone, newest first
    assert [p["page"] for p in only_short["pages"]] == [2]
    assert find(admin, "   ")["pages"] == []
    assert find(admin, 'kamae" OR "intro')["pages"] == []  # quoted: the words, not FTS5's syntax


def test_what_a_plain_user_gets(admin, library):  # noqa: F811
    _, _, region_id = library
    plain = logged_in(admin, "kenji", "user")
    out = find(plain, "takamatsu")
    assert out["pages"] == [] and out["book_comments"] == []
    assert [(a["id"], a["book"], a["technique"]) for a in out["annotations"]] == [(region_id, None, KOKU)]
    assert len(out["comments"]) == 1


def test_published_books_only(admin, library):  # noqa: F811
    sql("UPDATE book SET status = 'queued'")
    out = find(admin, "takamatsu")
    assert out["pages"] == [] and out["annotations"] == [] and out["book_comments"] == []
    assert len(out["comments"]) == 1


def test_query_rules(admin):  # noqa: F811
    assert admin.get("/api/search").status_code == 422
    assert admin.get("/api/search", params={"q": "x" * 201}).status_code == 422
    admin.cookies.clear()
    assert admin.get("/api/search", params={"q": "kamae"}).status_code == 401
