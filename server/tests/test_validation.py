import re

import pytest
from pydantic import BaseModel, ValidationError

from app.core.validation import RULES, field

KEYS = {"min_length", "max_length", "pattern"}


@pytest.mark.parametrize("name", RULES)
def test_rule_shape(name):
    rule = RULES[name]
    assert set(rule) <= KEYS and "max_length" in rule
    if "pattern" in rule:
        # Anchored for pydantic (search); the HTML pattern attribute anchors itself.
        assert rule["pattern"].startswith("^") and rule["pattern"].endswith("$")
        re.compile(rule["pattern"])


class Username(BaseModel):
    value: str = field("username")


@pytest.mark.parametrize("value", ["admin", "a.b_c-d", "x" * 32])
def test_username_accepted(value):
    Username(value=value)


@pytest.mark.parametrize("value", ["ab", "x" * 33, "Admin", "a b", "a/b", "é" * 5])
def test_username_rejected(value):
    with pytest.raises(ValidationError):
        Username(value=value)
