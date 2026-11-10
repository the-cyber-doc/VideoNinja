"""The search's full text: the books' page text (written), and the hits in the FTS5 indexes
over pages, book annotations and techniques' comments (domain/search.py makes the query). Published
books only. Best first (FTS5's rank) when a term has 3+ characters, else newest first.
`match`: the FTS5 expression (None: no term long enough), `likes`: LIKE patterns (ESCAPE '\\')."""

import sqlite3
from collections.abc import Sequence

from .users import DELETED_USER_ID

_AUTHOR = 'LEFT JOIN "user" u ON u."id" = x."user" AND u."id" <> ?'


def _hits(
    con: sqlite3.Connection,
    match: str | None,
    likes: Sequence[str],
    *,
    fts: str,
    table: str,
    text: str,
    select: str,
    joins: str = "",
    join_params: Sequence[object] = (),
    where: Sequence[str] = (),
    params: Sequence[object] = (),
    limit: int,
) -> list[sqlite3.Row]:
    """Rows of `table` (alias x) matching every term; `text` = the SQL of its searched text
    (for LIKE). Everything but the `?` parameters comes from this module's constants."""
    source = f'"{fts}" JOIN "{table}" x ON x."id" = "{fts}"."rowid"' if match else f'"{table}" x'
    conditions = [*where]
    args = [*join_params, *params]
    if match:
        conditions.append(f'"{fts}" MATCH ?')
        args.append(match)
    for like in likes:
        conditions.append(f"{text} LIKE ? ESCAPE '\\'")
        args.append(like)
    order = f'"{fts}"."rank"' if match else 'x."id" DESC'
    sql = (
        f"SELECT {select} FROM {source} {joins}"  # nosec B608 - names and SQL from this module's constants
        f" WHERE {' AND '.join(conditions) or '1'} ORDER BY {order} LIMIT ?"
    )
    return con.execute(sql, (*args, limit)).fetchall()


def pages(con: sqlite3.Connection, match: str | None, likes: Sequence[str], limit: int) -> list[sqlite3.Row]:
    """Pages of published books: "book", "page", "text"."""
    return _hits(
        con,
        match,
        likes,
        fts="book_page_fts",
        table="book_page",
        text='x."text"',
        select='x."book", x."page", x."text"',
        joins='JOIN "book" b ON b."id" = x."book"',
        where=["b.\"status\" = 'published'"],
        limit=limit,
    )


_ANNOTATION_TEXT = "COALESCE(x.\"quote\", '') || ' ' || COALESCE(x.\"note\", '')"


def annotations(
    con: sqlite3.Connection, match: str | None, likes: Sequence[str], with_technique_only: bool, limit: int
) -> list[sqlite3.Row]:
    """Annotations of published books (only those of a technique: `with_technique_only`):
    "id", "book", "page", "technique", "text" (quote and note)."""
    return _hits(
        con,
        match,
        likes,
        fts="book_annotation_fts",
        table="book_annotation",
        text=_ANNOTATION_TEXT,
        select=f'x."id", x."book", x."page", x."technique", {_ANNOTATION_TEXT} AS "text"',
        joins='JOIN "book" b ON b."id" = x."book"',
        where=["b.\"status\" = 'published'", *(['x."technique" IS NOT NULL'] if with_technique_only else [])],
        limit=limit,
    )


def comments(con: sqlite3.Connection, match: str | None, likes: Sequence[str], limit: int) -> list[sqlite3.Row]:
    """Comments on techniques: "id", "technique", "user" (display name; None: deleted), "text"."""
    return _hits(
        con,
        match,
        likes,
        fts="comment_fts",
        table="comment",
        text='x."text"',
        select='x."id", x."technique", COALESCE(u."name", u."username") AS "user", x."text"',
        joins=_AUTHOR,
        join_params=(DELETED_USER_ID,),
        limit=limit,
    )


# --- the page text, sent by the browser ---


def clear_pages(con: sqlite3.Connection, book_id: int) -> None:
    """Before the first batch: the text sent before goes, the book counts as not sent."""
    con.execute('DELETE FROM "book_page" WHERE "book" = ?', (book_id,))
    con.execute('UPDATE "book" SET "text_pages" = NULL WHERE "id" = ?', (book_id,))


def insert_pages(con: sqlite3.Connection, book_id: int, pages: list[tuple[int, str]]) -> None:
    """(page, text) rows; a page already there is replaced."""
    con.executemany(
        'INSERT INTO "book_page" ("book", "page", "text") VALUES (?, ?, ?)'
        ' ON CONFLICT ("book", "page") DO UPDATE SET "text" = excluded."text"',
        [(book_id, page, text) for page, text in pages],
    )


def finish_pages(con: sqlite3.Connection, book_id: int) -> int:
    """After the last batch: the count of pages with text, kept in book.text_pages."""
    con.execute(
        'UPDATE "book" SET "text_pages" = (SELECT count(*) FROM "book_page" WHERE "book" = ?) WHERE "id" = ?',
        (book_id, book_id),
    )
    row = con.execute('SELECT "text_pages" FROM "book" WHERE "id" = ?', (book_id,)).fetchone()
    return int(row[0])
