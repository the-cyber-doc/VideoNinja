"""Every SQL statement of the application, one function each.

Values are always bound as parameters (?), never formatted into the SQL.
These functions never commit: the caller opens the transaction (db.write, or
db.read for several reads), so one transaction can span several of them.
"""

import sqlite3

# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().

# --- user ---


def insert_user(
    con: sqlite3.Connection,
    username: str,
    role: str,
    name: str | None = None,
    pw_hash: str | None = None,
) -> int:
    return con.execute(
        'INSERT INTO "user" ("username", "name", "pw_hash", "role") VALUES (?, ?, ?, ?)',
        (username, name, pw_hash, role),
    ).lastrowid


def user_exists(con: sqlite3.Connection, user_id: int) -> bool:
    return con.execute('SELECT 1 FROM "user" WHERE "id" = ?', (user_id,)).fetchone() is not None


def username_exists(con: sqlite3.Connection, username: str) -> bool:
    return con.execute('SELECT 1 FROM "user" WHERE "username" = ?', (username,)).fetchone() is not None


def user_for_login(con: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return con.execute(
        'SELECT "id", "username", "name", "pw_hash", "totp", "role", "time_zone" FROM "user"'
        ' WHERE "username" = ?',
        (username,),
    ).fetchone()


def user_pw_hash(con: sqlite3.Connection, user_id: int) -> str | None:
    return con.execute('SELECT "pw_hash" FROM "user" WHERE "id" = ?', (user_id,)).fetchone()[0]


def list_users(con: sqlite3.Connection, now: str) -> list[sqlite3.Row]:
    """Every user with "registered" (password + TOTP set) and "invited" (valid invitation)."""
    return con.execute(
        'SELECT u."id", u."username", u."name", u."role",'
        ' u."pw_hash" IS NOT NULL AND u."totp" IS NOT NULL AS "registered",'
        ' COALESCE(datetime(i."expires_at") > datetime(?), 0) AS "invited"'
        ' FROM "user" u LEFT JOIN "invite" i ON i."user" = u."id" ORDER BY u."username"',
        (now,),
    ).fetchall()


def set_user_time_zone(con: sqlite3.Connection, user_id: int, time_zone: str) -> None:
    con.execute('UPDATE "user" SET "time_zone" = ? WHERE "id" = ?', (time_zone, user_id))


def set_user_name(con: sqlite3.Connection, user_id: int, name: str | None) -> None:
    con.execute('UPDATE "user" SET "name" = ? WHERE "id" = ?', (name, user_id))


def set_user_pw_hash(con: sqlite3.Connection, user_id: int, pw_hash: str) -> None:
    con.execute('UPDATE "user" SET "pw_hash" = ? WHERE "id" = ?', (pw_hash, user_id))


def set_user_totp(con: sqlite3.Connection, user_id: int, totp: str) -> None:
    con.execute('UPDATE "user" SET "totp" = ? WHERE "id" = ?', (totp, user_id))


def set_user_registration(
    con: sqlite3.Connection, user_id: int, name: str | None, pw_hash: str, totp: str
) -> None:
    con.execute(
        'UPDATE "user" SET "name" = ?, "pw_hash" = ?, "totp" = ? WHERE "id" = ?',
        (name, pw_hash, totp, user_id),
    )


def clear_user_credentials(con: sqlite3.Connection, user_id: int) -> None:
    con.execute('UPDATE "user" SET "pw_hash" = NULL, "totp" = NULL WHERE "id" = ?', (user_id,))


# --- role / access ---


def roles(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every role, with its name in each language ("name_en", "name_fr")."""
    return con.execute(
        'SELECT r."id", t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "role" r JOIN "translation" t ON t."id" = r."name"'
    ).fetchall()


def role_name(con: sqlite3.Connection, role_id: str) -> sqlite3.Row:
    """The role's name in each language ("name_en", "name_fr")."""
    return con.execute(
        'SELECT t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "role" r JOIN "translation" t ON t."id" = r."name" WHERE r."id" = ?',
        (role_id,),
    ).fetchone()


def role_exists(con: sqlite3.Connection, role_id: str) -> bool:
    return con.execute('SELECT 1 FROM "role" WHERE "id" = ?', (role_id,)).fetchone() is not None


def role_access(con: sqlite3.Connection, role: str) -> list[str]:
    rows = con.execute(
        'SELECT "access" FROM "role_has_access" WHERE "role" = ? ORDER BY "access"', (role,)
    )
    return [r[0] for r in rows]


# --- session ---


def insert_session(
    con: sqlite3.Connection, session_id: str, user_id: int, now: str, expires_at: str
) -> None:
    con.execute(
        'INSERT INTO "session" ("id", "user", "created_at", "last_seen_at", "expires_at")'
        " VALUES (?, ?, ?, ?, ?)",
        (session_id, user_id, now, now, expires_at),
    )


def session_user(con: sqlite3.Connection, session_id: str, now: str) -> sqlite3.Row | None:
    """The unexpired session's times and its user."""
    return con.execute(
        'SELECT s."created_at", s."last_seen_at", u."id", u."username", u."name", u."role",'
        ' u."time_zone"'
        ' FROM "session" s JOIN "user" u ON u."id" = s."user"'
        ' WHERE s."id" = ? AND datetime(s."expires_at") > datetime(?)',
        (session_id, now),
    ).fetchone()


def touch_session(con: sqlite3.Connection, session_id: str, now: str, expires_at: str) -> None:
    con.execute(
        'UPDATE "session" SET "last_seen_at" = ?, "expires_at" = ? WHERE "id" = ?',
        (now, expires_at, session_id),
    )


def delete_session(con: sqlite3.Connection, session_id: str) -> None:
    con.execute('DELETE FROM "session" WHERE "id" = ?', (session_id,))


def delete_user_sessions(con: sqlite3.Connection, user_id: int, except_id: str | None = None) -> None:
    """All the user's sessions, except `except_id` if given."""
    if except_id is None:
        con.execute('DELETE FROM "session" WHERE "user" = ?', (user_id,))
    else:
        con.execute('DELETE FROM "session" WHERE "user" = ? AND "id" != ?', (user_id, except_id))


def delete_expired_sessions(con: sqlite3.Connection, now: str) -> None:
    con.execute('DELETE FROM "session" WHERE datetime("expires_at") <= datetime(?)', (now,))


# --- invite ---


def replace_invite(
    con: sqlite3.Connection, user_id: int, token_hash: str, token: str, expires_at: str
) -> None:
    con.execute(
        'INSERT OR REPLACE INTO "invite" ("user", "token_hash", "token", "expires_at") VALUES (?, ?, ?, ?)',
        (user_id, token_hash, token, expires_at),
    )


def invited_user(con: sqlite3.Connection, token_hash: str, now: str) -> sqlite3.Row | None:
    return con.execute(
        'SELECT u."id", u."username", u."name", u."role" FROM "invite" i JOIN "user" u ON u."id" = i."user"'
        ' WHERE i."token_hash" = ? AND datetime(i."expires_at") > datetime(?)',
        (token_hash, now),
    ).fetchone()


def invite_token(con: sqlite3.Connection, user_id: int, now: str) -> str | None:
    """The user's unexpired invitation token, still encrypted."""
    row = con.execute(
        'SELECT "token" FROM "invite" WHERE "user" = ? AND datetime("expires_at") > datetime(?)', (user_id, now)
    ).fetchone()
    return row[0] if row else None


def invite_expiry(con: sqlite3.Connection, user_id: int) -> int:
    return con.execute('SELECT "expires_at" FROM "invite" WHERE "user" = ?', (user_id,)).fetchone()[0]


def delete_invite(con: sqlite3.Connection, user_id: int) -> bool:
    """True if an invitation was deleted."""
    return con.execute('DELETE FROM "invite" WHERE "user" = ?', (user_id,)).rowcount == 1


# --- config ---


def config_value(con: sqlite3.Connection, name: str) -> str | None:
    row = con.execute('SELECT "value" FROM "config" WHERE "name" = ?', (name,)).fetchone()
    return row["value"] if row else None


# --- catalogue ---
# rowid order = insertion order (the seed lists everything in its traditional order).
# Each row with its description in each language ("description_en", "description_fr").


def _named(con: sqlite3.Connection, table: str, *columns: str) -> list[sqlite3.Row]:
    # Table and columns: this module's own names (the callers below), never input.
    names = "".join(f', x."{c}"' for c in ("id", "kanji", "romaji", *columns))[2:]
    sql = f'SELECT {names}, t."en" AS "description_en", t."fr" AS "description_fr" FROM "{table}" x'  # nosec B608
    return con.execute(sql + ' LEFT JOIN "translation" t ON t."id" = x."description" ORDER BY x.rowid').fetchall()


def schools(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "ryu")


def categories(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Taijutsu, Muto Dori, Buki (weapons)."""
    return _named(con, "category")


def weapons(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "weapon")


def sections(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """A school's scrolls and groups: "ryu", "category", "weapon" (None but under Buki)."""
    return _named(con, "section", "ryu", "category", "weapon")


def techniques(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return _named(con, "technique", "section")


def technique_exists(con: sqlite3.Connection, technique_id: str) -> bool:
    return con.execute('SELECT 1 FROM "technique" WHERE "id" = ?', (technique_id,)).fetchone() is not None


def segments(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Segments of published videos only: the others are not encoded yet."""
    return con.execute(
        'SELECT s."id", s."video", s."technique", s."begin_s", s."end_s", s."performer"'
        ' FROM "segment" s JOIN "video" v ON v."id" = s."video"'
        " WHERE v.\"status\" = 'published' ORDER BY s.\"id\""
    ).fetchall()


def segment_media(con: sqlite3.Connection, segment_id: int) -> sqlite3.Row | None:
    """The encoded video's SHA-256 (NULL until published), the segment's times and
    its thumbnail file name: the segment's own, else its video's."""
    return con.execute(
        'SELECT v."sha256sum", s."begin_s", s."end_s", COALESCE(s."thumbnail", v."thumbnail") AS "thumbnail"'
        ' FROM "segment" s JOIN "video" v ON v."id" = s."video" WHERE s."id" = ?',
        (segment_id,),
    ).fetchone()


# --- comment ---


def technique_comments(con: sqlite3.Connection, technique_id: str, user_id: int) -> list[sqlite3.Row]:
    """Last modified first, with the author's display name (else username) and
    "mine": written by `user_id`."""
    return con.execute(
        'SELECT c."id", COALESCE(u."name", u."username") AS "user", c."created_at", c."modified_at",'
        ' c."lang", c."text", c."user" = ? AS "mine"'
        ' FROM "comment" c JOIN "user" u ON u."id" = c."user"'
        ' WHERE c."technique" = ? ORDER BY datetime(c."modified_at") DESC, c."id" DESC',
        (user_id, technique_id),
    ).fetchall()


def comment(con: sqlite3.Connection, comment_id: int, user_id: int) -> sqlite3.Row | None:
    """One comment, as in technique_comments, with its author's ID ("author")."""
    return con.execute(
        'SELECT c."id", COALESCE(u."name", u."username") AS "user", c."created_at", c."modified_at",'
        ' c."lang", c."text", c."user" = ? AS "mine", c."user" AS "author"'
        ' FROM "comment" c JOIN "user" u ON u."id" = c."user" WHERE c."id" = ?',
        (user_id, comment_id),
    ).fetchone()


def insert_comment(con: sqlite3.Connection, technique_id: str, user_id: int, lang: str, text: str, now: str) -> int:
    return con.execute(
        'INSERT INTO "comment" ("technique", "user", "lang", "text", "created_at", "modified_at")'
        " VALUES (?, ?, ?, ?, ?, ?)",
        (technique_id, user_id, lang, text, now, now),
    ).lastrowid


def update_comment(con: sqlite3.Connection, comment_id: int, lang: str, text: str, now: str) -> None:
    con.execute(
        'UPDATE "comment" SET "lang" = ?, "text" = ?, "modified_at" = ? WHERE "id" = ?',
        (lang, text, now, comment_id),
    )


def delete_comment(con: sqlite3.Connection, comment_id: int) -> None:
    con.execute('DELETE FROM "comment" WHERE "id" = ?', (comment_id,))


# --- performer / tag ---


def performers(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute('SELECT "id", "name" FROM "performer"').fetchall()


def performer_exists(con: sqlite3.Connection, performer_id: str) -> bool:
    return con.execute('SELECT 1 FROM "performer" WHERE "id" = ?', (performer_id,)).fetchone() is not None


def performer_name_exists(con: sqlite3.Connection, name: str) -> bool:
    return (
        con.execute('SELECT 1 FROM "performer" WHERE "name" = ? COLLATE NOCASE', (name,)).fetchone()
        is not None
    )


def insert_performer(con: sqlite3.Connection, performer_id: str, name: str) -> None:
    con.execute('INSERT INTO "performer" ("id", "name") VALUES (?, ?)', (performer_id, name))


def tags(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every tag, with its name in each language ("name_en", "name_fr")."""
    return con.execute(
        'SELECT g."id", g."value_format", t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "tag" g JOIN "translation" t ON t."id" = g."name"'
    ).fetchall()


def tag_values(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every fixed value of every tag, with its name in each language."""
    return con.execute(
        'SELECT v."tag", v."id", t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "tag_value" v JOIN "translation" t ON t."id" = v."name"'
    ).fetchall()


# --- upload (tus) ---


def insert_upload(
    con: sqlite3.Connection, tus_id: str, user_id: int, original_sha256: str, size: int, now: str
) -> None:
    con.execute(
        'INSERT INTO "upload" ("tus_id", "user", "original_sha256", "size", "created_at") VALUES (?, ?, ?, ?, ?)',
        (tus_id, user_id, original_sha256, size, now),
    )


def upload(con: sqlite3.Connection, tus_id: str) -> sqlite3.Row | None:
    return con.execute(
        'SELECT "tus_id", "user", "original_sha256", "size", "state" FROM "upload" WHERE "tus_id" = ?',
        (tus_id,),
    ).fetchone()


def set_upload_state(con: sqlite3.Connection, tus_id: str, state: str) -> None:
    con.execute('UPDATE "upload" SET "state" = ? WHERE "tus_id" = ?', (state, tus_id))


def delete_upload(con: sqlite3.Connection, tus_id: str) -> None:
    con.execute('DELETE FROM "upload" WHERE "tus_id" = ?', (tus_id,))


def expire_uploads(con: sqlite3.Connection, created_before: str) -> None:
    """Uploads abandoned (never finished) or never submitted: their files go."""
    con.execute(
        "UPDATE \"upload\" SET \"state\" = 'deleted'"
        " WHERE \"state\" IN ('uploading', 'finished') AND datetime(\"created_at\") < datetime(?)"
        ' AND "tus_id" NOT IN (SELECT "upload" FROM "video" WHERE "upload" IS NOT NULL)',
        (created_before,),
    )


def deleted_uploads(con: sqlite3.Connection) -> list[str]:
    rows = con.execute("SELECT \"tus_id\" FROM \"upload\" WHERE \"state\" = 'deleted' ORDER BY \"id\"")
    return [r[0] for r in rows]


# --- video (queue) ---


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


def insert_segment(
    con: sqlite3.Connection, video_id: int, technique: str, begin_s: int, end_s: int, performer: str, user_id: int
) -> int:
    """user_id: who created the segment (kept when it is edited later)."""
    return con.execute(
        'INSERT INTO "segment" ("video", "technique", "begin_s", "end_s", "performer", "created_by")'
        " VALUES (?, ?, ?, ?, ?, ?)",
        (video_id, technique, begin_s, end_s, performer, user_id),
    ).lastrowid


def insert_video_tag(con: sqlite3.Connection, video_id: int, tag: str, value: str | None) -> None:
    con.execute('INSERT INTO "video_has_tags" ("video", "tag", "value") VALUES (?, ?, ?)', (video_id, tag, value))


def insert_segment_tag(con: sqlite3.Connection, segment_id: int, tag: str, value: str | None) -> None:
    con.execute(
        'INSERT INTO "segment_has_tags" ("segment", "tag", "value") VALUES (?, ?, ?)', (segment_id, tag, value)
    )


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


# --- video management (published videos, annotated again) ---


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


def video_segments(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    """created_by: the author's display name (name, else username); None if unknown."""
    return con.execute(
        'SELECT s."id", s."begin_s", s."end_s", s."technique", s."performer",'
        ' COALESCE(u."name", u."username") AS "created_by"'
        ' FROM "segment" s LEFT JOIN "user" u ON u."id" = s."created_by"'
        ' WHERE s."video" = ? ORDER BY s."begin_s", s."id"',
        (video_id,),
    ).fetchall()


def video_tags(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "tag", "value" FROM "video_has_tags" WHERE "video" = ? ORDER BY "tag"', (video_id,)
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


def clear_video_tags(con: sqlite3.Connection, video_id: int) -> None:
    con.execute('DELETE FROM "video_has_tags" WHERE "video" = ?', (video_id,))


def set_all_segments_done(con: sqlite3.Connection, video_id: int, done: bool) -> None:
    con.execute('UPDATE "video" SET "all_segments_done" = ? WHERE "id" = ?', (done, video_id))


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


def clear_segment_thumbnail(con: sqlite3.Connection, segment_id: int) -> None:
    con.execute('UPDATE "segment" SET "thumbnail" = NULL WHERE "id" = ?', (segment_id,))


def mark_thumbs_dirty(con: sqlite3.Connection, video_id: int) -> None:
    con.execute('UPDATE "video" SET "thumbs_dirty" = "thumbs_dirty" + 1 WHERE "id" = ?', (video_id,))


def thumbs_dirty_videos(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "sha256sum", "duration_s", "thumbs_dirty" FROM "video"'
        " WHERE \"thumbs_dirty\" > 0 AND \"status\" = 'published' ORDER BY \"id\""
    ).fetchall()


def segment_thumbnails(con: sqlite3.Connection, video_id: int) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "begin_s", "end_s", "thumbnail" FROM "segment" WHERE "video" = ?', (video_id,)
    ).fetchall()


def set_new_segment_thumbnail(con: sqlite3.Connection, segment: sqlite3.Row, name: str) -> None:
    """Only if the segment still has no thumbnail and the same times (not re-timed meanwhile)."""
    con.execute(
        'UPDATE "segment" SET "thumbnail" = ?'
        ' WHERE "id" = ? AND "thumbnail" IS NULL AND "begin_s" = ? AND "end_s" = ?',
        (name, segment["id"], segment["begin_s"], segment["end_s"]),
    )


def clear_thumbs_dirty(con: sqlite3.Connection, video_id: int, seen: int) -> None:
    """Only the changes seen: one made meanwhile keeps the video dirty."""
    con.execute(
        'UPDATE "video" SET "thumbs_dirty" = "thumbs_dirty" - ? WHERE "id" = ?', (seen, video_id)
    )


# --- heartbeat ---


def set_heartbeat(con: sqlite3.Connection, name: str, at: str) -> None:
    con.execute(
        'INSERT INTO "heartbeat" ("name", "at") VALUES (?, ?) ON CONFLICT ("name") DO UPDATE SET "at" = excluded."at"',
        (name, at),
    )


def heartbeat(con: sqlite3.Connection, name: str) -> str | None:
    row = con.execute('SELECT "at" FROM "heartbeat" WHERE "name" = ?', (name,)).fetchone()
    return row["at"] if row else None


def requeue_or_fail(con: sqlite3.Connection, video_id: int, error: str, requeue: bool) -> bool:
    return con.execute(
        'UPDATE "video" SET "status" = ?, "error" = ?'
        " WHERE \"id\" = ? AND \"status\" = 'encoding'",
        ("queued" if requeue else "failed", error, video_id),
    ).rowcount == 1


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
