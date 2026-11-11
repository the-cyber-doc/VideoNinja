"""Catalogue entries proposed with "Other" in the technique picker, and their resolution on the
Options page: edited (renames cascade everywhere), validated, merged, deleted."""

import sqlite3

import pytest

from app.domain import catalog, proposals

from .conftest import connect
from .test_book_annotations import HIGHLIGHT, annotate
from .test_books import logged_in, published, sql
from .test_catalog import KOKU, SHA
from .test_upload import admin  # noqa: F401 (fixture)

JO_RYAKU = "gyokko.taijutsu.jo_ryaku"
URL = "/api/catalog/proposals"


def new(romaji, kanji=""):
    return {"new": {"romaji": romaji, "kanji": kanji}}


def ref(entry_id):
    return {"id": entry_id}


def body(technique, section=None, school="gyokko", category="taijutsu", weapon=None):
    out = {
        "school": school if isinstance(school, dict) else ref(school),
        "category": category if isinstance(category, dict) else ref(category),
        "section": section if isinstance(section, dict) else ref(section or JO_RYAKU),
        "technique": technique if isinstance(technique, dict) else ref(technique),
    }
    if weapon is not None:
        out["weapon"] = weapon if isinstance(weapon, dict) else ref(weapon)
    return out


def propose(client, data, status=201):
    r = client.post(URL, json=data)
    assert r.status_code == status, r.text
    return r.json()


def entries(client):
    r = client.get("/api/admin/proposals")
    assert r.status_code == 200, r.text
    return {(e["kind"], e["id"]): e for e in r.json()}


def edit(client, kind, entry_id, data, status=200):
    r = client.put(f"/api/admin/proposals/{kind}/{entry_id}", json=data)
    assert r.status_code == status, r.text
    return r.json()


def code(r):
    return r.json()["code"]


def snapshot():
    con = connect()
    con.row_factory = sqlite3.Row  # as the app's connections
    with con:
        return catalog.build(con, "en")


# --- the IDs ---


def test_slug_and_ids():
    assert proposals.slug("Kotō  Gake!") == "koto_gake"
    assert proposals.slug("虚空") == "entry"
    assert len(proposals.slug("a" * 99)) == 40
    assert proposals.section_id("togakure", "buki", "ninjato", "kamae") == "togakure.buki.ninjato.kamae"
    assert proposals.section_id("gyokko", "taijutsu", None, "x") == "gyokko.taijutsu.x"
    assert proposals.name_of(KOKU) == "koku"


# --- proposing ---


def test_a_new_technique_in_a_known_section(admin):  # noqa: F811
    out = propose(admin, body(new("Kotō Gake", "虎倒掛")))
    assert out == {
        "technique": f"{JO_RYAKU}.koto_gake",
        "created": [
            {
                "kind": "technique",
                "id": f"{JO_RYAKU}.koto_gake",
                "kanji": "虎倒掛",
                "romaji": "Kotō Gake",
                "ryu": None,
                "category": None,
                "weapon": None,
                "section": JO_RYAKU,
            }
        ],
    }
    again = propose(admin, body(new("  Koto gake ")))  # the same name: another ID; spaces trimmed, no kanji
    assert again["technique"] == f"{JO_RYAKU}.koto_gake_2"
    assert again["created"][0]["kanji"] == "" and again["created"][0]["romaji"] == "Koto gake"
    shown = next(t for t in snapshot()["techniques"] if t["id"] == f"{JO_RYAKU}.koto_gake")
    assert shown == {
        "id": f"{JO_RYAKU}.koto_gake",
        "kanji": "虎倒掛",
        "romaji": "Kotō Gake",
        "proposed": True,
        "section": JO_RYAKU,
    }
    assert "proposed" not in next(t for t in snapshot()["techniques"] if t["id"] == KOKU)


