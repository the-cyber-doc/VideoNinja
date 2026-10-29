"""The OpenAPI schema (app/api/openapi.py): committed as server/openapi.json, the
source of the frontend's types (frontend/src/lib/api/schema.d.ts)."""

from collections import Counter
from pathlib import Path

from app.api import openapi
from app.main import app

COMMITTED = Path(__file__).resolve().parents[1] / "openapi.json"
# Answers that are not a JSON model, on purpose: files and streams.
UNTYPED = {
    ("post", "/api/setup/complete"),  # NDJSON progress stream
    ("get", "/api/catalog"),  # the snapshot file (X-Accel-Redirect)
    ("get", "/media/segment/{segment_id}"),
    ("head", "/media/segment/{segment_id}"),
    ("get", "/media/segment/{segment_id}/thumbnail"),
    ("get", "/media/video/{video_id}"),
    ("get", "/media/video/{video_id}/thumbnail"),
}


def operations():
    for path, item in openapi.schema(app)["paths"].items():
        for method, operation in item.items():
            yield method, path, operation


def test_committed_schema_is_current():
    assert COMMITTED.read_text(encoding="utf-8") == openapi.text(app), (
        "server/openapi.json is out of date: run tools/api-types.sh (it also regenerates the frontend's types)"
    )


def test_every_operation_says_how_it_fails():
    for method, path, operation in operations():
        responses = operation["responses"]
        assert responses["default"]["content"]["application/json"]["schema"] == openapi.ERROR, (method, path)
        assert "422" not in responses, (method, path)  # FastAPI's format, not the app's
    schemas = openapi.schema(app)["components"]["schemas"]
    assert set(schemas["ApiError"]["required"]) == {"code", "detail", "params"}
    assert not set(openapi.FASTAPI_VALIDATION) & set(schemas)


def test_operation_ids_unique():
    ids = Counter(operation["operationId"] for _, _, operation in operations())
    assert [i for i, n in ids.items() if n > 1] == []


def test_json_answers_are_typed():
    """A frontend type for every JSON answer: an endpoint without a model is an error
    here (or a file / stream, listed above)."""
    untyped = set()
    for method, path, operation in operations():
        ok = {code: r for code, r in operation["responses"].items() if code.startswith("2") and code != "204"}
        for response in ok.values():
            schema = response.get("content", {}).get("application/json", {}).get("schema")
            if not schema:
                untyped.add((method, path))
    assert untyped == UNTYPED


def test_no_open_dictionaries():
    """An answer the frontend reads has a model, not dict[str, …] (any key would
    type-check there). tusd's hook answers tusd's own protocol."""
    open_ = {
        (method, path)
        for method, path, operation in operations()
        for code, response in operation["responses"].items()
        if code.startswith("2")
        for schema in [response.get("content", {}).get("application/json", {}).get("schema", {})]
        if "additionalProperties" in schema and "properties" not in schema
    }
    assert open_ == {("post", "/internal/tusd-hook")}


def test_schema_names_are_plain():
    """Two models of one name in different modules get names like app__api__setup__X,
    which change when a module moves: give each its own name."""
    names = openapi.schema(app)["components"]["schemas"]
    assert [n for n in names if "__" in n] == []
