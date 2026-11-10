"""Annotations of books' pages: the "book_mgmt" access. Each one is a row: the page, a
text highlight (its quote) or a region (scanned pages: its crop, a JPEG the browser
makes, published by the encoder), the PDF annotation itself as JSON (`target`: what the
viewer shows and a downloaded copy gets), an optional note, colour and technique (the
technique's page shows it). The PDF is never written. Each user changes only their own,
except moderators (the author stays), as for comments.

A technique's page shows the annotations about it to every logged-in user
(/api/techniques/<id>/book-notes): the quote or the region's picture, the note, the
book's reference, who and when; only book managers get the book's ID
(the link to open it): the books stay theirs.
"""

import json
import sqlite3
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field, field_validator
from pydantic_core import PydanticCustomError

from .. import queries
from ..core import clock, db
from ..core.errors import ApiError
from ..core.validation import field
from ..domain import audit
from ..domain.references import Reference
from ..queries.users import User
from .books import UploadIn, own_finished, wait_finished
from .deps import current_user, require_access, user_zone

router = APIRouter(prefix="/api", tags=["book annotations"])
manager = require_access("book_mgmt")
changer = require_access("book_mgmt", "moderator")


def _object(text: str) -> str:
    """The PDF annotation: a JSON object (the viewer's own format; never read here)."""
    try:
        value = json.loads(text)
    except ValueError:
        value = None
    if not isinstance(value, dict):
        raise PydanticCustomError("annotation_target", "The annotation must be a JSON object")
    return text


class _AnnotationBase(BaseModel):
    @field_validator("target", check_fields=False)
    @classmethod
    def _target(cls, value: str | None) -> str | None:
        return value if value is None else _object(value)


class AnnotationIn(_AnnotationBase):
    page: int = Field(ge=1, le=100_000)
    kind: Literal["text", "region"]
    target: str = field("annotation_target")
    quote: str | None = field("annotation_quote", default=None)
    color: str | None = field("annotation_color", default=None)
    note: str | None = field("annotation_note", default=None)
    technique: str | None = field("catalog_id", default=None)


class AnnotationChange(_AnnotationBase):
    """Only the fields sent change (null clears a note, a colour, a technique)."""

    page: int | None = Field(default=None, ge=1, le=100_000)
    target: str | None = field("annotation_target", default=None)
    quote: str | None = field("annotation_quote", default=None)
    color: str | None = field("annotation_color", default=None)
    note: str | None = field("annotation_note", default=None)
    technique: str | None = field("catalog_id", default=None)


class AnnotationOut(BaseModel):
    id: int
    page: int
    kind: Literal["text", "region"]
    target: str  # the PDF annotation (JSON text)
    quote: str | None
    color: str | None
    note: str | None
    technique: str | None
    has_image: bool
    created_by: str | None  # display name; None: unknown or deleted
    created_at: str  # e.g. "2026-10-23T12:13:38+02:00" (app/clock.py)
    modified_at: str
    mine: bool  # made by the caller: they may change it


class TechniqueNoteOut(BaseModel):
    id: int
    book_id: int | None  # None without the "book_mgmt" access: no link to the book
    page: int  # the PDF's page (its own numbering may differ)
    kind: Literal["text", "region"]
    quote: str | None
    note: str | None
    has_image: bool  # a region's picture: /media/book-annotation/<id>/image
    created_by: str | None  # display name; None: unknown or deleted
    created_at: str
    modified_at: str
    reference: Reference


def _published(con: sqlite3.Connection, book_id: int) -> None:
    book = queries.books.book(con, book_id)
    if book is None or book["status"] != "published":
        raise ApiError("book.unknown")


def _technique(con: sqlite3.Connection, technique: str | None) -> None:
    if technique is not None and not queries.catalog.technique_exists(con, technique):
        raise ApiError("technique.unknown")


def _changeable(con: sqlite3.Connection, annotation_id: int, me: User) -> tuple[sqlite3.Row, dict[str, int]]:
    """The annotation, if `me` may change it: its author, or a moderator (audit names the
    author). 404 unknown, 403 otherwise."""
    row = queries.book_annotations.annotation(con, annotation_id, me.id)
    if row is None:
        raise ApiError("book_annotation.unknown")
    if row["mine"]:
        return row, {}
    if "moderator" in me.access:
        return row, {"author_id": row["author"]}
    audit.event("book_annotation.denied", annotation_id=annotation_id, author_id=row["author"])
    raise ApiError("book_annotation.not_author")


