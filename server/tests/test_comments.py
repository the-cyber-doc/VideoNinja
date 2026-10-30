from datetime import UTC, datetime

import pyotp
import pytest

from app import queries
from app.core import clock

from .conftest import connect
from .test_auth import login
from .test_catalog import KETO, KOKU
from .test_users import USER_PASSWORD, create, register, user_login

COMMENTS = f"/api/techniques/{KOKU}/comments"


def add_comment(technique, user_id, created_at, text, lang="en", modified_at=None):
    con = connect()
    with con:
        con.execute(
            "INSERT INTO comment (technique, user, lang, text, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)",
            (technique, user_id, lang, text, created_at, modified_at or created_at),
        )


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    return client


@pytest.fixture
def kenji(admin):
    """A second user (role "user"), with his own session."""
    secret = register(create(admin))
    return user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())


def test_requires_login(client, admin_secret):
    assert client.get(COMMENTS).status_code == 401
    assert client.post(COMMENTS, json={"text": "Hi", "lang": "en"}).status_code == 401


def test_every_role_may_comment(client, admin_secret):
    con = connect()
    roles = {r for (r,) in con.execute("SELECT id FROM role")}
    assert {r for (r,) in con.execute("SELECT role FROM role_has_access WHERE access = 'comment'")} == roles
    assert con.execute("SELECT en, fr FROM translation WHERE id = 'access.comment.name'").fetchone() == (
        "Comment",
        "Commentaire",
    )


def test_last_modified_first_with_author(admin):
    con = connect()
    with con:  # a user without display name: shown by username
        kenji = con.execute("INSERT INTO user (username, role) VALUES ('kenji', 'user')").lastrowid
    add_comment(KOKU, 1, "2026-01-05T09:00:00+01:00", "First")
    add_comment(KOKU, kenji, "2026-03-05T09:00:00+01:00", "Newest", lang="fr")
    add_comment(KOKU, 1, "2026-02-05T09:00:00+00:00", "Middle")
    # 09:00 in Tokyo is midnight UTC: the oldest of the three, although its text sorts first.
    add_comment(KOKU, 1, "2026-02-05T01:00:00+00:00", "01:00 UTC")
    add_comment(KOKU, kenji, "2026-02-05T09:00:00+09:00", "09:00 Tokyo")
    add_comment(KETO, 1, "2026-05-05T09:00:00+02:00", "Other technique")
    # Written first, edited last: on top.
    add_comment(KOKU, kenji, "2025-12-01T09:00:00+01:00", "Edited", modified_at="2026-04-01T09:00:00+02:00")

    r = admin.get(COMMENTS)
    assert r.status_code == 200
    assert [(c["id"], c["user"], c["text"], c["mine"]) for c in r.json()] == [
        (7, "kenji", "Edited", False),
        (2, "kenji", "Newest", False),
        (3, "Admin", "Middle", True),
        (4, "Admin", "01:00 UTC", True),
        (5, "kenji", "09:00 Tokyo", False),
        (1, "Admin", "First", True),
    ]
    assert r.json()[0] == {
        "id": 7,
        "user": "kenji",
        "created_at": "2025-12-01T09:00:00+01:00",
        "modified_at": "2026-04-01T09:00:00+02:00",
        "lang": "en",
        "text": "Edited",
        "mine": False,
    }


def test_no_comments(admin):
    assert admin.get("/api/techniques/gyokko.taijutsu.jo_ryaku.hanebi/comments").json() == []


def test_unknown_technique(admin):
    assert admin.get("/api/techniques/nope/comments").status_code == 404
    assert admin.post("/api/techniques/nope/comments", json={"text": "Hi", "lang": "en"}).status_code == 404


