"""The search's full text (FTS5, db v5): what the user typed made into a query, and the
snippets shown with each hit.

The indexes use the trigram tokenizer (any part of a word matches, in any script; accents
and case ignored), which needs at least 3 characters: shorter terms are matched with LIKE
instead (no index; case folded for ASCII only). Every term must match. The user's words
are always quoted: FTS5's query syntax (AND, NEAR, column filters…) is never theirs.
"""

import re
import unicodedata
from dataclasses import dataclass

MAX_TERMS = 8
SNIPPET_WIDTH = 60  # characters of context on each side of the first match
START, END = "\x02", "\x03"  # around each match in a snippet (the frontend marks them)
_CONTROLS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


@dataclass(frozen=True)
class Query:
    match: str | None  # the FTS5 expression of the terms of 3+ characters; None: none
    likes: tuple[str, ...]  # LIKE patterns of the shorter ones (ESCAPE '\')
    terms: tuple[str, ...]  # every term, folded (the snippets look for them)


def fold(text: str) -> str:
    """Lower case, without accents (as the trigram tokenizer's remove_diacritics)."""
    return "".join(c for c in unicodedata.normalize("NFD", text.casefold()) if not unicodedata.combining(c))


def parse(text: str) -> Query | None:
    """The query of what was typed; None: nothing to look for."""
    terms = list(dict.fromkeys(t for t in text.split() if t))[:MAX_TERMS]
    if not terms:
        return None
    long = [t for t in terms if len(t) >= 3]
    short = [t for t in terms if len(t) < 3]
    match = " ".join('"' + t.replace('"', '""') + '"' for t in long) or None
    likes = tuple("%" + re.sub(r"([\\%_])", r"\\\1", t) + "%" for t in short)
    return Query(match=match, likes=likes, terms=tuple(fold(t) for t in terms))


def clean(text: str) -> str:
    """Text kept for the search: no control characters (newlines and tabs kept); the
    snippets' markers can then never come from a PDF."""
    return _CONTROLS.sub(" ", text).strip()


def snippet(text: str, terms: tuple[str, ...]) -> str:
    """Around the first match: SNIPPET_WIDTH characters on each side (cut at a space),
    every match inside marked START…END, "…" where text was left out. No match: the start."""
    text = " ".join(text.split())
    folded: list[str] = []
    origin: list[int] = []  # for each folded character, its index in `text`
    for i, c in enumerate(text):
        for f in fold(c):
            folded.append(f)
            origin.append(i)
    flat = "".join(folded)
    spans: list[tuple[int, int]] = []
    for term in terms:
        at = flat.find(term)
        while term and at >= 0:
            spans.append((origin[at], origin[at + len(term) - 1] + 1))
            at = flat.find(term, at + len(term))
    spans.sort()
    first = spans[0] if spans else (0, 0)
    start = max(0, first[0] - SNIPPET_WIDTH)
    end = min(len(text), first[1] + SNIPPET_WIDTH)
    if start > 0 and (space := text.find(" ", start, first[0])) >= 0:
        start = space + 1
    if end < len(text) and (space := text.rfind(" ", first[1], end)) >= 0:
        end = space
    out, at = [], start
    for s, e in spans:
        if s < at or e > end:
            continue  # overlapping a previous one, or outside the window
        out += [text[at:s], START, text[s:e], END]
        at = e
    out.append(text[at:end])
    return ("…" if start > 0 else "") + "".join(out) + ("…" if end < len(text) else "")
