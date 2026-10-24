"""Encoding queue: a background thread of the app, one video at a time.

Loop: delete the originals no longer needed, claim the oldest queued video,
check its original (complete, SHA-256 as announced, long enough), encode it
with tools/encode-videos/encode-videos.sh (libx265, NNEDI3 deinterlacing, HDR
tone mapping) unless it is already in that format (then it is published as
it is, same bytes and same SHA-256: see needs_encoding), check the result,
store it under video/<h2>/<sha256>/ with its thumbnails, and publish it.
The CPU work is done by ffmpeg (child process, low priority); this thread only
waits and reports progress to the database.

Restart: encodings cut by a crash or reboot are queued again at startup (at
most MAX_ATTEMPTS tries); a clean shutdown puts the current one back without
counting the attempt.

Environment: VIDEONINJA_X265_PRESET (default medium), VIDEONINJA_ENCODE_SCRIPT
(default: tools/encode-videos/encode-videos.sh of the repository),
VIDEONINJA_ENCODER=0 to disable it; folders in paths.py.
"""

import hashlib
import json
import logging
import os
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from . import clock, db, paths, queries, snapshot

log = logging.getLogger("uvicorn.error")

MAX_ATTEMPTS = 3
UPLOAD_EXPIRY_S = 7 * 24 * 3600  # an upload not submitted within a week is deleted
POLL_S = 10
PROGRESS_EVERY_S = 5
HASH_SHARE = 5  # % of the progress bar for checking the original; encoding gets the rest up to 95
THUMB_WIDTH = 320
GOP_S = 1  # encode-videos.sh's keyframe interval (-g), needed by the nginx mp4 module's cuts
DEFAULT_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "encode-videos" / "encode-videos.sh"


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """A connection of its own (this is not a request), in one transaction, then closed."""
    con = db.connect()
    try:
        with con:
            yield con
    finally:
        con.close()


class Gone(Exception):
    """The video is no longer to be encoded (deleted meanwhile)."""


class Stopped(Exception):
    """The app is shutting down."""


class JobError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


X265_PRESETS = ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow",
                "placebo")


def x265_preset() -> str:
    """VIDEONINJA_X265_PRESET (default medium), case and spaces ignored. RuntimeError if it
    is not a libx265 preset: checked at startup, not at the first encoding."""
    value = os.environ.get("VIDEONINJA_X265_PRESET", "medium")
    preset = value.strip().strip("\"'").strip().lower()
    if preset not in X265_PRESETS:
        raise RuntimeError(f"VIDEONINJA_X265_PRESET={value!r}: must be one of {', '.join(X265_PRESETS)}")
    return preset


