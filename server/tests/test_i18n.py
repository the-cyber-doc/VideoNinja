import pytest

from app.core import i18n

from .conftest import connect
from .test_users import admin  # noqa: F401 (fixture)


@pytest.mark.parametrize(
    "header, lang",
    [
        (None, "en"),
        ("", "en"),
        ("fr", "fr"),
        ("FR-ca", "fr"),
        ("de", "en"),  # unsupported
        ("de,fr;q=0.5", "fr"),  # first supported
        ("en;q=0.4,fr;q=0.8", "fr"),  # highest q wins
        ("fr;q=0,en", "en"),  # q=0: not acceptable
        ("fr;q=abc,en", "en"),  # malformed q: ignored
    ],
)
def test_parse(header, lang):
    assert i18n.parse(header) == lang


def test_pick_falls_back_to_english_then_fallback():
    row = {"name_en": "School", "name_fr": None}
    assert i18n.pick(row, "name", "fr") == "School"
    assert i18n.pick({"name_en": None, "name_fr": None}, "name", "fr", "admin") == "admin"


def test_translation_columns_match_languages(admin):  # noqa: F811
    columns = [r[1] for r in connect().execute('PRAGMA table_info("translation")')]
    assert tuple(columns[1:]) == i18n.LANGS


def test_roles_are_translated(admin):  # noqa: F811
    assert admin.get("/api/admin/roles").json() == [
        {"id": "admin", "name": "Admin"},
        {"id": "editor", "name": "Editor"},
        {"id": "uploader", "name": "Uploader"},
        {"id": "user", "name": "User"},
        {"id": "video_mgmt", "name": "Video manager"},
    ]
    fr = admin.get("/api/admin/roles", headers={"Accept-Language": "fr"}).json()
    # Sorted ignoring accents: "Éditeur" with the E's.
    assert fr == [
        {"id": "admin", "name": "Administrateur"},
        {"id": "editor", "name": "Éditeur"},
        {"id": "video_mgmt", "name": "Gestionnaire de vidéos"},
        {"id": "uploader", "name": "Téléverseur"},
        {"id": "user", "name": "Utilisateur"},
    ]


def test_me_role_name_is_translated(admin):  # noqa: F811
    assert admin.get("/api/auth/me", headers={"Accept-Language": "fr"}).json()["role_name"] == "Administrateur"
