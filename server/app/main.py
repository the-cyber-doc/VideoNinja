import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import (
    about, auth, comments, crypto, db, encoder, health, limits, media, paths, performers, procs, profile, register,
    security, setup, snapshot, tags, tusd, users, video_mgmt, videos,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    crypto.load_key()  # refuse to start without the encryption key
    paths.base_path()  # refuse to start with an invalid VIDEONINJA_BASE_PATH
    encoder.x265_preset()  # nor with an invalid VIDEONINJA_X265_PRESET
    limits.check()  # nor VIDEONINJA_MAX_UPLOAD_BYTES, VIDEONINJA_INPUT_FORMATS
    procs.check()  # nor VIDEONINJA_FFMPEG_TIMEOUT_H, VIDEONINJA_FFPROBE_TIMEOUT_MIN
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


log = logging.getLogger("uvicorn.error")
app = FastAPI(title="Video Ninja", lifespan=lifespan)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def same_origin_writes(request: Request, call_next):
    """A state-changing request to the API comes from this origin's own pages, or it is
    refused (security.cross_site). /internal/ (tusd's hooks, the encoder) is not a
    browser's: nginx never forwards it."""
    if (request.method not in SAFE_METHODS and request.url.path.startswith(("/api/", "/media/"))
            and security.cross_site(request.headers)):
        log.warning("Cross-site %s %s refused (Sec-Fetch-Site %r, Origin %r)", request.method, request.url.path,
                    request.headers.get("sec-fetch-site"), request.headers.get("origin"))
        return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
    return await call_next(request)


@app.exception_handler(security.Busy)
async def argon2_busy(request: Request, exc: security.Busy) -> JSONResponse:
    log.warning("Password checks: all busy, %s %s answered 503", request.method, request.url.path)
    return JSONResponse({"detail": "The server is busy, try again in a moment"}, status_code=503,
                        headers={"Retry-After": "5"})
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