def _out(row: sqlite3.Row) -> AnnotationOut:
    return AnnotationOut(**{k: row[k] for k in AnnotationOut.model_fields})


@router.get("/books/{book_id}/annotations")
def list_annotations(
    book_id: int, me: User = Depends(manager), con: sqlite3.Connection = Depends(db.get_db)
) -> list[AnnotationOut]:
    """A published book's annotations, by page."""
    with db.read(con):
        _published(con, book_id)
        return [_out(r) for r in queries.book_annotations.annotations(con, book_id, me.id)]


@router.post("/books/{book_id}/annotations", status_code=status.HTTP_201_CREATED)
def create_annotation(
    book_id: int,
    body: AnnotationIn,
    me: User = Depends(manager),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> AnnotationOut:
    with db.write(con):
        _published(con, book_id)
        _technique(con, body.technique)
        annotation_id = queries.book_annotations.insert_annotation(
            con,
            book_id,
            body.page,
            body.kind,
            body.target,
            body.quote,
            body.color,
            body.note,
            body.technique,
            me.id,
            clock.at(0, zone),
        )
        row = queries.book_annotations.annotation(con, annotation_id, me.id)
    audit.event("book_annotation.created", book_id=book_id, annotation_id=annotation_id)
    assert row is not None  # just written, in the same transaction  # nosec B101
    return _out(row)


@router.patch("/book-annotations/{annotation_id}")
def change_annotation(
    annotation_id: int,
    body: AnnotationChange,
    me: User = Depends(changer),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> AnnotationOut:
    changes = body.model_dump(include=body.model_fields_set)
    for required in ("page", "target"):
        if required in changes and changes[required] is None:
            raise ApiError("validation.missing")
    with db.write(con):
        _, fields = _changeable(con, annotation_id, me)
        _technique(con, changes.get("technique"))
        queries.book_annotations.update_annotation(con, annotation_id, changes, clock.at(0, zone))
        row = queries.book_annotations.annotation(con, annotation_id, me.id)
    audit.event("book_annotation.edited", annotation_id=annotation_id, **fields)
    assert row is not None  # nosec B101
    return _out(row)


@router.delete("/book-annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(
    annotation_id: int, me: User = Depends(changer), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    with db.write(con):
        row, fields = _changeable(con, annotation_id, me)
        queries.book_annotations.delete_annotation(con, annotation_id)
        if row["image_upload"]:
            queries.uploads.set_upload_state(con, row["image_upload"], "deleted")
    audit.event("book_annotation.deleted", annotation_id=annotation_id, **fields)


@router.put("/book-annotations/{annotation_id}/image", status_code=status.HTTP_204_NO_CONTENT)
def attach_image(
    annotation_id: int, body: UploadIn, me: User = Depends(changer), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    """A region's crop (a JPEG the browser made, its own upload): published by the encoder."""
    wait_finished(con, [body.upload])
    with db.write(con):
        row, _ = _changeable(con, annotation_id, me)
        if row["kind"] != "region":
            raise ApiError("book_annotation.not_region")
        own_finished(con, me, body.upload, "image")
        replaced = queries.book_annotations.set_image_upload(con, annotation_id, body.upload)
        if replaced:
            queries.uploads.set_upload_state(con, replaced, "deleted")


@router.get("/techniques/{technique_id}/book-notes")
def technique_notes(
    technique_id: str, me: User = Depends(current_user), con: sqlite3.Connection = Depends(db.get_db)
) -> list[TechniqueNoteOut]:
    """What the books say about a technique: every logged-in user (the technique's page)."""
    with db.read(con):
        if not queries.catalog.technique_exists(con, technique_id):
            raise ApiError("technique.unknown")
        rows = queries.book_annotations.technique_notes(con, technique_id, me.id)
    managed = "book_mgmt" in me.access
    return [
        TechniqueNoteOut(
            **{k: r[k] for k in TechniqueNoteOut.model_fields if k not in ("book_id", "reference")},
            book_id=r["book"] if managed else None,
            reference=Reference.model_validate(json.loads(r["reference"])),
        )
        for r in rows
    ]
