"""Input rules shared with the frontend: app/validation.json (where the frontend
imports it at build time), read here."""

import json
from pathlib import Path
from typing import Any

from pydantic import Field

SHARED = Path(__file__).resolve().parents[1] / "validation.json"  # app/validation.json
RULES: dict[str, dict[str, Any]] = {
    name: rule for name, rule in json.loads(SHARED.read_text(encoding="utf-8")).items() if not name.startswith("_")
}


def field(name: str, *, max_only: bool = False, **kwargs: Any) -> Any:
    """Pydantic Field with the shared rules of `name`.

    max_only: only the maximum length, for inputs checked against existing data
    (login), so that tightening a rule never locks out an existing account.
    """
    rule = RULES[name]
    if max_only:
        return Field(max_length=rule["max_length"], **kwargs)
    return Field(
        min_length=rule.get("min_length"),
        max_length=rule.get("max_length"),
        pattern=rule.get("pattern"),
        **kwargs,
    )
