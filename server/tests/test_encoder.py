"""The encoder with real ffmpeg and encode-videos.sh, on tiny generated clips."""

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import limits, procs, settings
from app.domain import snapshot
from app.encoder import checks, notify, thumbnails
from app.encoder import queue as encoding  # "queue" is this file's helper
from app.main import app

from .conftest import connect
from .test_catalog import KOKU
from .test_procs import gone
from .test_upload import admin, hook, session, submit, uploaded  # noqa: F401 (fixture)

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg not installed")


@pytest.fixture
def enc(client, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("VIDEONINJA_MEDIA_DIR", str(tmp_path / "media"))
    monkeypatch.setenv("VIDEONINJA_X265_PRESET", "ultrafast")
    e = encoding.Encoder()
    e.uploads.mkdir(parents=True)
    e.work.mkdir(parents=True)
    return e


def clip(path, seconds=3, interlaced=False):
    vf = ["-vf", "tinterlace=interleave_top,fieldorder=tff", "-flags", "+ilme+ildct", "-top", "1"] if interlaced else []
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x120:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            str(seconds),
            *vf,
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
            "-f",
            "mp4",
            str(path),
        ],
        check=True,
    )


def queue(
    admin,  # noqa: F811 - fixture
    enc,
    data: bytes | None = None,
    seconds=3,
    interlaced=False,
    complete=True,
    segments=({"begin_s": 0, "end_s": 2},),
):
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
    full = [{**s, "technique": KOKU, "performer": "hatsumi", "tags": []} for s in segments]
    return submit(admin, tus_id, segments=full).json()["id"]


def row(video):
    return connect().execute("SELECT status, error, sha256sum, thumbnail FROM video WHERE id = ?", (video,)).fetchone()


@pytest.mark.parametrize("interlaced", [False, True])
def test_encodes_and_publishes(admin, enc, interlaced):  # noqa: F811
    video = queue(admin, enc, interlaced=interlaced)
    assert enc.run_once() is True

    status, error, sha, thumb = row(video)
    assert (status, error, thumb) == ("published", None, "thumb.jpg")
    folder = enc.videos / sha[:2] / sha
    assert sorted(p.name for p in folder.iterdir()) == ["segment-1.jpg", "thumb.jpg", "video.mp4"]
    assert hashlib.sha256((folder / "video.mp4").read_bytes()).hexdigest() == sha
    checks.check_encoded(folder / "video.mp4")  # HEVC hvc1 + AAC
    assert checks.needs_encoding(folder / "video.mp4") is None  # uploaded again: not encoded twice
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
    script.write_text(f'#!/bin/sh\necho "$@" >> {called}\nexit 1\n')
    script.chmod(0o755)
    return str(script), called


def queue_sample(admin, enc, sample: Path) -> int:  # noqa: F811
    """Like queue(), but the upload is a symlink to the sample (not copied)."""
    tus_id = uploaded(admin, sha=checks.file_sha256(sample), size=sample.stat().st_size)
    (enc.uploads / tus_id).symlink_to(sample)
    (enc.uploads / f"{tus_id}.info").write_text(json.dumps({"Size": sample.stat().st_size, "Offset": 0}))
    segment = {"begin_s": 5, "end_s": 15, "technique": KOKU, "performer": "hatsumi", "tags": []}
    return submit(admin, tus_id, segments=[segment]).json()["id"]


def remuxed(tmp_path, *options, chapters=False) -> Path:
    """READY with its streams copied into a new MP4 (no encoding), with `options`."""
    out = tmp_path / "remuxed.mp4"
    extra = []
    if chapters:
        (tmp_path / "chapters.txt").write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=0\nEND=10\ntitle=Omote\n")
        extra = ["-f", "ffmetadata", "-i", str(tmp_path / "chapters.txt"), "-map_chapters", "1"]
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-i",
            f"file:{READY}",
            *extra,
            "-c",
            "copy",
            "-tag:v",
            "hvc1",
            *options,
            f"file:{out}",
        ],
        check=True,
    )
    return out


@samples
def test_detects_what_needs_encoding():
    assert checks.needs_encoding(READY) is None
    assert checks.needs_encoding(NOT_READY) == "not an MP4 file"