def test_add_edit_delete_own(admin, monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 23, 10, 0, tzinfo=UTC))
    r = admin.post(
        COMMENTS,
        json={"text": "  Keep the elbow low.\nThen turn.  ", "lang": "en"},
        headers={"Time-Zone": "Europe/Zurich"},
    )
    assert r.status_code == 201
    comment = r.json()
    assert comment == {
        "id": comment["id"],
        "user": "Admin",
        "created_at": "2026-10-23T12:00:00+02:00",
        "modified_at": "2026-10-23T12:00:00+02:00",
        "lang": "en",
        "text": "Keep the elbow low.\nThen turn.",
        "mine": True,
    }  # trimmed, line breaks kept
    assert admin.get(COMMENTS).json() == [comment]

    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 10, 24, 8, 30, tzinfo=UTC))
    r = admin.patch(
        f"/api/comments/{comment['id']}",
        json={"text": "Coude bas.", "lang": "fr"},
        headers={"Time-Zone": "Europe/Zurich"},
    )
    assert r.status_code == 200
    assert r.json() == {**comment, "text": "Coude bas.", "lang": "fr", "modified_at": "2026-10-24T10:30:00+02:00"}

    assert admin.delete(f"/api/comments/{comment['id']}").status_code == 204
    assert admin.get(COMMENTS).json() == []
    assert admin.delete(f"/api/comments/{comment['id']}").status_code == 404
    assert admin.patch(f"/api/comments/{comment['id']}", json={"text": "x", "lang": "en"}).status_code == 404


def test_only_the_author_edits_or_deletes(admin, kenji, caplog):
    mine = admin.post(COMMENTS, json={"text": "Admin's", "lang": "en"}).json()
    his = kenji.post(COMMENTS, json={"text": "Kenji's", "lang": "fr"}).json()
    assert his["user"] == "Kenji" and his["mine"] is True
    # Each sees which ones are theirs.
    assert {c["text"]: c["mine"] for c in admin.get(COMMENTS).json()} == {"Admin's": True, "Kenji's": False}
    assert {c["text"]: c["mine"] for c in kenji.get(COMMENTS).json()} == {"Admin's": False, "Kenji's": True}

    # Not even an admin changes someone else's comment.
    assert admin.patch(f"/api/comments/{his['id']}", json={"text": "Changed", "lang": "en"}).status_code == 403
    assert admin.delete(f"/api/comments/{his['id']}").status_code == 403
    assert kenji.delete(f"/api/comments/{mine['id']}").status_code == 403
    assert "comment.denied" in caplog.text
    assert {c["text"] for c in admin.get(COMMENTS).json()} == {"Admin's", "Kenji's"}


def test_needs_the_comment_access(admin, kenji):
    his = kenji.post(COMMENTS, json={"text": "Kenji's", "lang": "en"}).json()
    con = connect()
    with con:
        con.execute("DELETE FROM role_has_access WHERE role = 'user' AND access = 'comment'")
    assert kenji.get(COMMENTS).status_code == 200  # reading needs no access
    assert kenji.post(COMMENTS, json={"text": "More", "lang": "en"}).status_code == 403
    assert kenji.patch(f"/api/comments/{his['id']}", json={"text": "x", "lang": "en"}).status_code == 403
    assert kenji.delete(f"/api/comments/{his['id']}").status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"text": "", "lang": "en"},
        {"text": "   \n  ", "lang": "en"},
        {"text": "x" * 4001, "lang": "en"},
        {"text": "Hi", "lang": "de"},
        {"text": "Hi"},
        {"lang": "en"},
    ],
)
def test_invalid_comments(admin, body):
    assert admin.post(COMMENTS, json=body).status_code == 422


def test_longest_comment_accepted(admin):
    assert admin.post(COMMENTS, json={"text": "x" * 4000, "lang": "en"}).status_code == 201


def test_comment_gone_right_after_writing(admin, monkeypatch):
    """Never in practice (same transaction), but answered as an unknown comment."""
    monkeypatch.setattr(queries.comments, "comment", lambda con, comment_id, user_id: None)
    r = admin.post(COMMENTS, json={"text": "Hello", "lang": "en"})
    assert (r.status_code, r.json()["code"]) == (404, "comment.unknown")
