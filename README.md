# VideoNinja

An internal video library for uploading and processing videos, organized as a
monorepo with a shared backend and multiple client front-ends.

## Components

| Path             | Component        | Stack                                   |
|------------------|------------------|-----------------------------------------|
| `server/`        | Backend API      | FastAPI + Uvicorn (Python), Docker      |
| `frontend/`      | Web UI           | Vue 3 + Vite + TypeScript (user + admin)|
| `clients/android/` | Android client | Kotlin + Jetpack Compose (Gradle)       |
| `clients/ios/`   | iOS client       | SwiftUI + SwiftPM (`VideoNinjaKit`)     |

Each component has its own README with build/run instructions. The web frontend
serves both the **user** UI (`/app`) and the **admin** UI (`/admin`) from a
single app with shared components and API client.

## Tech Stack

- **Backend**: FastAPI (modern, fast, async-ready) on Uvicorn
- **Web frontend**: Vue 3, Vite, TypeScript, Pinia, Vue Router
- **Mobile**: Kotlin/Compose (Android), SwiftUI (iOS)
- **Testing**: pytest (server), vue-tsc (frontend), XCTest (iOS kit)
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Registry**: DockerHub

## Local Development

### Prerequisites

- Python 3.11+ (server)
- Node.js 24+ (frontend)
- Docker & Docker Compose
- Git
- For mobile: Android Studio (Android), macOS + Xcode (iOS)

### Server (`server/`)

```bash
cd server

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run tests
pytest -v

# Run development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Web frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies API calls to the server on :8000
```

See `frontend/README.md`, `clients/android/README.md`, and
`clients/ios/README.md` for per-component details.

### Using Docker Compose (server + frontend)

```bash
# Build and run both services from the repo root
docker-compose up -d

# View logs
docker-compose logs -f server
docker-compose logs -f frontend

# Stop
docker-compose down
```

The API is served at `http://localhost:8000` and the web UI at
`http://localhost:8080`.

## Running Behind a Reverse Proxy (Subfolder)

By default the app serves from the domain root. To mount it under a subpath
(e.g. `https://example.com/videoninja/`), set the `ROOT_PATH` environment
variable so FastAPI generates correct OpenAPI/docs URLs.

### 1. Set ROOT_PATH

`ROOT_PATH` is read in `main.py` and wired through `docker-compose.yml`. Pass it
at startup, or add it to a `.env` file next to `docker-compose.yml`:

```bash
# One-off
ROOT_PATH=/videoninja docker-compose up -d

# Or in .env
echo "ROOT_PATH=/videoninja" >> .env
docker-compose up -d
```

Leave it unset (or empty) to serve from the root — the default behavior is
unchanged.

### 2. Configure nginx

The proxy must **strip** the subfolder prefix before forwarding (note the
trailing slash on `proxy_pass`), since the app's routes live at `/health`,
`/upload`, etc.:

```nginx
location /videoninja/ {
    proxy_pass http://127.0.0.1:8000/;   # trailing slash strips /videoninja
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /videoninja;

    # Allow large video uploads (tune to your needs)
    client_max_body_size 100g;
}
```

The `ROOT_PATH` value and the `location` prefix must match. After this, the API
is reachable at `https://example.com/videoninja/` and the docs at
`https://example.com/videoninja/docs`.

## API Endpoints

- `GET /health` - Health check
- `GET /` - Root endpoint with API info
- `POST /upload` - Upload a video file
  - Supported formats: .mp4, .avi, .mov, .mkv, .webm
  - Returns: filename, status, and message

### Example Upload

```bash
curl -X POST -F "file=@video.mp4" http://localhost:8000/upload
```

## CI/CD Pipeline

### How It Works

1. **On every commit to `main` or `dev`**:
   - Tests run automatically
   - Linting checks (optional)

2. **On successful test completion**:
   - If pushing to `main`: Docker image is built and pushed to DockerHub
   - If pulling: Only tests run

### Pipeline Stages

```
Push to GitHub → Run Tests → [if main] Build Docker → Push to DockerHub
```

## Testing the Docker Image

Once pushed to DockerHub:

```bash
# Pull the latest image
docker pull thecyberdoc/videoninja:main

# Run it
docker run -p 8000:8000 thecyberdoc/videoninja:main

# Test it
curl http://localhost:8000/health
```

### On a Raspberry Pi (arm64)

The image is published as a multi-arch manifest, so the same commands work on a
64-bit Raspberry Pi OS — Docker pulls the `linux/arm64` variant automatically:

```bash
docker pull thecyberdoc/videoninja:main
docker run -p 8000:8000 thecyberdoc/videoninja:main
```

> Requires a **64-bit** OS on the Pi (`uname -m` should report `aarch64`). The
> 32-bit `armv7l` variant is not built.

## Continuous Deployment Notes

- **main branch**: Builds and pushes to DockerHub
- **develop branch**: Only runs tests (no push)
- **Pull requests**: Only runs tests
- **Image tags**: Auto-generated from git tags and branch names
- **Platforms**: Multi-arch image built for `linux/amd64` and `linux/arm64`
  (arm64 for Raspberry Pi). `docker pull` automatically selects the right
  architecture for the host.

Example tags:
- `main` - latest from main branch
- `main-abc123de` - specific commit
- `v1.0.0` - semantic version (if you tag releases)

## Next Steps

1. **Server listing/stats endpoints**: Back the frontend Library, admin
   Dashboard, and Videos views with real data (`GET /videos`, stats)
2. **Add processing logic**: Implement video processing in background tasks
3. **Add database**: Store processing history and results
4. **Add authentication**: Secure the upload endpoint and the admin area
   (frontend auth is currently stubbed in `frontend/src/stores/session.ts`)
5. **Wire mobile upload UIs**: `uploadVideo` exists in both mobile clients but
   isn't yet connected to a file picker

## File Structure

```
.
├── server/                    # FastAPI backend
│   ├── main.py                # FastAPI application
│   ├── test_main.py           # Pytest tests
│   ├── requirements.txt       # Python dependencies
│   ├── Dockerfile             # Container image definition
│   ├── .dockerignore          # Docker ignore rules
│   └── uploads/               # Video uploads directory
├── frontend/                  # Vue 3 + Vite + TS web UI (user + admin)
│   ├── src/                   # views/{user,admin}, layouts, api, router, stores
│   ├── Dockerfile             # multi-stage build → nginx
│   └── README.md
├── clients/
│   ├── android/               # Kotlin + Jetpack Compose (Gradle)
│   └── ios/                   # SwiftUI app + VideoNinjaKit (SwiftPM)
├── docker-compose.yml         # Orchestrates server + frontend
├── .github/
│   └── workflows/
│       └── ci-cd.yml          # GitHub Actions workflow
├── .gitignore                 # Git ignore rules
├── CLAUDE.md                  # Codebase documentation
└── LICENSE
```

## Troubleshooting

**Tests failing locally but passing in CI?**
- Check Python version: `python --version`
- Reinstall dependencies: `pip install -r requirements.txt --force-reinstall`

**Docker image not pushing to DockerHub?**
- Verify secrets are set correctly in GitHub Settings
- Check DockerHub token hasn't expired
- Ensure repository is public

**Can't pull image from DockerHub?**
```bash
# May need to login
docker login
docker pull thecyberdoc/videoninja:main
```

## Framwork to get ideas
- 
