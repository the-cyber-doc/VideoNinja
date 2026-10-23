"""The encoder with real ffmpeg and encode-videos.sh, on tiny generated clips."""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

import pytest

from app import db, encoder

from .test_upload import admin, hook, session, submit, uploaded  # noqa: F401 (fixture)

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
    folder = enc.videos / sha[:2] / sha
    assert sorted(p.name for p in folder.iterdir()) == ["segment-1.jpg", "thumb.jpg", "video.mp4"]
    assert hashlib.sha256((folder / "video.mp4").read_bytes()).hexdigest() == sha
    encoder.check_encoded(folder / "video.mp4")  # HEVC hvc1 + AAC
    assert encoder.needs_encoding(folder / "video.mp4") is None  # uploaded again: not encoded twice
    assert not list(enc.work.iterdir())  # scratch cleaned
    enc.housekeeping()
    assert not list(enc.uploads.iterdir())  # original deleted once published


# --- originals already in the target format (sample videos next to this file) ---

TESTS = Path(__file__).parent
READY = TESTS / "video_test_noneed_encoding.mp4"  # 20 s, H.265 hvc1 Main, 1080p60 BT.709, keyframe/s, AAC
NOT_READY = TESTS / "video_test_need_encoding.webm"  # 20 s, AV1 + Opus in WebM
samples = pytest.mark.skipif(not (READY.is_file() and NOT_READY.is_file()), reason="sample videos missing")


def failing_script(tmp_path) -> tuple[str, Path]:
    """An encode-videos.sh stand-in that only records that it was called."""
    called = tmp_path / "called"
    script = tmp_path / "encode.sh"
    script.write_text(f"#!/bin/sh\necho \"$@\" >> {called}\nexit 1\n")
    script.chmod(0o755)
    return str(script), called


def queue_sample(admin, enc, sample: Path) -> int:  # noqa: F811
    """Like queue(), but the upload is a symlink to the sample (not copied)."""
    tus_id = uploaded(admin, sha=encoder.file_sha256(sample), size=sample.stat().st_size)
    (enc.uploads / tus_id).symlink_to(sample)
    (enc.uploads / f"{tus_id}.info").write_text(json.dumps({"Size": sample.stat().st_size, "Offset": 0}))
    segment = {"begin_s": 5, "end_s": 15, "technique": "gyokko.koku", "performer": "hatsumi", "tags": []}
    return submit(admin, tus_id, segments=[segment]).json()["id"]


def remuxed(tmp_path, *options, chapters=False) -> Path:
    """READY with its streams copied into a new MP4 (no encoding), with `options`."""
    out = tmp_path / "remuxed.mp4"
    extra = []
    if chapters:
        (tmp_path / "chapters.txt").write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=0\nEND=10\n"
                                               "title=Omote\n")
        extra = ["-f", "ffmetadata", "-i", str(tmp_path / "chapters.txt"), "-map_chapters", "1"]
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", f"file:{READY}", *extra, "-c", "copy",
                    "-tag:v", "hvc1", *options, f"file:{out}"], check=True)
    return out


@samples
def test_detects_what_needs_encoding():
    assert encoder.needs_encoding(READY) is None
    assert encoder.needs_encoding(NOT_READY) == "not an MP4 file"


@samples
@pytest.mark.parametrize("options, reason", [
    (["-movflags", "+faststart"], None),  # same as READY
    ([], "no faststart (index after the media data)"),
    # Only the format counts: metadata (e.g. a phone's GPS location) stays.
    (["-movflags", "+faststart", "-metadata", "location=+46.2044+006.1432/", "-metadata", "title=Kata"], None),
    (["-movflags", "+faststart", "-map", "0:v", "-map", "0:a", "-map", "0:a"], "more than one audio stream"),
])
def test_published_as_it_is_when_the_format_is_right(tmp_path, options, reason):
    assert encoder.needs_encoding(remuxed(tmp_path, *options)) == reason


@samples
def test_chapters_are_ignored(tmp_path):
    with_chapters = remuxed(tmp_path, "-movflags", "+faststart", chapters=True)
    assert "Omote" in subprocess.run(["ffprobe", "-v", "error", "-show_chapters", str(with_chapters)],
                                     capture_output=True, text=True, check=True).stdout
    assert encoder.needs_encoding(with_chapters) is None


