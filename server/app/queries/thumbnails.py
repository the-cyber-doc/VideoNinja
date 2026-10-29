"""Segment thumbnails to make again (the Videos page marks, the encoder makes them)."""

import sqlite3


def clear_segment_thumbnail(con: sqlite3.Connection, segment_id: int) -> None:
    con.execute('UPDATE "segment" SET "thumbnail" = NULL WHERE "id" = ?', (segment_id,))


def mark_thumbs_dirty(con: sqlite3.Connection, video_id: int) -> None:
    con.execute('UPDATE "video" SET "thumbs_dirty" = "thumbs_dirty" + 1 WHERE "id" = ?', (video_id,))


def thumbs_dirty_videos(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "sha256sum", "duration_s", "thumbs_dirty" FROM "video"'
        ' WHERE "thumbs_dirty" > 0 AND "status" = \'published\' ORDER BY "id"'
    ).fetchall()


def segment_thumbnails(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "begin_s", "end_s", "thumbnail" FROM "segment" WHERE "video" = ?', (video_id,)
    ).fetchall()


def set_new_segment_thumbnail(con: sqlite3.Connection, segment: sqlite3.Row, name: str) -> None:
    """Only if the segment still has no thumbnail and the same times (not re-timed meanwhile)."""
    con.execute(
        'UPDATE "segment" SET "thumbnail" = ? WHERE "id" = ? AND "thumbnail" IS NULL AND "begin_s" = ? AND "end_s" = ?',
        (name, segment["id"], segment["begin_s"], segment["end_s"]),
    )


def clear_thumbs_dirty(con: sqlite3.Connection, video_id: int, seen: int) -> None:
    """Only the changes seen: one made meanwhile keeps the video dirty."""
    con.execute('UPDATE "video" SET "thumbs_dirty" = "thumbs_dirty" - ? WHERE "id" = ?', (seen, video_id))
