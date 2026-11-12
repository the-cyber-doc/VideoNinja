#!/usr/bin/env python3
"""Remove the content users added (videos with their segments, books with their pages
and annotations, comments, pending uploads) and its files, to restart a test instance clean.

Kept: users and their sessions, roles, invitations, the catalogue (schools, categories,
weapons, sections, techniques, proposed ones included), tags and their values, performers,
translations, the configuration.

The cleared tables' AUTOINCREMENT counters are reset (the next video, segment, book… is
number 1 again). The browsers' caches key saved media by those IDs: a service worker that
sees the empty catalogue drops the saved clips and thumbnails, but whole videos saved from
the Videos page stay (its phone button removes them), and a browser that only sees the
catalogue again once a new segment has an old one's ID and times keeps the old clip.
Logging out and in empties a browser's caches. Old IDs in the logs then name other rows.

Only the Python standard library: it runs on the host or inside the encoder's image.
Stop the API, the encoder and tusd first. Without --yes it only shows what it would do.
Before deleting, the database is copied next to itself (<db>.clean-<UTC time>.bak).

Development (from the repository root):

    python3 tools/clean-content.py           # server/dev.db, server/media, server/uploads
    python3 tools/clean-content.py --yes

Production (on the Pi, in /opt/videoninja, the script copied there): the encoder's
container has the database, the media and the uploads, and runs as their owner:

    sudo docker compose stop api encoder tusd
    sudo docker compose run --rm --no-deps -T --entrypoint python encoder - < clean-content.py
    sudo docker compose run --rm --no-deps -T --entrypoint python encoder - --yes < clean-content.py
    sudo docker compose up -d

The API rebuilds the catalogue snapshot at its next start.
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"

# Children first (foreign keys are on): every row of these tables goes.
TABLES = (
    "segment_has_tags",
    "segment",
    "video_has_tags",
    "video",
    "book_annotation",
    "book_page",
    "book_has_tags",
    "book_comment",  # v5 only (dropped in v6)
    "book",
    "comment",
    "upload",
)
# External-content FTS5 indexes of those tables: rebuilt (empty) after the deletes.
FTS = ("book_page_fts", "book_annotation_fts", "comment_fts", "book_comment_fts")
# Folders of the media directory that hold only users' content (clips/: development).
MEDIA = ("video", "book", "clips")
# The encoder writes its heartbeat every 30 s: a recent one means it is still running.
ALIVE = timedelta(minutes=2)


def fail(message: str) -> None:
    sys.exit(f"clean-content: {message}")


def folder(variable: str, db: Path, name: str) -> Path:
    """As the app's settings: the variable, else a folder next to the database."""
    return Path(os.environ.get(variable) or db.parent / name)


def children(path: Path) -> list[Path]:
    return sorted(path.iterdir()) if path.is_dir() else []


def existing(con: sqlite3.Connection, names: tuple[str, ...]) -> list[str]:
    found = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    return [n for n in names if n in found]


def running(con: sqlite3.Connection) -> str | None:
    """The latest heartbeat if the encoder seems to run."""
    if "heartbeat" not in existing(con, ("heartbeat",)):
        return None
    for (at,) in con.execute('SELECT "at" FROM "heartbeat"'):
        try:
            when = datetime.fromisoformat(at)
        except ValueError:
            continue
        if datetime.now(UTC) - when < ALIVE:
            return str(at)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    default_db = Path(os.environ.get("VIDEONINJA_DB") or SERVER / "dev.db")
    parser.add_argument("--db", type=Path, default=default_db, help=f"database (default: {default_db})")
    parser.add_argument(
        "--media", type=Path, help="media folder (default: VIDEONINJA_MEDIA_DIR, else media/ next to the database)"
    )
    parser.add_argument(
        "--uploads",
        type=Path,
        help="tusd's folder (default: VIDEONINJA_UPLOAD_DIR, else uploads/ next to the database)",
    )
    parser.add_argument("--yes", action="store_true", help="really delete (otherwise: show what would go)")
    parser.add_argument("--force", action="store_true", help="even if the encoder's heartbeat is recent")
    args = parser.parse_args()

    db: Path = args.db
    if not db.is_file():
        fail(f"no database: {db}")
    media: Path = args.media or folder("VIDEONINJA_MEDIA_DIR", db, "media")
    uploads: Path = args.uploads or folder("VIDEONINJA_UPLOAD_DIR", db, "uploads")

    con = sqlite3.connect(db, autocommit=True)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    beat = running(con)
    if beat and not args.force:
        fail(f"the encoder looks alive (heartbeat {beat}): stop the API, the encoder and tusd first (or --force)")

    tables = existing(con, TABLES)
    counts = {t: con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in tables}  # nosec B608 - names from TABLES
    files = [p for name in MEDIA for p in children(media / name)] + children(uploads)

    print(f"Database {db}:")
    for t in tables:
        print(f"  {t:18} {counts[t]:6} rows")
    print(f"Files: {len(files)} entries under {media}/{{{','.join(MEDIA)}}} and {uploads}")
    print("IDs of those tables restart at 1 (users and sessions kept).")
    if not args.yes:
        print("Nothing deleted: run again with --yes.")
        return

    backup = db.with_name(f"{db.name}.clean-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.bak")
    with sqlite3.connect(backup) as copy:
        con.backup(copy)
    copy.close()
    print(f"Backup: {backup}")

    con.execute("BEGIN IMMEDIATE")
    try:
        for t in tables:
            con.execute(f'DELETE FROM "{t}"')  # nosec B608 - names from TABLES
        for f in existing(con, FTS):
            con.execute(f'INSERT INTO "{f}" ("{f}") VALUES (\'rebuild\')')  # nosec B608 - names from FTS
        # Their AUTOINCREMENT counters: the next row of each is number 1 again.
        marks = ",".join("?" * len(tables))
        con.execute(f'DELETE FROM "sqlite_sequence" WHERE "name" IN ({marks})', tables)  # nosec B608 - only "?"
        problems = con.execute("PRAGMA foreign_key_check").fetchall()
        if problems:
            raise RuntimeError(f"foreign keys broken: {problems[:5]}")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    con.execute("COMMIT")
    con.execute("VACUUM")
    con.close()
    print(f"Deleted {sum(counts.values())} rows, IDs restart at 1.")

    for p in files:
        if p.is_dir() and not p.is_symlink():
            shutil.rmtree(p)
        else:
            p.unlink(missing_ok=True)
    print(f"Deleted {len(files)} file entries. Start the app again: the catalogue snapshot is rebuilt.")


if __name__ == "__main__":
    main()
