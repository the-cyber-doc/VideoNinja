"""Tags and their fixed values."""

import sqlite3


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