@samples
def test_original_in_the_target_format_is_not_encoded(admin, enc, tmp_path):  # noqa: F811
    enc.script, called = failing_script(tmp_path)
    video = queue_sample(admin, enc, READY)
    assert enc.run_once() is True

    status, error, sha, thumb = row(video)
    assert (status, error, thumb) == ("published", None, "thumb.jpg")
    assert not called.exists()  # the encoding script never ran
    # Published as it is: the same file, so the same hash as the original.
    original_sha = sqlite3.connect(db.db_path()).execute(
        "SELECT original_sha256 FROM video WHERE id = ?", (video,)).fetchone()[0]
    assert sha == original_sha == encoder.file_sha256(READY)
    published = enc.videos / sha[:2] / sha / "video.mp4"
    assert published.read_bytes() == READY.read_bytes()


def copying_script(tmp_path, result: Path) -> str:
    """An encode-videos.sh stand-in that "encodes" by copying `result` (fast)."""
    script = tmp_path / "encode.sh"
    script.write_text("#!/bin/sh\n"
                      'while [ $# -gt 1 ]; do [ "$1" = -o ] && out=$2; shift; done\n'
                      f'mkdir -p "$out" && cp {result} "$out/$(basename "$1").mp4"\n')
    script.chmod(0o755)
    return str(script)


def refused_again(admin, sha: str, size: int) -> None:  # noqa: F811
    """Uploading a file with this hash again is refused: before the upload (the
    page's check) and by tusd's pre-create hook (if the page is bypassed)."""
    assert admin.get(f"/api/videos/exists?original_sha256={sha}").json() == {"exists": True}
    answer = hook(admin, "pre-create", session(admin), size=size, sha=sha)
    assert answer["RejectUpload"] is True
    assert answer["HTTPResponse"]["StatusCode"] == 409
    assert json.loads(answer["HTTPResponse"]["Body"]) == {"detail": "This video already exists"}


@samples
def test_reupload_of_a_video_published_as_it_is(admin, enc, tmp_path):  # noqa: F811
    enc.script, _ = failing_script(tmp_path)
    queue_sample(admin, enc, READY)
    assert enc.run_once() is True
    refused_again(admin, encoder.file_sha256(READY), READY.stat().st_size)


@samples
def test_reupload_of_an_encoded_video(admin, enc, tmp_path):  # noqa: F811
    enc.script = copying_script(tmp_path, READY)  # its "encoding" of NOT_READY is READY
    video = queue_sample(admin, enc, NOT_READY)
    assert enc.run_once() is True
    assert row(video)[2] == encoder.file_sha256(READY) != encoder.file_sha256(NOT_READY)
    refused_again(admin, encoder.file_sha256(NOT_READY), NOT_READY.stat().st_size)  # the original
    refused_again(admin, encoder.file_sha256(READY), READY.stat().st_size)  # the published file


def test_thumbnail_in_the_middle():
    assert encoder.middle(0, 20.05, 20.05) == 10.025  # the video's
    assert encoder.middle(5, 15, 20.05) == 10  # a segment's
    assert encoder.middle(18, 21, 20.05) == 19.025  # a segment ending after the video (rounded up)


@samples
def test_thumbnails_taken_in_the_middle(admin, enc, tmp_path, monkeypatch):  # noqa: F811
    taken = {}
    real = encoder.thumbnail

    def record(video, at_s, out):
        taken[out.name] = at_s
        real(video, at_s, out)

    monkeypatch.setattr(encoder, "thumbnail", record)
    queue_sample(admin, enc, READY)  # one segment, 5-15 s
    assert enc.run_once() is True
    assert taken == {"thumb.jpg": encoder.probe_duration(READY) / 2, "segment-1.jpg": 10}


@samples
def test_original_in_another_format_is_encoded(admin, enc, tmp_path):  # noqa: F811
    enc.script, called = failing_script(tmp_path)  # a real 1080p60 encode would take minutes
    video = queue_sample(admin, enc, NOT_READY)
    assert enc.run_once() is True
    assert len(called.read_text().splitlines()) == 1  # encode-videos.sh was called, once
    status, error, _, _ = row(video)
    assert status == "failed" and error.startswith("Encoding failed")


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
