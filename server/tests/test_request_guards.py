"""Guards on every request: writes from another origin refused, password checks capped."""

import threading

import pytest

from app import security

from .test_auth import login
from .test_upload import admin, auth, uploaded  # noqa: F401 (fixture)


@pytest.mark.parametrize("headers, refused", [
    ({"Sec-Fetch-Site": "same-origin"}, False),
    ({"Sec-Fetch-Site": "same-site"}, True),  # another subdomain of the domain
    ({"Sec-Fetch-Site": "cross-site"}, True),
    ({"Sec-Fetch-Site": "none"}, True),  # typed or bookmarked: never a write
    ({"Sec-Fetch-Site": "same-origin", "Origin": "https://evil.example"}, False),  # Sec-Fetch-Site decides
    ({"Origin": "https://testserver"}, False),  # older browsers: Origin
    ({"Origin": "https://testserver:8443"}, False),  # nginx forwards the host without its port
    ({"Origin": "https://evil.example"}, True),
    ({"Origin": "null"}, True),  # sandboxed or opaque origin
    ({}, False),  # no browser: tools, server calls (the cookie is SameSite=Strict anyway)
])
def test_cross_site_writes_refused(client, admin_secret, headers, refused):
    assert login(client, admin_secret).status_code == 200
    r = client.post("/api/profile/name", json={"name": "Sensei"}, headers=headers)
    if refused:
        assert (r.status_code, r.json()) == (403, {"detail": "Cross-site request refused"})
    else:
        assert r.status_code == 200, r.text


def test_reads_are_not_checked(client, admin_secret):
    """A GET changes nothing: an image or a link from elsewhere still works."""
    assert login(client, admin_secret).status_code == 200
    assert client.get("/api/auth/me", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200


def test_cross_site_login_refused(client, admin_secret):
    """Before any session too: login, setup and registration are writes."""
    r = client.post("/api/auth/login", json={"username": "admin", "password": "x", "totp_code": "123456"},
                    headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403


def test_cross_site_uploads_refused(admin):  # noqa: F811
    """tus requests go to tusd after the app's check (nginx auth_request), with the
    browser's headers: a chunk or a cancel from another origin is refused there."""
    tus_id = uploaded(admin)
    for method in ("POST", "PATCH", "DELETE"):
        uri = "/files/" if method == "POST" else f"/files/{tus_id}"
        headers = {"X-Original-URI": uri, "X-Original-Method": method, "Sec-Fetch-Site": "cross-site"}
        r = admin.get("/internal/upload-auth", headers=headers)
        assert r.status_code == 403, method
        assert auth(admin, uri, method).status_code == 204  # the same, from the app's own page
    headers = {"X-Original-URI": f"/files/{tus_id}", "X-Original-Method": "HEAD", "Sec-Fetch-Site": "cross-site"}
    r = admin.get("/internal/upload-auth", headers=headers)
    assert r.status_code == 204  # a resume's offset check: a read


def test_password_checks_capped(client, admin_secret, monkeypatch):
    """Every slot taken (a burst of logins): the next one waits, then gets 503 with
    Retry-After, not a crash of the container for lack of memory."""
    monkeypatch.setattr(security, "_argon2", threading.BoundedSemaphore(1))
    monkeypatch.setattr(security, "ARGON2_WAIT_S", 0.2)
    security._argon2.acquire()  # a check in progress
    try:
        r = login(client, admin_secret)
        assert r.status_code == 503 and r.headers["retry-after"] == "5"
        assert r.json() == {"detail": "The server is busy, try again in a moment"}
    finally:
        security._argon2.release()
    assert login(client, admin_secret).status_code == 200  # free again


def test_password_checks_wait_their_turn(client, admin_secret, monkeypatch):
    """A slot freed within the wait: the login goes through."""
    monkeypatch.setattr(security, "_argon2", threading.BoundedSemaphore(1))
    security._argon2.acquire()
    threading.Timer(0.3, security._argon2.release).start()
    assert login(client, admin_secret).status_code == 200
