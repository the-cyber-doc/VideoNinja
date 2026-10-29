"""Performers (who demonstrates a technique). Uploaders pick one or add a new one."""

import re
import sqlite3
import unicodedata

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from .. import queries
from ..core import db, i18n
from ..core.errors import ApiError
from ..queries.users import User
from ..core.validation import field
from .deps import require_access

router = APIRouter(prefix="/api", tags=["performers"])
uploader = require_access("upload", "video_mgmt")  # annotating at upload or later


class Performer(BaseModel):
    id: str
    name: str


class PerformerIn(BaseModel):
    name: str = field("performer_name")


def slug(name: str) -> str:
    """Readable ID from a name: "Hatsumi Masaaki" -> "hatsumi-masaaki" (accents dropped)."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:48] or "performer"


@router.get("/performers")
def list_performers(
    _: User = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)
) -> list[Performer]:
    """Sorted by name, ignoring case and accents."""
    performers = (Performer(**dict(r)) for r in queries.performers.performers(con))
    return sorted(performers, key=lambda p: i18n.sort_key(p.name))


@router.post("/performers", status_code=status.HTTP_201_CREATED)
def create_performer(
    body: PerformerIn, _: User = Depends(uploader), con: sqlite3.Connection = Depends(db.get_db)
) -> Performer:
    name = " ".join(body.name.split())
    if not name:
        raise ApiError("performer.empty_name")
    with db.write(con):
        if queries.performers.performer_name_exists(con, name):
            raise ApiError("performer.exists")
        base = performer_id = slug(name)
        n = 1
        while queries.performers.performer_exists(con, performer_id):
            n += 1
            performer_id = f"{base}-{n}"
        queries.performers.insert_performer(con, performer_id, name)
    return Performer(id=performer_id, name=name)
