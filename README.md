# Video Ninja

Installable web app (PWA) for Ninjutsu technique videos, organised by
school (ryu) → level → technique → video segments, with annotations.
Self-hosted on a Raspberry Pi 5 with Docker behind nginx.

Architecture, conventions and security rules: see [CLAUDE.md](CLAUDE.md).

## Layout

| Path | Content |
|---|---|
| `server/` | Backend: Python 3.12 + FastAPI (`app/`, `tests/`, `database/`) |
| `frontend/` | SvelteKit PWA (`adapter-static`) |
| `tools/encode-videos/` | `encode-videos.sh` (ffmpeg H.265 encoding) + NNEDI3 weights |

## Development

```bash
# Backend
cd server
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --reload

# Front-end
cd frontend
npm ci
npm run dev
```

## License

See [LICENSE](LICENSE).
