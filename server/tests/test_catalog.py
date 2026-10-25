import sqlite3

from app import db, snapshot

from .test_auth import login

# Techniques of the seed used by the tests (Gyokko Ryu, Jo Ryaku no Maki).
KOKU = "gyokko.taijutsu.jo_ryaku.koku"
KETO = "gyokko.taijutsu.jo_ryaku.keto"
HANEBI = "gyokko.taijutsu.jo_ryaku.hanebi"

SCHOOLS = ["togakure", "gyokko", "kukishinden", "koto", "shinden",
           "takagi", "gikan", "gyokushin", "kumogakure"]


def no_nulls(value) -> bool:
    if isinstance(value, dict):
        return all(v is not None and no_nulls(v) for v in value.values())
    if isinstance(value, list):
        return all(no_nulls(v) for v in value)
    return value is not None


def test_requires_login(client, admin_secret):
    assert client.get("/api/catalog").status_code == 401


def test_catalog(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    r = client.get("/api/catalog")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "private, no-cache"
    cat = r.json()
    assert no_nulls(cat)

    assert [s["id"] for s in cat["schools"]] == SCHOOLS  # seed (traditional) order
    assert cat["schools"][0] == {"id": "togakure", "kanji": "戸隠流", "romaji": "Togakure Ryu",
                                 "description": "School of the Hidden Door"}
    assert [c["id"] for c in cat["categories"]] == ["taijutsu", "muto_dori", "buki"]
    assert cat["categories"][2] == {"id": "buki", "kanji": "武器", "romaji": "Buki", "description": "Weapons"}
    assert "rokushakubo" in {w["id"] for w in cat["weapons"]}

    # Sections: a school's scrolls and groups, in their order; a weapon only under Buki.
    sections = {s["id"]: s for s in cat["sections"]}
    gyokko = [s["id"] for s in cat["sections"] if s["ryu"] == "gyokko"]
    assert gyokko == ["gyokko.taijutsu.sanshin", "gyokko.taijutsu.torite_kihon", "gyokko.taijutsu.jo_ryaku",
                      "gyokko.taijutsu.chu_ryaku", "gyokko.taijutsu.ge_ryaku"]
    assert sections["kukishinden.buki.rokushakubo.shoden"] == {
        "id": "kukishinden.buki.rokushakubo.shoden", "kanji": "初伝型", "romaji": "Shoden Gata",
        "description": "Initial transmission forms", "ryu": "kukishinden", "category": "buki", "weapon": "rokushakubo"}
    for s in cat["sections"]:
        assert s["ryu"] in SCHOOLS and ("weapon" in s) == (s["category"] == "buki")

    assert all(t["section"] in sections for t in cat["techniques"])
    koku = next(t for t in cat["techniques"] if t["id"] == KOKU)
    assert koku == {"id": KOKU, "kanji": "虚空", "romaji": "Koku",
                    "description": "Empty space", "section": "gyokko.taijutsu.jo_ryaku"}
    assert cat["segments"] == []  # no video in the seed data


def test_catalog_in_french(client, admin_secret):
    login(client, admin_secret)
    cat = client.get("/api/catalog", headers={"Accept-Language": "fr"}).json()
    assert cat["schools"][0]["description"] == "École de la porte cachée"
    assert cat["schools"][0]["romaji"] == "Togakure Ryu"  # Japanese names are not translated
    koku = next(t for t in cat["techniques"] if t["id"] == KOKU)
    assert koku["description"] == "Espace vide" and koku["romaji"] == "Koku"
    assert cat["categories"][0]["description"] == "Techniques à mains nues"


def test_segments_in_catalog(client, admin_secret):
    login(client, admin_secret)
    add_segments()
    snapshot.rebuild()
    cat = client.get("/api/catalog").json()
    assert cat["segments"] == [
        {"id": 1, "video": 1, "technique": KOKU, "begin_s": 12, "end_s": 27, "performer": "hatsumi"},
        {"id": 2, "video": 1, "technique": KOKU, "begin_s": 40, "end_s": 55, "performer": "hatsumi"},
    ]


SHA = "ab" + "0" * 62


def add_segments(segment_thumbnail="seg1.jpg", video_thumbnail="thumb.jpg"):
    """One published video with two segments of Koku: the first with its own thumbnail."""
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO performer (id, name) VALUES ('hatsumi', 'Hatsumi')")
        con.execute("INSERT INTO video (sha256sum, original_sha256, original_filename, directory, thumbnail,"
                    " uploaded_at, status) VALUES (?, ?, 'a.mp4', ?, ?, '2026-01-01T00:00:00Z', 'published')",
                    (SHA, "f" * 64, f"ab/{SHA}", video_thumbnail))
        con.execute("INSERT INTO segment (video, technique, begin_s, end_s, performer, thumbnail)"
                    " VALUES (1, 'gyokko.taijutsu.jo_ryaku.koku', 12, 27, 'hatsumi', ?)", (segment_thumbnail,))
        con.execute("INSERT INTO segment (video, technique, begin_s, end_s, performer)"
                    " VALUES (1, 'gyokko.taijutsu.jo_ryaku.koku', 40, 55, 'hatsumi')")


def test_seed_catalogue():
    """The seed's catalogue: every school but two has sections; generated from the JSON."""
    import subprocess
    import sys
    from pathlib import Path
    tool = Path(__file__).resolve().parents[2] / "tools" / "catalog-sql.py"
    check = subprocess.run([sys.executable, str(tool), "--check"], capture_output=True, text=True)
    assert check.returncode == 0, check.stderr  # db_v1_init.sql matches catalog/techniques.json

    con = sqlite3.connect(":memory:")
    for script in db.latest_scripts()[1:]:
        con.executescript(script.read_text(encoding="utf-8"))
    per_school = dict(con.execute('SELECT ryu, count(*) FROM technique JOIN section s ON s.id = section GROUP BY ryu'))
    assert set(per_school) == set(SCHOOLS) - {"gyokushin", "kumogakure"}
    assert sum(per_school.values()) > 600
    # A weapon only (and always) under Buki: the schema refuses anything else.
    for weapon, category in (("jo", "taijutsu"), (None, "buki")):
        try:
            con.execute("INSERT INTO section (id, ryu, category, weapon, kanji, romaji)"
                        " VALUES ('x', 'koto', ?, ?, 'x', 'x')", (category, weapon))
        except sqlite3.IntegrityError:
            continue
        raise AssertionError(f"accepted {category} with weapon {weapon}")