class Encoder:
    def __init__(self) -> None:
        self.uploads = paths.upload_dir()
        self.videos = paths.video_dir()
        self.work = self.videos / ".work"  # same filesystem as video/: moves are renames
        try:
            self.preset = x265_preset()
        except RuntimeError:
            self.preset = ""  # the app refuses to start with it (main.lifespan): never used
        self.script = os.environ.get("VIDEONINJA_ENCODE_SCRIPT", str(DEFAULT_SCRIPT))
        self.stopping = threading.Event()
        self.process: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None

    # --- lifecycle ---

    def start(self) -> None:
        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            log.warning("Encoder not started: ffmpeg/ffprobe not found (uploads stay queued)")
            return
        self.work.mkdir(parents=True, exist_ok=True)
        with transaction() as con:
            queries.requeue_interrupted(con, MAX_ATTEMPTS)
        self.thread = threading.Thread(target=self.run, name="encoder", daemon=True)
        self.thread.start()
        log.info("Encoder started (x265 preset %s)", self.preset)

    def stop(self) -> None:
        self.stopping.set()
        self.kill_encoding()
        if self.thread:
            self.thread.join(timeout=60)

    def kill_encoding(self) -> None:
        """Stop the script AND its ffmpeg: the script does not pass SIGTERM on,
        so the whole process group goes (else ffmpeg keeps encoding, orphaned)."""
        process = self.process
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(30)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()

    def run(self) -> None:
        while not self.stopping.is_set():
            try:
                self.housekeeping()
                if not self.run_once():
                    self.stopping.wait(POLL_S)
            except Exception:  # noqa: BLE001 - keep the queue alive
                log.exception("Encoder error")
                self.stopping.wait(POLL_S)

    # --- queue ---

    def housekeeping(self) -> None:
        """Delete the originals of published, dropped or abandoned uploads."""
        with transaction() as con:
            queries.expire_uploads(con, clock.at(-UPLOAD_EXPIRY_S))
            tus_ids = queries.deleted_uploads(con)
        for tus_id in tus_ids:
            for path in self.upload_files(tus_id):
                path.unlink(missing_ok=True)
            with transaction() as con:
                queries.delete_upload(con, tus_id)
            log.info("Original %s deleted", tus_id)

    def run_once(self) -> bool:
        """Encode one queued video; False if the queue is empty."""
        with transaction() as con:
            row = queries.next_job(con)
            if row is None:
                return False
            if not queries.claim_job(con, row["id"]):
                return True
            segments = [dict(s) for s in queries.job_segments(con, row["id"])]
        video = row["id"]
        job = {"video": video, "tus_id": row["upload"], "original_sha256": row["original_sha256"],
               "segments": segments}
        log.info("Video %s: claimed", video)
        work = self.work / str(video)
        try:
            self.publish(video, self.process_job(job, work))
        except Gone:
            log.info("Video %s: deleted while encoding, stopped", video)
        except Stopped:
            with transaction() as c:
                queries.release_job(c, video)
            log.info("Video %s: back in the queue (shutdown)", video)
        except JobError as e:
            self.fail(video, str(e), e.retryable)
        except Exception as e:  # noqa: BLE001 - report anything, keep the queue alive
            log.exception("Video %s: unexpected error", video)
            self.fail(video, f"Unexpected error: {e}", retryable=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return True

    def fail(self, video: int, error: str, retryable: bool) -> None:
        with transaction() as con:
            row = queries.video(con, video)
            requeue = retryable and row is not None and row["attempts"] < MAX_ATTEMPTS
            queries.requeue_or_fail(con, video, error[:2000], requeue)
        log.warning("Video %s: encoding failed (%s): %s", video, "retry" if requeue else "final", error)

    def publish(self, video: int, result: dict) -> None:
        sha256 = result["sha256"]
        folder = self.videos / sha256[:2] / sha256
        try:
            with transaction() as con:
                row = queries.video(con, video)
                published = row is not None and queries.publish_video(
                    con, video, sha256, f"{sha256[:2]}/{sha256}", result["thumbnail"], result["duration_s"])
                if published:
                    for segment_id, name in result["segment_thumbnails"].items():
                        queries.set_segment_thumbnail(con, segment_id, video, name)
                    queries.set_upload_state(con, row["upload"], "deleted")  # original: no longer needed
        except sqlite3.IntegrityError:  # same encoded file as another video
            shutil.rmtree(folder, ignore_errors=True)
            raise JobError("Same video as another one") from None
        if not published:  # deleted meanwhile: its files must not stay
            shutil.rmtree(folder, ignore_errors=True)
            raise Gone()
        log.info("Video %s published (%s)", video, sha256)
        snapshot.schedule()

    def progress(self, video: int, percent: float) -> None:
        if self.stopping.is_set():
            raise Stopped()
        with transaction() as con:
            if not queries.job_progress(con, video, int(percent)):
                raise Gone()

    # --- one job ---

    def upload_files(self, tus_id: str) -> list[Path]:
        if not tus_id or "/" in tus_id or tus_id.startswith("."):
            raise JobError(f"Invalid upload ID {tus_id!r}")
        return [self.uploads / tus_id, self.uploads / f"{tus_id}.info", self.uploads / f"{tus_id}.lock"]

    def process_job(self, job: dict, work: Path) -> dict:
        video = job["video"]
        original, info = self.upload_files(job["tus_id"])[:2]
        check_complete(original, info)
        self.check_hash(video, original, job["original_sha256"])
        duration = probe_duration(original)
        if any(s["end_s"] > duration + 1 for s in job["segments"]):
            raise JobError("A segment ends after the end of the video")

        work.mkdir(parents=True, exist_ok=True)
        reason = needs_encoding(original)
        if reason:
            log.info("Video %s: encoding (%s)", video, reason)
            encoded = self.encode(video, original, work, duration)
        else:
            log.info("Video %s: already in the target format, published as it is", video)
            encoded = work / "out" / "video.mp4"
            encoded.parent.mkdir()
            shutil.copyfile(original, encoded)  # a copy: the original stays until published
        check_encoded(encoded)
        sha256 = file_sha256(encoded)
        folder = self.videos / sha256[:2] / sha256
        folder.mkdir(parents=True, exist_ok=True)

        thumbnail(encoded, middle(0, duration, duration), work / "thumb.jpg")
        segment_thumbnails = {}
        for s in job["segments"]:
            name = f"segment-{s['id']}.jpg"
            thumbnail(encoded, middle(s["begin_s"], s["end_s"], duration), work / name)
            segment_thumbnails[s["id"]] = name
        # Thumbnails first, the video last: video.mp4 present = folder complete.
        for name in ["thumb.jpg", *segment_thumbnails.values()]:
            os.replace(work / name, folder / name)
        os.replace(encoded, folder / "video.mp4")
        return {"sha256": sha256, "duration_s": duration, "thumbnail": "thumb.jpg",
                "segment_thumbnails": segment_thumbnails}

    def check_hash(self, video: int, original: Path, expected: str) -> None:
        size = original.stat().st_size or 1
        digest, done, last = hashlib.sha256(), 0, time.monotonic()
        with original.open("rb") as f:
            while chunk := f.read(4 << 20):
                digest.update(chunk)
                done += len(chunk)
                if time.monotonic() - last >= PROGRESS_EVERY_S:
                    self.progress(video, HASH_SHARE * done / size)
                    last = time.monotonic()
        if digest.hexdigest() != expected:
            raise JobError("The uploaded file is not the one announced (SHA-256 differs)")

    def encode(self, video: int, original: Path, work: Path, duration: float) -> Path:
        progress_file = work / "progress"
        out = work / "out"
        cmd = ["nice", "-n", "10", self.script, "-c", "-x", self.preset, "-P", str(progress_file),
               "-o", str(out), "-f", str(original)]
        with (work / "encode.log").open("wb") as log_file:
            # Own process group: stopping it stops ffmpeg too (kill_encoding).
            self.process = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT,
                                            start_new_session=True)
            try:
                last = time.monotonic()
                while self.process.poll() is None:
                    self.stopping.wait(0.5)  # notice the end (or a shutdown) quickly
                    if self.stopping.is_set() or time.monotonic() - last >= PROGRESS_EVERY_S:
                        done = out_time_s(progress_file)
                        self.progress(video, HASH_SHARE + (95 - HASH_SHARE) * min(done / duration, 1))
                        last = time.monotonic()
            finally:
                self.kill_encoding()  # stopped, deleted or failed: nothing keeps running
        if self.process.returncode != 0:
            tail = (work / "encode.log").read_text(encoding="utf-8", errors="replace").strip().splitlines()[-5:]
            raise JobError("Encoding failed: " + " | ".join(tail))
        return out / f"{original.name}.mp4"