def test_every_step_new(admin):  # noqa: F811
    out = propose(admin, body(new("Kote"), new("Kihon"), school=new("Kasumi Ryu"), category=new("Jutaijutsu")))
    assert [(c["kind"], c["id"]) for c in out["created"]] == [
        ("school", "kasumi_ryu"),
        ("category", "jutaijutsu"),
        ("section", "kasumi_ryu.jutaijutsu.kihon"),
        ("technique", "kasumi_ryu.jutaijutsu.kihon.kote"),
    ]
    assert out["created"][2] | {"kind": "section"} == {
        "kind": "section",
        "id": "kasumi_ryu.jutaijutsu.kihon",
        "kanji": "",
        "romaji": "Kihon",
        "ryu": "kasumi_ryu",
        "category": "jutaijutsu",
        "weapon": None,
        "section": None,
    }


def test_a_new_weapon_under_buki(admin):  # noqa: F811
    out = propose(admin, body(new("Tsuki"), new("Kihon"), category="buki", weapon=new("Kusari Fundo")))
    assert out["technique"] == "gyokko.buki.kusari_fundo.kihon.tsuki"


def test_proposals_refused(admin):  # noqa: F811
    cases = [
        (body(new("X"), school="nope"), 422, "catalog.unknown"),
        (body(new("X"), category="buki"), 422, "catalog.weapon"),  # Buki needs a weapon
        (body(new("X"), weapon="hanbo"), 422, "catalog.weapon"),  # and only Buki has one
        (body(new("X"), section="togakure.buki.ninjato.kamae"), 422, "catalog.mismatch"),  # another school's
        (body("togakure.buki.ninjato.kamae.x", section=JO_RYAKU), 422, "catalog.unknown"),
        (body(f"{JO_RYAKU}.koku", section="gyokko.taijutsu.missing"), 422, "catalog.unknown"),
        (body({"id": KOKU, "new": {"romaji": "X"}}), 422, "validation.missing"),  # both
        (body({}), 422, "validation.missing"),  # neither
        (body(new("   ")), 422, "validation.missing"),
    ]
    for data, status, expected in cases:
        r = admin.post(URL, json=data)
        assert (r.status_code, code(r)) == (status, expected), data
    other = sql("SELECT id FROM technique WHERE section <> ? LIMIT 1", JO_RYAKU)[0][0]
    r = admin.post(URL, json=body(other))
    assert (r.status_code, code(r)) == (422, "catalog.mismatch")
    long = "a" * 40
    r = admin.post(URL, json=body(new(long), new(long), school=new(long), category=new(long)))
    assert (r.status_code, code(r)) == (422, "catalog.id_too_long")
    assert sql("SELECT count(*) FROM ryu WHERE proposed_at IS NOT NULL") == [(0,)]  # nothing kept


def test_nothing_new_creates_nothing(admin, caplog):  # noqa: F811
    assert propose(admin, body(KOKU)) == {"technique": KOKU, "created": []}
    assert "catalog.proposed" not in caplog.text


def test_who_may_propose(admin):  # noqa: F811
    plain = logged_in(admin, "kenji", "user")
    assert plain.post(URL, json=body(new("X"))).status_code == 403
    books = logged_in(admin, "aiko", "book_mgmt")
    assert books.post(URL, json=body(new("X"))).status_code == 201
    assert books.get("/api/admin/proposals").status_code == 403  # resolving: the options access


# --- the Options page ---


def add_segments():
    """A published video with two segments of Koku (its performer: the admin fixture's)."""
    con = connect()
    with con:
        con.execute(
            "INSERT INTO video (sha256sum, original_sha256, original_filename, directory, uploaded_at, status)"
            " VALUES (?, ?, 'a.mp4', ?, '2026-01-01T00:00:00Z', 'published')",
            (SHA, "f" * 64, f"ab/{SHA}"),
        )
        for begin in (12, 40):
            con.execute(
                "INSERT INTO segment (video, technique, begin_s, end_s, performer) VALUES (1, ?, ?, ?, 'hatsumi')",
                (KOKU, begin, begin + 10),
            )


