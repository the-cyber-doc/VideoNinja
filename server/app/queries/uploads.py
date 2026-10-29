"""tus uploads, from creation until the encoder deletes the original."""

import sqlite3

from .rows import one

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def insert_upload(
    con: sqlite3.Connection, tus_id: str, user_id: int, original_sha256: str, size: int, now: str
) -> None:
    con.execute(
        'INSERT INTO "upload" ("tus_id", "user", "original_sha256", "size", "created_at") VALUES (?, ?, ?, ?, ?)',
        (tus_id, user_id, original_sha256, size, now),
    )


def upload(con: sqlite3.Connection, tus_id: str) -> sqlite3.Row | None:
    return one(
        con.execute(
            'SELECT "tus_id", "user", "original_sha256", "size", "state" FROM "upload" WHERE "tus_id" = ?',
            (tus_id,),
        )
    )


def set_upload_state(con: sqlite3.Connection, tus_id: str, state: str) -> None:
    con.execute('UPDATE "upload" SET "state" = ? WHERE "tus_id" = ?', (state, tus_id))


def delete_upload(con: sqlite3.Connection, tus_id: str) -> None:
    con.execute('DELETE FROM "upload" WHERE "tus_id" = ?', (tus_id,))


def expire_uploads(con: sqlite3.Connection, created_before: str) -> None:
    """Uploads abandoned (never finished) or never submitted: their files go."""
    con.execute(
        'UPDATE "upload" SET "state" = \'deleted\''
        " WHERE \"state\" IN ('uploading', 'finished') AND datetime(\"created_at\") < datetime(?)"
        ' AND "tus_id" NOT IN (SELECT "upload" FROM "video" WHERE "upload" IS NOT NULL)',
        (created_before,),
    )


def deleted_uploads(con: sqlite3.Connection) -> list[str]:
    rows = con.execute('SELECT "tus_id" FROM "upload" WHERE "state" = \'deleted\' ORDER BY "id"')
    return [r[0] for r in rows]
