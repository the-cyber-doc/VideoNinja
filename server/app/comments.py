"""Comments on techniques. Read by every logged-in user; written with the
"comment" access; each user edits and deletes only their own.

Not in the catalogue snapshot: written by users and changing often.
"""

import sqlite3
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, field_validator
from pydantic_core import PydanticCustomError

from . import audit, clock, db, i18n, queries
from .errors import ApiError
from .auth import current_user, require_access, user_zone
from .validation import field
from .queries.users import User

router = APIRouter(prefix="/api", tags=["comments"])
commenter = require_access("comment")


class CommentOut(BaseModel):
    id: int
    user: str  # display name, else username
    created_at: str  # e.g. "2026-10-23T12:13:38+02:00" (app/clock.py)
    modified_at: str  # = created_at until edited
    lang: str  # language the comment is written in
    text: str
    mine: bool  # written by the caller: they may edit and delete it


class CommentIn(BaseModel):
    text: str = field("comment_text")
    lang: Literal[*i18n.LANGS]  # type: ignore[valid-type]

    @field_validator("text")
    @classmethod
    def not_blank(cls, text: str) -> str:
        text = text.strip()
        if not text:
            raise PydanticCustomError("comment_empty", "The comment is empty")
        return text


def _out(row: sqlite3.Row) -> CommentOut:
    return CommentOut(**{k: row[k] for k in CommentOut.model_fields})


def _own(con: sqlite3.Connection, comment_id: int, me: User) -> sqlite3.Row:
    """The comment, if `me` wrote it: 404 unknown, 403 someone else's."""
    row = queries.comments.comment(con, comment_id, me.id)
    if row is None:
        raise ApiError("comment.unknown")
    if not row["mine"]:
        audit.event("comment.denied", comment_id=comment_id, author_id=row["author"])
        raise ApiError("comment.not_author")
    return row


def _technique(con: sqlite3.Connection, technique_id: str) -> None:
    if not queries.catalog.technique_exists(con, technique_id):
        raise ApiError("technique.unknown")


@router.get("/techniques/{technique_id}/comments")
def technique_comments(
    technique_id: str,
    me: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
) -> list[CommentOut]:
    """Last modified first."""
    _technique(con, technique_id)
    return [_out(r) for r in queries.comments.technique_comments(con, technique_id, me.id)]


@router.post("/techniques/{technique_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    technique_id: str,
    body: CommentIn,
    me: User = Depends(commenter),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> CommentOut:
    with db.write(con):
        _technique(con, technique_id)
        comment_id = queries.comments.insert_comment(con, technique_id, me.id, body.lang, body.text,
                                                     clock.at(0, zone))
    audit.event("comment.created", comment_id=comment_id, technique_id=technique_id)
    return _out(queries.comments.comment(con, comment_id, me.id))


@router.patch("/comments/{comment_id}")
def edit_comment(
    comment_id: int,
    body: CommentIn,
    me: User = Depends(commenter),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> CommentOut:
    with db.write(con):
        _own(con, comment_id, me)
        queries.comments.update_comment(con, comment_id, body.lang, body.text, clock.at(0, zone))
    audit.event("comment.edited", comment_id=comment_id)
    return _out(queries.comments.comment(con, comment_id, me.id))


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: int,
    me: User = Depends(commenter),
    con: sqlite3.Connection = Depends(db.get_db),
) -> None:
    with db.write(con):
        _own(con, comment_id, me)
        queries.comments.delete_comment(con, comment_id)
    audit.event("comment.deleted", comment_id=comment_id)
