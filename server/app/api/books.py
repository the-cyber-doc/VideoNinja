"""Books (PDF): the "book_mgmt" access. The file goes to tusd (kind "book"), with
its first page as a JPEG made by the browser (kind "image"); the submit queues both
for the encoder, which checks and publishes them (app/encoder/books.py).

Not in the catalogue snapshot: the Books page loads the list itself.
"""

import json
import sqlite3
import time
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from .. import queries
from ..core import clock, db
from ..core.errors import ApiError
from ..core.validation import RULES, field
from ..domain import audit, segments
from ..domain.references import Reference
from ..domain.segments import TagIn
from ..queries.users import User
from .deps import require_access, user_zone

router = APIRouter(prefix="/api", tags=["books"])
manager = require_access("book_mgmt")
# tusd answers the last chunk before its post-finish hook has marked the upload
# finished: a submit sent at once waits for it, this long at most (as for videos).
FINISH_WAIT_S = 5.0


class BookExistsOut(BaseModel):
    exists: bool  # a book (published, waiting or failed) is this file


class BookIn(BaseModel):
    upload: str = field("tus_id")  # the PDF's tus upload
    thumbnail_upload: str | None = field("tus_id", default=None)  # its first page (JPEG); None: none made
    original_filename: str = field("original_filename")
    pages: int | None = Field(default=None, ge=1, le=100_000)  # as the browser counted them
    reference: Reference
    tags: list[TagIn] = Field(default=[], max_length=50)


class BookSubmittedOut(BaseModel):
    id: int


class BookOut(BaseModel):
    id: int
    original_filename: str
    status: Literal["queued", "published", "failed"]
    error: str | None
    pages: int | None
    reference: Reference
    uploaded_at: str  # e.g. "2026-10-23T12:13:38+02:00" (app/clock.py)
    uploaded_by: str | None  # the uploader's display name (never an ID); None: unknown
    has_thumbnail: bool
    tags: list[TagIn]


class BookEditIn(BaseModel):
    reference: Reference
    tags: list[TagIn] = Field(default=[], max_length=50)


class UploadIn(BaseModel):
    upload: str = field("tus_id")  # a finished tus upload of the caller's (kind "image")


def _book_out(row: sqlite3.Row, tags: list[TagIn]) -> BookOut:
    return BookOut(**{**dict(row), "reference": Reference.model_validate(json.loads(row["reference"]))}, tags=tags)


def wait_finished(con: sqlite3.Connection, tus_ids: list[str]) -> None:
    """Until tusd's post-finish hook has marked each upload (outside a transaction:
    each read sees the hook's commit), or FINISH_WAIT_S."""
    end = time.monotonic() + FINISH_WAIT_S
    for tus_id in tus_ids:
        while (u := queries.uploads.upload(con, tus_id)) and u["state"] == "uploading" and time.monotonic() < end:
            time.sleep(0.1)


def own_finished(con: sqlite3.Connection, me: User, tus_id: str, kind: str) -> sqlite3.Row:
    upload = queries.uploads.upload(con, tus_id)
    if upload is None or upload["user"] != me.id or upload["state"] == "deleted" or upload["kind"] != kind:
        raise ApiError("upload.unknown")
    if upload["state"] != "finished":
        raise ApiError("upload.not_finished")
    return upload


@router.get("/books/exists")
def book_exists(
    sha256: str = Query(**RULES["sha256"]),
    _: User = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
) -> BookExistsOut:
    """True if a book (published, pending or failed) is this file: checked before uploading."""
    return BookExistsOut(exists=queries.books.book_known(con, sha256))


