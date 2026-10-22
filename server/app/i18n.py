"""Content languages: the language of a request, and picking a translated text.

Translated texts live in the "translation" table, one column per language.
Queries select every language column as "<key>_<lang>" (e.g. "name_fr"), and
`pick` chooses: requested language, then English, then `fallback` (e.g. the ID).
Japanese names (kanji, romaji) are not translations: they are sent as they are.
"""

import sqlite3

from fastapi import Header

LANGS = ("en", "fr")  # the columns of "translation"; "en" is required
DEFAULT = "en"


def parse(accept_language: str | None) -> str:
    """The best supported language of an Accept-Language value, else English.

    The frontend sends only its chosen language ("fr"); a browser's list
    ("fr-CA,fr;q=0.9,en;q=0.8") works too.
    """
    choices = []
    for i, part in enumerate((accept_language or "").split(",")):
        tag, _, params = part.partition(";")
        q = 1.0
        if params.strip().startswith("q="):
            try:
                q = float(params.strip()[2:])
            except ValueError:
                continue
        lang = tag.strip().split("-")[0].lower()
        if q > 0 and lang in LANGS:
            choices.append((-q, i, lang))
    return min(choices)[2] if choices else DEFAULT


def language(accept_language: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the language to answer in."""
    return parse(accept_language)


def pick(row: sqlite3.Row, key: str, lang: str, fallback: str | None = None) -> str | None:
    return row[f"{key}_{lang}"] or row[f"{key}_{DEFAULT}"] or fallback
