"""Tags that can be put on videos and segments. Tag kinds are created by admins
(no page yet); a tag either takes one of its fixed values or a free text value."""

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import db, queries
from .auth import require_access

router = APIRouter(prefix="/api", tags=["tags"])


class Tag(BaseModel):
    id: str
    values: list[str] | None = None  # fixed values, else any text


def tag_values(row: sqlite3.Row) -> list[str] | None:
    if not row["fixed_values"]:
        return None
    return [v.strip() for v in (row["list_of_values"] or "").split(",") if v.strip()]


@router.get("/tags", response_model_exclude_none=True)
def list_tags(
    _: sqlite3.Row = Depends(require_access("upload")), con: sqlite3.Connection = Depends(db.get_db)
) -> list[Tag]:
    return [Tag(id=r["id"], values=tag_values(r)) for r in queries.tags(con)]
