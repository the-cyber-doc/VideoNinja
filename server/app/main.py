import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import RequestResponseEndpoint

from . import api, encoder
from .api import openapi, setup
from .core import crypto, db, errors, logs, middleware, settings
from .domain import audit, security, snapshot, tusd


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings.current()  # refuse to start with a wrong setting (every one named)
    crypto.load_key()  # nor without the encryption key
    if db.is_initialized():
        app.state.setup_token = None
        db.migrate()  # to this release's version, before anything reads it (else: no start)
        con = db.connect()
        try:
            security.purge_expired_sessions(con)
        finally:
            con.close()
        snapshot.rebuild()  # the database may have changed while the app was stopped
        tusd.start()
        encoder.start()
    else:
        app.state.setup_token = setup.new_setup_token()  # uploads start after setup
    yield
    encoder.stop()  # the current encoding goes back to the queue
    tusd.stop()
    snapshot.flush()  # don't lose a pending rebuild


# Before anything logs: uvicorn has imported this module, its startup lines come after.
logs.configure()  # refuses to start with an invalid VIDEONINJA_LOG_LEVEL / VIDEONINJA_LOG_FORMAT
log = logging.getLogger(__name__)
app = FastAPI(title="Video Ninja", lifespan=lifespan)
errors.install(app)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def same_origin_writes(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """A state-changing request to the API comes from this origin's own pages, or it is
    refused (security.cross_site). /internal/ (tusd's hooks, the encoder) is not a
    browser's: nginx never forwards it."""
    if (
        request.method not in SAFE_METHODS
        and request.url.path.startswith(("/api/", "/media/"))
        and security.cross_site(request.headers)
    ):
        audit.event(
            "request.cross_site",
            method=request.method,
            path=request.url.path,
            sec_fetch_site=request.headers.get("sec-fetch-site"),
            origin=request.headers.get("origin"),
        )
        return errors.response("cross_site")
    return await call_next(request)


@app.exception_handler(security.Busy)
async def argon2_busy(request: Request, exc: security.Busy) -> JSONResponse:
    log.warning("Password checks: all busy, %s %s answered 503", request.method, request.url.path)
    return errors.response("busy", headers={"Retry-After": "5"})


# Added last: the outermost, so that every answer has its ID and its line, the
# refusals above included.
app.add_middleware(middleware.RequestLog)
for router in api.ROUTERS:
    app.include_router(router)
openapi.install(app)
