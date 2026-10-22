import sqlite3

from app import db, snapshot

from .test_auth import login

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
    assert [lv["id"] for lv in cat["levels"]] == ["shoden", "chuden", "okuden"]

    assert cat["techniques"]
    levels = {lv["id"] for lv in cat["levels"]}
    for tech in cat["techniques"]:
        assert tech["ryu"] in SCHOOLS and tech["level"] in levels
    assert cat["techniques"][0] == {"id": "gyokko.koku", "kanji": "虚空", "romaji": "Koku",
                                    "description": "Description will be added later.",
                                    "ryu": "gyokko", "level": "shoden"}
    assert cat["segments"] == []  # no video in the seed data


def test_catalog_in_french(client, admin_secret):
    login(client, admin_secret)
    cat = client.get("/api/catalog", headers={"Accept-Language": "fr"}).json()
    assert cat["schools"][0]["description"] == "École de la porte cachée"
    assert cat["schools"][0]["romaji"] == "Togakure Ryu"  # Japanese names are not translated
    assert cat["techniques"][0]["description"] == "La description sera ajoutée plus tard."


def test_segments_in_catalog(client, admin_secret):
    login(client, admin_secret)
    add_segments()
    snapshot.rebuild()
    cat = client.get("/api/catalog").json()
    assert cat["segments"] == [
        {"id": 1, "video": 1, "technique": "gyokko.koku", "begin_s": 12, "end_s": 27, "performer": "hatsumi"},
        {"id": 2, "video": 1, "technique": "gyokko.koku", "begin_s": 40, "end_s": 55, "performer": "hatsumi"},
    ]


SHA = "ab" + "0" * 62


def add_segments(segment_thumbnail="seg1.jpg", video_thumbnail="thumb.jpg"):
    """One video with two segments of Koku: the first with its own thumbnail."""
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO performer (id, name) VALUES ('hatsumi', 'Hatsumi')")
        con.execute("INSERT INTO video (sha256sum, filename, directory, thumbnail) VALUES (?, 'a.mp4', 'x', ?)",
                    (SHA, video_thumbnail))
        con.execute("INSERT INTO segment (video, technique, begin_s, end_s, performer, thumbnail)"
                    " VALUES (1, 'gyokko.koku', 12, 27, 'hatsumi', ?)", (segment_thumbnail,))
        con.execute("INSERT INTO segment (video, technique, begin_s, end_s, performer)"
                    " VALUES (1, 'gyokko.koku', 40, 55, 'hatsumi')")
