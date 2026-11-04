"""A book's reference: one CSL-JSON item (the format of Zotero, BibTeX converters and
Pandoc: https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html), with the
types and fields this app offers. Stored as JSON in book.reference, shown by the
frontend in Chicago style ($lib/books/citation.ts). Bibliographic data is shown as
typed: never translated.

Field names are CSL's (hyphens included: "container-title", "publisher-place"); the
Python attributes use underscores. Unknown fields are refused, empty strings too
(a field left blank is simply absent).
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..core.validation import field

Type = Literal["book", "chapter", "article-journal", "thesis", "manuscript"]


class _Csl(BaseModel):
    """CSL names, unknown fields refused. Stored without the absent fields (to_json);
    answered with them as null (typed: the frontend treats null as absent)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


class Name(_Csl):
    """A person or an organisation: family + given (inverted in the bibliography), or
    a literal name shown as is (an organisation, a single name, a Japanese name written
    family name first: "Hatsumi Masaaki")."""

    family: str | None = field("reference_name", default=None)
    given: str | None = field("reference_name", default=None)
    literal: str | None = field("reference_name", default=None)

    @model_validator(mode="after")
    def _one_form(self) -> Name:
        if (self.literal is None) == (self.family is None) or (self.literal is not None and self.given is not None):
            raise PydanticCustomError("reference_name", "Either a family name (and a given name) or a literal name")
        return self


DatePart = Annotated[int, Field(ge=1, le=9999)]


class Date(_Csl):
    """CSL's date: {"date-parts": [[year, month?, day?]]} (one date, no range)."""

    date_parts: list[list[DatePart]] = Field(alias="date-parts", min_length=1, max_length=1)

    @model_validator(mode="after")
    def _year_month_day(self) -> Date:
        [parts] = self.date_parts
        if not 1 <= len(parts) <= 3 or (len(parts) > 1 and parts[1] > 12) or (len(parts) > 2 and parts[2] > 31):
            raise PydanticCustomError("reference_date", "A date is a year, a month (1-12) and a day (1-31)")
        return self


Names = list[Name] | None


def _text(name: str = "reference_text", alias: str | None = None) -> Any:
    return field(name, default=None, alias=alias)


class Reference(_Csl):
    """The fields each type uses are the frontend's choice (ReferenceForm); the server
    takes any of them for any type, checks their form, and needs a title."""

    type: Type
    title: str = field("reference_text")
    original_title: str | None = _text(alias="original-title")
    container_title: str | None = _text(alias="container-title")  # the book of a chapter, the journal
    collection_title: str | None = _text(alias="collection-title")  # the series
    collection_number: str | None = _text("reference_short", alias="collection-number")
    author: Names = Field(default=None, max_length=20)
    editor: Names = Field(default=None, max_length=20)
    translator: Names = Field(default=None, max_length=20)
    edition: str | None = _text("reference_short")
    volume: str | None = _text("reference_short")
    issue: str | None = _text("reference_short")
    page: str | None = _text("reference_short")  # pages of a chapter or an article: "12-34"
    number_of_pages: str | None = _text("reference_short", alias="number-of-pages")
    publisher: str | None = _text()
    publisher_place: str | None = _text(alias="publisher-place")
    genre: str | None = _text("reference_short")  # a thesis's kind: "PhD diss."
    archive: str | None = _text()  # where a manuscript is kept
    archive_place: str | None = _text(alias="archive-place")
    issued: Date | None = None
    original_date: Date | None = Field(default=None, alias="original-date")
    accessed: Date | None = None
    ISBN: str | None = _text("reference_short")
    ISSN: str | None = _text("reference_short")
    DOI: str | None = _text("reference_short")
    URL: str | None = field("reference_url", default=None)
    language: str | None = field("reference_language", default=None)
    note: str | None = field("reference_note", default=None)

    def to_json(self) -> str:
        """As stored: CSL names, nothing empty."""
        return self.model_dump_json(exclude_none=True)
