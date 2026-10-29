"""Tags that can be put on videos and segments. Tags are created by admins (no
page yet); a tag takes one of its fixed values, or text in its value format
(any text, or a year). Names (of tags and of fixed values) are translated; text
values are not."""

import re
import sqlite3
from datetime import tzinfo
from typing import Literal


from .. import queries
from ..core import clock

YEARS_BACK = 100  # a "year" tag: from this many years ago to this year
YEAR = re.compile(r"[0-9]{4}")

# What a tag takes: its fixed value IDs, "year", or None (any text).
Rule = list[str] | Literal["year"] | None


def year_range(zone: tzinfo) -> tuple[int, int]:
    """The years a "year" tag accepts, from the user's current year."""
    this_year = clock.now().astimezone(zone).year
    return this_year - YEARS_BACK, this_year


def tag_rules(con: sqlite3.Connection) -> dict[str, Rule]:
    rules: dict[str, Rule] = {r["id"]: r["value_format"] for r in queries.tags.tags(con)}
    for v in queries.tags.tag_values(con):
        rule = rules[v["tag"]]
        rules[v["tag"]] = [*(rule if isinstance(rule, list) else []), v["id"]]
    return rules


def value_error(rule: Rule, value: str | None, zone: tzinfo) -> tuple[str, dict[str, str | int]] | None:
    """Why `value` is not accepted by a tag with this rule (an error code of errors.py
    and its params, but the tag), or None."""
    if rule == "year":
        low, high = year_range(zone)
        if value is None or not YEAR.fullmatch(value) or not low <= int(value) <= high:
            return "tag.year", {"min": low, "max": high}
    elif rule is not None and value not in rule:
        return "tag.value", {"values": ", ".join(rule)}
    return None