@router.post("/books", status_code=status.HTTP_201_CREATED)
def submit_book(
    body: BookIn,
    me: User = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> BookSubmittedOut:
    """Queue a finished PDF upload (and its thumbnail's) for the encoder, with its reference and tags."""
    segments.check(con, body.tags, [])  # at once (and again inside the write: tags can change meanwhile)
    wait_finished(con, [body.upload, *([body.thumbnail_upload] if body.thumbnail_upload else [])])
    with db.write(con):
        segments.check(con, body.tags, [])
        upload = own_finished(con, me, body.upload, "book")
        if body.thumbnail_upload:
            own_finished(con, me, body.thumbnail_upload, "image")
        if queries.books.book_known(con, upload["original_sha256"]):
            raise ApiError("book.exists")
        book_id = queries.books.insert_book(
            con,
            upload["original_sha256"],
            body.original_filename,
            body.pages,
            body.reference.to_json(),
            me.id,
            clock.at(0, zone),
            body.upload,
            body.thumbnail_upload,
        )
        for tag in body.tags:
            queries.books.insert_book_tag(con, book_id, tag.id, tag.value)
    audit.event("book.submitted", book_id=book_id, tus_id=body.upload)
    return BookSubmittedOut(id=book_id)


@router.get("/books")
def list_books(_: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)) -> list[BookOut]:
    """Every book (queued, failed, published) with its reference and tags, newest upload first."""
    with db.read(con):  # the books and their tags from the same moment
        tags: dict[int, list[TagIn]] = {}
        for r in queries.books.book_tags(con):
            tags.setdefault(r["book"], []).append(TagIn(id=r["tag"], value=r["value"]))
        return [_book_out(r, tags.get(r["id"], [])) for r in queries.books.books(con)]


@router.get("/books/{book_id}")
def get_book(book_id: int, _: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)) -> BookOut:
    """One book (any status), as the list has it."""
    with db.read(con):
        row = queries.books.listed_book(con, book_id)
        if row is None:
            raise ApiError("book.unknown")
        tags = [TagIn(id=t["tag"], value=t["value"]) for t in queries.books.tags_of(con, book_id)]
        return _book_out(row, tags)


@router.put("/books/{book_id}")
def edit_book(
    book_id: int, body: BookEditIn, _: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)
) -> BookOut:
    """A book's reference and tags, by any book manager (the library is shared)."""
    segments.check(con, body.tags, [])
    with db.write(con):
        segments.check(con, body.tags, [])
        if queries.books.book(con, book_id) is None:
            raise ApiError("book.unknown")
        queries.books.set_reference(con, book_id, body.reference.to_json())
        queries.books.clear_book_tags(con, book_id)
        for tag in body.tags:
            queries.books.insert_book_tag(con, book_id, tag.id, tag.value)
    audit.event("book.edited", book_id=book_id)
    return get_book(book_id, _, con)


@router.put("/books/{book_id}/thumbnail", status_code=status.HTTP_204_NO_CONTENT)
def replace_thumbnail(
    book_id: int, body: UploadIn, me: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    """A new first-page picture for a published book (the viewer makes one when it has none);
    the encoder publishes it."""
    wait_finished(con, [body.upload])
    with db.write(con):
        book = queries.books.book(con, book_id)
        if book is None or book["status"] != "published":
            raise ApiError("book.unknown")
        own_finished(con, me, body.upload, "image")
        replaced = queries.books.set_thumbnail_upload(con, book_id, body.upload)
        if replaced:
            queries.uploads.set_upload_state(con, replaced, "deleted")


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, me: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    """Drop a book that is not published yet (queued or failed): by its uploader or an admin
    (user_mgmt). The encoder deletes its uploads."""
    with db.write(con):
        book = queries.books.book(con, book_id)
        if book is None or (book["uploaded_by"] != me.id and "user_mgmt" not in me.access):
            raise ApiError("book.unknown")
        if book["status"] == "published":
            raise ApiError("book.not_deletable")
        queries.books.delete_book(con, book_id)
        for tus_id in (book["upload"], book["thumbnail_upload"]):
            if tus_id:
                queries.uploads.set_upload_state(con, tus_id, "deleted")
    audit.event("book.deleted", book_id=book_id)
