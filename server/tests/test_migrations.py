"""Database versions: built from db_v<N>.sql + db_v<N>_init.sql, migrated at startup
(migrations/v<a>_to_v<b>.sql) to the version this release runs on, up or down."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.core import db
from app.main import app

from .conftest import run_setup


def build(path, version):
    """A database as the setup of a release on that version made it (no admin needed here)."""
    con = sqlite3.connect(path)
    for script in db.scripts(version):
        con.executescript(script.read_text(encoding="utf-8"))
    con.close()


def schema(path):
    """Tables, their columns, indexes, foreign keys, triggers and virtual tables: what a migration must reproduce."""
    con = sqlite3.connect(path)
    tables = [t for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
    out = {
        t: (
            con.execute(f'PRAGMA table_info("{t}")').fetchall(),
            sorted(
                (name, unique, origin, partial, con.execute(f'PRAGMA index_info("{name}")').fetchall())
                for _, name, unique, origin, partial in con.execute(f'PRAGMA index_list("{t}")')
            ),
            con.execute(f'PRAGMA foreign_key_list("{t}")').fetchall(),
        )
        for t in tables
    }
    # Triggers and virtual tables (the search's FTS5 indexes): their definitions.
    out["sqlite_master"] = con.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE type = 'trigger' OR sql LIKE 'CREATE VIRTUAL%' ORDER BY name"
    ).fetchall()
    con.close()
    return out


def sql(path, query, *args):
    con = sqlite3.connect(path)
    with con:
        rows = con.execute(query, args).fetchall()
    con.close()
    return rows


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / "videoninja.db"
    monkeypatch.setenv("VIDEONINJA_DB", str(path))
    return path


def test_every_version_has_its_scripts():
    for version in range(1, db.EXPECTED_VERSION + 1):
        db.scripts(version)
        if version > 1:
            db.migration(version - 1, version)
            db.migration(version, version - 1)


def test_up_then_down_as_if_built_so(database, tmp_path, monkeypatch):
    """v1 → v2 gives what v2's scripts build, and back to what v1's build. Data kept."""
    build(database, 1)
    sql(
        database,
        "INSERT INTO video (sha256sum, original_sha256, original_filename, uploaded_at, status)"
        " VALUES ('a', 'b', 'kata.mp4', '2026-01-01T00:00:00Z', 'published')",
    )
    fresh = {v: tmp_path / f"fresh-v{v}.db" for v in (1, 2)}
    for v, path in fresh.items():
        build(path, v)

    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    db.migrate()
    assert db.current_version() == 2
    assert schema(database) == schema(fresh[2])
    assert sql(database, "SELECT original_filename, thumbs_dirty FROM video") == [("kata.mp4", 0)]
    backups = list(tmp_path.glob("videoninja.db.v1-*.bak"))
    assert len(backups) == 1 and schema(backups[0]) == schema(fresh[1])  # the copy, before

    sql(database, "INSERT INTO heartbeat (name, at) VALUES ('encoder', '2026-01-01T00:00:00Z')")
    monkeypatch.setattr(db, "EXPECTED_VERSION", 1)  # an older release started on it
    db.migrate()
    assert db.current_version() == 1
    assert schema(database) == schema(fresh[1])
    assert sql(database, "SELECT original_filename FROM video") == [("kata.mp4",)]


@pytest.mark.parametrize("version", range(2, db.EXPECTED_VERSION + 1))
def test_each_step_as_if_built_so(database, tmp_path, monkeypatch, version):
    """Every step, up then down: the schema (tables, columns, indexes, foreign keys)
    its scripts build, and the data kept."""
    build(database, version - 1)
    sql(
        database,
        "INSERT INTO video (original_sha256, original_filename, uploaded_at)"
        " VALUES ('b', 'kata.mp4', '2026-01-01T00:00:00Z')",
    )
    fresh = {v: tmp_path / f"fresh-v{v}.db" for v in (version - 1, version)}
    for v, path in fresh.items():
        build(path, v)

    monkeypatch.setattr(db, "EXPECTED_VERSION", version)
    db.migrate()
    assert db.current_version() == version
    assert schema(database) == schema(fresh[version])

    monkeypatch.setattr(db, "EXPECTED_VERSION", version - 1)
    db.migrate()
    assert db.current_version() == version - 1
    assert schema(database) == schema(fresh[version - 1])
    assert sql(database, "SELECT original_filename FROM video") == [("kata.mp4",)]


def test_nothing_done_on_the_expected_version(database, tmp_path):
    build(database, db.EXPECTED_VERSION)
    db.migrate()
    assert not list(tmp_path.glob("*.bak"))


def test_no_way_there_refuses_to_start(database, tmp_path, monkeypatch):
    """A step without its script: nothing changed (not even half-way), and the app does not start."""
    build(database, 1)
    latest = db.EXPECTED_VERSION
    monkeypatch.setattr(db, "EXPECTED_VERSION", latest + 1)
    with pytest.raises(RuntimeError, match=f"v{latest}_to_v{latest + 1}.sql"):
        db.migrate()
    assert db.current_version() == 1
    assert not list(tmp_path.glob("*.bak"))
    with pytest.raises(RuntimeError), TestClient(app):
        pass


def test_a_failing_step_leaves_its_version(database, tmp_path, monkeypatch):
    """A script that fails half-way is rolled back (BEGIN … COMMIT): still the old version."""
    build(database, 1)
    broken = tmp_path / "migrations"
    broken.mkdir()
    (broken / "v1_to_v2.sql").write_text(
        'BEGIN; CREATE TABLE "heartbeat" ("name" VARCHAR); ALTER TABLE "nope" ADD COLUMN "x" INTEGER; COMMIT;'
    )
    monkeypatch.setattr(db, "MIGRATIONS_DIR", broken)
    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    with pytest.raises(sqlite3.OperationalError):
        db.migrate()
    assert db.current_version() == 1
    assert sql(database, "SELECT count(*) FROM sqlite_master WHERE name = 'heartbeat'") == [(0,)]


def test_the_app_migrates_at_startup(database):
    """A database of the previous release: migrated before the first request."""
    build(database, db.EXPECTED_VERSION - 1)
    with TestClient(app, base_url="https://testserver"):
        assert db.current_version() == db.EXPECTED_VERSION


def test_a_new_setup_is_on_the_expected_version(client):
    run_setup(client)
    assert db.current_version() == db.EXPECTED_VERSION


def test_step_that_does_not_set_the_version_refused(tmp_path, monkeypatch):
    """A script that ran but left the version as it was: no start on an unknown schema."""
    build(tmp_path / "videoninja.db", db.EXPECTED_VERSION - 1)
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    steps = tmp_path / "migrations"
    steps.mkdir()
    (steps / f"v{db.EXPECTED_VERSION - 1}_to_v{db.EXPECTED_VERSION}.sql").write_text("BEGIN; COMMIT;")
    monkeypatch.setattr(db, "MIGRATIONS_DIR", steps)
    with pytest.raises(RuntimeError, match="did not set the database version"):
        db.migrate()


def test_v3_brings_the_moderator_access(database, monkeypatch):
    """v2 → v3 gives admins the "moderator" access, as v3's scripts do; v3 → v2 removes it."""
    build(database, 2)
    monkeypatch.setattr(db, "EXPECTED_VERSION", 3)
    db.migrate()
    assert sql(database, "SELECT role FROM role_has_access WHERE access = 'moderator'") == [("admin",)]
    assert sql(database, "SELECT name FROM access WHERE id = 'moderator'") == [("access.moderator.name",)]

    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    db.migrate()
    assert sql(database, "SELECT count(*) FROM role_has_access WHERE access = 'moderator'") == [(0,)]
    assert sql(database, "SELECT count(*) FROM access WHERE id = 'moderator'") == [(0,)]
    assert sql(database, "SELECT count(*) FROM translation WHERE id = 'access.moderator.name'") == [(0,)]


