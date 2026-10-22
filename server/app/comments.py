"""Comments on techniques. Read by every logged-in user.

Not in the catalogue snapshot: written by users and changing often.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import db, queries
from .auth import current_user

router = APIRouter(prefix="/api", tags=["comments"])


class CommentOut(BaseModel):
    id: int
    user: str  # display name, else username
    created_s: int
    lang: str  # language the comment is written in
    text: str


@router.get("/techniques/{technique_id}/comments")
def technique_comments(
    technique_id: str,
    _: sqlite3.Row = Depends(current_user),
    con: sqlite3.Connection = Depends(db.get_db),
) -> list[CommentOut]:
    """Newest first."""
    if not queries.technique_exists(con, technique_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown technique")
    return [CommentOut(**dict(r)) for r in queries.technique_comments(con, technique_id)]