@pytest.fixture
def proposed(admin):  # noqa: F811
    """A new school with a section and two techniques, one of them used by a segment, a book
    annotation and a comment."""
    out = propose(admin, body(new("Kote", "小手"), new("Kihon"), school=new("Kasumi")))
    propose(admin, body(new("Ura"), "kasumi.taijutsu.kihon", school="kasumi"))
    used = out["technique"]
    add_segments()  # 1 and 2, of Koku
    sql("UPDATE segment SET technique = ? WHERE id = 1", used)
    annotate(admin, published(admin), {**HIGHLIGHT, "technique": used})
    admin.post(f"/api/techniques/{used}/comments", json={"text": "Seen", "lang": "en"})
    return used


def test_the_list(admin, proposed):  # noqa: F811
    listed = entries(admin)
    assert [k for k in listed] == [
        ("school", "kasumi"),
        ("section", "kasumi.taijutsu.kihon"),
        ("technique", proposed),
        ("technique", "kasumi.taijutsu.kihon.ura"),
    ]
    kote = listed[("technique", proposed)]
    assert kote == {
        **kote,
        "name": "kote",
        "kanji": "小手",
        "romaji": "Kote",
        "section": "kasumi.taijutsu.kihon",
        "ryu": None,
        "descriptions": {"en": "", "fr": ""},
        "used": 3,
        "children": 0,
        "proposed_by": "Admin",
    }
    assert listed[("section", "kasumi.taijutsu.kihon")]["children"] == 2
    assert listed[("school", "kasumi")]["children"] == 1


def test_edit_a_technique_renames_it_everywhere(admin, proposed):  # noqa: F811
    out = edit(
        admin,
        "technique",
        proposed,
        {
            "name": "kote_gaeshi",
            "kanji": "小手返",
            "romaji": "Kote Gaeshi",
            "parents": {"section": JO_RYAKU},
            "descriptions": {"en": "Wrist turn", "fr": "Retournement du poignet"},
        },
    )
    new_id = f"{JO_RYAKU}.kote_gaeshi"
    assert (out["id"], out["section"], out["kanji"], out["descriptions"]) == (
        new_id,
        JO_RYAKU,
        "小手返",
        {"en": "Wrist turn", "fr": "Retournement du poignet"},
    )
    for table in ("segment", "book_annotation", "comment"):
        assert sql(f"SELECT count(*) FROM {table} WHERE technique = ?", new_id) == [(1,)], table
    assert sql("SELECT count(*) FROM technique WHERE id = ?", proposed) == [(0,)]
    shown = next(t for t in snapshot()["techniques"] if t["id"] == new_id)
    assert shown["description"] == "Wrist turn"

    # Renamed again: its meaning's translation follows; cleared: gone.
    out = edit(
        admin,
        "technique",
        new_id,
        {"name": "kote_2", "romaji": "Kote", "parents": {"section": JO_RYAKU}, "descriptions": {"en": "Wrist"}},
    )
    assert out["descriptions"] == {"en": "Wrist", "fr": ""}
    assert sql("SELECT id FROM translation WHERE id LIKE 'technique.gyokko.taijutsu.jo_ryaku.kote%'") == [
        (f"technique.{JO_RYAKU}.kote_2.description",)
    ]
    out = edit(
        admin,
        "technique",
        out["id"],
        {"name": "kote_2", "romaji": "Kote", "parents": {"section": JO_RYAKU}, "descriptions": {"en": " ", "fr": ""}},
    )
    assert out["descriptions"] == {"en": "", "fr": ""}
    assert sql("SELECT count(*) FROM translation WHERE id LIKE 'technique.gyokko.taijutsu.jo_ryaku.kote%'") == [(0,)]
    assert sql("PRAGMA foreign_key_check") == []


