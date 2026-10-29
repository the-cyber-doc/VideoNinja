"""Videos: submitted, listed, retried, deleted; the published ones; their tags."""

import sqlite3

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def video_known(con: sqlite3.Connection, sha256: str) -> bool:
    """A video (pending, failed or published) has this original, or this encoded
    file (e.g. downloaded from the app and uploaded again)."""
    return (
        con.execute('SELECT 1 FROM "video" WHERE "original_sha256" = ? OR "sha256sum" = ?', (sha256, sha256))
        .fetchone()
        is not None
    )


def insert_video(
    con: sqlite3.Connection,
    original_sha256: str,
    original_filename: str,
    all_segments_done: bool,
    user_id: int,
    now: str,
    tus_id: str,
) -> int:
    return con.execute(
        'INSERT INTO "video" ("original_sha256", "original_filename", "all_segments_done", "uploaded_by",'
        ' "uploaded_at", "upload") VALUES (?, ?, ?, ?, ?, ?)',
        (original_sha256, original_filename, all_segments_done, user_id, now, tus_id),
    ).lastrowid


def insert_video_tag(con: sqlite3.Connection, video_id: int, tag: str, value: str | None) -> None:
    con.execute('INSERT INTO "video_has_tags" ("video", "tag", "value") VALUES (?, ?, ?)', (video_id, tag, value))


def video(con: sqlite3.Connection, video_id: int) -> sqlite3.Row | None:
    return con.execute(
        'SELECT "id", "status", "uploaded_by", "upload", "attempts" FROM "video" WHERE "id" = ?', (video_id,)
    ).fetchone()


def user_videos(con: sqlite3.Connection, user_id: int, since: str) -> list[sqlite3.Row]:
    """The user's videos not published yet, and those published since `since`, newest first,
    with their place in the queue (1 = next to be encoded)."""
    return con.execute(
        'SELECT v."id", v."original_filename", v."status", v."progress", v."error", v."uploaded_at",'
        " CASE WHEN v.\"status\" = 'queued' THEN"
        "  (SELECT count(*) FROM \"video\" q WHERE q.\"status\" = 'queued' AND q.\"id\" <= v.\"id\")"
        ' END AS "queue_position"'
        ' FROM "video" v WHERE v."uploaded_by" = ?'
        " AND (v.\"status\" != 'published' OR datetime(v.\"uploaded_at\") >= datetime(?))"
        ' ORDER BY v."id" DESC',
        (user_id, since),
    ).fetchall()


def published_videos(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every published video with its number of segments, newest upload first."""
    return con.execute(
        'SELECT v."id", v."original_filename", v."uploaded_at", v."duration_s", v."all_segments_done",'
        ' (SELECT count(*) FROM "segment" s WHERE s."video" = v."id") AS "segment_count"'
        " FROM \"video\" v WHERE v.\"status\" = 'published'"
        ' ORDER BY datetime(v."uploaded_at") DESC, v."id" DESC'
    ).fetchall()


def published_video(con: sqlite3.Connection, video_id: int) -> sqlite3.Row | None:
    """uploaded_by: the uploader's display name (name, else username); None if unknown."""
    return con.execute(
        'SELECT v."id", v."sha256sum", v."thumbnail", v."duration_s", v."all_segments_done",'
        ' v."original_filename", COALESCE(u."name", u."username") AS "uploaded_by"'
        ' FROM "video" v LEFT JOIN "user" u ON u."id" = v."uploaded_by"'
        " WHERE v.\"id\" = ? AND v.\"status\" = 'published'",
        (video_id,),
    ).fetchone()


def video_tags(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "tag", "value" FROM "video_has_tags" WHERE "video" = ? ORDER BY "tag"', (video_id,)
    ).fetchall()


def clear_video_tags(con: sqlite3.Connection, video_id: int) -> None:
    con.execute('DELETE FROM "video_has_tags" WHERE "video" = ?', (video_id,))


def set_all_segments_done(con: sqlite3.Connection, video_id: int, done: bool) -> None:
    con.execute('UPDATE "video" SET "all_segments_done" = ? WHERE "id" = ?', (done, video_id))


def retry_video(con: sqlite3.Connection, video_id: int) -> bool:
    return con.execute(
        "UPDATE \"video\" SET \"status\" = 'queued', \"attempts\" = 0, \"error\" = NULL, \"progress\" = 0"
        " WHERE \"id\" = ? AND \"status\" = 'failed'",
        (video_id,),
    ).rowcount == 1


def delete_video(con: sqlite3.Connection, video_id: int) -> None:
    """The video, its segments and tags (not published: nothing else refers to them)."""
    con.execute(
        'DELETE FROM "segment_has_tags" WHERE "segment" IN (SELECT "id" FROM "segment" WHERE "video" = ?)',
        (video_id,),
    )
    con.execute('DELETE FROM "segment" WHERE "video" = ?', (video_id,))
    con.execute('DELETE FROM "video_has_tags" WHERE "video" = ?', (video_id,))
    con.execute('DELETE FROM "video" WHERE "id" = ?', (video_id,))