@samples
@pytest.mark.parametrize(
    "options, reason",
    [
        (["-movflags", "+faststart"], None),  # same as READY
        ([], "no faststart (index after the media data)"),
        # Only the format counts: metadata (e.g. a phone's GPS location) is removed when published.
        (["-movflags", "+faststart", "-metadata", "location=+46.2044+006.1432/", "-metadata", "title=Kata"], None),
        (["-movflags", "+faststart", "-map", "0:v", "-map", "0:a", "-map", "0:a"], "more than one audio stream"),
        # Mono is fine (a phone's microphone); more than stereo is not.
        (["-movflags", "+faststart", "-c:a", "aac", "-ac", "1"], None),
        (
            ["-movflags", "+faststart", "-c:a", "aac", "-ac", "6"],
            "audio is aac LC with 6 channels, not AAC mono or stereo",
        ),
    ],
)
def test_published_as_it_is_when_the_format_is_right(tmp_path, options, reason):
    assert checks.needs_encoding(remuxed(tmp_path, *options)) == reason


@samples
def test_chapters_are_ignored(tmp_path):
    with_chapters = remuxed(tmp_path, "-movflags", "+faststart", chapters=True)
    assert (
        "Omote"
        in subprocess.run(
            ["ffprobe", "-v", "error", "-show_chapters", str(with_chapters)], capture_output=True, text=True, check=True
        ).stdout
    )
    assert checks.needs_encoding(with_chapters) is None


@samples
def test_original_in_the_target_format_is_not_encoded(admin, enc, tmp_path):  # noqa: F811
    enc.script, called = failing_script(tmp_path)
    video = queue_sample(admin, enc, READY)
    assert enc.run_once() is True

    status, error, sha, thumb = row(video)
    assert (status, error, thumb) == ("published", None, "thumb.jpg")
    assert not called.exists()  # the encoding script never ran
    # Its streams copied without the metadata: another file, so another hash.
    original_sha = connect().execute("SELECT original_sha256 FROM video WHERE id = ?", (video,)).fetchone()[0]
    assert original_sha == checks.file_sha256(READY) != sha
    published = enc.videos / sha[:2] / sha / "video.mp4"
    assert checks.file_sha256(published) == sha
    assert checks.needs_encoding(published) is None
    assert "encoder" not in probe(published, "format_tags")  # READY's "Lavf…" is gone


def probe(path: Path, entries: str) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", entries, "-show_chapters", "-of", "compact", f"file:{path}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout


@samples
def test_metadata_stripped_rotation_kept(tmp_path):
    """A phone's recording: GPS location, title, device names, chapters (with their data track)
    and a portrait rotation. Published: only the rotation is left."""
    (tmp_path / "chapters.txt").write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=0\nEND=10\ntitle=Omote\n")
    phone = tmp_path / "phone.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-display_rotation",
            "90",
            "-i",
            f"file:{READY}",
            "-f",
            "ffmetadata",
            "-i",
            str(tmp_path / "chapters.txt"),
            "-map",
            "0",
            "-map_chapters",
            "1",
            "-c",
            "copy",
            "-tag:v",
            "hvc1",
            "-movflags",
            "+faststart",
            "-metadata",
            "location=+46.2044+006.1432/",
            "-metadata",
            "title=Kata",
            "-metadata:s:v",
            "handler_name=Kenji's phone",
            f"file:{phone}",
        ],
        check=True,
    )
    before = probe(phone, "format_tags:stream_tags:stream=codec_type")
    assert all(text in before for text in ("46.2044", "Kata", "Kenji's phone", "Omote", "codec_type=data"))

    out = tmp_path / "out.mp4"
    checks.strip_metadata(phone, out)
    after = probe(out, "format_tags:stream_tags:stream=codec_type:stream_side_data=rotation")
    assert not any(text in after for text in ("46.2044", "Kata", "Kenji", "Omote", "data", "Lav"))
    assert [line.split("|")[1] for line in after.splitlines() if line.startswith("stream")] == [
        "codec_type=video",
        "codec_type=audio",
    ]
    assert "rotation=90" in after  # side data, not metadata: the picture stays upright
    assert checks.needs_encoding(out) is None


