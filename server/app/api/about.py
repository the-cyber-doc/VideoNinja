"""About page: what the server knows (the app's version and build are in the frontend build)."""

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import queries
from ..core import db
from ..queries.users import User
from .deps import current_user

router = APIRouter(prefix="/api", tags=["about"])


class AboutOut(BaseModel):
    db_version: int  # of the running database (config.db_version, set when it was built)
    db_schema: int  # the version this release runs on (db.EXPECTED_VERSION)


@router.get("/about")
def about(
    _: User = Depends(current_user), con: sqlite3.Connection = Depends(db.get_db)
) -> AboutOut:
    return AboutOut(db_version=int(queries.config.config_value(con, "db_version") or 0), db_schema=db.EXPECTED_VERSION)
