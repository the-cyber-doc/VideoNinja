"""Every error the API answers with, in one table, as JSON:

    {"code": "segment.unknown_technique", "detail": "Unknown technique: x", "params": {"technique": "x"}}

`code` is stable: the frontend shows the message `error.<code>` of messages.json in the
user's language, with `params` as its placeholders (a test checks that each code has
one, in every language). `detail` is the English text, for logs, curl and tests;
never shown to users.

Raise ApiError("<code>", param=value): the status and text come from ERRORS. Request
validation (pydantic) answers "validation.<kind>"; other HTTP errors (an unknown
route…) "not_found", "method_not_allowed" or "http_error"; anything unexpected
"internal" (500, logged by uvicorn). nginx answers "rate_limited" itself (nginx.conf).
"""

from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# code: (HTTP status, English text with the params as {placeholders})
ERRORS: dict[str, tuple[int, str]] = {
    # Any endpoint
    "not_found": (404, "Not found"),
    "method_not_allowed": (405, "Method not allowed"),
    "http_error": (400, "HTTP error {status}"),  # any other of Starlette's: answered with its own status
    "internal": (500, "Internal error"),
    "busy": (503, "The server is busy, try again in a moment"),
    "throttled": (429, "Too many failed attempts, try again in {minutes} min"),
    "rate_limited": (429, "Too many requests"),
    "cross_site": (403, "Cross-site request refused"),
    # Sessions and accesses
    "auth.not_logged_in": (401, "Not logged in"),
    "auth.access_denied": (403, "Access denied"),
    "auth.invalid_credentials": (401, "Invalid username, password or code"),
    # Setup, registration, profile
    "setup.required": (503, "Setup required"),
    "setup.invalid_token": (403, "Invalid setup token"),
    "totp.invalid_code": (400, "Invalid TOTP code"),
    "invite.invalid": (404, "Invalid or expired invitation"),
    "profile.wrong_password": (403, "Wrong current password"),
    # User management
    "user.unknown": (404, "No such user"),
    "user.unknown_role": (422, "Unknown role"),
    "user.exists": (409, "This username already exists"),
    "user.reset_self": (400, "You cannot reset your own account"),
    "user.no_invite": (404, "No valid invitation"),
    # Catalogue and comments
    "catalog.unavailable": (503, "Catalogue not available"),
    "technique.unknown": (404, "Unknown technique"),
    "comment.unknown": (404, "Unknown comment"),
    "comment.not_author": (403, "Only its author can change a comment"),
    # Uploads and videos
    "upload.unknown": (404, "Unknown upload"),
    "upload.not_finished": (409, "The upload is not finished"),
    "upload.size_unknown": (400, "The file size must be known"),
    "upload.too_large": (413, "File too large"),
    "upload.invalid_metadata": (400, "Invalid metadata"),
    "upload.type_refused": (415, "This type of file is not accepted"),
    "video.unknown": (404, "Unknown video"),
    "video.exists": (409, "This video already exists"),
    "video.not_failed": (409, "Only a failed video can be retried"),
    "video.not_deletable": (409, "Published or encoding videos cannot be deleted here"),
    "performer.empty_name": (422, "Empty name"),
    "performer.exists": (409, "This performer already exists"),
    # Annotations (app/segments.py)
    "segment.duplicate": (422, "A segment is given twice"),
    "segment.unknown": (422, "Unknown segment of this video: {id}"),
    "segment.unknown_technique": (422, "Unknown technique: {technique}"),
    "segment.unknown_performer": (422, "Unknown performer: {performer}"),
    "segment.after_end": (422, "A segment ends after the end of the video"),
    "tag.duplicate": (422, "A tag is given twice"),
    "tag.unknown": (422, "Unknown tag: {tag}"),
    "tag.year": (422, "Tag {tag}: the value must be a year from {min} to {max}"),
    "tag.value": (422, "Tag {tag}: the value must be one of {values}"),
    # Request validation (pydantic): the first problem found
    "validation.missing": (422, "A value is missing"),
    "validation.too_short": (422, "A value is too short (at least {min_length})"),
    "validation.too_long": (422, "A value is too long (at most {max_length})"),
    "validation.pattern": (422, "A value has characters or a form not accepted"),
    "validation.too_small": (422, "A number is too small (at least {min})"),
    "validation.segment_order": (422, "A segment must end after it begins"),
    "validation.comment_empty": (422, "The comment is empty"),
    "validation.invalid": (422, "A value is not valid"),
}

# pydantic error type → (code, {param: the error's context key})
VALIDATION: dict[str, tuple[str, dict[str, str]]] = {
    "missing": ("validation.missing", {}),
    "string_too_short": ("validation.too_short", {"min_length": "min_length"}),
    "too_short": ("validation.too_short", {"min_length": "min_length"}),
    "string_too_long": ("validation.too_long", {"max_length": "max_length"}),
    "too_long": ("validation.too_long", {"max_length": "max_length"}),
    "string_pattern_mismatch": ("validation.pattern", {}),
    "greater_than_equal": ("validation.too_small", {"min": "ge"}),
    "greater_than": ("validation.too_small", {"min": "gt"}),
    # Custom errors (pydantic_core.PydanticCustomError types)
    "segment_order": ("validation.segment_order", {}),
    "comment_empty": ("validation.comment_empty", {}),
}

Params = Mapping[str, str | int | float]


class ApiError(HTTPException):
    """An error answered as {"code", "detail", "params"} (see ERRORS)."""

    def __init__(self, code: str, headers: Mapping[str, str] | None = None, **params: str | int | float) -> None:
        status, text = ERRORS[code]  # KeyError: a code missing from the table (tests catch it)
        super().__init__(status, text.format(**params), dict(headers) if headers else None)
        self.code = code
        self.params = params


def body(code: str, **params: str | int | float) -> dict[str, Any]:
    """The JSON of an error, for answers built without raising (tusd hooks, middleware)."""
    return {"code": code, "detail": ERRORS[code][1].format(**params), "params": params}


def response(code: str, headers: Mapping[str, str] | None = None, **params: str | int | float) -> JSONResponse:
    return JSONResponse(body(code, **params), status_code=ERRORS[code][0], headers=headers)


async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    if isinstance(exc, ApiError):
        content = {"code": exc.code, "detail": exc.detail, "params": exc.params}
    else:  # Starlette's own: unknown route, wrong method
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        content = {"code": code, "detail": exc.detail, "params": {"status": exc.status_code}}
    return JSONResponse(content, status_code=exc.status_code, headers=exc.headers)


async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {"type": ""}
    code, wanted = VALIDATION.get(first["type"], ("validation.invalid", {}))
    context = first.get("ctx") or {}
    params = {name: context[key] for name, key in wanted.items() if key in context}
    field = next((part for part in reversed(first.get("loc", ())) if isinstance(part, str)), None)
    if field:
        params["field"] = field  # the JSON field's name, e.g. "end_s"
    return JSONResponse({"code": code, "detail": ERRORS[code][1].format(**params), "params": params}, status_code=422)


async def _internal_error(request: Request, exc: Exception) -> JSONResponse:
    # uvicorn logs the traceback after this answer (ServerErrorMiddleware re-raises).
    return response("internal")


def install(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_error)  # also routing's 404 / 405
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _internal_error)
