"""Users, their roles and what the roles allow."""

import json
import sqlite3
from dataclasses import dataclass

from .rows import inserted

# What a user's role allows, as a JSON array (one query with the user: no other per request).
ACCESS = '(SELECT json_group_array(a."access") FROM "role_has_access" a WHERE a."role" = u."role") AS "access"'
USER_COLUMNS = f'u."id", u."username", u."name", u."role", u."time_zone", {ACCESS}'


@dataclass(frozen=True)
class User:
    """A user as the app sees them: who, their role, what it allows. No credentials."""

    id: int
    username: str
    name: str | None
    role: str
    time_zone: str | None  # IANA name, from the browser (clock.py)
    access: frozenset[str]  # e.g. {"user_mgmt", "upload"}

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> User:
        """A row with USER_COLUMNS."""
        return cls(
            row["id"], row["username"], row["name"], row["role"], row["time_zone"], frozenset(json.loads(row["access"]))
        )


@dataclass(frozen=True)
class Credentials:
    """For the login only: the user and what proves it is them (both None until registered)."""

    user: User
    pw_hash: str | None
    totp: str | None  # encrypted (crypto.py)


# Dates are text with their UTC offset, "2026-10-23T12:13:38+02:00" (app/clock.py),
# in different timezones: always compare and sort them through datetime().


def insert_user(
    con: sqlite3.Connection,
    username: str,
    role: str,
    name: str | None = None,
    pw_hash: str | None = None,
) -> int:
    return inserted(
        con.execute(
            'INSERT INTO "user" ("username", "name", "pw_hash", "role") VALUES (?, ?, ?, ?)',
            (username, name, pw_hash, role),
        )
    )


def user_exists(con: sqlite3.Connection, user_id: int) -> bool:
    return con.execute('SELECT 1 FROM "user" WHERE "id" = ?', (user_id,)).fetchone() is not None


def username_exists(con: sqlite3.Connection, username: str) -> bool:
    return con.execute('SELECT 1 FROM "user" WHERE "username" = ?', (username,)).fetchone() is not None


def user_for_login(con: sqlite3.Connection, username: str) -> Credentials | None:
    row = con.execute(
        f'SELECT {USER_COLUMNS}, u."pw_hash", u."totp" FROM "user" u'  # a constant, no input  # nosec B608
        ' WHERE u."username" = ?',
        (username,),
    ).fetchone()
    return Credentials(User.from_row(row), row["pw_hash"], row["totp"]) if row else None


def user_pw_hash(con: sqlite3.Connection, user_id: int) -> str | None:
    pw_hash: str | None = con.execute('SELECT "pw_hash" FROM "user" WHERE "id" = ?', (user_id,)).fetchone()[0]
    return pw_hash


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


def set_user_registration(con: sqlite3.Connection, user_id: int, name: str | None, pw_hash: str, totp: str) -> None:
    con.execute(
        'UPDATE "user" SET "name" = ?, "pw_hash" = ?, "totp" = ? WHERE "id" = ?',
        (name, pw_hash, totp, user_id),
    )


def clear_user_credentials(con: sqlite3.Connection, user_id: int) -> None:
    con.execute('UPDATE "user" SET "pw_hash" = NULL, "totp" = NULL WHERE "id" = ?', (user_id,))


def roles(con: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every role, with its name in each language ("name_en", "name_fr")."""
    return con.execute(
        'SELECT r."id", t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "role" r JOIN "translation" t ON t."id" = r."name"'
    ).fetchall()


def role_name(con: sqlite3.Connection, role_id: str) -> sqlite3.Row:
    """The role's name in each language ("name_en", "name_fr")."""
    row: sqlite3.Row = con.execute(
        'SELECT t."en" AS "name_en", t."fr" AS "name_fr"'
        ' FROM "role" r JOIN "translation" t ON t."id" = r."name" WHERE r."id" = ?',
        (role_id,),
    ).fetchone()
    return row


def role_exists(con: sqlite3.Connection, role_id: str) -> bool:
    return con.execute('SELECT 1 FROM "role" WHERE "id" = ?', (role_id,)).fetchone() is not None
