"""The encoding queue: the worker (a background thread of the app, or of its own
container), one video at a time.

Loop: delete the originals no longer needed, claim the oldest queued video,
check its original (complete, SHA-256 as announced, long enough), encode it
with tools/encode-videos/encode-videos.sh (libx265, NNEDI3 deinterlacing, HDR
tone mapping) unless it is already in that format (then its streams are only
copied into a new MP4 without the metadata: see needs_encoding and
strip_metadata), check the result,
store it under video/<h2>/<sha256>/ with its thumbnails, and publish it.
The CPU work is done by ffmpeg (child process, low priority); this thread only
waits and reports progress to the database.

Restart: encodings cut by a crash or reboot are queued again at startup (at
most MAX_ATTEMPTS tries); a clean shutdown puts the current one back without
counting the attempt.

A second thread makes the thumbnails of segments added or re-timed on the Videos
page (the API marks the video, video.thumbs_dirty) and deletes those of removed
segments, also while a video is being encoded. A third one writes a heartbeat
every HEARTBEAT_S seconds (table heartbeat), checked by /health.

Where it runs: its own container in production (python -m app.encoder, no
encryption key, no catalogue: after a change it asks the API to rebuild the
catalogue, VIDEONINJA_API_URL); a thread of the API in development.

Every ffmpeg / ffprobe reads local files of the allowed formats only and stops
after VIDEONINJA_FFMPEG_TIMEOUT_H, ffprobe after VIDEONINJA_FFPROBE_TIMEOUT_MIN
(limits.py, procs.py).

Environment: VIDEONINJA_X265_PRESET (default medium), VIDEONINJA_ENCODE_SCRIPT
(default: tools/encode-videos/encode-videos.sh of the repository),
VIDEONINJA_ENCODER=0 to keep it out of the API, VIDEONINJA_API_URL (its own
container); folders in paths.py.
"""

import hashlib
import logging
import os
import shutil
import sqlite3
import subprocess  # only through procs.py: argument lists, no shell  # nosec B404
import threading
import time
from pathlib import Path
from typing import Any

from .. import queries
from ..core import clock, db, logs, paths, procs, settings
from . import checks, heartbeat, notify, thumbnails
from .checks import JobError

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
UPLOAD_EXPIRY_S = 7 * 24 * 3600  # an upload not submitted within a week is deleted
POLL_S = 10
PROGRESS_EVERY_S = 5
HASH_SHARE = 5  # % of the progress bar for checking the original; encoding gets the rest up to 95


class Gone(Exception):
    """The video is no longer to be encoded (deleted meanwhile)."""


class Stopped(Exception):
    """The app is shutting down."""


