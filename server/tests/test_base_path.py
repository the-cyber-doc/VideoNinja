"""The app under a base path (e.g. https://example.org/videoninja/), behind nginx."""

import time

import pytest

from app import nginx, paths, tusd

from .test_auth import login
from .test_upload import admin, hook, uploaded  # noqa: F401 (fixture)


@pytest.fixture
def base(monkeypatch):
    monkeypatch.setenv("VIDEONINJA_BASE_PATH", "/videoninja")


def test_base_path_values(monkeypatch):
    for value, expected in [("", ""), ("/", ""), ("/videoninja", "/videoninja"), ("/videoninja/", "/videoninja"),
                            ("/a/b-c_d.e", "/a/b-c_d.e")]:
        monkeypatch.setenv("VIDEONINJA_BASE_PATH", value)
        assert paths.base_path() == expected
    for bad in ("videoninja", "/video ninja", "/a//b", "/a?b", "/%2e%2e"):
        monkeypatch.setenv("VIDEONINJA_BASE_PATH", bad)
        with pytest.raises(RuntimeError):
            paths.base_path()


def test_session_cookie_only_for_the_app(client, admin_secret, base):
    """Under a base path the origin is shared with the domain's other sites: the
    cookie is limited to the app's path, so their servers never receive it."""
    r = login(client, admin_secret)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("__Secure-session=")
    for attr in ("Path=/videoninja", "HttpOnly", "Secure", "SameSite=strict"):
        assert attr in cookie
    token = cookie.split(";")[0].split("=", 1)[1]
    # nginx removes the base path: the app sees /api/… with the browser's cookie.
    client.cookies.clear()
    assert client.get("/api/auth/me", headers={"Cookie": f"__Secure-session={token}"}).status_code == 200
    assert client.get("/api/auth/me", headers={"Cookie": f"__Host-session={token}"}).status_code == 401
    r = client.post("/api/auth/logout", headers={"Cookie": f"__Secure-session={token}"})
    assert "__Secure-session=" in r.headers["set-cookie"] and "Path=/videoninja" in r.headers["set-cookie"]


def test_root_keeps_the_host_cookie(client, admin_secret):
    cookie = login(client, admin_secret).headers["set-cookie"]
    assert cookie.startswith("__Host-session=") and "Path=/" in cookie


def test_tusd_under_the_base_path(base, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", "/bin/tusd")
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path))
    cmd = tusd.Tusd().command()
    assert cmd[cmd.index("-base-path") + 1] == "/videoninja/files/"  # its upload URLs, as the browser sees them


def test_upload_auth_under_the_base_path(base, client, admin):  # noqa: F811
    token = client.cookies.get("__Secure-session")  # logged in under the base path
    client.cookies.clear()  # Path=/videoninja: sent by hand, as the browser does to /videoninja/…
    cookie = {"Cookie": f"__Secure-session={token}"}
    tus_id = hook(client, "pre-create", token)["ChangeFileInfo"]["ID"]  # tusd forwards the cookie

    def auth(uri, method="PATCH"):
        headers = {**cookie, "X-Original-URI": uri, "X-Original-Method": method}
        return client.get("/internal/upload-auth", headers=headers).status_code

    assert auth("/videoninja/files/", "POST") == 204
    assert auth(f"/videoninja/files/{tus_id}") == 204
    assert auth(f"/files/{tus_id}") == 404  # not under the base path


def stub(tmp_path):
    script = tmp_path / "nginx"
    calls = tmp_path / "calls"
    script.write_text(f'#!/bin/sh\necho "$@" >> "{calls}"\necho "2026/10/23 [warn] 1#1: hello"\nexec sleep 60\n')
    script.chmod(0o755)
    return script, calls


def test_nginx_started_with_its_configuration(tmp_path, monkeypatch, caplog):
    script, calls = stub(tmp_path)
    monkeypatch.setenv("VIDEONINJA_NGINX", "1")
    monkeypatch.setenv("VIDEONINJA_NGINX_BIN", str(script))
    monkeypatch.setenv("VIDEONINJA_NGINX_CONF", "/app/nginx/nginx.conf")
    nginx.start()
    try:
        for _ in range(100):
            if calls.exists() and "hello" in caplog.text:
                break
            time.sleep(0.05)
        assert calls.read_text().split() == ["-c", "/app/nginx/nginx.conf", "-e", "stderr", "-g", "daemon", "off;"]
        assert nginx.process.running()
        assert "nginx: 2026/10/23 [warn] 1#1: hello" in caplog.text  # its warnings in the app's log
    finally:
        nginx.stop()
    assert not nginx.process.running()


def test_nginx_not_started_without_configuration(tmp_path, monkeypatch):
    script, calls = stub(tmp_path)
    monkeypatch.setenv("VIDEONINJA_NGINX", "1")
    monkeypatch.setenv("VIDEONINJA_NGINX_BIN", str(script))
    monkeypatch.delenv("VIDEONINJA_NGINX_CONF", raising=False)
    monkeypatch.setattr(nginx, "process", None)
    nginx.start()  # development: Vite serves the frontend
    assert nginx.process is None
