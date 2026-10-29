"""About: the database version, for every logged-in user."""

import sqlite3

from app.core import db

from .test_auth import login


def test_needs_session(client, admin_secret):
    assert client.get("/api/about").status_code == 401


def test_database_version(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    expected = db.EXPECTED_VERSION
    assert client.get("/api/about").json() == {"db_version": expected, "db_schema": expected}

    # Another version (migrated at the next start): said as it is.
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("UPDATE config SET value = '0' WHERE name = 'db_version'")
    con.close()
    assert client.get("/api/about").json() == {"db_version": 0, "db_schema": expected}
