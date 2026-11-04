"""Books in the encoder's queue: seconds of work each, taken before the next video.

For the oldest queued book: its PDF upload complete and the file announced (SHA-256),
a PDF by its markers (the "%PDF-" header, the "%%EOF" trailer: no PDF parser on the
server: the browser alone reads PDFs), its first page (a JPEG the browser made, its
own upload) re-encoded by ffmpeg (a real JPEG, no metadata, at most THUMB_WIDTH wide;
a book is published without it if that fails); then both moved to
book/<h2>/<sha256>/{book.pdf, thumb.jpg} and the book published. The PDF is stored as
uploaded, never rewritten (its annotations are rows, written into a downloaded copy).

A bad file fails the book for good (deleting it lets the user upload another); an
unexpected error leaves it queued, MAX_ATTEMPTS times at most.
"""

import logging
import os
import shutil
import sqlite3
import threading
from pathlib import Path

from .. import queries
from ..core import db, limits, logs, paths
from . import checks
from .checks import JobError

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
THUMB_WIDTH = 480  # the browser renders the first page this wide
HEAD_BYTES = 1024  # where "%PDF-" must start (the PDF specification's tolerance)
TAIL_BYTES = 2048  # where the last "%%EOF" must be (trailing junk is common)


def check_pdf(path: Path) -> None:
    with path.open("rb") as f:
        head = f.read(HEAD_BYTES)
        f.seek(max(path.stat().st_size - TAIL_BYTES, 0))
        tail = f.read()
    if b"%PDF-" not in head or b"%%EOF" not in tail:
        raise JobError("Not a PDF file")


def reencode_jpeg(source: Path, out: Path) -> None:
    """The browser's JPEG, decoded and encoded again: a picture and nothing else."""
    checks.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            limits.IMAGE_FORMAT,
            "-f",
            limits.IMAGE_FORMAT,
            "-i",
            f"file:{source}",
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({THUMB_WIDTH},iw)':-2",
            "-map_metadata",
            "-1",
            "-q:v",
            "4",
            "-f",
            "image2",
            f"file:{out}",
        ]
    )
    if not out.is_file():
        raise JobError("No picture in the thumbnail")


def run_once(stopping: threading.Event) -> bool:
    """Publish (or fail) the oldest queued book; False if none waits."""
    if stopping.is_set():
        return False
    with db.transaction() as con:
        row = queries.books.next_book(con)
        if row is None:
            return False
        queries.books.count_attempt(con, row["id"])
    with logs.bind(book_id=row["id"]):
        run_job(row)
    return True


def run_job(row: sqlite3.Row) -> None:
    book = row["id"]
    work = paths.book_dir() / ".work" / str(book)  # same filesystem as book/: moves are renames
    try:
        publish(row, process(row, work))
    except JobError as e:
        fail(row, str(e))
    except Exception as e:
        log.exception("Book %s: unexpected error", book)
        if row["attempts"] + 1 >= MAX_ATTEMPTS:
            fail(row, f"Unexpected error: {e}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def process(row: sqlite3.Row, work: Path) -> str | None:
    """The book's folder filled; its thumbnail's name, or None."""
    sha256 = row["sha256sum"]
    pdf, info = checks.upload_files(paths.upload_dir(), row["upload"])[:2]
    checks.check_complete(pdf, info)
    if checks.file_sha256(pdf) != sha256:
        raise JobError("The uploaded file is not the one announced (SHA-256 differs)")
    check_pdf(pdf)
    work.mkdir(parents=True, exist_ok=True)
    thumbnail = None
    if row["thumbnail_upload"]:
        try:
            image, image_info = checks.upload_files(paths.upload_dir(), row["thumbnail_upload"])[:2]
            checks.check_complete(image, image_info)
            reencode_jpeg(image, work / "thumb.jpg")
            thumbnail = "thumb.jpg"
        except JobError as e:
            log.warning("Book %s: published without a thumbnail (%s)", row["id"], e)
    shutil.copyfile(pdf, work / "book.pdf")  # the upload folder may be another filesystem
    folder = paths.book_dir() / sha256[:2] / sha256
    folder.mkdir(parents=True, exist_ok=True)
    # The thumbnail first, the PDF last: book.pdf present = folder complete.
    if thumbnail:
        os.replace(work / thumbnail, folder / thumbnail)
    os.replace(work / "book.pdf", folder / "book.pdf")
    return thumbnail


def _drop_uploads(con: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Its uploads are no longer needed: the encoder's housekeeping deletes them."""
    for tus_id in (row["upload"], row["thumbnail_upload"]):
        if tus_id:
            queries.uploads.set_upload_state(con, tus_id, "deleted")


def publish(row: sqlite3.Row, thumbnail: str | None) -> None:
    sha256 = row["sha256sum"]
    with db.transaction() as con:
        published = queries.books.publish_book(con, row["id"], f"{sha256[:2]}/{sha256}", thumbnail)
        if published:
            _drop_uploads(con, row)
    if not published:  # deleted meanwhile: its files must not stay
        shutil.rmtree(paths.book_dir() / sha256[:2] / sha256, ignore_errors=True)
        log.info("Book %s: deleted while being published", row["id"])
        return
    log.info("Book %s published (%s)", row["id"], sha256)


def fail(row: sqlite3.Row, error: str) -> None:
    with db.transaction() as con:
        queries.books.fail_book(con, row["id"], error[:2000])
        _drop_uploads(con, row)
    log.warning("Book %s failed: %s", row["id"], error)