encoder = Encoder()


def start() -> None:
    """Start the queue (app startup, or after setup). VIDEONINJA_ENCODER=0: off."""
    global encoder
    if os.environ.get("VIDEONINJA_ENCODER", "1") == "0" or (encoder.thread and encoder.thread.is_alive()):
        return
    encoder = Encoder()  # folders from the current environment
    encoder.start()


def stop() -> None:
    encoder.stop()


# --- file helpers ---


def check_complete(original: Path, info: Path) -> None:
    """tusd's file store keeps the announced Size in <id>.info, but not the
    offset (it stays 0): the data received is the file's size on disk."""
    try:
        meta = json.loads(info.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise JobError("The uploaded file is missing") from None
    if not original.is_file() or original.stat().st_size != meta.get("Size"):
        raise JobError("The upload is incomplete")


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise JobError(f"{cmd[0]} failed: {result.stderr.strip()[-500:]}")
    return result.stdout


def probe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
               "-of", "json", f"file:{path}"])
    data = json.loads(out)
    if not any(s.get("codec_type") == "video" for s in data.get("streams", [])):
        raise JobError("No video in this file")
    try:
        return float(data["format"]["duration"])
    except (KeyError, ValueError):
        raise JobError("Unknown duration") from None


def check_encoded(path: Path) -> None:
    out = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,codec_tag_string",
               "-of", "json", f"file:{path}"])
    streams = json.loads(out).get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    if len(videos) != 1 or videos[0].get("codec_name") != "hevc" or videos[0].get("codec_tag_string") != "hvc1":
        raise JobError("Encoded video is not HEVC/hvc1")
    if any(a.get("codec_name") != "aac" for a in audios):
        raise JobError("Encoded audio is not AAC")


