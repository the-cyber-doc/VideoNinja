import sqlite3

from app import db

from .test_auth import login


def add_comment(technique, user_id, created_s, text, lang="en"):
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO comment (technique, user, lang, text, created_s) VALUES (?, ?, ?, ?, ?)",
                    (technique, user_id, lang, text, created_s))


def test_requires_login(client, admin_secret):
    assert client.get("/api/techniques/gyokko.koku/comments").status_code == 401


def test_newest_first_with_author(client, admin_secret):
    login(client, admin_secret)
    con = sqlite3.connect(db.db_path())
    with con:  # a user without display name: shown by username
        kenji = con.execute("INSERT INTO user (username, role) VALUES ('kenji', 'user')").lastrowid
    add_comment("gyokko.koku", 1, 1000, "First")
    add_comment("gyokko.koku", kenji, 3000, "Newest", lang="fr")
    add_comment("gyokko.koku", 1, 2000, "Middle")
    add_comment("gyokko.keto", 1, 5000, "Other technique")

    r = client.get("/api/techniques/gyokko.koku/comments")
    assert r.status_code == 200
    assert r.json() == [
        {"id": 2, "user": "kenji", "created_s": 3000, "lang": "fr", "text": "Newest"},
        {"id": 3, "user": "Admin", "created_s": 2000, "lang": "en", "text": "Middle"},
        {"id": 1, "user": "Admin", "created_s": 1000, "lang": "en", "text": "First"},
    ]


def test_no_comments(client, admin_secret):
    login(client, admin_secret)
    assert client.get("/api/techniques/gyokko.hanebi/comments").json() == []


def test_unknown_technique(client, admin_secret):
    login(client, admin_secret)
    assert client.get("/api/techniques/nope/comments").status_code == 404
