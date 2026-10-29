"""Security events (app/audit.py): fixed names, who and what, never a secret."""

import ast
import logging
from pathlib import Path

import pyotp
import pytest

from app.domain import audit, security

from .conftest import PASSWORD
from .test_auth import login
from .test_users import USER_PASSWORD, create, register, user_login

APP = Path(__file__).resolve().parents[1] / "app"


def events(caplog, name=None):
    return [r for r in caplog.records if r.name == "app.audit" and (name is None or r.event == name)]


def test_every_event_in_the_table():
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "event"
                and getattr(node.func.value, "id", None) == "audit"
            ):
                name = node.args[0]
                assert isinstance(name, ast.Constant), f"{path.name}:{node.lineno}: not a literal"
                assert name.value in audit.EVENTS, f"{path.name}:{node.lineno}: {name.value!r}"


def test_unknown_event_refused():
    with pytest.raises(KeyError):
        audit.event("login.maybe")


def test_message_carries_the_fields(caplog):
    caplog.set_level(logging.INFO)
    audit.event("video.deleted", video_id=3)
    (record,) = events(caplog)
    assert (record.getMessage(), record.event, record.video_id, record.levelno) == (
        "video.deleted video_id=3",
        "video.deleted",
        3,
        logging.INFO,
    )


def test_login_failed_then_succeeded(client, admin_secret, caplog):
    caplog.set_level(logging.INFO)
    assert login(client, admin_secret, password="wrong password!").status_code == 401
    (failed,) = events(caplog, "login.failed")
    assert failed.levelno == logging.WARNING and failed.client == "testclient"
    assert not hasattr(failed, "user_id")  # nobody is logged in yet
    assert "admin" not in failed.getMessage()  # never the username of a failed login
    assert login(client, admin_secret).status_code == 200
    (succeeded,) = events(caplog, "login.succeeded")
    assert succeeded.user_id == 1
    assert client.post("/api/auth/logout").status_code == 204
    assert events(caplog, "logout")[0].user_id == 1


def test_denied_access_names_who_and_what(client, admin_secret, caplog):
    assert login(client, admin_secret).status_code == 200
    secret = register(create(client))
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    caplog.set_level(logging.INFO)
    assert kenji.get("/api/admin/users").status_code == 403
    (denied,) = events(caplog, "access.denied")
    assert (denied.user_id, denied.access) == (2, "user_mgmt")


def test_no_secret_in_any_record(client, admin_secret, caplog):
    """A whole account's life: setup, invitation, registration, logins, password and
    authenticator changes. None of the secrets appears in any record."""
    caplog.set_level(logging.DEBUG)
    assert login(client, admin_secret).status_code == 200
    token = create(client)
    shown = client.get("/api/admin/users/2/invite").json()["token"]
    secret = register(token)
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    session = kenji.cookies.get(security.session_cookie()[0])
    new_password = "kenji's new long password"
    body = {"current_password": USER_PASSWORD, "new_password": new_password}
    assert kenji.post("/api/profile/password", json=body).status_code == 204
    new_secret = kenji.post("/api/profile/totp").json()["secret"]
    assert (
        kenji.post(
            "/api/profile/totp/confirm",
            json={
                "current_password": new_password,
                "totp_secret": new_secret,
                "totp_code": pyotp.TOTP(new_secret).now(),
            },
        ).status_code
        == 204
    )

    names = {r.event for r in events(caplog)}
    assert {
        "login.succeeded",
        "user.invited",
        "invite.shown",
        "user.registered",
        "password.changed",
        "totp.replaced",
    } <= names
    secrets = {PASSWORD, USER_PASSWORD, new_password, admin_secret, secret, new_secret, token, shown, session}
    for record in caplog.records:
        text = record.getMessage() + " " + " ".join(map(str, record.__dict__.values()))
        assert not [s for s in secrets if s and s in text], (record.name, record.getMessage())


def test_readme_lists_every_event():
    """The README's Logs section names every event (for the operator's alerts)."""
    readme = (APP.parents[1] / "README.md").read_text(encoding="utf-8")
    section = readme[readme.index("**Security events**") : readme.index("## Security")]
    assert [name for name in audit.EVENTS if f"`{name}`" not in section] == []