def needs_encoding(path: Path) -> str | None:
    """Why the original must be encoded, or None if its format is already what
    encode-videos.sh makes: MP4 with faststart, one H.265 Main 8-bit video
    (hvc1), SDR BT.709, progressive, a keyframe every GOP_S seconds, AAC stereo
    (or no audio). Only the format counts: metadata (GPS location, dates…),
    chapters and other streams (data, subtitles) are ignored and stay in the
    file. Such a file (e.g. encoded with the script before upload) is published
    as it is: encoding it again would only lose quality and take the Pi minutes
    to hours. When unsure: encode."""
    out = run(["ffprobe", "-v", "error", "-show_entries",
               "format=format_name:stream=codec_type,codec_name,codec_tag_string,profile,pix_fmt,"
               "width,height,field_order,color_transfer,color_primaries,channels,avg_frame_rate"
               ":stream_side_data=side_data_type", "-of", "json", f"file:{path}"])
    data = json.loads(out)
    fmt = data.get("format", {})
    if "mp4" not in fmt.get("format_name", "").split(","):
        return "not an MP4 file"
    if not moov_first(path):
        return "no faststart (index after the media data)"
    streams = data.get("streams", [])
    v = [s for s in streams if s.get("codec_type") == "video"]
    a = [s for s in streams if s.get("codec_type") == "audio"]
    if len(v) != 1:
        return "no video" if not v else "more than one video stream"
    if len(a) > 1:
        return "more than one audio stream"
    v, a = v[0], a[0] if a else None
    if (v.get("codec_name"), v.get("codec_tag_string"), v.get("profile")) != ("hevc", "hvc1", "Main"):
        return f"video is {v.get('codec_name')}/{v.get('codec_tag_string')} {v.get('profile')}, not hevc/hvc1 Main"
    if v.get("pix_fmt") != "yuv420p":
        return f"pixel format {v.get('pix_fmt')}, not yuv420p"
    if v.get("width", 1) % 2 or v.get("height", 1) % 2:
        return "odd dimensions"
    if v.get("field_order") != "progressive":
        return f"field order {v.get('field_order', 'unknown')}, not progressive"
    for key in ("color_transfer", "color_primaries"):
        if v.get(key, "unknown") not in ("bt709", "unknown"):
            return f"{key} {v[key]}, not BT.709 (HDR?)"
    if any("DOVI" in d.get("side_data_type", "") for d in v.get("side_data_list", [])):
        return "Dolby Vision"
    if a is not None and (a.get("codec_name"), a.get("profile"), a.get("channels")) != ("aac", "LC", 2):
        return f"audio is {a.get('codec_name')} {a.get('profile')} with {a.get('channels')} channels, not AAC stereo"
    return keyframe_problem(path, v.get("avg_frame_rate", "0/1"))


def keyframe_problem(path: Path, frame_rate: str) -> str | None:
    """None if the video starts with a keyframe and has one at least every GOP_S
    seconds (one frame of tolerance). Reads packet headers only: no decoding."""
    num, _, den = frame_rate.partition("/")
    frame_s = float(den or 1) / float(num) if float(num or 0) else 0.1
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
               "-of", "csv=p=0", f"file:{path}"])
    keys = sorted(float(t) for t, _, flags in (line.partition(",") for line in out.splitlines())
                  if "K" in flags and t not in ("", "N/A"))
    if not keys or keys[0] > frame_s:
        return "does not start with a keyframe"
    gap = max((b - a for a, b in zip(keys, keys[1:])), default=0)
    if gap > GOP_S + frame_s:
        return f"keyframes up to {gap:.1f} s apart, not every {GOP_S} s"
    return None


def moov_first(path: Path) -> bool:
    """The MP4 index (moov box) comes before the media data (mdat): faststart,
    playback starts before the whole file is downloaded."""
    with path.open("rb") as f:
        while header := f.read(8):
            if len(header) < 8:
                return False
            size, box = int.from_bytes(header[:4]), header[4:]
            if box in (b"moov", b"mdat"):
                return box == b"moov"
            if size == 1:  # 64-bit size after the type
                size = int.from_bytes(f.read(8)) - 8
            if size < 8:  # 0 = up to the end of the file
                return False
            f.seek(size - 8, os.SEEK_CUR)
    return False


def middle(begin_s: float, end_s: float, duration: float) -> float:
    """Where a thumbnail is taken: the middle of the video or segment. A segment
    may end up to 1 s after the video (rounded seconds): only its part inside counts."""
    return (begin_s + min(end_s, duration)) / 2


def thumbnail(video: Path, at_s: float, out: Path) -> None:
    common = ["-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "4", f"file:{out}"]
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{max(at_s, 0):.3f}", "-i", f"file:{video}", *common])
    if not out.is_file():  # -ss past the last frame writes nothing
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", f"file:{video}", *common])


def out_time_s(progress_file: Path) -> float:
    """Last out_time_us of ffmpeg's -progress output, in seconds."""
    try:
        lines = progress_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0.0
    for line in reversed(lines):
        if line.startswith("out_time_us="):
            try:
                return max(int(line.split("=", 1)[1]), 0) / 1e6
            except ValueError:
                return 0.0
    return 0.0


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(4 << 20):
            digest.update(chunk)
    return digest.hexdigest()
