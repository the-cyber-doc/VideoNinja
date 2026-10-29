"""The annotation checks shared by the upload and Videos pages (app/segments.py), and
how many queries they and the access checks cost: constant, whatever the number of
segments."""

import re

import pytest

from app.core import db

from .test_catalog import KETO, KOKU
from .test_video_mgmt import admin, sql  # noqa: F401 - fixture

LONG_VIDEO_S = 3600


@pytest.fixture
def statements(monkeypatch):
    """Every SQL statement the app runs from now on (its connections only)."""
    seen: list[str] = []
    connect = db.connect

    def traced(*args, **kwargs):
        con = connect(*args, **kwargs)
        con.set_trace_callback(seen.append)
        return con

    monkeypatch.setattr(db, "connect", traced)
    return seen


def count(statements, pattern) -> int:
    return sum(1 for s in statements if re.search(pattern, s))


def segment(begin_s, technique=KOKU, performer="hatsumi"):
    return {"begin_s": begin_s, "end_s": begin_s + 5, "technique": technique, "performer": performer}


@pytest.mark.parametrize("n", [1, 40])
def test_lookups_do_not_grow_with_the_segments(admin, statements, n):  # noqa: F811 - fixture
    sql("UPDATE video SET duration_s = ?", LONG_VIDEO_S)
    body = {"all_segments_done": True,
            "segments": [segment(10 * i, KOKU if i % 2 else KETO) for i in range(n)]}
    statements.clear()
    r = admin.put("/api/videos/1/annotations", json=body)
    assert r.status_code == 200, r.text
    assert len(r.json()["segments"]) == n
    assert count(statements, r'FROM "technique"') == 1
    assert count(statements, r'FROM "performer"') == 1


def test_unknown_ones_named_in_order(admin):  # noqa: F811 - fixture
    """The first problem in the segments' order, as before the lookups were grouped."""
    body = {"all_segments_done": True,
            "segments": [segment(1), segment(10, performer="nope"), segment(20, technique="nope")]}
    r = admin.put("/api/videos/1/annotations", json=body)
    assert r.status_code == 422
    assert r.json() == {"code": "segment.unknown_performer", "detail": "Unknown performer: nope",
                        "params": {"performer": "nope"}}


def test_access_checks_cost_no_query(admin, statements):  # noqa: F811 - fixture
    """The role's accesses come with the session: one query, not one more per check."""
    statements.clear()
    assert admin.get("/api/videos").status_code == 200
    roles = [s for s in statements if '"role_has_access"' in s]
    assert len(roles) == 1 and 'FROM "session"' in roles[0]  # within the session's query