def test_edit_refused(admin, proposed):  # noqa: F811
    keep = {"name": "kote", "romaji": "Kote", "parents": {"section": "kasumi.taijutsu.kihon"}}
    cases = [
        ("technique", proposed, {**keep, "name": "ura"}, 409, "catalog.id_taken"),
        ("technique", proposed, {**keep, "parents": {"section": "nope"}}, 422, "catalog.unknown"),
        ("technique", proposed, {**keep, "parents": {}}, 422, "catalog.unknown"),
        ("technique", proposed, {**keep, "descriptions": {"fr": "Seulement"}}, 422, "validation.missing"),
        ("technique", proposed, {**keep, "descriptions": {"de": "x"}}, 422, "validation.invalid"),
        ("technique", proposed, {**keep, "descriptions": {"en": "x" * 501}}, 422, "validation.too_long"),
        ("technique", proposed, {**keep, "name": "Kote Gaeshi"}, 422, "validation.pattern"),
        ("technique", KOKU, keep, 409, "catalog.not_proposed"),
        ("technique", "gyokko.nope", keep, 404, "catalog.not_found"),
        (
            "section",
            "kasumi.taijutsu.kihon",
            {"name": "kihon", "romaji": "K", "parents": {"ryu": "nope", "category": "taijutsu"}},
            422,
            "catalog.unknown",
        ),
        (
            "section",
            "kasumi.taijutsu.kihon",
            {"name": "kihon", "romaji": "K", "parents": {"ryu": "kasumi"}},
            422,
            "catalog.unknown",
        ),
        (
            "section",
            "kasumi.taijutsu.kihon",
            {"name": "kihon", "romaji": "K", "parents": {"ryu": "kasumi", "category": "buki"}},
            422,
            "catalog.weapon",
        ),
        (
            "section",
            "kasumi.taijutsu.kihon",
            {"name": "kihon", "romaji": "K", "parents": {"ryu": "kasumi", "category": "buki", "weapon": "nope"}},
            422,
            "catalog.unknown",
        ),
    ]
    for kind, entry_id, data, status, expected in cases:
        r = admin.put(f"/api/admin/proposals/{kind}/{entry_id}", json=data)
        assert (r.status_code, code(r)) == (status, expected), (kind, data)
    # Deep under Buki: a longer name would make an ID past the limit (96).
    deep = propose(admin, body(new("t"), new("c" * 20), school=new("a" * 30), category="buki", weapon=new("b" * 30)))
    section = deep["created"][2]["id"]
    r = admin.put(
        f"/api/admin/proposals/technique/{deep['technique']}",
        json={"name": "t" * 20, "romaji": "T", "parents": {"section": section}},
    )
    assert (r.status_code, code(r)) == (422, "catalog.id_too_long")
    assert sql("SELECT count(*) FROM technique WHERE section = 'kasumi.taijutsu.kihon'") == [(2,)]  # unchanged


def test_moving_a_section_or_renaming_a_school_moves_what_is_under_it(admin, proposed):  # noqa: F811
    edit(
        admin,
        "section",
        "kasumi.taijutsu.kihon",
        {
            "name": "kihon",
            "romaji": "Kihon",
            "parents": {"ryu": "kasumi", "category": "taijutsu"},
            "descriptions": {"en": "Basics"},
        },
    )
    out = edit(
        admin,
        "section",
        "kasumi.taijutsu.kihon",
        {
            "name": "kihon",
            "romaji": "Kihon",
            "parents": {"ryu": "kasumi", "category": "buki", "weapon": "hanbo"},
            "descriptions": {"en": "Basics"},
        },
    )
    assert (out["id"], out["weapon"]) == ("kasumi.buki.hanbo.kihon", "hanbo")
    out = edit(admin, "school", "kasumi", {"name": "kasumi_ryu", "kanji": "霞流", "romaji": "Kasumi Ryū"})
    assert out["id"] == "kasumi_ryu"
    assert sql("SELECT id, ryu FROM section WHERE ryu = 'kasumi_ryu'") == [
        ("kasumi_ryu.buki.hanbo.kihon", "kasumi_ryu")
    ]
    assert sorted(r[0] for r in sql("SELECT id FROM technique WHERE section = 'kasumi_ryu.buki.hanbo.kihon'")) == [
        "kasumi_ryu.buki.hanbo.kihon.kote",
        "kasumi_ryu.buki.hanbo.kihon.ura",
    ]
    assert sql("SELECT technique FROM segment WHERE id = 1") == [("kasumi_ryu.buki.hanbo.kihon.kote",)]
    assert sql("SELECT description FROM section WHERE ryu = 'kasumi_ryu'") == [
        ("section.kasumi_ryu.buki.hanbo.kihon.description",)
    ]
    assert sql("PRAGMA foreign_key_check") == []


