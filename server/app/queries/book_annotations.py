"""Annotations of books' pages: listed, written, their crop pictures (published by the encoder)."""

import sqlite3

from .rows import inserted, one
from .users import DELETED_USER_ID

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().

_COLUMNS = (
    'a."id", a."book", a."page", a."kind", a."target", a."quote", a."color", a."note", a."technique",'
    ' a."image" IS NOT NULL AS "has_image", a."created_at", a."modified_at",'
    ' COALESCE(u."name", u."username") AS "created_by", a."created_by" = ? AS "mine"'
)
_FROM = 'FROM "book_annotation" a LEFT JOIN "user" u ON u."id" = a."created_by" AND u."id" <> ?'


def annotations(con: sqlite3.Connection, book_id: int, me: int) -> list[sqlite3.Row]:
    """A book's annotations, by page then in the order they were made. created_by: the
    author's display name (None: unknown or deleted); mine: written by `me`."""
    return con.execute(
        f'SELECT {_COLUMNS} {_FROM} WHERE a."book" = ? ORDER BY a."page", a."id"',  # nosec B608 - constant columns
        (me, DELETED_USER_ID, book_id),
    ).fetchall()


def annotation(con: sqlite3.Connection, annotation_id: int, me: int) -> sqlite3.Row | None:
    return one(
        con.execute(
            f'SELECT {_COLUMNS}, a."created_by" AS "author", a."image", a."image_upload" {_FROM} WHERE a."id" = ?',  # nosec B608 - constant columns
            (me, DELETED_USER_ID, annotation_id),
        )
    )


def insert_annotation(
    con: sqlite3.Connection,
    book_id: int,
    page: int,
    kind: str,
    target: str,
    quote: str | None,
    color: str | None,
    note: str | None,
    technique: str | None,
    user_id: int,
    now: str,
) -> int:
    return inserted(
        con.execute(
            'INSERT INTO "book_annotation" ("book", "page", "kind", "target", "quote", "color", "note", "technique",'
            ' "created_by", "created_at", "modified_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (book_id, page, kind, target, quote, color, note, technique, user_id, now, now),
        )
    )


# Columns a change may set (the request names them; never formatted from input).
CHANGEABLE = ("page", "target", "quote", "color", "note", "technique")


def update_annotation(con: sqlite3.Connection, annotation_id: int, changes: dict[str, object], now: str) -> None:
    columns = [c for c in CHANGEABLE if c in changes]
    sets = "".join(f'"{c}" = ?, ' for c in columns)
    con.execute(
        f'UPDATE "book_annotation" SET {sets}"modified_at" = ? WHERE "id" = ?',  # nosec B608 - columns from CHANGEABLE
        (*(changes[c] for c in columns), now, annotation_id),
    )


def delete_annotation(con: sqlite3.Connection, annotation_id: int) -> None:
    """With its comments (ON DELETE CASCADE). The encoder deletes its picture (orphan_images)."""
    con.execute('DELETE FROM "book_annotation" WHERE "id" = ?', (annotation_id,))


def set_image_upload(con: sqlite3.Connection, annotation_id: int, tus_id: str) -> str | None:
    """Its new crop's upload; the one it replaces (its file to delete), if any."""
    old = con.execute('SELECT "image_upload" FROM "book_annotation" WHERE "id" = ?', (annotation_id,)).fetchone()
    con.execute('UPDATE "book_annotation" SET "image_upload" = ? WHERE "id" = ?', (tus_id, annotation_id))
    return old[0] if old else None


# --- the encoder ---


def waiting_images(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Crops uploaded and not published yet, with their book's folder (published books only)."""
    return con.execute(
        'SELECT a."id", a."image_upload", b."directory" FROM "book_annotation" a JOIN "book" b ON b."id" = a."book"'
        ' WHERE a."image_upload" IS NOT NULL AND b."status" = \'published\' ORDER BY a."id"'
    ).fetchall()


def publish_image(con: sqlite3.Connection, annotation_id: int, tus_id: str, name: str | None) -> bool:
    """The crop published (name) or given up (None); False if the annotation has another upload by now."""
    return (
        con.execute(
            'UPDATE "book_annotation" SET "image" = COALESCE(?, "image"), "image_upload" = NULL'
            ' WHERE "id" = ? AND "image_upload" = ?',
            (name, annotation_id, tus_id),
        ).rowcount
        == 1
    )


def images_in_use(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every published book's folder and the crop files its annotations use."""
    return con.execute(
        'SELECT b."directory", a."image" FROM "book" b LEFT JOIN "book_annotation" a'
        ' ON a."book" = b."id" AND a."image" IS NOT NULL'
        ' WHERE b."status" = \'published\' ORDER BY b."id"'
    ).fetchall()


def image_of(con: sqlite3.Connection, annotation_id: int) -> sqlite3.Row | None:
    """An annotation's crop and its book's folder, for /media (published books only)."""
    return one(
        con.execute(
            'SELECT b."sha256sum", a."image" FROM "book_annotation" a JOIN "book" b ON b."id" = a."book"'
            ' WHERE a."id" = ? AND b."status" = \'published\'',
            (annotation_id,),
        )
    )


def technique_notes(con: sqlite3.Connection, technique_id: str, me: int) -> list[sqlite3.Row]:
    """The annotations about a technique, in published books only, with their book's
    reference: by book (newest upload first), then page."""
    return con.execute(
        f'SELECT {_COLUMNS}, b."reference", b."original_filename"'  # nosec B608 - constant columns
        f' {_FROM} JOIN "book" b ON b."id" = a."book"'
        ' WHERE a."technique" = ? AND b."status" = \'published\''
        ' ORDER BY datetime(b."uploaded_at") DESC, b."id" DESC, a."page", a."id"',
        (me, DELETED_USER_ID, technique_id),
    ).fetchall()
