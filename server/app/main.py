from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import auth, crypto, db, profile, register, security, setup, snapshot, users


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
    else:
        app.state.setup_token = setup.new_setup_token()
    yield
    snapshot.flush()  # don't lose a pending rebuild


app = FastAPI(title="Video Ninja", lifespan=lifespan)
app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(register.router)
app.include_router(users.router)
app.include_router(snapshot.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