def copying_script(tmp_path, result: Path) -> str:
    """An encode-videos.sh stand-in that "encodes" by copying `result` (fast)."""
    script = tmp_path / "encode.sh"
    script.write_text(
        "#!/bin/sh\n"
        'while [ $# -gt 1 ]; do [ "$1" = -o ] && out=$2; shift; done\n'
        f'mkdir -p "$out" && cp {result} "$out/$(basename "$1").mp4"\n'
    )
    script.chmod(0o755)
    return str(script)


def refused_again(admin, sha: str, size: int) -> None:  # noqa: F811
    """Uploading a file with this hash again is refused: before the upload (the
    page's check) and by tusd's pre-create hook (if the page is bypassed)."""
    assert admin.get(f"/api/videos/exists?original_sha256={sha}").json() == {"exists": True}
    answer = hook(admin, "pre-create", session(admin), size=size, sha=sha)
    assert answer["RejectUpload"] is True
    assert answer["HTTPResponse"]["StatusCode"] == 409
    assert json.loads(answer["HTTPResponse"]["Body"])["code"] == "video.exists"


@samples
def test_reupload_of_a_video_published_as_it_is(admin, enc, tmp_path):  # noqa: F811
    enc.script, _ = failing_script(tmp_path)
    queue_sample(admin, enc, READY)
    assert enc.run_once() is True
    refused_again(admin, checks.file_sha256(READY), READY.stat().st_size)


@samples
def test_reupload_of_an_encoded_video(admin, enc, tmp_path):  # noqa: F811
    enc.script = copying_script(tmp_path, READY)  # its "encoding" of NOT_READY is READY
    video = queue_sample(admin, enc, NOT_READY)
    assert enc.run_once() is True
    assert row(video)[2] == checks.file_sha256(READY) != checks.file_sha256(NOT_READY)
    refused_again(admin, checks.file_sha256(NOT_READY), NOT_READY.stat().st_size)  # the original
    refused_again(admin, checks.file_sha256(READY), READY.stat().st_size)  # the published file


def test_thumbnail_in_the_middle():
    assert thumbnails.middle(0, 20.05, 20.05) == 10.025  # the video's
    assert thumbnails.middle(5, 15, 20.05) == 10  # a segment's
    assert thumbnails.middle(18, 21, 20.05) == 19.025  # a segment ending after the video (rounded up)


@samples
def test_thumbnails_taken_in_the_middle(admin, enc, tmp_path, monkeypatch):  # noqa: F811
    taken = {}
    real = thumbnails.thumbnail

    def record(video, at_s, out):
        taken[out.name] = at_s
        real(video, at_s, out)

    monkeypatch.setattr(thumbnails, "thumbnail", record)
    queue_sample(admin, enc, READY)  # one segment, 5-15 s
    assert enc.run_once() is True
    assert taken == {"thumb.jpg": checks.probe_duration(READY) / 2, "segment-1.jpg": 10}


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
    assert checks.out_time_s(f) == 2.5
    assert checks.out_time_s(tmp_path / "missing") == 0.0


def test_rejects_path_in_upload_id(enc):
    with pytest.raises(checks.JobError):
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
        except Exception as e:
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


@pytest.mark.parametrize("value, preset", [("fast", "fast"), (" Medium\r", "medium"), ('"slow"', "slow")])
def test_x265_preset_tidied(monkeypatch, value, preset):
    monkeypatch.setenv("VIDEONINJA_X265_PRESET", value)
    assert settings.current().x265_preset == preset


@pytest.mark.parametrize("value", ["", "p6", "medium fast"])
def test_invalid_x265_preset_refuses_start(tmp_path, monkeypatch, value):
    """Checked at startup with the value received, not at the first encoding."""
    monkeypatch.setenv("VIDEONINJA_DB", str(tmp_path / "videoninja.db"))
    monkeypatch.setenv("VIDEONINJA_X265_PRESET", value)
    with (
        pytest.raises(RuntimeError, match=re.escape(f"VIDEONINJA_X265_PRESET={value!r}: must be one of ultrafast")),
        TestClient(app),
    ):
        pass


