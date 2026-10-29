import gzip
import json
import os
import shutil
import sqlite3
import subprocess

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import db, snapshot
from app.api import deps

from .test_auth import login


@pytest.fixture
def logged_in(client, admin_secret):
    assert login(client, admin_secret).status_code == 200
    snapshot.flush()  # the first snapshot, scheduled by the setup
    return client


def add_school(school_id="new_ryu"):
    con = sqlite3.connect(db.db_path())
    with con:
        con.execute("INSERT INTO ryu (id, kanji, romaji) VALUES (?, '新流', 'Shin Ryu')", (school_id,))


def versions() -> list[str]:
    return sorted(d.name for d in (snapshot.catalog_dir() / "versions").iterdir())


def test_x_accel_redirect(logged_in, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    r = logged_in.get("/api/catalog")
    assert r.status_code == 200
    assert r.content == b""
    assert "cache-control" not in r.headers  # set by nginx's internal location
    target = r.headers["x-accel-redirect"]
    version, manifest = snapshot.current()
    name = manifest["catalog"]["en"]
    assert target == f"/protected-catalog/{version}/{name}"
    assert name.startswith("catalog.en.") and name.endswith(".json")

    # The redirect names a file of the versions/ directory (nginx alias).
    data = json.loads((snapshot.catalog_dir() / "versions" / version / name).read_text())
    assert data["schools"][0]["id"] == "togakure"

    fr = logged_in.get("/api/catalog", headers={"Accept-Language": "fr"}).headers["x-accel-redirect"]
    assert "/catalog.fr." in fr and fr != target


def test_requires_login_behind_nginx(client, admin_secret, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_X_ACCEL", "1")
    r = client.get("/api/catalog")
    assert r.status_code == 401
    assert "x-accel-redirect" not in r.headers


def test_catalogue_next_to_the_database_by_default(logged_in):
    assert snapshot.catalog_dir() == db.db_path().parent / "catalog"
    assert (snapshot.catalog_dir() / "current" / "manifest.json").is_file()


def test_unchanged_catalogue_keeps_its_version(logged_in):
    before = snapshot.current()
    assert snapshot.rebuild() == before  # same files, same ETag: clients get 304
    assert versions() == [before[0]]


def test_change_makes_a_new_version(logged_in):
    old_version, old = snapshot.current()
    add_school()
    version, manifest = snapshot.rebuild()
    assert version != old_version
    assert manifest["catalog"]["en"] != old["catalog"]["en"]
    assert os.readlink(snapshot.catalog_dir() / "current") == f"versions/{version}"
    assert old_version in versions()  # kept for requests in flight
    path = snapshot.catalog_dir() / "versions" / version / manifest["catalog"]["en"]
    assert json.loads(path.read_text())["schools"][-1]["id"] == "new_ryu"


def test_old_versions_pruned(logged_in):
    first = snapshot.current()[0]
    for i in range(snapshot.KEEP + 2):
        add_school(f"school{i}")
        snapshot.rebuild()
    kept = versions()
    assert len(kept) == snapshot.KEEP + 1  # current + KEEP previous
    assert first not in kept
    assert not list((snapshot.catalog_dir()).glob("versions/.tmp-*"))


@pytest.mark.skipif(not (shutil.which("brotli") and shutil.which("zopfli")),
                    reason="brotli/zopfli command-line tools not installed")
@pytest.mark.compress
def test_precompressed(logged_in):
    version, manifest = snapshot.current()
    path = snapshot.catalog_dir() / "versions" / version / manifest["catalog"]["en"]
    body = path.read_bytes()
    assert gzip.decompress(path.with_name(path.name + ".gz").read_bytes()) == body
    br = subprocess.run(["brotli", "-dc", f"{path}.br"], check=True, capture_output=True).stdout
    assert br == body


def test_debounced(logged_in, monkeypatch):
    calls = []
    monkeypatch.setattr(snapshot, "rebuild", lambda: calls.append(1))
    monkeypatch.setattr(snapshot, "DEBOUNCE_S", 60)
    for _ in range(5):
        snapshot.schedule()
    assert calls == []
    snapshot.flush()
    assert calls == [1]  # one rebuild for the burst
    snapshot.flush()
    assert calls == [1]  # nothing pending


def test_rebuild_after_write(monkeypatch):
    scheduled = []
    monkeypatch.setattr(snapshot, "schedule", lambda: scheduled.append(1))
    # Any router whose writes change the catalogue, whoever may call it.
    router = APIRouter(dependencies=[Depends(deps.rebuild_after_write)])

    @router.get("/item")
    def read():
        return {}

    @router.post("/item")
    def write():
        return {}

    @router.patch("/item")
    def refused():
        raise HTTPException(403, "Access denied")

    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    assert c.get("/item").status_code == 200
    assert scheduled == []
    assert c.patch("/item").status_code == 403
    assert scheduled == []
    assert c.post("/item").status_code == 200
    assert scheduled == [1]
