"""The encoder with real ffmpeg and encode-videos.sh, on tiny generated clips."""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import threading
import time

import pytest

from app import db, encoder

from .test_upload import admin, submit, uploaded  # noqa: F401 (fixture)

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                reason="ffmpeg not installed")


@pytest.fixture
def enc(client, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    monkeypatch.setenv("VIDEONINJA_X265_PRESET", "ultrafast")
    e = encoder.Encoder()
    e.uploads.mkdir(parents=True)
    e.work.mkdir(parents=True)
    return e


def clip(path, seconds=3, interlaced=False):
    vf = ["-vf", "tinterlace=interleave_top,fieldorder=tff", "-flags", "+ilme+ildct", "-top", "1"] if interlaced else []
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-t", str(seconds), *vf,
                    "-c:v", "libx264", "-c:a", "aac", "-shortest", "-f", "mp4", str(path)], check=True)


def queue(admin, enc, data: bytes | None = None, seconds=3, interlaced=False, complete=True,  # noqa: F811
          segments=({"begin_s": 0, "end_s": 2},)):
    """Upload (as tusd would) and submit a clip; returns the video ID."""
    scratch = enc.uploads / "scratch"
    if data is None:
        clip(scratch, seconds, interlaced)
        data = scratch.read_bytes()
        scratch.unlink()
    sha = hashlib.sha256(data).hexdigest()
    tus_id = uploaded(admin, sha=sha, size=len(data))
    (enc.uploads / tus_id).write_bytes(data if complete else data[:-10])
    (enc.uploads / f"{tus_id}.info").write_text(json.dumps({"Size": len(data), "Offset": 0}))  # as tusd
    full = [{**s, "technique": "gyokko.koku", "performer": "hatsumi", "tags": []} for s in segments]
    return submit(admin, tus_id, segments=full).json()["id"]


def row(video):
    return sqlite3.connect(db.db_path()).execute(
        "SELECT status, error, sha256sum, thumbnail FROM video WHERE id = ?", (video,)).fetchone()


@pytest.mark.parametrize("interlaced", [False, True])
def test_encodes_and_publishes(admin, enc, interlaced):  # noqa: F811
    video = queue(admin, enc, interlaced=interlaced)
    assert enc.run_once() is True

    status, error, sha, thumb = row(video)
    assert (status, error, thumb) == ("published", None, "thumb.jpg")
    folder = enc.derived / sha[:2] / sha
    assert sorted(p.name for p in folder.iterdir()) == ["segment-1.jpg", "thumb.jpg", "video.mp4"]
    assert hashlib.sha256((folder / "video.mp4").read_bytes()).hexdigest() == sha
    encoder.check_encoded(folder / "video.mp4")  # HEVC hvc1 + AAC
    assert not list(enc.work.iterdir())  # scratch cleaned
    enc.housekeeping()
    assert not list(enc.uploads.iterdir())  # original deleted once published


def test_hash_mismatch(admin, enc):  # noqa: F811
    video = queue(admin, enc)
    original = next(p for p in enc.uploads.iterdir() if not p.suffix)
    original.write_bytes(original.read_bytes()[:-1] + b"\0")  # same size, other content
    enc.run_once()
    assert row(video)[:2] == ("failed", "The uploaded file is not the one announced (SHA-256 differs)")


def test_incomplete_upload(admin, enc):  # noqa: F811
    video = queue(admin, enc, complete=False)
    enc.run_once()
    assert row(video)[:2] == ("failed", "The upload is incomplete")


def test_segment_after_the_end(admin, enc):  # noqa: F811
    video = queue(admin, enc, seconds=2, segments=[{"begin_s": 5, "end_s": 9}])
    enc.run_once()
    assert row(video)[:2] == ("failed", "A segment ends after the end of the video")


def test_not_a_video(admin, enc):  # noqa: F811
    video = queue(admin, enc, data=b"not a video at all", segments=[])
    enc.run_once()
    assert row(video)[0] == "failed"


def test_progress_parsing(tmp_path):
    f = tmp_path / "progress"
    f.write_text("out_time_us=1000000\nprogress=continue\nout_time_us=2500000\nprogress=continue\n")
    assert encoder.out_time_s(f) == 2.5
    assert encoder.out_time_s(tmp_path / "missing") == 0.0


def test_rejects_path_in_upload_id(enc):
    with pytest.raises(encoder.JobError):
        enc.upload_files("../etc")


def test_stopping_kills_ffmpeg_too(enc, tmp_path):
    """A script that, like encode-videos.sh, waits for a child (ffmpeg) and does
    not pass SIGTERM on: stopping must not leave the child running."""
    pid_file = tmp_path / "child.pid"
    script = tmp_path / "encode.sh"
    script.write_text(f"#!/bin/bash\nsleep 60 &\necho $! > {pid_file}\nwait\n")
    script.chmod(0o755)
    enc.script = str(script)
    work = tmp_path / "work"
    work.mkdir()
    enc.progress = lambda video, percent: None
    errors = []

    def encode():
        try:
            enc.encode(1, tmp_path / "original", work, 60.0)
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    thread = threading.Thread(target=encode)
    thread.start()
    for _ in range(100):
        if pid_file.exists() and pid_file.read_text().strip():
            break
        time.sleep(0.05)
    child = int(pid_file.read_text())
    enc.stop()
    thread.join(10)
    time.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(child, 0)  # the "ffmpeg" is gone
