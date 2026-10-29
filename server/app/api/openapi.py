"""The API's OpenAPI schema, as FastAPI makes it, with the errors as they really are:
every operation may answer ErrorOut ({code, detail, params}: core/errors.py),
validation errors included (FastAPI would describe its own 422 format, which the
app replaces).

Committed as server/openapi.json; the frontend's types (frontend/src/lib/api/
schema.d.ts) are generated from it. Both: tools/api-types.sh. Tests fail when
either is out of date.

    python -m app.api.openapi > openapi.json
"""

import json
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from ..core.errors import ErrorOut

ERROR = {"$ref": "#/components/schemas/ApiError"}
FASTAPI_VALIDATION = ("HTTPValidationError", "ValidationError")


def schema(app: FastAPI) -> dict[str, Any]:
    spec = get_openapi(title=app.title, version="1", routes=app.routes)
    schemas = spec.setdefault("components", {}).setdefault("schemas", {})
    for name in FASTAPI_VALIDATION:
        schemas.pop(name, None)
    schemas["ApiError"] = ErrorOut.model_json_schema(ref_template="#/components/schemas/{model}")
    schemas["ApiError"]["title"] = "ApiError"
    for path in spec["paths"].values():
        for operation in path.values():
            responses = operation["responses"]
            responses.pop("422", None)  # FastAPI's format: ours is in "default"
            responses["default"] = {"description": "An error (core/errors.py: ERRORS)",
                                    "content": {"application/json": {"schema": ERROR}}}
    return spec


def install(app: FastAPI) -> None:
    """Serve this schema (/openapi.json, /docs) instead of FastAPI's own."""
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = schema(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def text(app: FastAPI) -> str:
    """The committed file's content: stable (keys sorted), readable diffs."""
    return json.dumps(schema(app), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    from ..main import app

    print(text(app), end="")
