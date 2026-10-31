"""Comments on techniques. Read by every logged-in user; written with the
"comment" access; each user edits and deletes only their own, except users with
the "moderator" access, who edit and delete anyone's (the author stays).

Not in the catalogue snapshot: written by users and changing often.
"""

import sqlite3
from datetime import tzinfo
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, field_validator
from pydantic_core import PydanticCustomError

from .. import queries
from ..core import clock, db, i18n
from ..core.errors import ApiError
from ..core.validation import field
from ..domain import audit
from ..queries.users import User
from .deps import current_user, require_access, user_zone

router = APIRouter(prefix="/api", tags=["comments"])
commenter = require_access("comment")
changer = require_access("comment", "moderator")


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


def _changeable(con: sqlite3.Connection, comment_id: int, me: User) -> dict[str, int]:
    """Check that `me` may change the comment: its author (with the "comment" access) or
    a moderator. 404 unknown, 403 otherwise. Returns the audit fields: someone else's
    comment names its author."""
    row = queries.comments.comment(con, comment_id, me.id)
    if row is None:
        raise ApiError("comment.unknown")
    if row["mine"] and "comment" in me.access:
        return {}
    if "moderator" in me.access:
        return {"author_id": row["author"]}
    audit.event("comment.denied", comment_id=comment_id, author_id=row["author"])
    raise ApiError("comment.not_author")


def _technique(con: sqlite3.Connection, technique_id: str) -> None:
    if not queries.catalog.technique_exists(con, technique_id):
        raise ApiError("technique.unknown")


def _written(con: sqlite3.Connection, comment_id: int, me: User) -> sqlite3.Row:
    """The comment just written (in this request's transaction: it exists)."""
    row = queries.comments.comment(con, comment_id, me.id)
    if row is None:
        raise ApiError("comment.unknown")
    return row


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
        comment_id = queries.comments.insert_comment(con, technique_id, me.id, body.lang, body.text, clock.at(0, zone))
    audit.event("comment.created", comment_id=comment_id, technique_id=technique_id)
    return _out(_written(con, comment_id, me))


@router.patch("/comments/{comment_id}")
def edit_comment(
    comment_id: int,
    body: CommentIn,
    me: User = Depends(changer),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> CommentOut:
    with db.write(con):
        moderated = _changeable(con, comment_id, me)
        queries.comments.update_comment(con, comment_id, body.lang, body.text, clock.at(0, zone))
    audit.event("comment.edited", comment_id=comment_id, **moderated)
    return _out(_written(con, comment_id, me))


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: int,
    me: User = Depends(changer),
    con: sqlite3.Connection = Depends(db.get_db),
) -> None:
    with db.write(con):
        moderated = _changeable(con, comment_id, me)
        queries.comments.delete_comment(con, comment_id)
    audit.event("comment.deleted", comment_id=comment_id, **moderated)
