"""Error answers (app/errors.py): one JSON shape {"code", "detail", "params"} for every
error, each code in the table and translated in every language for the frontend."""

import ast
import json
import re
import string
from datetime import UTC
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import errors, i18n
from app.domain import tags

APP = Path(__file__).resolve().parents[1] / "app"
MESSAGES = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "messages.json"
# Calls whose first argument is an error code.
CODE_CALLS = {"ApiError", "_reject", "response", "body"}


def placeholders(text: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}


def test_every_code_translated_in_every_language():
    messages = json.loads(MESSAGES.read_text(encoding="utf-8"))
    for code, (_, english) in errors.ERRORS.items():
        message = messages.get(f"error.{code}")
        assert message, f"messages.json: error.{code} missing"
        for lang in i18n.LANGS:
            assert message.get(lang), f"error.{code}: no {lang}"
            # Only what the server sends: the placeholders of its own text.
            assert placeholders(message[lang]) <= placeholders(english) | {"field"}, f"error.{code} ({lang})"


def _code_calls():
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", None)
                yield path.name, name, node


def test_every_code_raised_is_in_the_table():
    for file, name, node in _code_calls():
        if name in CODE_CALLS and node.args and isinstance(node.args[0], ast.Constant):
            assert node.args[0].value in errors.ERRORS, f"{file}:{node.lineno}: {node.args[0].value!r}"


def test_no_error_without_a_code():
    """Every error is an ApiError (or answered by errors.py): never a bare HTTPException."""
    for file, name, node in _code_calls():
        assert not (name == "HTTPException" and file != "errors.py"), f"{file}:{node.lineno}"


def test_validation_codes_in_the_table():
    for code, _ in errors.VALIDATION.values():
        assert code in errors.ERRORS


def test_tag_value_errors_in_the_table():
    for rule, value in (("year", "1066"), (["dojo"], "beach")):
        code, params = tags.value_error(rule, value, UTC)
        assert code in errors.ERRORS
        errors.body(code, tag="place", **params)  # its text takes these params


def test_routing_errors(client):
    r = client.get("/api/nope")
    assert (r.status_code, r.json()["code"]) == (404, "not_found")
    r = client.delete("/api/auth/me")
    assert (r.status_code, r.json()["code"]) == (405, "method_not_allowed")


def test_validation_errors(client, admin_secret):
    r = client.post("/api/auth/login", json={"username": "admin"})
    assert r.status_code == 422
    assert r.json() == {"code": "validation.missing", "detail": "A value is missing", "params": {"field": "password"}}
    r = client.post("/api/auth/login", json={"username": "a" * 300, "password": "x"})
    assert r.json()["code"] == "validation.too_long"
    assert r.json()["params"] == {"field": "username", "max_length": 32}


def test_custom_validation_error(client, admin_secret):
    from .test_auth import login

    assert login(client, admin_secret).status_code == 200
    r = client.post("/api/techniques/x/comments", json={"text": "   ", "lang": "en"})
    assert (r.status_code, r.json()["code"]) == (422, "validation.comment_empty")


def test_unexpected_error_is_internal():
    app = FastAPI()
    errors.install(app)

    @app.get("/boom")
    def boom():
        raise RuntimeError("bug")

    r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert (r.status_code, r.json()) == (500, {"code": "internal", "detail": "Internal error", "params": {}})
    assert not re.search("bug|RuntimeError", r.text)  # nothing of the exception leaks
