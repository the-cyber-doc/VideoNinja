from contextlib import asynccontextmanager

from fastapi import FastAPI

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


app = FastAPI(title="Video Ninja", lifespan=lifespan)
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
