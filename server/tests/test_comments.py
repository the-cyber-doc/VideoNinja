import sqlite3

from app import db

from .test_auth import login


def add_comment(technique, user_id, created_at, text, lang="en"):
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO comment (technique, user, lang, text, created_at) VALUES (?, ?, ?, ?, ?)",
                    (technique, user_id, lang, text, created_at))


def test_requires_login(client, admin_secret):
    assert client.get("/api/techniques/gyokko.koku/comments").status_code == 401


def test_newest_first_with_author(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:  # a user without display name: shown by username
        kenji = con.execute("INSERT INTO user (username, role) VALUES ('kenji', 'user')").lastrowid
    add_comment("gyokko.koku", 1, "2026-01-05T09:00:00+01:00", "First")
    add_comment("gyokko.koku", kenji, "2026-03-05T09:00:00+01:00", "Newest", lang="fr")
    add_comment("gyokko.koku", 1, "2026-02-05T09:00:00+00:00", "Middle")
    # 09:00 in Tokyo is midnight UTC: the oldest of the three, although its text sorts first.
    add_comment("gyokko.koku", 1, "2026-02-05T01:00:00+00:00", "01:00 UTC")
    add_comment("gyokko.koku", kenji, "2026-02-05T09:00:00+09:00", "09:00 Tokyo")
    add_comment("gyokko.keto", 1, "2026-05-05T09:00:00+02:00", "Other technique")

    r = client.get("/api/techniques/gyokko.koku/comments")
    assert r.status_code == 200
    assert r.json() == [
        {"id": 2, "user": "kenji", "created_at": "2026-03-05T09:00:00+01:00", "lang": "fr", "text": "Newest"},
        {"id": 3, "user": "Admin", "created_at": "2026-02-05T09:00:00+00:00", "lang": "en", "text": "Middle"},
        {"id": 4, "user": "Admin", "created_at": "2026-02-05T01:00:00+00:00", "lang": "en",
         "text": "01:00 UTC"},
        {"id": 5, "user": "kenji", "created_at": "2026-02-05T09:00:00+09:00", "lang": "en",
         "text": "09:00 Tokyo"},
        {"id": 1, "user": "Admin", "created_at": "2026-01-05T09:00:00+01:00", "lang": "en", "text": "First"},
    ]


def test_no_comments(client, admin_secret):
    login(client, admin_secret)
    assert client.get("/api/techniques/gyokko.hanebi/comments").json() == []


def test_unknown_technique(client, admin_secret):
    login(client, admin_secret)
    assert client.get("/api/techniques/nope/comments").status_code == 404
