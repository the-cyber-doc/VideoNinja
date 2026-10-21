import os
import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from fastapi import HTTPException, status

from . import crypto

SQL_DIR = Path(__file__).resolve().parent.parent / "database"
DEFAULT_DB = "/data/videoninja.db"


def db_path() -> Path:
    return Path(os.environ.get("VIDEONINJA_DB", DEFAULT_DB))


def is_initialized() -> bool:
    return db_path().exists()


def connect(path: Path | None = None, create: bool = False) -> sqlite3.Connection:
    path = (path or db_path()).resolve()
    # mode=rw: never create the file by accident (its existence means "initialized").
    target = str(path) if create else path.as_uri() + "?mode=rw"
    con = sqlite3.connect(target, uri=not create, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request."""
    if not is_initialized():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Setup required")
    con = connect()
    try:
        yield con
    finally:
        con.close()


def latest_scripts() -> tuple[int, Path, Path]:
    """Highest N for which both db_vN.sql (schema) and init_db_vN.sql (data) exist."""
    versions = {
        int(m.group(1))
        for f in SQL_DIR.glob("db_v*.sql")
        if (m := re.fullmatch(r"db_v(\d+)\.sql", f.name))
    }
    for version in sorted(versions, reverse=True):
        seed = SQL_DIR / f"init_db_v{version}.sql"
        if seed.exists():
            return version, SQL_DIR / f"db_v{version}.sql", seed
    raise RuntimeError(f"no db_vN.sql + init_db_vN.sql pair in {SQL_DIR}")


def create_database(username: str, name: str, pw_hash: str, totp_secret: str) -> Iterator[str]:
    """Build the database in a temporary file, then move it into place atomically.

    Yields the name of each completed step. A failure leaves no database behind.
    """
    final = db_path()
    tmp = final.with_name(final.name + ".tmp")
    tmp.unlink(missing_ok=True)
    try:
        _, schema, seed = latest_scripts()
        con = connect(tmp, create=True)
        try:
            con.executescript(schema.read_text(encoding="utf-8"))
            yield "schema"
            con.executescript(seed.read_text(encoding="utf-8"))
            yield "data"
            with con:
                user_id = con.execute(
                    'INSERT INTO "user" ("username", "name", "pw_hash", "role") VALUES (?, ?, ?, ?)',
                    (username, name, pw_hash, "admin"),
                ).lastrowid
                # Encrypted with the row's ID as associated data, so the ID must exist first.
                con.execute(
                    'UPDATE "user" SET "totp" = ? WHERE "id" = ?',
                    (crypto.encrypt(totp_secret, crypto.totp_aad(user_id)), user_id),
                )
            yield "admin"
            con.execute("PRAGMA journal_mode = WAL")
        finally:
            con.close()
        # link() fails if the target exists: never overwrite an existing database.
        os.link(tmp, final)
        yield "done"
    finally:
        tmp.unlink(missing_ok=True)
