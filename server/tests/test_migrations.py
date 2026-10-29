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
    """Tables, their columns, indexes and foreign keys: what a migration must reproduce."""
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
