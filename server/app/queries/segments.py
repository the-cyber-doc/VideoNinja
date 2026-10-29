"""Segments of a video, and their tags."""

import sqlite3

from .rows import inserted


def insert_segment(
    con: sqlite3.Connection, video_id: int, technique: str, begin_s: int, end_s: int, performer: str, user_id: int
) -> int:
    """user_id: who created the segment (kept when it is edited later)."""
    return inserted(
        con.execute(
            'INSERT INTO "segment" ("video", "technique", "begin_s", "end_s", "performer", "created_by")'
            " VALUES (?, ?, ?, ?, ?, ?)",
            (video_id, technique, begin_s, end_s, performer, user_id),
        )
    )


def insert_segment_tag(con: sqlite3.Connection, segment_id: int, tag: str, value: str | None) -> None:
    con.execute('INSERT INTO "segment_has_tags" ("segment", "tag", "value") VALUES (?, ?, ?)', (segment_id, tag, value))


def video_segments(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    """created_by: the author's display name (name, else username); None if unknown."""
    return con.execute(
        'SELECT s."id", s."begin_s", s."end_s", s."technique", s."performer",'
        ' COALESCE(u."name", u."username") AS "created_by"'
        ' FROM "segment" s LEFT JOIN "user" u ON u."id" = s."created_by"'
        ' WHERE s."video" = ? ORDER BY s."begin_s", s."id"',
        (video_id,),
    ).fetchall()


def video_segment_tags(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT t."segment", t."tag", t."value" FROM "segment_has_tags" t'
        ' JOIN "segment" s ON s."id" = t."segment" WHERE s."video" = ? ORDER BY t."tag"',
        (video_id,),
    ).fetchall()


def update_segment(
    con: sqlite3.Connection, segment_id: int, technique: str, begin_s: int, end_s: int, performer: str
) -> None:
    con.execute(
        'UPDATE "segment" SET "technique" = ?, "begin_s" = ?, "end_s" = ?, "performer" = ? WHERE "id" = ?',
        (technique, begin_s, end_s, performer, segment_id),
    )


def delete_segment(con: sqlite3.Connection, segment_id: int) -> None:
    con.execute('DELETE FROM "segment_has_tags" WHERE "segment" = ?', (segment_id,))
    con.execute('DELETE FROM "segment" WHERE "id" = ?', (segment_id,))


def clear_segment_tags(con: sqlite3.Connection, segment_id: int) -> None:
    con.execute('DELETE FROM "segment_has_tags" WHERE "segment" = ?', (segment_id,))
