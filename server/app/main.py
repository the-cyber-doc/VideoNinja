from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import (
    auth, comments, crypto, db, encoder, media, performers, profile, register, security, setup,
    snapshot, tags, tusd, users, videos,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    crypto.load_key()  # refuse to start without the encryption key
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
app.include_router(tusd.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
