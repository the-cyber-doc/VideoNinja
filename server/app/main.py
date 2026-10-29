import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import (
    about, audit, auth, comments, crypto, db, encoder, errors, health, logs, media, middleware, performers, profile,
    register, security, settings, setup, snapshot, tags, tusd, users, video_mgmt, videos,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
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
async def same_origin_writes(request: Request, call_next):
    """A state-changing request to the API comes from this origin's own pages, or it is
    refused (security.cross_site). /internal/ (tusd's hooks, the encoder) is not a
    browser's: nginx never forwards it."""
    if (request.method not in SAFE_METHODS and request.url.path.startswith(("/api/", "/media/"))
            and security.cross_site(request.headers)):
        audit.event("request.cross_site", method=request.method, path=request.url.path,
                    sec_fetch_site=request.headers.get("sec-fetch-site"), origin=request.headers.get("origin"))
        return errors.response("cross_site")
    return await call_next(request)


@app.exception_handler(security.Busy)
async def argon2_busy(request: Request, exc: security.Busy) -> JSONResponse:
    log.warning("Password checks: all busy, %s %s answered 503", request.method, request.url.path)
    return errors.response("busy", headers={"Retry-After": "5"})


# Added last: the outermost, so that every answer has its ID and its line, the
# refusals above included.
app.add_middleware(middleware.RequestLog)
app.include_router(setup.router)
app.include_router(about.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(register.router)
app.include_router(users.router)
app.include_router(snapshot.router)
app.include_router(comments.router)
app.include_router(media.router)
app.include_router(performers.router)
app.include_router(tags.router)
app.include_router(videos.router)
app.include_router(video_mgmt.router)
app.include_router(tusd.router)
app.include_router(snapshot.internal_router)
app.include_router(health.router)
