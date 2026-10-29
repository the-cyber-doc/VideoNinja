"""Connections and transactions (db.connect, db.write, db.read): autocommit outside
an explicit transaction, writes serialised from their first read, never half done."""

import re
import sqlite3
import threading
import time

import pytest

from app.core import db


@pytest.fixture
def path(tmp_path):
    """A WAL database with one counter, as the app's (API and encoder share it)."""
    path = tmp_path / "test.db"
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("CREATE TABLE counter (n INTEGER NOT NULL)")
    con.execute("INSERT INTO counter VALUES (0)")
    con.commit()
    con.close()
    return path


def count(path) -> int:
    con = sqlite3.connect(path)
    try:
        return con.execute("SELECT n FROM counter").fetchone()[0]
    finally:
        con.close()


def test_with_con_is_refused(path):
    """In autocommit mode `with con:` would commit nothing and roll nothing back."""
    con = db.connect(path)
    try:
        with pytest.raises(TypeError, match=re.escape("db.write")), con:
            pass
    finally:
        con.close()


def test_write_commits(path):
    con = db.connect(path)
    try:
        with db.write(con):
            con.execute("UPDATE counter SET n = 1")
        assert not con.in_transaction
    finally:
        con.close()
    assert count(path) == 1


def test_write_rolls_back_on_error(path):
    """An error in the middle (e.g. a 4xx after the first writes) leaves nothing behind."""
    con = db.connect(path)
    try:
        with pytest.raises(RuntimeError), db.write(con):
            con.execute("UPDATE counter SET n = 1")
            con.execute("INSERT INTO counter VALUES (2)")
            raise RuntimeError("refused")
        assert not con.in_transaction
    finally:
        con.close()
    assert count(path) == 0


def test_read_is_one_snapshot(path):
    """What another connection commits during a read() is not seen half-way."""
    con, other = db.connect(path), db.connect(path)
    try:
        with db.read(con):
            before = con.execute("SELECT n FROM counter").fetchone()[0]
            with db.write(other):
                other.execute("UPDATE counter SET n = 5")
            assert con.execute("SELECT n FROM counter").fetchone()[0] == before == 0
        assert not con.in_transaction
        assert con.execute("SELECT n FROM counter").fetchone()[0] == 5
    finally:
        con.close()
        other.close()


def test_concurrent_read_modify_write(path):
    """Each writer reads then writes (as the annotations save does), several at
    once on their own connections (API requests, the encoder): none fails with
    SQLITE_BUSY and no update is lost."""
    writers = 8
    errors: list[BaseException] = []
    start = threading.Barrier(writers)

    def increment():
        con = db.connect(path)
        try:
            start.wait()
            with db.write(con):
                n = con.execute("SELECT n FROM counter").fetchone()[0]
                time.sleep(0.02)  # the others try meanwhile
                con.execute("UPDATE counter SET n = ?", (n + 1,))
        except BaseException as e:
            errors.append(e)
        finally:
            con.close()

    threads = [threading.Thread(target=increment) for _ in range(writers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert count(path) == writers
