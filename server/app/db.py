import logging
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


from . import crypto, queries, settings
from .errors import ApiError

log = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent.parent / "database"
MIGRATIONS_DIR = SQL_DIR / "migrations"
# The database version this release runs on (config.db_version). A new database is
# built from db_v<N>.sql + db_v<N>_init.sql; an existing one of another version is
# migrated at startup (migrate), one version at a time: migrations/v<a>_to_v<b>.sql.
EXPECTED_VERSION = 3


def db_path() -> Path:
    return settings.current().db


def is_initialized() -> bool:
    return db_path().exists()


class Connection(sqlite3.Connection):
    """Autocommit: each statement is its own transaction unless the caller opens one
    with write() or read(). `with con:` would then do nothing (commit and rollback
    are no-ops in autocommit mode): refused, so no block is left silently
    without a transaction."""

    def __enter__(self):
        raise TypeError("Use db.write(con) or db.read(con), not `with con:`")


def connect(path: Path | None = None, create: bool = False) -> sqlite3.Connection:
    path = (path or db_path()).resolve()
    # mode=rw: never create the file by accident (its existence means "initialized").
    target = str(path) if create else path.as_uri() + "?mode=rw"
    con = sqlite3.connect(target, uri=not create, check_same_thread=False, autocommit=True, factory=Connection)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


@contextmanager
def write(con: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """One write transaction: BEGIN IMMEDIATE takes the write lock at once (waiting
    up to busy_timeout), so the reads inside see the data the writes change, and a
    read never has to be upgraded to a write later (with WAL, that fails at once,
    SQLITE_BUSY, when another connection, e.g. the encoder's, wrote meanwhile).
    Committed at the end, rolled back on any exception. Keep slow work (Argon2,
    ffmpeg, network) out of it: other writers wait meanwhile."""
    con.execute("BEGIN IMMEDIATE")
    try:
        yield con
    except BaseException:
        if con.in_transaction:  # SQLite may have rolled back already (e.g. disk full)
            con.execute("ROLLBACK")
        raise
    con.execute("COMMIT")


@contextmanager
def read(con: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Several reads from one snapshot of the database (no write lock): what a
    concurrent write commits meanwhile is either entirely seen or not at all."""
    con.execute("BEGIN DEFERRED")
    try:
        yield con
    finally:
        if con.in_transaction:
            con.execute("ROLLBACK")  # nothing to commit


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """A connection of its own (not a request: the encoder), in one write transaction,
    then closed."""
    con = connect()
    try:
        with write(con):
            yield con
    finally:
        con.close()


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request."""
    if not is_initialized():
        raise ApiError("setup.required")
    con = connect()
    try:
        yield con
    finally:
        con.close()


def scripts(version: int | None = None) -> tuple[Path, Path]:
    """db_v<version>.sql (schema) and db_v<version>_init.sql (data); default EXPECTED_VERSION
    (read at the call, not bound when the module was imported)."""
    version = EXPECTED_VERSION if version is None else version
    schema, seed = SQL_DIR / f"db_v{version}.sql", SQL_DIR / f"db_v{version}_init.sql"
    if not (schema.is_file() and seed.is_file()):
        raise RuntimeError(f"Database version {version}: {schema.name} or {seed.name} missing in {SQL_DIR}")
    return schema, seed


def version(con: sqlite3.Connection) -> int:
    """The database's own version (config.db_version; 0 if unknown)."""
    try:
        value = queries.config.config_value(con, "db_version")
    except sqlite3.OperationalError:  # no config table
        return 0
    return int(value) if value and value.isdigit() else 0


def current_version() -> int | None:
    """The version of the database file; None before the setup."""
    if not is_initialized():
        return None
    con = connect()
    try:
        return version(con)
    finally:
        con.close()


def migration(start: int, end: int) -> Path:
    path = MIGRATIONS_DIR / f"v{start}_to_v{end}.sql"
    if not path.is_file():
        raise RuntimeError(f"Database version {start}, this release needs {EXPECTED_VERSION}: no {path.name}")
    return path


def migrate() -> None:
    """Bring the database to EXPECTED_VERSION (at startup, before any request), one
    version at a time, up or down. A copy is kept first, next to it:
    <name>.v<old version>-<time>.bak. Each step is one transaction (the scripts'
    BEGIN … COMMIT). Refuses (RuntimeError, the app does not start) when a step's
    script is missing or did not set the version: never runs on another schema."""
    if not is_initialized():
        return
    con = connect()
    try:
        start = version(con)
        if start == EXPECTED_VERSION:
            return
        if start == 0:
            raise RuntimeError("The database has no version (config.db_version): not migrated")
        step = 1 if EXPECTED_VERSION > start else -1
        steps = [migration(v, v + step) for v in range(start, EXPECTED_VERSION, step)]  # all present first
        backup = db_path().with_name(f"{db_path().name}.v{start}-{_stamp()}.bak")
        target = sqlite3.connect(backup)
        try:
            con.backup(target)
        finally:
            target.close()
        log.warning("Database version %s, this release needs %s: migrating (copy kept: %s)",
                    start, EXPECTED_VERSION, backup.name)
        for script, end in zip(steps, range(start + step, EXPECTED_VERSION + step, step)):
            con.executescript(script.read_text(encoding="utf-8"))
            if version(con) != end:
                raise RuntimeError(f"{script.name} did not set the database version to {end}")
            log.warning("Database migrated to version %s (%s)", end, script.name)
    finally:
        con.close()


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def create_database(username: str, name: str, pw_hash: str, totp_secret: str) -> Iterator[str]:
    """Build the database in a temporary file, then move it into place atomically.

    Yields the name of each completed step. A failure leaves no database behind.
    """
    final = db_path()
    tmp = final.with_name(final.name + ".tmp")
    tmp.unlink(missing_ok=True)
    try:
        schema, seed = scripts()
        con = connect(tmp, create=True)
        try:
            con.executescript(schema.read_text(encoding="utf-8"))
            yield "schema"
            con.executescript(seed.read_text(encoding="utf-8"))
            yield "data"
            with write(con):
                user_id = queries.users.insert_user(con, username, "admin", name, pw_hash)
                # Encrypted with the row's ID as associated data, so the ID must exist first.
                queries.users.set_user_totp(con, user_id, crypto.encrypt(totp_secret, crypto.totp_aad(user_id)))
            yield "admin"
            con.execute("PRAGMA journal_mode = WAL")
        finally:
            con.close()
        # link() fails if the target exists: never overwrite an existing database.
        os.link(tmp, final)
        yield "done"
    finally:
        tmp.unlink(missing_ok=True)
