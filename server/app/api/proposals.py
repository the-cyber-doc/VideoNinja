"""Catalogue entries proposed by users ("Other" in the technique picker) and their resolution
on the Options page (rules: domain/proposals.py). Proposing: whoever annotates (upload,
video_mgmt or book_mgmt); resolving: the "options" access. Every write rebuilds the
catalogue snapshot (proposed entries are in it, marked)."""

import sqlite3
from datetime import tzinfo

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from .. import queries
from ..core import clock, db, i18n
from ..domain import audit, proposals
from ..domain.proposals import Created, EntryEdit, Kind, ProposalIn
from ..queries.users import User
from .deps import rebuild_after_write, require_access, user_zone

router = APIRouter(prefix="/api", tags=["catalog proposals"], dependencies=[Depends(rebuild_after_write)])
proposer = require_access("upload", "video_mgmt", "book_mgmt")
resolver = require_access("options")


class ProposalOut(BaseModel):
    technique: str  # the technique's ID, to save the annotation or segment with
    created: list[Created]  # in order: what the frontend adds to its copy of the catalogue


class ProposedEntry(BaseModel):
    kind: Kind
    id: str
    name: str  # the last part of its ID
    kanji: str
    romaji: str
    ryu: str | None  # a section's parents
    category: str | None
    weapon: str | None
    section: str | None  # a technique's
    descriptions: dict[str, str]  # every language ("" where none)
    used: int  # a technique's segments, book annotations and comments
    children: int  # the sections or techniques under it
    proposed_by: str | None  # display name; None: a deleted user
    proposed_at: str


class MergeIn(BaseModel):
    into: str  # an entry of the same kind


@router.post("/catalog/proposals", status_code=status.HTTP_201_CREATED)
def propose(
    body: ProposalIn,
    me: User = Depends(proposer),
    con: sqlite3.Connection = Depends(db.get_db),
    zone: tzinfo = Depends(user_zone),
) -> ProposalOut:
    """The new steps of a technique's place, created as proposed entries."""
    with db.write(con):
        technique, created = proposals.propose(con, body, me.id, clock.at(0, zone))
    if created:
        audit.event("catalog.proposed", ids=",".join(c.id for c in created))
    return ProposalOut(technique=technique, created=created)


def _entries(con: sqlite3.Connection) -> list[ProposedEntry]:
    out = []
    with db.read(con):
        for kind, table in proposals.TABLE.items():
            for r in queries.proposals.pending(con, table):
                used, children = proposals.usage(con, kind, r["id"])
                keys = r.keys()
                out.append(
                    ProposedEntry(
                        kind=kind,
                        id=r["id"],
                        name=proposals.name_of(r["id"]),
                        kanji=r["kanji"],
                        romaji=r["romaji"],
                        **{c: (r[c] if c in keys else None) for c in ("ryu", "category", "weapon", "section")},
                        descriptions={lang: r[f"description_{lang}"] or "" for lang in i18n.LANGS},
                        used=used,
                        children=children,
                        proposed_by=r["proposed_by"],
                        proposed_at=r["proposed_at"],
                    )
                )
    return out


@router.get("/admin/proposals")
def list_proposals(_: User = Depends(resolver), con: sqlite3.Connection = Depends(db.get_db)) -> list[ProposedEntry]:
    """Every proposed entry: schools, categories, weapons, sections, then techniques; oldest first in each."""
    return _entries(con)


@router.put("/admin/proposals/{kind}/{entry_id}")
def edit_proposal(
    kind: Kind,
    entry_id: str,
    body: EntryEdit,
    _: User = Depends(resolver),
    con: sqlite3.Connection = Depends(db.get_db),
) -> ProposedEntry:
    """Its name (a new one renames it and everything under it, everywhere), names, parent, meanings."""
    with db.write(con):
        queries.tags.defer_foreign_keys(con)
        new_id = proposals.edit(con, kind, entry_id, body)
    audit.event("catalog.edited", kind=kind, id=new_id, previous_id=entry_id)
    return next(e for e in _entries(con) if e.kind == kind and e.id == new_id)


@router.post("/admin/proposals/{kind}/{entry_id}/validate", status_code=status.HTTP_204_NO_CONTENT)
def validate_proposal(
    kind: Kind, entry_id: str, _: User = Depends(resolver), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    """An ordinary entry from now on (its parents validated first)."""
    with db.write(con):
        proposals.validate(con, kind, entry_id)
    audit.event("catalog.validated", kind=kind, id=entry_id)


@router.post("/admin/proposals/{kind}/{entry_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
def merge_proposal(
    kind: Kind,
    entry_id: str,
    body: MergeIn,
    _: User = Depends(resolver),
    con: sqlite3.Connection = Depends(db.get_db),
) -> None:
    """Into an existing entry of the same kind: its uses and what is under it move there."""
    with db.write(con):
        queries.tags.defer_foreign_keys(con)
        proposals.merge(con, kind, entry_id, body.into)
    audit.event("catalog.merged", kind=kind, id=entry_id, into=body.into)


@router.delete("/admin/proposals/{kind}/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_proposal(
    kind: Kind, entry_id: str, _: User = Depends(resolver), con: sqlite3.Connection = Depends(db.get_db)
) -> None:
    """Only while nothing uses it nor sits under it."""
    with db.write(con):
        proposals.delete(con, kind, entry_id)
    audit.event("catalog.deleted", kind=kind, id=entry_id)
