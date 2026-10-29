"""Request IDs and the line per request (app/middleware.py), and the IDs of the tusd
hooks and the encoder's calls."""

import logging
import re
import urllib.request

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import errors, middleware
from app.encoder import notify

from .test_auth import login

NGINX_ID = "0123456789abcdef0123456789abcdef"  # $request_id: 32 hex digits


def lines(caplog, logger="app.middleware"):
    return [r for r in caplog.records if r.name == logger]


def test_an_id_per_answer(client, caplog):
    caplog.set_level(logging.INFO)
    r = client.get("/api/setup/status")
    assert re.fullmatch(r"[0-9a-f]{32}", r.headers["x-request-id"])
    (line,) = lines(caplog)
    assert line.request_id == r.headers["x-request-id"]
    assert (line.method, line.route, line.status) == ("GET", "/api/setup/status", 200)
    assert isinstance(line.duration_ms, int)


def test_nginx_id_kept_and_not_repeated(client, caplog):
    """nginx sends its ID and adds it to the answer itself: the app does not add a second."""
    caplog.set_level(logging.INFO)
    r = client.get("/api/setup/status", headers={"X-Request-ID": NGINX_ID})
    assert "x-request-id" not in r.headers
    assert lines(caplog)[-1].request_id == NGINX_ID


@pytest.mark.parametrize("sent", ["bad id!", "x" * 65, "a\nb"])
def test_an_invalid_id_replaced(client, caplog, sent):
    caplog.set_level(logging.INFO)
    r = client.get("/api/setup/status", headers={"X-Request-ID": sent})
    assert r.headers["x-request-id"] != sent
    assert lines(caplog)[-1].request_id == r.headers["x-request-id"]


def test_route_template_and_user(client, admin_secret, caplog):
    """The route's template, never the path's IDs; the user once the session is checked,
    also on the endpoint's own lines."""
    assert login(client, admin_secret).status_code == 200
    caplog.set_level(logging.INFO)
    r = client.patch("/api/comments/12345", json={"text": "x", "lang": "en"})
    assert r.status_code == 404
    line = lines(caplog)[-1]
    assert (line.route, line.status, line.user_id) == ("/api/comments/{comment_id}", 404, 1)
    assert "12345" not in line.getMessage()


def test_endpoint_lines_carry_the_request(client, admin_secret, caplog):
    assert login(client, admin_secret).status_code == 200
    caplog.set_level(logging.INFO)
    r = client.post("/api/admin/users", json={"username": "kenji", "role": "user"}, headers={"X-Request-ID": NGINX_ID})
    assert r.status_code == 201
    ours = [rec for rec in caplog.records if getattr(rec, "request_id", None) == NGINX_ID]
    assert {rec.name for rec in ours} == {"app.audit", "app.middleware"}  # the endpoint's own line too
    assert all(rec.user_id == 1 for rec in ours)


def test_unknown_route_and_refusals_logged(client, caplog):
    caplog.set_level(logging.INFO)
    assert client.get("/api/nope").status_code == 404
    assert (lines(caplog)[-1].route, lines(caplog)[-1].status) == ("(no route)", 404)
    r = client.post("/api/profile/name", json={"name": "x"}, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403 and "x-request-id" in r.headers  # outermost: the refusal has its ID


def test_healthy_health_is_debug(client, caplog):
    caplog.set_level(logging.DEBUG)
    assert client.get("/health").status_code == 200
    assert lines(caplog)[-1].levelno == logging.DEBUG


def test_unexpected_error_logged_with_status_500(caplog):
    caplog.set_level(logging.INFO)
    app = FastAPI()
    errors.install(app)
    app.add_middleware(middleware.RequestLog)

    @app.get("/boom")
    def boom():
        raise RuntimeError("bug")

    assert TestClient(app, raise_server_exceptions=False).get("/boom").status_code == 500
    assert (lines(caplog)[-1].route, lines(caplog)[-1].status) == ("/boom", 500)


def test_tusd_hook_takes_the_browser_request_id(client, admin_secret, caplog):
    """tusd calls the app itself: the line carries the browser's request (nginx's ID)."""
    caplog.set_level(logging.INFO)
    hook = {
        "Type": "post-finish",
        "Event": {"Upload": {"ID": "nope"}, "HTTPRequest": {"Header": {"X-Request-Id": [NGINX_ID]}}},
    }
    assert client.post("/internal/tusd-hook", json=hook).status_code == 200
    assert lines(caplog)[-1].request_id == NGINX_ID


def test_encoder_call_carries_an_id(monkeypatch, caplog):
    sent = {}

    class Answer:
        def close(self):
            pass

    def urlopen(request, timeout):
        sent["id"] = request.get_header("X-request-id")
        return Answer()

    caplog.set_level(logging.INFO)
    monkeypatch.setenv("VIDEONINJA_API_URL", "http://api:8000")
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    notify.catalog_changed()
    assert re.fullmatch(r"[0-9a-f]{32}", sent["id"])
    assert lines(caplog, "app.encoder.notify")[-1].request_id == sent["id"]