def test_a_new_weapon_renamed(admin):  # noqa: F811
    out = propose(admin, body(new("Tsuki"), new("Kihon"), category="buki", weapon=new("Fundo")))
    edit(admin, "weapon", "fundo", {"name": "kusari_fundo", "romaji": "Kusari Fundo"})
    assert sql("SELECT id FROM technique WHERE id LIKE 'gyokko.buki.kusari_fundo.%'") == [
        ("gyokko.buki.kusari_fundo.kihon.tsuki",)
    ]
    assert out["technique"] == "gyokko.buki.fundo.kihon.tsuki"


def test_validate_parents_first(admin, proposed):  # noqa: F811
    v = lambda kind, entry_id: admin.post(f"/api/admin/proposals/{kind}/{entry_id}/validate")  # noqa: E731
    r = v("technique", proposed)
    assert (r.status_code, code(r), r.json()["params"]) == (
        409,
        "catalog.parent_proposed",
        {"parent": "kasumi.taijutsu.kihon"},
    )
    r = v("section", "kasumi.taijutsu.kihon")
    assert (r.status_code, r.json()["params"]) == (409, {"parent": "kasumi"})
    for kind, entry_id in (("school", "kasumi"), ("section", "kasumi.taijutsu.kihon"), ("technique", proposed)):
        assert v(kind, entry_id).status_code == 204
    assert ("technique", proposed) not in entries(admin)
    assert "proposed" not in next(t for t in snapshot()["techniques"] if t["id"] == proposed)
    assert code(v("technique", proposed)) == "catalog.not_proposed"
    # A section under Buki: its weapon checked too.
    propose(admin, body(new("Tsuki"), new("Kihon"), category="buki", weapon="hanbo"))
    assert v("section", "gyokko.buki.hanbo.kihon").status_code == 204


def test_merge(admin, proposed):  # noqa: F811
    m = lambda kind, entry_id, into: admin.post(f"/api/admin/proposals/{kind}/{entry_id}/merge", json={"into": into})  # noqa: E731
    assert code(m("technique", proposed, proposed)) == "catalog.merge_self"
    assert code(m("technique", proposed, "nope")) == "catalog.unknown"
    edit(
        admin,
        "technique",
        proposed,
        {
            "name": "kote",
            "romaji": "Kote",
            "parents": {"section": "kasumi.taijutsu.kihon"},
            "descriptions": {"en": "Wrist"},
        },
    )

    # A technique into Koku: its uses go there.
    assert m("technique", proposed, KOKU).status_code == 204
    assert sql("SELECT technique FROM segment WHERE id = 1") == [(KOKU,)]
    assert sql("SELECT count(*) FROM translation WHERE id LIKE 'technique.kasumi%'") == [(0,)]

    # A school into Gyokko: its section moves there (Jo Ryaku exists: merged, its techniques
    # with it: one with Koku's name merged, the other moved).
    propose(admin, body(new("Koku"), "kasumi.taijutsu.kihon", school="kasumi"))
    edit(
        admin,
        "section",
        "kasumi.taijutsu.kihon",
        {"name": "jo_ryaku", "romaji": "Jo Ryaku", "parents": {"ryu": "kasumi", "category": "taijutsu"}},
    )
    sql("UPDATE segment SET technique = 'kasumi.taijutsu.jo_ryaku.koku' WHERE id = 2")
    propose(admin, body(new("Hicho"), new("Other section"), school="kasumi"))
    assert m("school", "kasumi", "gyokko").status_code == 204
    assert sql("SELECT count(*) FROM ryu WHERE id = 'kasumi'") == [(0,)]
    assert sql("SELECT technique FROM segment WHERE id = 2") == [(KOKU,)]
    assert sql("SELECT count(*) FROM technique WHERE id = ?", f"{JO_RYAKU}.ura") == [(1,)]
    assert sql("SELECT count(*) FROM technique WHERE id = 'gyokko.taijutsu.other_section.hicho'") == [(1,)]
    assert sql("PRAGMA foreign_key_check") == []

    # A category whose sections have no weapon: never into Buki.
    propose(admin, body(new("X"), new("Y"), category=new("Jutaijutsu")))
    assert code(m("category", "jutaijutsu", "buki")) == "catalog.weapon"
    assert m("category", "jutaijutsu", "taijutsu").status_code == 204
    assert sql("SELECT count(*) FROM technique WHERE id = 'gyokko.taijutsu.y.x'") == [(1,)]
    # A section into another, an unused weapon into another.
    propose(admin, body(new("Z"), new("W")))
    assert m("section", "gyokko.taijutsu.w", "gyokko.taijutsu.y").status_code == 204
    propose(admin, body(new("Z"), new("W"), category="buki", weapon=new("Fundo")))
    assert m("weapon", "fundo", "hanbo").status_code == 204
    assert sql("SELECT count(*) FROM technique WHERE id = 'gyokko.buki.hanbo.w.z'") == [(1,)]


