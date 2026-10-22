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


def test_catalog_in_french(client, admin_secret):
    login(client, admin_secret)
    cat = client.get("/api/catalog", headers={"Accept-Language": "fr"}).json()
    assert cat["schools"][0]["description"] == "École de la porte cachée"
    assert cat["schools"][0]["romaji"] == "Togakure Ryu"  # Japanese names are not translated
