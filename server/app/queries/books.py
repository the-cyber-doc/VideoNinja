"""Books: submitted, listed, deleted, published by the encoder; their tags."""

import sqlite3

from .rows import inserted, one
from .users import DELETED_USER_ID

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def book_known(con: sqlite3.Connection, sha256: str) -> bool:
    """A book (queued, failed or published) is this file."""
    return con.execute('SELECT 1 FROM "book" WHERE "sha256sum" = ?', (sha256,)).fetchone() is not None


def insert_book(
    con: sqlite3.Connection,
    sha256: str,
    original_filename: str,
    pages: int | None,
    reference: str,
    user_id: int,
    now: str,
    tus_id: str,
    thumbnail_tus_id: str | None,
) -> int:
    return inserted(
        con.execute(
            'INSERT INTO "book" ("sha256sum", "original_filename", "pages", "reference", "uploaded_by",'
            ' "uploaded_at", "upload", "thumbnail_upload") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (sha256, original_filename, pages, reference, user_id, now, tus_id, thumbnail_tus_id),
        )
    )


def insert_book_tag(con: sqlite3.Connection, book_id: int, tag: str, value: str | None) -> None:
    con.execute('INSERT INTO "book_has_tags" ("book", "tag", "value") VALUES (?, ?, ?)', (book_id, tag, value))


def book(con: sqlite3.Connection, book_id: int) -> sqlite3.Row | None:
    return one(
        con.execute(
            'SELECT "id", "status", "uploaded_by", "upload", "thumbnail_upload", "reference", "original_filename",'
            ' "pages", "thumbnail" IS NOT NULL AS "has_thumbnail" FROM "book" WHERE "id" = ?',
            (book_id,),
        )
    )


def books(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every book (queued, failed and published), newest upload first. uploaded_by: the
    uploader's display name (name, else username); None if unknown or deleted."""
    return con.execute(
        'SELECT b."id", b."original_filename", b."status", b."error", b."pages", b."reference",'
        ' b."uploaded_at", b."thumbnail" IS NOT NULL AS "has_thumbnail",'
        ' COALESCE(u."name", u."username") AS "uploaded_by"'
        ' FROM "book" b LEFT JOIN "user" u ON u."id" = b."uploaded_by" AND u."id" <> ?'
        ' ORDER BY datetime(b."uploaded_at") DESC, b."id" DESC',
        (DELETED_USER_ID,),
    ).fetchall()


def book_tags(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """The tags of every book (book, tag, value), by book then tag."""
    return con.execute('SELECT "book", "tag", "value" FROM "book_has_tags" ORDER BY "book", "tag"').fetchall()


def delete_book(con: sqlite3.Connection, book_id: int) -> None:
    """The book, its tags, annotations and their comments (ON DELETE CASCADE)."""
    con.execute('DELETE FROM "book" WHERE "id" = ?', (book_id,))


def published_book(con: sqlite3.Connection, book_id: int) -> sqlite3.Row | None:
    """A published book's folder (directory: "<h2>/<sha256>") and thumbnail file name."""
    return one(
        con.execute(
            'SELECT "sha256sum", "directory", "thumbnail" FROM "book" WHERE "id" = ? AND "status" = \'published\'',
            (book_id,),
        )
    )


# --- the encoder ---


def next_book(con: sqlite3.Connection) -> sqlite3.Row | None:
    """The oldest queued book, with its uploads."""
    return one(
        con.execute(
            'SELECT "id", "sha256sum", "upload", "thumbnail_upload", "attempts" FROM "book"'
            ' WHERE "status" = \'queued\' ORDER BY "id" LIMIT 1'
        )
    )


def count_attempt(con: sqlite3.Connection, book_id: int) -> None:
    con.execute('UPDATE "book" SET "attempts" = "attempts" + 1 WHERE "id" = ?', (book_id,))


def publish_book(con: sqlite3.Connection, book_id: int, directory: str, thumbnail: str | None) -> bool:
    """False if it is no longer queued (deleted meanwhile)."""
    return (
        con.execute(
            'UPDATE "book" SET "status" = \'published\', "directory" = ?, "thumbnail" = ?, "error" = NULL,'
            ' "upload" = NULL, "thumbnail_upload" = NULL'
            ' WHERE "id" = ? AND "status" = \'queued\'',
            (directory, thumbnail, book_id),
        ).rowcount
        == 1
    )


def fail_book(con: sqlite3.Connection, book_id: int, error: str) -> None:
    con.execute(
        'UPDATE "book" SET "status" = \'failed\', "error" = ? WHERE "id" = ? AND "status" = \'queued\'',
        (error, book_id),
    )


def set_reference(con: sqlite3.Connection, book_id: int, reference: str) -> None:
    con.execute('UPDATE "book" SET "reference" = ? WHERE "id" = ?', (reference, book_id))


def clear_book_tags(con: sqlite3.Connection, book_id: int) -> None:
    con.execute('DELETE FROM "book_has_tags" WHERE "book" = ?', (book_id,))


def set_thumbnail_upload(con: sqlite3.Connection, book_id: int, tus_id: str) -> str | None:
    """A published book's new first-page picture to publish; the upload it replaces, if any."""
    old = con.execute('SELECT "thumbnail_upload" FROM "book" WHERE "id" = ?', (book_id,)).fetchone()
    con.execute('UPDATE "book" SET "thumbnail_upload" = ? WHERE "id" = ?', (tus_id, book_id))
    return old[0] if old else None


def waiting_thumbnails(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Published books with a first-page picture uploaded and not published yet."""
    return con.execute(
        'SELECT "id", "directory", "thumbnail_upload" FROM "book"'
        ' WHERE "status" = \'published\' AND "thumbnail_upload" IS NOT NULL ORDER BY "id"'
    ).fetchall()


def publish_thumbnail(con: sqlite3.Connection, book_id: int, tus_id: str, name: str | None) -> bool:
    """The picture published (name) or given up (None); False if another one was uploaded meanwhile."""
    return (
        con.execute(
            'UPDATE "book" SET "thumbnail" = COALESCE(?, "thumbnail"), "thumbnail_upload" = NULL'
            ' WHERE "id" = ? AND "thumbnail_upload" = ?',
            (name, book_id, tus_id),
        ).rowcount
        == 1
    )


def tags_of(con: sqlite3.Connection, book_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "tag", "value" FROM "book_has_tags" WHERE "book" = ? ORDER BY "tag"', (book_id,)
    ).fetchall()


def listed_book(con: sqlite3.Connection, book_id: int) -> sqlite3.Row | None:
    """One book as the list has it (books())."""
    return one(
        con.execute(
            'SELECT b."id", b."original_filename", b."status", b."error", b."pages", b."reference",'
            ' b."uploaded_at", b."thumbnail" IS NOT NULL AS "has_thumbnail",'
            ' COALESCE(u."name", u."username") AS "uploaded_by"'
            ' FROM "book" b LEFT JOIN "user" u ON u."id" = b."uploaded_by" AND u."id" <> ? WHERE b."id" = ?',
            (DELETED_USER_ID, book_id),
        )
    )