def test_v3_brings_the_deleted_user(database, monkeypatch):
    """v2 → v3 adds the deleted user (id 0); v3 → v2 keeps it while comments point to it."""
    build(database, 2)
    monkeypatch.setattr(db, "EXPECTED_VERSION", 3)
    db.migrate()
    assert sql(database, "SELECT id, username FROM user") == [(0, "#deleted")]
    sql(
        database,
        "INSERT INTO video (original_sha256, original_filename, uploaded_at, uploaded_by)"
        " VALUES ('b', 'kata.mp4', '2026-01-01T00:00:00Z', 0)",
    )
    sql(
        database,
        "INSERT INTO comment (technique, user, lang, text, created_at, modified_at)"
        " VALUES ('gyokko.taijutsu.jo_ryaku.koku', 0, 'en', 'Kept', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )

    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    db.migrate()
    assert sql(database, "SELECT uploaded_by FROM video") == [(None,)]
    assert sql(database, "SELECT user, text FROM comment") == [(0, "Kept")]
    assert sql(database, "SELECT id FROM user") == [(0,)]


def test_v3_to_v2_removes_an_unused_deleted_user(database, monkeypatch):
    build(database, 3)
    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    db.migrate()
    assert sql(database, "SELECT count(*) FROM user") == [(0,)]


def test_v3_gives_tags_an_explicit_format(database, monkeypatch):
    """v2 → v3: fixed values → list, 'year' → its regexp + hint + numeric keyboard, any text
    → free; the "options" access for admins. v3 → v2 back to v2's formats."""
    build(database, 2)
    sql(database, "INSERT INTO translation (id, en) VALUES ('tag.note.name', 'Note')")
    sql(database, "INSERT INTO tag (id, name) VALUES ('note', 'tag.note.name')")
    sql(database, "INSERT INTO video (original_sha256, original_filename, uploaded_at) VALUES ('b', 'k.mp4', 'x')")
    sql(database, "INSERT INTO video_has_tags (video, tag, value) VALUES (1, 'year', '2024')")
    monkeypatch.setattr(db, "EXPECTED_VERSION", 3)
    db.migrate()
    rows = (
        "SELECT id, value_format, regexp, hint, input_mode FROM tag WHERE id IN ('country', 'note', 'year') ORDER BY id"
    )
    assert sql(database, rows) == [
        ("country", "list", None, None, "text"),
        ("note", "free", None, None, "text"),
        ("year", "regexp", "[12][0-9]{3}", "tag.year.hint", "numeric"),
    ]
    assert sql(database, "SELECT en, fr FROM translation WHERE id = 'tag.year.hint'") == [
        ("A year, e.g. 2024", "Une année, par ex. 2024")
    ]
    assert sql(database, "SELECT role FROM role_has_access WHERE access = 'options'") == [("admin",)]
    assert sql(database, "SELECT tag, value FROM video_has_tags") == [("year", "2024")]
    assert sql(database, "PRAGMA foreign_key_check") == []

    monkeypatch.setattr(db, "EXPECTED_VERSION", 2)
    db.migrate()
    rows = "SELECT id, value_format FROM tag WHERE id IN ('country', 'note', 'year') ORDER BY id"
    assert sql(database, rows) == [("country", None), ("note", None), ("year", "year")]
    assert sql(database, "SELECT count(*) FROM translation WHERE id IN ('tag.year.hint', 'access.options.name')") == [
        (0,)
    ]
    assert sql(database, "SELECT count(*) FROM role_has_access WHERE access = 'options'") == [(0,)]
    assert sql(database, "SELECT tag, value FROM video_has_tags") == [("year", "2024")]
    assert sql(database, "PRAGMA foreign_key_check") == []


def test_v4_brings_books_and_their_roles(database, monkeypatch):
    """v3 → v4: existing uploads are videos; the book_mgmt access for admins and two new roles.
    v4 → v3: their users get the closest v3 role, books and their uploads go."""
    build(database, 3)
    sql(database, "INSERT INTO user (id, username, role) VALUES (5, 'kenji', 'user')")
    sql(
        database,
        "INSERT INTO upload (tus_id, user, original_sha256, size, created_at) VALUES ('t1', 5, 'a', 1, 'x')",
    )
    monkeypatch.setattr(db, "EXPECTED_VERSION", 4)
    db.migrate()
    assert sql(database, "SELECT kind FROM upload") == [("video",)]
    accesses = "SELECT access FROM role_has_access WHERE role = ? ORDER BY access"
    assert sql(database, accesses, "book_mgmt") == [
        ("annotate",),
        ("book_mgmt",),
        ("comment",),
        ("segment",),
        ("upload",),
    ]
    assert sql(database, accesses, "content_mgmt") == sorted([*sql(database, accesses, "book_mgmt"), ("video_mgmt",)])
    assert sql(database, "SELECT role FROM role_has_access WHERE access = 'book_mgmt' ORDER BY role") == [
        ("admin",),
        ("book_mgmt",),
        ("content_mgmt",),
    ]

    sql(database, "INSERT INTO user (id, username, role) VALUES (6, 'aiko', 'book_mgmt'), (7, 'mei', 'content_mgmt')")
    sql(
        database,
        "INSERT INTO upload (tus_id, user, original_sha256, size, created_at, kind)"
        " VALUES ('t2', 6, 'b', 1, 'x', 'book')",
    )
    sql(
        database,
        "INSERT INTO book (sha256sum, original_filename, reference, uploaded_by, uploaded_at)"
        " VALUES ('c', 'densho.pdf', '{}', 6, 'x')",
    )
    sql(database, "INSERT INTO book_has_tags (book, tag, value) VALUES (1, 'year', '1950')")
    sql(
        database,
        "INSERT INTO book_annotation (book, page, kind, target, created_by, created_at, modified_at)"
        " VALUES (1, 3, 'text', '{}', 6, 'x', 'x')",
    )
    sql(
        database,
        "INSERT INTO book_comment (annotation, user, lang, text, created_at, modified_at)"
        " VALUES (1, 7, 'en', 'Seen', 'x', 'x')",
    )

    monkeypatch.setattr(db, "EXPECTED_VERSION", 3)
    db.migrate()
    assert sql(database, "SELECT username, role FROM user WHERE id > 0 ORDER BY id") == [
        ("kenji", "user"),
        ("aiko", "uploader"),
        ("mei", "video_mgmt"),
    ]
    assert sql(database, "SELECT tus_id, state FROM upload ORDER BY id") == [("t1", "uploading"), ("t2", "deleted")]
    assert sql(database, "SELECT count(*) FROM translation WHERE id LIKE '%book_mgmt%' OR id LIKE '%content%'") == [
        (0,)
    ]
    assert sql(database, "PRAGMA foreign_key_check") == []


def test_v5_brings_the_full_text_search(database, monkeypatch):
    """v4 → v5: existing annotations and comments indexed at once, the year tag bounded, the
    comments on book annotations gone; the triggers keep the indexes in step. v5 → v4: the page
    text goes, the comments on annotations come back empty, the bounds stay."""
    build(database, 4)
    sql(database, "INSERT INTO user (id, username, role) VALUES (5, 'kenji', 'user')")
    sql(
        database,
        "INSERT INTO book (sha256sum, original_filename, reference, uploaded_by, uploaded_at)"
        " VALUES ('c', 'densho.pdf', '{}', 5, 'x')",
    )
    sql(
        database,
        "INSERT INTO book_annotation (book, page, kind, target, quote, note, created_by, created_at, modified_at)"
        " VALUES (1, 3, 'text', '{}', 'Le dōjō', 'Kamae first', 5, 'x', 'x')",
    )
    sql(
        database,
        "INSERT INTO comment (technique, user, lang, text, created_at, modified_at)"
        " VALUES ('gyokko.taijutsu.jo_ryaku.koku', 5, 'en', 'Seen at the Daikomyosai', 'x', 'x')",
    )
    sql(
        database,
        "INSERT INTO book_comment (annotation, user, lang, text, created_at, modified_at)"
        " VALUES (1, 5, 'en', 'Also in the scroll', 'x', 'x')",
    )
    monkeypatch.setattr(db, "EXPECTED_VERSION", 5)
    db.migrate()
    assert sql(database, "SELECT rowid FROM book_annotation_fts WHERE book_annotation_fts MATCH '\"dojo\"'") == [(1,)]
    assert sql(database, "SELECT rowid FROM comment_fts WHERE comment_fts MATCH '\"komyo\"'") == [(1,)]
    assert sql(database, "SELECT name FROM sqlite_master WHERE name LIKE 'book_comment%'") == []
    assert sql(database, "SELECT min_value, max_value FROM tag WHERE id = 'year'") == [(1950, 2080)]
    assert sql(database, "SELECT text_pages FROM book") == [(None,)]

    # The triggers: new rows, changes and cascades.
    sql(database, "INSERT INTO book_page (book, page, text) VALUES (1, 2, '虚空の構え')")
    assert sql(database, "SELECT rowid FROM book_page_fts WHERE book_page_fts MATCH '\"虚空の\"'") == [(1,)]
    sql(database, "UPDATE book_page SET text = 'Ichimonji'")
    assert sql(database, "SELECT rowid FROM book_page_fts WHERE book_page_fts MATCH '\"虚空の\"'") == []
    assert sql(database, "SELECT rowid FROM book_page_fts WHERE book_page_fts MATCH '\"monji\"'") == [(1,)]
    sql(database, "UPDATE comment SET text = 'Changed'")
    assert sql(database, "SELECT rowid FROM comment_fts WHERE comment_fts MATCH '\"komyo\"'") == []
    sql(database, "UPDATE book_annotation SET note = 'Hicho'")
    assert sql(database, "SELECT rowid FROM book_annotation_fts WHERE book_annotation_fts MATCH '\"kamae\"'") == []
    sql(database, "DELETE FROM comment")
    con = sqlite3.connect(database)
    con.execute("PRAGMA foreign_keys = ON")
    with con:
        con.execute("DELETE FROM book")  # cascades: pages, annotations
    con.close()
    for table in ("book_page_fts", "book_annotation_fts", "comment_fts"):
        assert sql(database, f"INSERT INTO {table} ({table}) VALUES ('integrity-check')") == []
        assert sql(database, f"SELECT count(*) FROM {table}") == [(0,)]

    sql(database, "UPDATE tag SET min_value = 1900 WHERE id = 'year'")
    monkeypatch.setattr(db, "EXPECTED_VERSION", 4)
    db.migrate()
    assert sql(database, "SELECT min_value, max_value FROM tag WHERE id = 'year'") == [(1900, 2080)]
    assert sql(database, "SELECT count(*) FROM book_comment") == [(0,)]


@pytest.mark.parametrize(
    ("bounds", "stored", "expected"),
    [
        ((None, None), "1066", (None, None)),  # a stored year would fail the bounds: none given
        ((1000, None), "2024", (1000, None)),  # the admin's own: kept
        ((None, None), "2024", (1950, 2080)),
    ],
)
def test_v5_bounds_the_year_only_when_it_can(database, monkeypatch, bounds, stored, expected):
    build(database, 4)
    sql(database, "UPDATE tag SET min_value = ?, max_value = ? WHERE id = 'year'", *bounds)
    sql(
        database,
        "INSERT INTO video (original_sha256, original_filename, uploaded_at) VALUES ('b', 'k.mp4', 'x')",
    )
    sql(database, "INSERT INTO video_has_tags (video, tag, value) VALUES (1, 'year', ?)", stored)
    monkeypatch.setattr(db, "EXPECTED_VERSION", 5)
    db.migrate()
    assert sql(database, "SELECT min_value, max_value FROM tag WHERE id = 'year'") == [expected]
