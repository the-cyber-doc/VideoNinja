"""Every SQL statement of the application, one function each, one module per table
(or purpose: queue, thumbnails). Called by module: queries.users.insert_user(…).

Values are always bound as parameters (?), never formatted into the SQL.
These functions never commit: the caller opens the transaction (db.write, or
db.read for several reads), so one transaction can span several of them.
"""

from . import (
    catalog,
    comments,
    config,
    invites,
    performers,
    queue,
    segments,
    sessions,
    tags,
    thumbnails,
    uploads,
    users,
    videos,
)

__all__ = [
    "catalog",
    "comments",
    "config",
    "invites",
    "performers",
    "queue",
    "segments",
    "sessions",
    "tags",
    "thumbnails",
    "uploads",
    "users",
    "videos",
]
