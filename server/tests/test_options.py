"""The Options page's tags (admin API): definitions, renames everywhere, refusals."""

import logging

import pyotp
import pytest

from app.domain import tags

from .conftest import connect
from .test_auth import login
from .test_catalog import add_segments
from .test_users import USER_PASSWORD, create, register, user_login

NAMES = {"en": "Place", "fr": "Lieu"}
PLACE = {
    "id": "place",
    "names": NAMES,
    "format": "list",
    "values": [
        {"id": "dojo", "names": {"en": "Dojo", "fr": "Dojo"}},
        {"id": "beach", "names": {"en": "Beach", "fr": "Plage"}},
    ],
}


def sql(query, *args):
    con = connect()
    with con:
        return con.execute(query, args).fetchall()


@pytest.fixture
def admin(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    add_segments()  # video 1 (published): segments 1 and 2
    return client


def definition(client, tag_id, lang="en"):
    return next(t for t in client.get("/api/admin/tags", headers={"Accept-Language": lang}).json() if t["id"] == tag_id)


def created(client, body=PLACE):
    r = client.post("/api/admin/tags", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def use(tag, value, video=True, segment=None):
    if video:
        sql("INSERT INTO video_has_tags (video, tag, value) VALUES (1, ?, ?)", tag, value)
    if segment:
        sql("INSERT INTO segment_has_tags (segment, tag, value) VALUES (?, ?, ?)", segment, tag, value)


def translations(prefix):
    return sql("SELECT id, en, fr FROM translation WHERE id LIKE ? ORDER BY id", prefix + "%")


# --- access ---


def test_needs_the_options_access(admin):
    secret = register(create(admin))  # kenji, role "user"
    kenji = user_login("kenji", USER_PASSWORD, pyotp.TOTP(secret).now())
    for method, url in [
        ("get", "/api/admin/tags"),
        ("post", "/api/admin/tags"),
        ("put", "/api/admin/tags/year"),
        ("delete", "/api/admin/tags/year"),
    ]:
        r = getattr(kenji, method)(url, **({"json": PLACE} if method in ("post", "put") else {}))
        assert (r.status_code, r.json()["code"]) == (403, "auth.access_denied"), url
    assert sql("SELECT role FROM role_has_access WHERE access = 'options'") == [("admin",)]
    assert sql("SELECT en, fr FROM translation WHERE id = 'access.options.name'") == [("Options", "Options")]


# --- reading ---


def test_seeded_definitions(admin):
    use("year", "2024", segment=1)
    use("country", "CHE")
    listed = admin.get("/api/admin/tags", headers={"Accept-Language": "fr"}).json()
    assert [t["id"] for t in listed] == ["year", "event", "location", "country", "source"]  # Année, Événement…
    year = definition(admin, "year")
    assert year == {
        "id": "year",
        "names": {"en": "Year", "fr": "Année"},
        "format": "regexp",
        "regexp": "[12][0-9]{3}",
        "hint": {"en": "A year, e.g. 2024", "fr": "Une année, par ex. 2024"},
        "input_mode": "numeric",
        "min": None,
        "max": None,
        "values": [],
        "used": 2,
    }
    country = definition(admin, "country", "fr")
    assert (country["used"], country["hint"], len(country["values"])) == (1, None, 249)
    assert country["values"][0] == {"id": "AFG", "names": {"en": "Afghanistan", "fr": "Afghanistan"}, "used": 0}
    assert next(v for v in country["values"] if v["id"] == "CHE")["used"] == 1


def test_missing_french_shown_empty(admin):
    sql("INSERT INTO translation (id, en) VALUES ('tag.rain.name', 'Rain')")
    sql("INSERT INTO tag (id, name) VALUES ('rain', 'tag.rain.name')")
    rain = definition(admin, "rain", "fr")
    assert (rain["names"], rain["format"]) == ({"en": "Rain", "fr": ""}, None)


# --- creating ---


def test_create_a_list_tag(admin, caplog):
    caplog.set_level(logging.INFO, "app.audit")
    tag = created(admin)
    assert tag["values"] == [  # sorted by name
        {"id": "beach", "names": {"en": "Beach", "fr": "Plage"}, "used": 0},
        {"id": "dojo", "names": {"en": "Dojo", "fr": "Dojo"}, "used": 0},
    ]
    assert translations("tag_value.place.") == [
        ("tag_value.place.beach.name", "Beach", "Plage"),
        ("tag_value.place.dojo.name", "Dojo", "Dojo"),
    ]
    assert translations("tag.place.") == [("tag.place.name", "Place", "Lieu")]
    assert sql("SELECT name, value_format, input_mode FROM tag WHERE id = 'place'") == [
        ("tag.place.name", "list", "text")
    ]
    assert "tag.created tag_id=place" in caplog.text
    # Usable at once by the upload page.
    listed = next(t for t in admin.get("/api/tags").json() if t["id"] == "place")
    assert listed["values"] == [{"id": "beach", "name": "Beach"}, {"id": "dojo", "name": "Dojo"}]


def test_create_a_numeric_free_tag(admin):
    body = {
        "id": "dan",
        "names": {"en": "Dan", "fr": "Dan"},
        "format": "free",
        "hint": {"en": "1 to 15", "fr": "1 à 15"},
        "input_mode": "numeric",
        "min": 1,
        "max": 15,
        "regexp": "ignored",
        "values": PLACE["values"],  # ignored: not a list
    }
    tag = created(admin, body)
    assert {k: tag[k] for k in ("format", "regexp", "hint", "input_mode", "min", "max", "values")} == {
        "format": "free",
        "regexp": None,
        "hint": {"en": "1 to 15", "fr": "1 à 15"},
        "input_mode": "numeric",
        "min": 1,
        "max": 15,
        "values": [],
    }
    listed = next(t for t in admin.get("/api/tags", headers={"Accept-Language": "fr"}).json() if t["id"] == "dan")
    assert listed == {
        "id": "dan",
        "name": "Dan",
        "format": "free",
        "hint": "1 à 15",
        "input_mode": "numeric",
        "min": 1,
        "max": 15,
    }


def test_hints_and_bounds_only_where_they_apply(admin):
    body = {**PLACE, "hint": NAMES, "input_mode": "numeric", "min": 1}  # list: no hint, no keyboard
    tag = created(admin, body)
    assert (tag["hint"], tag["input_mode"], tag["min"]) == (None, "text", None)
    body = {"id": "dan", "names": NAMES, "format": "free", "min": 1, "max": 2}  # bounds: numeric only
    tag = created(admin, body)
    assert (tag["min"], tag["max"]) == (None, None)
    assert translations("tag.place.hint") == []


@pytest.mark.parametrize(
    "change, code",
    [
        ({"id": "Place"}, "validation.pattern"),
        ({"id": "pl.ace"}, "validation.pattern"),
        ({"names": {"en": "Place"}}, "validation.translations"),
        ({"names": {"en": "Place", "fr": "Lieu", "de": "Ort"}}, "validation.translations"),
        ({"names": {"en": "Place", "fr": "  "}}, "validation.too_short"),
        ({"values": [{"id": "do.jo", "names": NAMES}]}, "validation.pattern"),
        ({"values": [{"id": "dojo", "names": NAMES}, {"id": "dojo", "names": NAMES}]}, "tag.duplicate_value"),
        ({"values": [{"id": "dojo", "previous_id": "dojo", "names": NAMES}]}, "tag.value_unknown"),
        ({"format": "regexp"}, "tag.regexp_invalid"),
        ({"format": "regexp", "regexp": "[12"}, "tag.regexp_invalid"),
        ({"format": "free", "input_mode": "numeric", "min": 3, "max": 2}, "tag.range_invalid"),
        ({"format": "other"}, "validation.invalid"),
    ],
)
def test_create_refused(admin, change, code):
    r = admin.post("/api/admin/tags", json={**PLACE, **change})
    assert (r.status_code, r.json()["code"]) == (422, code), r.text
    assert sql("SELECT count(*) FROM tag WHERE id = 'place'") == [(0,)]


def test_create_an_existing_id_refused(admin):
    r = admin.post("/api/admin/tags", json={**PLACE, "id": "year"})
    assert (r.status_code, r.json()["code"], r.json()["params"]) == (409, "tag.exists", {"tag": "year"})


# --- saving ---


def test_rename_everywhere(admin, caplog):
    caplog.set_level(logging.INFO, "app.audit")
    created(admin)
    use("place", "dojo", segment=1)
    use("place", "beach", video=False, segment=2)
    body = {
        **PLACE,
        "id": "venue",
        "values": [  # dojo ↔ beach swapped, a new one
            {"id": "beach", "previous_id": "dojo", "names": {"en": "Was dojo", "fr": "Était dojo"}},
            {"id": "dojo", "previous_id": "beach", "names": {"en": "Was beach", "fr": "Était plage"}},
            {"id": "park", "names": {"en": "Park", "fr": "Parc"}},
        ],
    }
    r = admin.put("/api/admin/tags/place", json=body)
    assert r.status_code == 200, r.text
    assert [(v["id"], v["used"]) for v in r.json()["values"]] == [("park", 0), ("dojo", 1), ("beach", 2)]
    assert sql("SELECT tag, value FROM video_has_tags") == [("venue", "beach")]
    assert sql("SELECT segment, tag, value FROM segment_has_tags ORDER BY segment") == [
        (1, "venue", "beach"),
        (2, "venue", "dojo"),
    ]
    assert translations("tag.place.") == translations("tag_value.place.") == []
    assert translations("tag_value.venue.") == [
        ("tag_value.venue.beach.name", "Was dojo", "Était dojo"),
        ("tag_value.venue.dojo.name", "Was beach", "Était plage"),
        ("tag_value.venue.park.name", "Park", "Parc"),
    ]
    assert sql("PRAGMA foreign_key_check") == []
    assert "tag.saved tag_id=venue previous_id=place" in caplog.text


def test_save_keeps_a_value_by_its_id(admin):
    """Without previous_id, a value already there is the same value (names changed)."""
    created(admin)
    use("place", "dojo")
    body = {**PLACE, "values": [{"id": "dojo", "names": {"en": "Hall", "fr": "Salle"}}]}  # beach removed
    r = admin.put("/api/admin/tags/place", json=body)
    assert r.status_code == 200, r.text
    assert translations("tag_value.place.") == [("tag_value.place.dojo.name", "Hall", "Salle")]
    assert sql("SELECT tag, value FROM video_has_tags") == [("place", "dojo")]


def test_a_new_value_takes_the_id_a_renamed_one_left(admin):
    created(admin)
    use("place", "dojo")
    body = {
        **PLACE,
        "values": [
            {"id": "hall", "previous_id": "dojo", "names": {"en": "Hall", "fr": "Salle"}},
            {"id": "dojo", "names": {"en": "New dojo", "fr": "Nouveau dojo"}},
            {"id": "beach", "previous_id": "beach", "names": {"en": "Beach", "fr": "Plage"}},
        ],
    }
    assert admin.put("/api/admin/tags/place", json=body).status_code == 200
    assert sql("SELECT value FROM video_has_tags") == [("hall",)]
    assert translations("tag_value.place.dojo") == [("tag_value.place.dojo.name", "New dojo", "Nouveau dojo")]


def test_a_value_in_use_cannot_be_removed(admin):
    created(admin)
    use("place", "beach", segment=1)
    body = {**PLACE, "values": PLACE["values"][:1]}
    r = admin.put("/api/admin/tags/place", json=body)
    assert (r.status_code, r.json()["code"], r.json()["params"]) == (
        409,
        "tag.value_in_use",
        {"tag": "place", "value": "beach", "count": 2},
    )
    assert len(definition(admin, "place")["values"]) == 2


@pytest.mark.parametrize(
    "change, count",
    [
        ({"format": "regexp", "regexp": "[0-9]{4}"}, 2),  # "1999" passes, "x"s don't
        ({"format": None}, 3),
        ({"format": "free", "input_mode": "numeric", "max": 2000}, 2),
        ({"format": "free", "input_mode": "numeric", "max": 1999}, 2),
    ],
)
def test_a_rule_that_stored_values_break_is_refused(admin, change, count):
    created(admin, {"id": "note", "names": NAMES, "format": "free"})
    use("note", "1999", segment=1)
    use("note", "x", video=False, segment=2)
    sql("INSERT INTO segment_has_tags (segment, tag, value) VALUES (3, 'note', 'x')")  # no such segment: no FK here
    r = admin.put("/api/admin/tags/note", json={"id": "note", "names": NAMES, **change})
    assert (r.status_code, r.json()["code"], r.json()["params"]) == (
        422,
        "tag.format_conflict",
        {"tag": "note", "count": count + (1 if change.get("format") is None else 0)},
    )


def test_a_rule_that_stored_values_follow(admin):
    created(admin, {"id": "note", "names": NAMES, "format": "free"})
    use("note", "1999")
    r = admin.put("/api/admin/tags/note", json={"id": "note", "names": NAMES, "format": "regexp", "regexp": "1[0-9]+"})
    assert r.status_code == 200, r.text
    # A list from free text: the stored values must be its value IDs.
    body = {"id": "note", "names": NAMES, "format": "list", "values": [{"id": "1999", "names": NAMES}]}
    assert admin.put("/api/admin/tags/note", json=body).status_code == 200


def test_save_unknown_or_onto_another_tag(admin):
    r = admin.put("/api/admin/tags/nope", json=PLACE)
    assert (r.status_code, r.json()["code"]) == (404, "tag.not_found")
    created(admin)
    r = admin.put("/api/admin/tags/place", json={**PLACE, "id": "year"})
    assert (r.status_code, r.json()["code"]) == (409, "tag.exists")


def test_the_annotation_follows_the_new_rule(admin):
    created(admin)
    body = {"all_segments_done": True, "tags": [{"id": "place", "value": "dojo"}], "segments": []}
    assert admin.put("/api/videos/1/annotations", json=body).status_code == 200
    admin.put(
        "/api/admin/tags/place", json={**PLACE, "values": [{"id": "hall", "previous_id": "dojo", "names": NAMES}]}
    )
    r = admin.put("/api/videos/1/annotations", json=body)
    assert (r.status_code, r.json()["code"]) == (422, "tag.value")
    assert admin.get("/api/videos/1/annotations").json()["tags"] == [{"id": "place", "value": "hall"}]


# --- deleting ---


def test_delete(admin, caplog):
    caplog.set_level(logging.INFO, "app.audit")
    created(admin)
    created(admin, {"id": "dan", "names": NAMES, "format": "free", "hint": NAMES})
    for tag_id in ("place", "dan"):
        assert admin.delete(f"/api/admin/tags/{tag_id}").status_code == 204
    assert sql("SELECT count(*) FROM tag WHERE id IN ('place', 'dan')") == [(0,)]
    assert sql("SELECT count(*) FROM tag_value WHERE tag = 'place'") == [(0,)]
    assert translations("tag.place.") == translations("tag.dan.") == translations("tag_value.place.") == []
    assert "tag.deleted tag_id=dan" in caplog.text


def test_delete_in_use_or_unknown_refused(admin):
    use("year", "2024", segment=2)
    r = admin.delete("/api/admin/tags/year")
    assert (r.status_code, r.json()["code"], r.json()["params"]) == (409, "tag.in_use", {"tag": "year", "count": 2})
    r = admin.delete("/api/admin/tags/nope")
    assert (r.status_code, r.json()["code"]) == (404, "tag.not_found")


# --- the rule of a value ---


@pytest.mark.parametrize(
    "rule, value, error",
    [
        (tags.Rule(None), None, None),
        (tags.Rule(None), "x", ("tag.no_value", {})),
        (tags.Rule("free"), "", ("tag.missing_value", {})),
        (tags.Rule("free"), "anything", None),
        (tags.Rule("list", frozenset({"b", "a"})), "c", ("tag.value", {"values": "a, b"})),
        (tags.Rule("regexp", regexp="[0-9]+"), "12a", ("tag.pattern", {"pattern": "[0-9]+"})),
        (tags.Rule("regexp", regexp="[0-9]+", min=10), "9", ("tag.range", {"min": 10, "max": "…"})),
        (tags.Rule("free", max=10), "11", ("tag.range", {"min": "…", "max": 10})),
        (tags.Rule("free", max=10), "-3", None),
        (tags.Rule("free", min=1, max=10), "x", ("tag.range", {"min": 1, "max": 10})),
        (tags.Rule("free", min=1, max=10), "10", None),
    ],
)
def test_value_error(rule, value, error):
    assert tags.value_error(rule, value) == error