@pytest.mark.parametrize(
    "keep, present, absent",
    [
        (False, ["-map_metadata -1", "-map_chapters -1", "+bitexact"], ["-map_metadata 0"]),
        (True, ["-map_metadata 0", "-map_chapters 0"], ["-map_metadata -1", "+bitexact"]),
    ],
)
def test_script_strips_metadata_unless_asked(tmp_path, keep, present, absent):
    """encode-videos.sh: metadata removed by default, kept with -m (dry run: the ffmpeg command)."""
    clip = tmp_path / "clip.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x120:rate=25:d=1",
            "-c:v",
            "libx264",
            f"file:{clip}",
        ],
        check=True,
    )
    out = subprocess.run(
        [str(settings.DEFAULT_SCRIPT), "-c", "-n", *(["-m"] if keep else []), "-o", str(tmp_path / "out"), str(clip)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert all(option in out for option in present), out
    assert not any(option in out for option in absent), out


@pytest.mark.parametrize(
    "rate, options, every",
    [
        (25, [], "1"),
        (30, [], "1"),
        (60, [], "0.5"),  # auto: 1 s up to 30 fps, 0.5 s above
        (60, ["-g", "2"], "2"),  # -g sets it
    ],
)
def test_script_keyframe_interval(tmp_path, rate, options, every):
    """encode-videos.sh: a keyframe every second, every half second above 30 fps (dry run)."""
    clip = tmp_path / "clip.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=160x120:rate={rate}:d=1",
            "-c:v",
            "libx264",
            f"file:{clip}",
        ],
        check=True,
    )
    result = subprocess.run(
        [str(settings.DEFAULT_SCRIPT), "-c", "-n", *options, "-o", str(tmp_path / "out"), str(clip)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert f"{rate} fps, keyframe every {every} s" in result.stderr
    # The dry run prints the ffmpeg command shell-escaped: expr:gte\(t\,n_forced\*1\)
    assert re.search(rf"n_forced\\?\*{re.escape(every)}\\?\)", result.stdout), result.stdout


# --- hardening: formats, time limits, its own container ---


def test_script_gets_the_formats_and_the_time_limit(enc, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_INPUT_FORMATS", "mov,matroska")
    monkeypatch.setenv("VIDEONINJA_FFMPEG_TIMEOUT_H", "2")
    monkeypatch.setenv("VIDEONINJA_FFPROBE_TIMEOUT_MIN", "10")
    enc.script, called = failing_script(tmp_path)
    (tmp_path / "work").mkdir()
    with pytest.raises(checks.JobError):
        enc.encode(1, tmp_path / "original", tmp_path / "work", 60.0)
    args = called.read_text().split()
    assert args[args.index("-W") + 1] == "mov,matroska" and args[args.index("-T") + 1] == "7200"
    assert args[args.index("-L") + 1] == "600"


def test_encoding_stopped_after_the_time_limit(enc, tmp_path, monkeypatch):
    """Too long: stopped (ffmpeg included), a final failure (not tried again)."""
    pid_file = tmp_path / "child.pid"
    script = tmp_path / "encode.sh"
    script.write_text(f"#!/bin/bash\nsleep 60 &\necho $! > {pid_file}\nwait\n")
    script.chmod(0o755)
    enc.script = str(script)
    enc.progress = lambda video, percent: None
    monkeypatch.setenv("VIDEONINJA_FFMPEG_TIMEOUT_H", str(1 / 3600))  # 1 s
    (tmp_path / "work").mkdir()
    with pytest.raises(checks.JobError, match="stopped after") as error:
        enc.encode(1, tmp_path / "original", tmp_path / "work", 60.0)
    assert not error.value.retryable
    assert gone(int(pid_file.read_text()))  # the "ffmpeg" too


def test_probe_time_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(procs, "run", lambda cmd: (_ for _ in ()).throw(procs.Timeout("x")))
    with pytest.raises(checks.JobError) as error:
        checks.probe_duration(tmp_path / "a.mp4")
    assert not error.value.retryable


def test_only_allowed_formats_are_read(tmp_path, monkeypatch):
    """By content, whatever the name: a Matroska file named .mp4 is refused when
    only MP4 is allowed. And only local files."""
    sample = Path(__file__).parent / "video_test_need_encoding.webm"
    disguised = tmp_path / "kata.mp4"
    disguised.symlink_to(sample)
    assert checks.probe_duration(disguised) > 0
    monkeypatch.setenv("VIDEONINJA_INPUT_FORMATS", "mov")
    with pytest.raises(checks.JobError, match="whitelist"):
        checks.probe_duration(disguised)
    with pytest.raises(checks.JobError, match="whitelist"):
        checks.run(["ffprobe", "-v", "error", *limits.ffmpeg_input(), "http://127.0.0.1:9/a.mp4"])


def test_script_refuses_other_formats(tmp_path):
    sample = Path(__file__).parent / "video_test_need_encoding.webm"
    result = subprocess.run(
        [str(settings.DEFAULT_SCRIPT), "-c", "-n", "-W", "mov", "-o", str(tmp_path / "out"), str(sample)],
        capture_output=True,
        text=True,
    )
    assert "FAIL" in result.stderr, result.stderr
    result = subprocess.run(
        [str(settings.DEFAULT_SCRIPT), "-c", "-n", "-o", str(tmp_path / "out"), str(sample)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "-protocol_whitelist file -format_whitelist mov\\,matroska" in result.stdout, result.stdout


def test_catalogue_rebuilt_by_the_api(client, admin_secret, monkeypatch):
    """The encoder's container has no catalogue: it asks the API, which rebuilds it at once."""
    scheduled = []
    monkeypatch.setattr(snapshot, "rebuild_now", lambda: scheduled.append(True))
    assert client.post("/internal/catalog-changed").status_code == 204
    assert scheduled == [True]

    requests = []
    monkeypatch.setenv("VIDEONINJA_API_URL", "http://api:8000/")
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda r, timeout: requests.append((r.method, r.full_url)) or io.BytesIO()
    )
    notify.catalog_changed()
    assert requests == [("POST", "http://api:8000/internal/catalog-changed")]
    assert scheduled == [True]  # not in the encoder itself


def test_container_waits_for_the_setup_and_stops_on_sigterm(tmp_path):
    """python -m app.encoder before the setup: waits for the database; SIGTERM: exits at once."""
    env = {
        **os.environ,
        "VIDEONINJA_DB": str(tmp_path / "none.db"),
        "VIDEONINJA_MEDIA_DIR": str(tmp_path / "m"),
        "VIDEONINJA_UPLOAD_DIR": str(tmp_path / "u"),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "app.encoder"], env=env, cwd=Path(__file__).parents[1], stderr=subprocess.PIPE, text=True
    )
    time.sleep(1)
    assert process.poll() is None  # waiting
    process.terminate()
    assert process.wait(5) == 0


def test_container_refuses_wrong_settings(tmp_path):
    env = {**os.environ, "VIDEONINJA_DB": str(tmp_path / "none.db"), "VIDEONINJA_INPUT_FORMATS": "hls"}
    result = subprocess.run(
        [sys.executable, "-m", "app.encoder"],
        env=env,
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode != 0 and "VIDEONINJA_INPUT_FORMATS" in result.stderr


def test_container_waits_for_the_expected_database_version(tmp_path):
    """A database not migrated yet (the API migrates it at its start): the encoder waits."""
    from .test_migrations import build

    build(tmp_path / "v1.db", 1)
    env = {
        **os.environ,
        "VIDEONINJA_DB": str(tmp_path / "v1.db"),
        "VIDEONINJA_MEDIA_DIR": str(tmp_path / "m"),
        "VIDEONINJA_UPLOAD_DIR": str(tmp_path / "u"),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "app.encoder"], env=env, cwd=Path(__file__).parents[1], stderr=subprocess.PIPE, text=True
    )
    time.sleep(1)
    assert process.poll() is None  # waiting, not encoding on the old schema
    process.terminate()
    assert process.wait(5) == 0
    con = sqlite3.connect(tmp_path / "v1.db")  # untouched: still version 1, no heartbeat table
    assert con.execute("SELECT value FROM config WHERE name = 'db_version'").fetchone() == ("1",)
    assert con.execute("SELECT count(*) FROM sqlite_master WHERE name = 'heartbeat'").fetchone() == (0,)
    con.close()
