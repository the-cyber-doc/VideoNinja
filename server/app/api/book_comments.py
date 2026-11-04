"""Comments on books' annotations: a thread per annotation, read by book managers
("book_mgmt"), written with the "comment" access too. As for the techniques' comments
(api/comments.py, whose models they share): each user edits and deletes only their own,
except moderators (the author stays). A downloaded copy of the book has them as replies
to their annotation.
"""

import sqlite3
from datetime import tzinfo

from fastapi import APIRouter, Depends, status

from .. import queries
from ..core import clock, db
from ..core.errors import ApiError
from ..domain import audit
from ..queries.users import User
from .comments import CommentIn, CommentOut
from .deps import require_access, user_zone

router = APIRouter(prefix="/api", tags=["book comments"])
reader = require_access("book_mgmt")
changer = require_access("comment", "moderator")


class BookCommentOut(CommentOut):
    annotation: int  # the annotation it is about


def _out(row: sqlite3.Row) -> BookCommentOut:
    return BookCommentOut(**{k: row[k] for k in BookCommentOut.model_fields})


def _annotation(con: sqlite3.Connection, annotation_id: int, me: User) -> None:
    if queries.book_annotations.annotation(con, annotation_id, me.id) is None:
        raise ApiError("book_annotation.unknown")


def _changeable(con: sqlite3.Connection, comment_id: int, me: User) -> dict[str, int]:
    """`me` may change the comment: its author (with "comment" and "book_mgmt") or a
    moderator. 404 unknown, 403 otherwise; someone else's names its author for the audit."""
    row = queries.book_comments.comment(con, comment_id, me.id)
    if row is None:
        raise ApiError("comment.unknown")
    if row["mine"] and {"comment", "book_mgmt"} <= me.access:
        return {}
    if "moderator" in me.access:
        return {"author_id": row["author"]}
    audit.event("comment.denied", book_comment_id=comment_id, author_id=row["author"])
    raise ApiError("comment.not_author")


def _written(con: sqlite3.Connection, comment_id: int, me: User) -> BookCommentOut:
    row = queries.book_comments.comment(con, comment_id, me.id)
    if row is None:  # deleted meanwhile, between the write and this read
        raise ApiError("comment.unknown")
    return _out(row)


@router.get("/book-annotations/{annotation_id}/comments")
def annotation_comments(
    annotation_id: int, me: User = Depends(reader), con: sqlite3.Connection = Depends(db.get_db)
) -> list[BookCommentOut]:
    """Oldest first: a thread."""
    with db.read(con):
        _annotation(con, annotation_id, me)
        return [_out(r) for r in queries.book_comments.annotation_comments(con, annotation_id, me.id)]


@router.get("/books/{book_id}/comments")
def book_comments(
    book_id: int, me: User = Depends(reader), con: sqlite3.Connection = Depends(db.get_db)
) -> list[BookCommentOut]:
    """Every thread of the book's annotations (the panel's counts, the annotated download)."""
    with db.read(con):
        if queries.books.book(con, book_id) is None:
            raise ApiError("book.unknown")
        return [_out(r) for r in queries.book_comments.book_comments(con, book_id, me.id)]


@router.post("/book-annotations/{annotation_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    annotation_id: int,
    body: CommentIn,
    me: User = Depends(reader),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> BookCommentOut:
    if "comment" not in me.access:
        audit.event("access.denied", access="comment")
        raise ApiError("auth.access_denied")
    with db.write(con):
        _annotation(con, annotation_id, me)
        comment_id = queries.book_comments.insert_comment(
            con, annotation_id, me.id, body.lang, body.text, clock.at(0, zone)
        )
    audit.event("book_comment.created", book_comment_id=comment_id, annotation_id=annotation_id)
    return _written(con, comment_id, me)


@router.patch("/book-comments/{comment_id}")
def edit_comment(
    comment_id: int,
    body: CommentIn,
    me: User = Depends(changer),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> BookCommentOut:
    with db.write(con):
        moderated = _changeable(con, comment_id, me)
        queries.book_comments.update_comment(con, comment_id, body.lang, body.text, clock.at(0, zone))
    audit.event("book_comment.edited", book_comment_id=comment_id, **moderated)
    return _written(con, comment_id, me)


@router.delete("/book-comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, me: User = Depends(changer), con: sqlite3.Connection = Depends(db.get_db)) -> None:
    with db.write(con):
        moderated = _changeable(con, comment_id, me)
        queries.book_comments.delete_comment(con, comment_id)
    audit.event("book_comment.deleted", book_comment_id=comment_id, **moderated)
