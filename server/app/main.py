from fastapi import FastAPI

app = FastAPI(title="Video Ninja")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
