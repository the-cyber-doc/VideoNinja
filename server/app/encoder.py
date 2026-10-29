"""Encoding queue: a background thread of the app, one video at a time.

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
import json
import logging
import os
import shutil
import signal
import sqlite3
import subprocess  # only through procs.py: argument lists, no shell  # nosec B404
import sys
import threading
import time
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from . import clock, db, limits, paths, procs, queries, snapshot

log = logging.getLogger("uvicorn.error")

MAX_ATTEMPTS = 3
UPLOAD_EXPIRY_S = 7 * 24 * 3600  # an upload not submitted within a week is deleted
POLL_S = 10
HEARTBEAT_S = 30
HEARTBEAT_MAX_AGE_S = 120  # older: the encoder is down (/health)
PROGRESS_EVERY_S = 5
HASH_SHARE = 5  # % of the progress bar for checking the original; encoding gets the rest up to 95
THUMB_WIDTH = 320
# Longest keyframe interval accepted without encoding, needed by the nginx mp4 module's cuts.
# encode-videos.sh makes 1 s up to 30 fps, 0.5 s above (smoother seeking at high frame rates).
GOP_S = 1
DEFAULT_SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "encode-videos" / "encode-videos.sh"


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """A connection of its own (this is not a request), in one write transaction, then closed."""
    con = db.connect()
    try:
        with db.write(con):
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
        self.helpers: list[threading.Thread] = []  # thumbnails, heartbeat

    # --- lifecycle ---

    def start(self) -> None:
        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            log.warning("Encoder not started: ffmpeg/ffprobe not found (uploads stay queued)")
            return
        self.work.mkdir(parents=True, exist_ok=True)
        with transaction() as con:
            queries.requeue_interrupted(con, MAX_ATTEMPTS)
        self.beat()  # healthy from the start
        self.thread = threading.Thread(target=self.run, name="encoder", daemon=True)
        self.helpers = [threading.Thread(target=self.run_thumbnails, name="thumbnails", daemon=True),
                        threading.Thread(target=self.run_heartbeat, name="heartbeat", daemon=True)]
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
            except Exception:  # noqa: BLE001 - keep the queue alive
                log.exception("Encoder error")
                self.stopping.wait(POLL_S)

    # --- queue ---

    def run_heartbeat(self) -> None:
        while not self.stopping.wait(HEARTBEAT_S):
            try:
                self.beat()
            except Exception:  # noqa: BLE001 - try again at the next beat
                log.exception("Encoder heartbeat failed")

    @staticmethod
    def beat() -> None:
        with transaction() as con:
            queries.set_heartbeat(con, "encoder", clock.at(0))

    def run_thumbnails(self) -> None:
        while not self.stopping.wait(POLL_S):
            try:
                self.refresh_thumbnails()
            except Exception:  # noqa: BLE001 - keep the loop alive
                log.exception("Thumbnails error")

    def refresh_thumbnails(self) -> None:
        """Videos whose segments changed on the Videos page: a thumbnail for each
        segment without one (new or re-timed), the files of removed segments deleted."""
        with transaction() as con:
            videos = queries.thumbs_dirty_videos(con)
        changed = False
        for video in videos:
            if self.stopping.is_set():
                return
            with transaction() as con:
                segments = queries.segment_thumbnails(con, video["id"])
            folder = self.videos / video["sha256sum"][:2] / video["sha256sum"]
            duration = video["duration_s"] or max((s["end_s"] for s in segments), default=0)
            for s in segments:
                if s["thumbnail"] is not None:
                    continue
                name = f"segment-{s['id']}.jpg"
                tmp = folder / f".{name}"
                try:
                    thumbnail(folder / "video.mp4", middle(s["begin_s"], s["end_s"], duration), tmp)
                    os.replace(tmp, folder / name)  # whole or not at all
                except (OSError, JobError) as e:
                    log.warning("Video %s: no thumbnail for segment %s: %s", video["id"], s["id"], e)
                    continue
                finally:
                    tmp.unlink(missing_ok=True)
                with transaction() as con:
                    queries.set_new_segment_thumbnail(con, s, name)
            keep = {f"segment-{s['id']}.jpg" for s in segments}
            for path in folder.glob("segment-*.jpg"):
                if path.name not in keep:
                    path.unlink(missing_ok=True)
            with transaction() as con:
                queries.clear_thumbs_dirty(con, video["id"], video["thumbs_dirty"])
            log.info("Video %s: segment thumbnails updated", video["id"])
            changed = True
        if changed:
            catalog_changed()

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
        catalog_changed()

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
            log.info("Video %s: already in the target format, published without its metadata", video)
            encoded = work / "out" / "video.mp4"
            encoded.parent.mkdir()
            strip_metadata(original, encoded)  # a new file: the original stays until published
            if reason := needs_encoding(encoded, own=True):
                raise JobError(f"Removing the metadata changed the format: {reason}")
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
        limit = procs.timeout_s()
        cmd = ["nice", "-n", "10", self.script, "-c", "-x", self.preset, "-P", str(progress_file),
               "-W", ",".join(limits.input_formats()), "-T", str(int(limit)),
               "-L", str(int(procs.probe_timeout_s())),
               "-o", str(out), "-f", str(original)]
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
                        done = out_time_s(progress_file)
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
    if os.environ.get("VIDEONINJA_ENCODER", "1") == "0" or (encoder.thread and encoder.thread.is_alive()):
        return
    encoder = Encoder()  # folders from the current environment
    encoder.start()


def stop() -> None:
    encoder.stop()


def catalog_changed() -> None:
    """A video published or new thumbnails: the catalogue must be rebuilt. In its own
    container the encoder has no catalogue: the API rebuilds it (an internal call).
    In the API: directly. At once, not debounced: the upload page fetches the
    catalogue as soon as it sees the video published."""
    api = paths.service_url("VIDEONINJA_API_URL")
    if not api:
        snapshot.rebuild_now()
        return
    request = urllib.request.Request(f"{api}/internal/catalog-changed", method="POST")
    try:
        urllib.request.urlopen(request, timeout=10).close()  # http(s) only (paths)  # nosec B310
    except OSError as e:  # the API rebuilds at its next start anyway
        log.warning("Catalogue rebuild not requested from the API: %s", e)


def healthy(con: sqlite3.Connection) -> bool:
    """Its heartbeat is recent (/health, and the encoder container's healthcheck)."""
    at = queries.heartbeat(con, "encoder")
    if at is None:
        return False
    return (clock.now() - datetime.fromisoformat(at)).total_seconds() < HEARTBEAT_MAX_AGE_S


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
    """ffmpeg / ffprobe to the end (procs.run: own process group, time limit)."""
    try:
        result = procs.run(cmd)
    except procs.Timeout as e:
        raise JobError(str(e)) from None  # final: it would take as long again
    if result.returncode != 0:
        raise JobError(f"{cmd[0]} failed: {result.stderr.strip()[-500:]}")
    return result.stdout


def probe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(), "-show_entries", "format=duration:stream=codec_type",
               "-of", "json", f"file:{path}"])
    data = json.loads(out)
    if not any(s.get("codec_type") == "video" for s in data.get("streams", [])):
        raise JobError("No video in this file")
    try:
        return float(data["format"]["duration"])
    except (KeyError, ValueError):
        raise JobError("Unknown duration") from None


