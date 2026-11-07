"""deploy/: the files a release attaches are the README's own examples, word for word."""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")


def block(heading: str, lang: str) -> str:
    """The first ```lang block after the heading, without its fences."""
    start = README.index(f"```{lang}\n", README.index(heading)) + len(lang) + 4
    return README[start : README.index("\n```\n", start) + 1]


@pytest.mark.parametrize(
    ("name", "heading", "lang"),
    [
        ("docker-compose.yaml", "### 2. `docker-compose.yaml`", "yaml"),
        ("reverse-proxy.conf", "#### Your reverse proxy", "nginx"),
    ],
)
def test_same_as_the_readme(name: str, heading: str, lang: str) -> None:
    assert (ROOT / "deploy" / name).read_text(encoding="utf-8") == block(heading, lang)


def test_compose_images_are_the_four_latest() -> None:
    """The release job pins them to its version by replacing ':latest'."""
    compose = (ROOT / "deploy" / "docker-compose.yaml").read_text(encoding="utf-8")
    images = re.findall(r"^\s+image: (\S+)", compose, re.MULTILINE)
    assert images == [f"thecyberdoc/videoninja-{i}:latest" for i in ("nginx", "api", "encoder", "tusd")]
    assert compose.count(":latest") == 4
