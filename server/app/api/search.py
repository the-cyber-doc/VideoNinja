"""The search's full text (the rest of the search runs in the browser, over the catalogue
snapshot and the Videos/Books lists): pages of books, book annotations, techniques' comments. Each user
gets what they may open: the techniques' comments and the annotations of a technique for
everyone (as on the technique's page), the rest with "book_mgmt"."""

import sqlite3

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from .. import queries
from ..core import db
from ..core.validation import RULES
from ..domain import search
from ..queries.users import User
from .deps import current_user

router = APIRouter(prefix="/api", tags=["search"])
LIMIT = 50  # hits per kind


class PageHit(BaseModel):
    book: int
    page: int
    snippet: str  # the matches between \x02 and \x03


class AnnotationHit(BaseModel):
    id: int
    book: int | None  # None without "book_mgmt" (the technique's page shows it)
    page: int
    technique: str | None
    snippet: str


class CommentHit(BaseModel):
    id: int
    technique: str
    user: str | None  # display name; None: the deleted user
    snippet: str


class SearchOut(BaseModel):
    pages: list[PageHit]
    annotations: list[AnnotationHit]
    comments: list[CommentHit]


@router.get("/search")
def search_text(
    q: str = Query(**RULES["search_query"]),
    me: User = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
) -> SearchOut:
    """Every term must match (any part of a word, accents and case ignored); best first."""
    out = SearchOut(pages=[], annotations=[], comments=[])
    query = search.parse(q)
    if query is None:
        return out
    books = "book_mgmt" in me.access
    m, likes = query.match, query.likes
    with db.read(con):
        if books:
            out.pages = [
                PageHit(book=r["book"], page=r["page"], snippet=search.snippet(r["text"], query.terms))
                for r in queries.search.pages(con, m, likes, LIMIT)
            ]
        out.annotations = [
            AnnotationHit(
                id=r["id"],
                book=r["book"] if books else None,
                page=r["page"],
                technique=r["technique"],
                snippet=search.snippet(r["text"], query.terms),
            )
            for r in queries.search.annotations(con, m, likes, not books, LIMIT)
        ]
        out.comments = [
            CommentHit(
                id=r["id"], technique=r["technique"], user=r["user"], snippet=search.snippet(r["text"], query.terms)
            )
            for r in queries.search.comments(con, m, likes, LIMIT)
        ]
    return out
