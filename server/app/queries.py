"""Every SQL statement of the application, one function each.

Values are always bound as parameters (?), never formatted into the SQL.
These functions never commit: the caller opens the transaction (`with con:`),
so one transaction can span several of them.
"""

import sqlite3

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
        'SELECT "id", "username", "name", "pw_hash", "totp", "role" FROM "user" WHERE "username" = ?',
        (username,),
    ).fetchone()


def user_pw_hash(con: sqlite3.Connection, user_id: int) -> str | None:
    return con.execute('SELECT "pw_hash" FROM "user" WHERE "id" = ?', (user_id,)).fetchone()[0]


def list_users(con: sqlite3.Connection, now: int) -> list[sqlite3.Row]:
    """Every user with "registered" (password + TOTP set) and "invited" (valid invitation)."""
    return con.execute(
        'SELECT u."id", u."username", u."name", u."role",'
        ' u."pw_hash" IS NOT NULL AND u."totp" IS NOT NULL AS "registered",'
        ' COALESCE(i."expires_s" > ?, 0) AS "invited"'
        ' FROM "user" u LEFT JOIN "invite" i ON i."user" = u."id" ORDER BY u."username"',
        (now,),
    ).fetchall()


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
    con: sqlite3.Connection, session_id: str, user_id: int, now: int, expires_s: int
) -> None:
    con.execute(
        'INSERT INTO "session" ("id", "user", "created_s", "last_seen_s", "expires_s")'
        " VALUES (?, ?, ?, ?, ?)",
        (session_id, user_id, now, now, expires_s),
    )


def session_user(con: sqlite3.Connection, session_id: str, now: int) -> sqlite3.Row | None:
    """The unexpired session's times and its user."""
    return con.execute(
        'SELECT s."created_s", s."last_seen_s", u."id", u."username", u."name", u."role"'
        ' FROM "session" s JOIN "user" u ON u."id" = s."user"'
        ' WHERE s."id" = ? AND s."expires_s" > ?',
        (session_id, now),
    ).fetchone()


def touch_session(con: sqlite3.Connection, session_id: str, now: int, expires_s: int) -> None:
    con.execute(
        'UPDATE "session" SET "last_seen_s" = ?, "expires_s" = ? WHERE "id" = ?',
        (now, expires_s, session_id),
    )


def delete_session(con: sqlite3.Connection, session_id: str) -> None:
    con.execute('DELETE FROM "session" WHERE "id" = ?', (session_id,))


def delete_user_sessions(con: sqlite3.Connection, user_id: int, except_id: str | None = None) -> None:
    """All the user's sessions, except `except_id` if given."""
    if except_id is None:
        con.execute('DELETE FROM "session" WHERE "user" = ?', (user_id,))
    else:
        con.execute('DELETE FROM "session" WHERE "user" = ? AND "id" != ?', (user_id, except_id))


def delete_expired_sessions(con: sqlite3.Connection, now: int) -> None:
    con.execute('DELETE FROM "session" WHERE "expires_s" <= ?', (now,))


# --- invite ---


def replace_invite(
    con: sqlite3.Connection, user_id: int, token_hash: str, token: str, expires_s: int
) -> None:
    con.execute(
        'INSERT OR REPLACE INTO "invite" ("user", "token_hash", "token", "expires_s") VALUES (?, ?, ?, ?)',
        (user_id, token_hash, token, expires_s),
    )


def invited_user(con: sqlite3.Connection, token_hash: str, now: int) -> sqlite3.Row | None:
    return con.execute(
        'SELECT u."id", u."username", u."name", u."role" FROM "invite" i JOIN "user" u ON u."id" = i."user"'
        ' WHERE i."token_hash" = ? AND i."expires_s" > ?',
        (token_hash, now),
    ).fetchone()


def invite_token(con: sqlite3.Connection, user_id: int, now: int) -> str | None:
    """The user's unexpired invitation token, still encrypted."""
    row = con.execute(
        'SELECT "token" FROM "invite" WHERE "user" = ? AND "expires_s" > ?', (user_id, now)
    ).fetchone()
    return row[0] if row else None


def invite_expiry(con: sqlite3.Connection, user_id: int) -> int:
    return con.execute('SELECT "expires_s" FROM "invite" WHERE "user" = ?', (user_id,)).fetchone()[0]


def delete_invite(con: sqlite3.Connection, user_id: int) -> bool:
    """True if an invitation was deleted."""
    return con.execute('DELETE FROM "invite" WHERE "user" = ?', (user_id,)).rowcount == 1


# --- catalogue ---
# rowid order = insertion order (the seed lists schools and levels in their traditional order).


def schools(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every school, with its description in each language ("description_en", "description_fr")."""
    return con.execute(
        'SELECT r."id", r."kanji", r."romaji", t."en" AS "description_en", t."fr" AS "description_fr"'
        ' FROM "ryu" r LEFT JOIN "translation" t ON t."id" = r."description" ORDER BY r.rowid'
    ).fetchall()


def levels(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every level, with its description in each language ("description_en", "description_fr")."""
    return con.execute(
        'SELECT l."id", l."kanji", l."romaji", t."en" AS "description_en", t."fr" AS "description_fr"'
        ' FROM "level" l LEFT JOIN "translation" t ON t."id" = l."description" ORDER BY l.rowid'
    ).fetchall()


def techniques(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        'SELECT "id", "kanji", "romaji", "ryu", "level" FROM "technique" ORDER BY rowid'
    ).fetchall()