def test_delete_unused_only(admin, proposed):  # noqa: F811
    d = lambda kind, entry_id: admin.delete(f"/api/admin/proposals/{kind}/{entry_id}")  # noqa: E731
    r = d("technique", proposed)
    assert (r.status_code, code(r), r.json()["params"]["count"]) == (409, "catalog.in_use", 3)
    r = d("section", "kasumi.taijutsu.kihon")
    assert (code(r), r.json()["params"]["count"]) == ("catalog.has_children", 2)
    edit(
        admin,
        "technique",
        "kasumi.taijutsu.kihon.ura",
        {
            "name": "ura",
            "romaji": "Ura",
            "parents": {"section": "kasumi.taijutsu.kihon"},
            "descriptions": {"en": "Back"},
        },
    )
    assert d("technique", "kasumi.taijutsu.kihon.ura").status_code == 204
    assert sql("SELECT count(*) FROM translation WHERE id = 'technique.kasumi.taijutsu.kihon.ura.description'") == [
        (0,)
    ]
    assert code(d("technique", KOKU)) == "catalog.not_proposed"


def test_resolving_needs_the_options_access(admin, proposed):  # noqa: F811
    plain = logged_in(admin, "kenji", "video_mgmt")
    for r in (
        plain.get("/api/admin/proposals"),
        plain.put(f"/api/admin/proposals/technique/{proposed}", json={"name": "x", "romaji": "x"}),
        plain.post(f"/api/admin/proposals/technique/{proposed}/validate"),
        plain.post(f"/api/admin/proposals/technique/{proposed}/merge", json={"into": KOKU}),
        plain.delete(f"/api/admin/proposals/technique/{proposed}"),
    ):
        assert r.status_code == 403


def test_a_deleted_proposer(admin):  # noqa: F811
    books = logged_in(admin, "aiko", "book_mgmt")
    propose(books, body(new("Kote")))
    user_id = sql("SELECT id FROM user WHERE username = 'aiko'")[0][0]
    assert admin.delete(f"/api/admin/users/{user_id}").status_code == 204
    [entry] = entries(admin).values()
    assert entry["proposed_by"] is None
    assert sql("SELECT proposed_by FROM technique WHERE proposed_at IS NOT NULL") == [(0,)]


def test_queries_take_catalogue_names_only(admin):  # noqa: F811
    """Table and column names are the callers' constants: anything else is a mistake, refused."""
    from app import queries

    con = connect()
    for call in (
        lambda: queries.proposals.exists(con, "user", "x"),
        lambda: queries.proposals.children(con, "video", "x"),
        lambda: queries.proposals.update(con, "technique", "x", {"proposed_by": "1"}),
    ):
        with pytest.raises(ValueError):
            call()
