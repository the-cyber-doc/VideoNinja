"""The encoder's queue: claiming a job, its progress, publishing, failing."""

import sqlite3


def requeue_interrupted(con: sqlite3.Connection, max_attempts: int) -> None:
    """At startup: encodings cut by a crash or a reboot go back to the queue,
    unless they were already tried max_attempts times."""
    con.execute(
        "UPDATE \"video\" SET \"status\" = 'failed', \"error\" = 'Encoding interrupted too many times'"
        " WHERE \"status\" = 'encoding' AND \"attempts\" >= ?",
        (max_attempts,),
    )
    con.execute("UPDATE \"video\" SET \"status\" = 'queued' WHERE \"status\" = 'encoding'")


def next_job(con: sqlite3.Connection) -> sqlite3.Row | None:
    """The oldest queued video."""
    return con.execute(
        'SELECT "id", "upload", "original_sha256" FROM "video"'
        " WHERE \"status\" = 'queued' ORDER BY \"id\" LIMIT 1"
    ).fetchone()


def claim_job(con: sqlite3.Connection, video_id: int) -> bool:
    """False if it is no longer queued (deleted meanwhile)."""
    return con.execute(
        "UPDATE \"video\" SET \"status\" = 'encoding', \"attempts\" = \"attempts\" + 1,"
        ' "progress" = 0, "error" = NULL'
        " WHERE \"id\" = ? AND \"status\" = 'queued'",
        (video_id,),
    ).rowcount == 1


def release_job(con: sqlite3.Connection, video_id: int) -> None:
    """Clean shutdown during an encoding: back to the queue, the attempt not counted."""
    con.execute(
        "UPDATE \"video\" SET \"status\" = 'queued', \"attempts\" = max(\"attempts\" - 1, 0)"
        " WHERE \"id\" = ? AND \"status\" = 'encoding'",
        (video_id,),
    )


def job_segments(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "begin_s", "end_s" FROM "segment" WHERE "video" = ? ORDER BY "id"', (video_id,)
    ).fetchall()


def job_progress(con: sqlite3.Connection, video_id: int, percent: int) -> bool:
    """False if the video is no longer being encoded (deleted meanwhile)."""
    return con.execute(
        'UPDATE "video" SET "progress" = ?'
        " WHERE \"id\" = ? AND \"status\" = 'encoding'",
        (percent, video_id),
    ).rowcount == 1


def publish_video(
    con: sqlite3.Connection, video_id: int, sha256: str, directory: str, thumbnail: str | None,
    duration_s: float,
) -> bool:
    return con.execute(
        "UPDATE \"video\" SET \"status\" = 'published', \"sha256sum\" = ?, \"directory\" = ?,"
        ' "thumbnail" = ?, "duration_s" = ?, "progress" = 100, "upload" = NULL, "error" = NULL'
        " WHERE \"id\" = ? AND \"status\" = 'encoding'",
        (sha256, directory, thumbnail, duration_s, video_id),
    ).rowcount == 1


def set_segment_thumbnail(con: sqlite3.Connection, segment_id: int, video_id: int, name: str) -> None:
    con.execute(
        'UPDATE "segment" SET "thumbnail" = ? WHERE "id" = ? AND "video" = ?', (name, segment_id, video_id)
    )


def requeue_or_fail(con: sqlite3.Connection, video_id: int, error: str, requeue: bool) -> bool:
    return con.execute(
        'UPDATE "video" SET "status" = ?, "error" = ?'
        " WHERE \"id\" = ? AND \"status\" = 'encoding'",
        ("queued" if requeue else "failed", error, video_id),
    ).rowcount == 1
