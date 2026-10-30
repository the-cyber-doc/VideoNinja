"""The query layer (app/queries/): one module per table, no query left unused, and the
user the app passes around carries no credentials."""

import ast
import dataclasses
import re
import sqlite3
from pathlib import Path

import pytest

from app import queries
from app.queries.users import User

APP = Path(__file__).resolve().parents[1] / "app"


def test_every_query_is_used():
    """A query nobody calls is SQL nobody tests: removed, not kept."""
    code = "\n".join(p.read_text(encoding="utf-8") for p in APP.rglob("*.py"))
    for module in queries.__all__:
        source = (APP / "queries" / f"{module}.py").read_text(encoding="utf-8")
        for node in ast.parse(source).body:
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                assert re.search(rf"queries\.{module}\.{node.name}\(", code), f"queries.{module}.{node.name}: unused"


def test_user_has_no_credentials():
    fields = {f.name for f in dataclasses.fields(User)}
    assert fields == {"id", "username", "name", "role", "time_zone", "access"}
    user = User(1, "admin", None, "admin", None, frozenset())
    with pytest.raises(dataclasses.FrozenInstanceError):
        user.role = "user"  # type: ignore[misc]


def test_inserted_needs_a_row():
    con = sqlite3.connect(":memory:")
    try:
        with pytest.raises(RuntimeError, match="No row inserted"):
            queries.rows.inserted(con.cursor())
    finally:
        con.close()