class Encoder:
    def __init__(self) -> None:
        self.uploads = paths.upload_dir()
        self.videos = paths.video_dir()
        self.work = self.videos / ".work"  # same filesystem as video/: moves are renames
        self.preset = settings.current().x265_preset
        self.script = str(settings.current().encode_script)
        self.stopping = threading.Event()
        self.process: subprocess.Popen[Any] | None = None
        self.thread: threading.Thread | None = None
        self.helpers: list[threading.Thread] = []  # thumbnails, heartbeat

    # --- lifecycle ---

    def start(self) -> None:
        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            log.warning("Encoder not started: ffmpeg/ffprobe not found (uploads stay queued)")
            return
        self.work.mkdir(parents=True, exist_ok=True)
        with db.transaction() as con:
            queries.queue.requeue_interrupted(con, MAX_ATTEMPTS)
        heartbeat.beat()  # healthy from the start
        self.thread = threading.Thread(target=self.run, name="encoder", daemon=True)
        self.helpers = [
            threading.Thread(target=self.run_thumbnails, name="thumbnails", daemon=True),
            threading.Thread(target=heartbeat.run, args=(self.stopping,), name="heartbeat", daemon=True),
        ]
        for thread in (self.thread, *self.helpers):
            thread.start()
        log.info("Encoder started (x265 preset %s)", self.preset)

    def stop(self) -> None:
        self.stopping.set()
        self.kill_encoding()
        for thread in (self.thread, *self.helpers):
            if thread:
                thread.join(timeout=60)

    def kill_encoding(self) -> None:
        """Stop the script AND its ffmpeg: the script does not pass SIGTERM on,
        so the whole process group goes (else ffmpeg keeps encoding, orphaned)."""
        if self.process is not None:
            procs.stop(self.process)

    def run(self) -> None:
        while not self.stopping.is_set():
            try:
                self.housekeeping()
                if not self.run_once():
                    self.stopping.wait(POLL_S)
            except Exception:
                log.exception("Encoder error")
                self.stopping.wait(POLL_S)

    def run_thumbnails(self) -> None:
        while not self.stopping.wait(POLL_S):
            try:
                self.refresh_thumbnails()
            except Exception:
                log.exception("Thumbnails error")

    def refresh_thumbnails(self) -> None:
        """Segments added or re-timed on the Videos page: see thumbnails.refresh."""
        if thumbnails.refresh(self.videos, self.stopping):
            notify.catalog_changed()

    # --- queue ---

    def housekeeping(self) -> None:
        """Delete the originals of published, dropped or abandoned uploads."""
        with db.transaction() as con:
            queries.uploads.expire_uploads(con, clock.at(-UPLOAD_EXPIRY_S))
            tus_ids = queries.uploads.deleted_uploads(con)
        for tus_id in tus_ids:
            for path in self.upload_files(tus_id):
                path.unlink(missing_ok=True)
            with db.transaction() as con:
                queries.uploads.delete_upload(con, tus_id)
            log.info("Original %s deleted", tus_id)

    def run_once(self) -> bool:
        """Encode one queued video; False if the queue is empty."""
        with db.transaction() as con:
            row = queries.queue.next_job(con)
            if row is None:
                return False
            if not queries.queue.claim_job(con, row["id"]):
                return True
            segments = [dict(s) for s in queries.queue.job_segments(con, row["id"])]
        video = row["id"]
        with logs.bind(video_id=video):  # on every line of this job
            self.run_job(video, row, segments)
        return True

    def run_job(self, video: int, row: sqlite3.Row, segments: list[dict[str, Any]]) -> None:
        job = {"video": video, "tus_id": row["upload"], "original_sha256": row["original_sha256"], "segments": segments}
        log.info("Video %s: claimed", video)
        work = self.work / str(video)
        try:
            self.publish(video, self.process_job(job, work))
        except Gone:
            log.info("Video %s: deleted while encoding, stopped", video)
        except Stopped:
            with db.transaction() as c:
                queries.queue.release_job(c, video)
            log.info("Video %s: back in the queue (shutdown)", video)
        except JobError as e:
            self.fail(video, str(e), e.retryable)
        except Exception as e:
            log.exception("Video %s: unexpected error", video)
            self.fail(video, f"Unexpected error: {e}", retryable=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def fail(self, video: int, error: str, retryable: bool) -> None:
        with db.transaction() as con:
            row = queries.videos.video(con, video)
            requeue = retryable and row is not None and row["attempts"] < MAX_ATTEMPTS
            queries.queue.requeue_or_fail(con, video, error[:2000], requeue)
        log.warning("Video %s: encoding failed (%s): %s", video, "retry" if requeue else "final", error)

    def publish(self, video: int, result: dict[str, Any]) -> None:
        sha256 = result["sha256"]
        folder = self.videos / sha256[:2] / sha256
        try:
            with db.transaction() as con:
                row = queries.videos.video(con, video)
                published = row is not None and queries.queue.publish_video(
                    con, video, sha256, f"{sha256[:2]}/{sha256}", result["thumbnail"], result["duration_s"]
                )
                if published and row is not None:
                    for segment_id, name in result["segment_thumbnails"].items():
                        queries.queue.set_segment_thumbnail(con, segment_id, video, name)
                    queries.uploads.set_upload_state(con, row["upload"], "deleted")  # original: no longer needed
        except sqlite3.IntegrityError:  # same encoded file as another video
            shutil.rmtree(folder, ignore_errors=True)
            raise JobError("Same video as another one") from None
        if not published:  # deleted meanwhile: its files must not stay
            shutil.rmtree(folder, ignore_errors=True)
            raise Gone()
        log.info("Video %s published (%s)", video, sha256)
        notify.catalog_changed()

    def progress(self, video: int, percent: float) -> None:
        if self.stopping.is_set():
            raise Stopped()
        with db.transaction() as con:
            if not queries.queue.job_progress(con, video, int(percent)):
                raise Gone()

    # --- one job ---

    def upload_files(self, tus_id: str) -> list[Path]:
        if not tus_id or "/" in tus_id or tus_id.startswith("."):
            raise JobError(f"Invalid upload ID {tus_id!r}")
        return [self.uploads / tus_id, self.uploads / f"{tus_id}.info", self.uploads / f"{tus_id}.lock"]

    def process_job(self, job: dict[str, Any], work: Path) -> dict[str, Any]:
        video = job["video"]
        original, info = self.upload_files(job["tus_id"])[:2]
        checks.check_complete(original, info)
        self.check_hash(video, original, job["original_sha256"])
        duration = checks.probe_duration(original)
        if any(s["end_s"] > duration + 1 for s in job["segments"]):
            raise JobError("A segment ends after the end of the video")

        work.mkdir(parents=True, exist_ok=True)
        reason = checks.needs_encoding(original)
        if reason:
            log.info("Video %s: encoding (%s)", video, reason)
            encoded = self.encode(video, original, work, duration)
        else:
            log.info("Video %s: already in the target format, published without its metadata", video)
            encoded = work / "out" / "video.mp4"
            encoded.parent.mkdir()
            checks.strip_metadata(original, encoded)  # a new file: the original stays until published
            if reason := checks.needs_encoding(encoded, own=True):
                raise JobError(f"Removing the metadata changed the format: {reason}")
        checks.check_encoded(encoded)
        sha256 = checks.file_sha256(encoded)
        folder = self.videos / sha256[:2] / sha256
        folder.mkdir(parents=True, exist_ok=True)

        thumbnails.thumbnail(encoded, thumbnails.middle(0, duration, duration), work / "thumb.jpg")
        segment_thumbnails = {}
        for s in job["segments"]:
            name = f"segment-{s['id']}.jpg"
            thumbnails.thumbnail(encoded, thumbnails.middle(s["begin_s"], s["end_s"], duration), work / name)
            segment_thumbnails[s["id"]] = name
        # Thumbnails first, the video last: video.mp4 present = folder complete.
        for name in ["thumb.jpg", *segment_thumbnails.values()]:
            os.replace(work / name, folder / name)
        os.replace(encoded, folder / "video.mp4")
        return {
            "sha256": sha256,
            "duration_s": duration,
            "thumbnail": "thumb.jpg",
            "segment_thumbnails": segment_thumbnails,
        }

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
        limit = settings.current().ffmpeg_timeout_s
        cmd = [
            "nice",
            "-n",
            "10",
            self.script,
            "-c",
            "-x",
            self.preset,
            "-P",
            str(progress_file),
            "-W",
            ",".join(settings.current().input_formats),
            "-T",
            str(int(limit)),
            "-L",
            str(int(settings.current().ffprobe_timeout_s)),
            "-o",
            str(out),
            "-f",
            str(original),
        ]
        with (work / "encode.log").open("wb") as log_file:
            # Own process group: stopping it stops ffmpeg too (kill_encoding).
            self.process = procs.popen(cmd, stdout=log_file, stderr=subprocess.STDOUT)
            try:
                started = last = time.monotonic()
                while self.process.poll() is None:
                    self.stopping.wait(0.5)  # notice the end (or a shutdown) quickly
                    if time.monotonic() - started > limit:
                        raise JobError(f"Encoding stopped after {limit / 3600:g} h")
                    if self.stopping.is_set() or time.monotonic() - last >= PROGRESS_EVERY_S:
                        done = checks.out_time_s(progress_file)
                        self.progress(video, HASH_SHARE + (95 - HASH_SHARE) * min(done / duration, 1))
                        last = time.monotonic()
            finally:
                self.kill_encoding()  # stopped, deleted, failed or too long: nothing keeps running
        if self.process.returncode != 0:
            tail = (work / "encode.log").read_text(encoding="utf-8", errors="replace").strip().splitlines()[-5:]
            raise JobError("Encoding failed: " + " | ".join(tail))
        return out / f"{original.name}.mp4"


encoder = Encoder()


def start() -> None:
    """Start the queue (app startup, or after setup). VIDEONINJA_ENCODER=0: off."""
    global encoder
    if not settings.current().run_encoder or (encoder.thread and encoder.thread.is_alive()):
        return
    encoder = Encoder()  # folders from the current environment
    encoder.start()


def stop() -> None:
    encoder.stop()


def running() -> bool:
    return bool(encoder.thread and encoder.thread.is_alive())