def check_encoded(path: Path) -> None:
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own=True),
               "-show_entries", "stream=codec_type,codec_name,codec_tag_string", "-of", "json", f"file:{path}"])
    streams = json.loads(out).get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    if len(videos) != 1 or videos[0].get("codec_name") != "hevc" or videos[0].get("codec_tag_string") != "hvc1":
        raise JobError("Encoded video is not HEVC/hvc1")
    if any(a.get("codec_name") != "aac" for a in audios):
        raise JobError("Encoded audio is not AAC")


def needs_encoding(path: Path, own: bool = False) -> str | None:
    """Why the original must be encoded, or None if its format is already what
    encode-videos.sh makes: MP4 with faststart, one H.265 Main 8-bit video
    (hvc1), SDR BT.709, progressive, a keyframe every GOP_S seconds, AAC mono or
    stereo (or no audio). Only the format counts: metadata (GPS location,
    dates…), chapters and other streams (data, subtitles) are ignored here.
    Such a file (e.g. a phone's recording, or encoded with the script before
    upload) is not encoded again, which would only lose quality and take the Pi
    minutes to hours: strip_metadata copies its streams. When unsure: encode."""
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own), "-show_entries",
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
    if a is not None and ((a.get("codec_name"), a.get("profile")) != ("aac", "LC") or a.get("channels") not in (1, 2)):
        return (f"audio is {a.get('codec_name')} {a.get('profile')} with {a.get('channels')} channels,"
                " not AAC mono or stereo")
    return keyframe_problem(path, v.get("avg_frame_rate", "0/1"), own)


def strip_metadata(original: Path, out: Path) -> None:
    """The original's first video and audio streams, copied (no encoding) into a
    new MP4 without its metadata: no global or stream tags (GPS location, dates,
    device, encoder), no chapters, no other streams (data or GPS tracks,
    timecode, subtitles). The picture's rotation is side data, not metadata: it
    stays. Seconds, even for a long video: only the bytes are copied."""
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", *limits.ffmpeg_input(), "-i", f"file:{original}",
         "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
         "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
         "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
         "-tag:v", "hvc1", "-movflags", "+faststart", "-f", "mp4", f"file:{out}"])


def keyframe_problem(path: Path, frame_rate: str, own: bool = False) -> str | None:
    """None if the video starts with a keyframe and has one at least every GOP_S
    seconds (one frame of tolerance). Reads packet headers only: no decoding."""
    num, _, den = frame_rate.partition("/")
    frame_s = float(den or 1) / float(num) if float(num or 0) else 0.1
    out = run(["ffprobe", "-v", "error", *limits.ffmpeg_input(own), "-select_streams", "v:0",
               "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", f"file:{path}"])
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
    """A JPEG of one of the app's own videos (encoded, MP4)."""
    common = ["-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "4", "-f", "image2", f"file:{out}"]
    source = [*limits.ffmpeg_input(own=True), "-i", f"file:{video}"]
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{max(at_s, 0):.3f}", *source, *common])
    if not out.is_file():  # -ss past the last frame writes nothing
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", *source, *common])


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


# --- its own container: python -m app.encoder ---


def main(argv: list[str]) -> int:
    """The encoder's container. --health: exit 0 if the heartbeat is recent (healthcheck)."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
    if argv == ["--health"]:
        if not db.is_initialized():
            return 0  # before the setup there is nothing to encode
        con = db.connect()
        try:
            return 0 if healthy(con) else 1
        finally:
            con.close()
    limits.check()
    procs.check()
    x265_preset()
    paths.service_url("VIDEONINJA_API_URL")
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    # The API's setup wizard creates the database; at its start, the API migrates it.
    # Never on another version: its columns would not be the ones used here.
    while db.current_version() != db.EXPECTED_VERSION:
        if stopping.wait(POLL_S):
            return 0
    start()
    if not (encoder.thread and encoder.thread.is_alive()):
        return 1  # ffmpeg missing: logged by start()
    stopping.wait()
    log.info("Encoder stopping")
    stop()  # the current encoding goes back to the queue
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
