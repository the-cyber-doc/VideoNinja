# Video Ninja

Installable web app (PWA) for Ninjutsu technique videos, organised by
school (ryu) → level → technique → video segments, with annotations.
Self-hosted on a Raspberry Pi 5 with Docker behind nginx.

Architecture, conventions and security rules: see [CLAUDE.md](CLAUDE.md).

- [Layout](#layout)
- [Development](#development)
- [Releasing](#releasing)
- [Production](#production)
- [License](#license)

## Layout

| Path | Content |
|---|---|
| `server/app/` | Backend: Python 3.12 + FastAPI |
| `server/tests/` | Backend tests (pytest) |
| `server/database/` | `db_vN.sql` (schema) + `init_db_vN.sql` (initial data) |
| `frontend/` | SvelteKit PWA (`adapter-static`, Svelte 5, TypeScript) |
| `tools/encode-videos/` | `encode-videos.sh` (ffmpeg H.265 encoding) + NNEDI3 weights |
| `.github/workflows/ci-cd.yml` | CI: tests + builds on every push; images published only for `v*` tags |

## Development

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Git | any recent | |
| Python | 3.12 | Same as the Docker image and CI |
| Node.js | ≥ 22.17 (24 LTS recommended) | Required by SvelteKit 3; CI uses 24 |
| ffmpeg | recent, with the `nnedi` filter | Only for `tools/encode-videos/` |
| Docker | optional | Only to build/run the image locally |

### 1. Get the code

```bash
git clone git@github.com:the-cyber-doc/VideoNinja.git
cd VideoNinja
```

Everything happens on `main`, for development and releases. Commit to `main`
directly, or use a short-lived feature branch and a pull request to `main`.

Every push, on any branch, runs CI: backend tests, front-end type-check and
build, and the Docker image build for amd64 and arm64. Nothing is published.
Keep `main` green. Users only get what is released with a tag (see
[Releasing](#releasing)).

### 2. Backend (terminal 1)

```bash
cd server
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt

# Encryption key for development (32 random bytes, base64). Never commit it.
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())" > dev.key

VIDEONINJA_DB=dev.db VIDEONINJA_KEY_FILE=dev.key uvicorn app.main:app --reload
```

The API listens on `http://localhost:8000`. `dev.db` and `dev.key` are ignored
by git.

| Variable | Default | Purpose |
|---|---|---|
| `VIDEONINJA_DB` | `/data/videoninja.db` | SQLite database file. If missing, the app starts in setup mode. |
| `VIDEONINJA_KEY_FILE` | `/run/secrets/videoninja_key` | Key that encrypts the TOTP secrets in the database. The app does not start without it. |

### 3. Front-end (terminal 2)

```bash
cd frontend
npm ci
npm run dev
```

Open **https://localhost:5173** and accept the self-signed certificate once.
The dev server runs over HTTPS because the session cookie is `Secure`, as in
production. It forwards `/api` to the backend on port 8000.

### 4. First start

With no database, the backend prints a one-time setup token in terminal 1:

```
WARNING:  Video Ninja is not set up yet. Setup token: 3q2-…
```

The app opens the setup wizard: enter the token, create the admin account
(password + authenticator app), and the database is built. Then log in.

To start over, stop the backend and delete `server/dev.db` (and
`dev.db-wal` / `dev.db-shm` if present).

### 5. Checks (same as CI)

```bash
# Backend, in server/ with the venv active
pytest
pip install flake8 && flake8 app tests --count --select=E9,F63,F7,F82 --show-source --statistics

# Front-end, in frontend/
npm run check
npm run build
```

### Database schema

The schema is designed in [drawdb](https://drawdb.app) and exported to
`server/database/db_v1.sql`. drawdb does not export `AUTOINCREMENT`: after each
export, re-add `"id" INTEGER PRIMARY KEY AUTOINCREMENT` on `video`, `segment`,
`user` and `comment` (see CLAUDE.md). On first start the app uses the highest
`N` for which both `db_vN.sql` and `init_db_vN.sql` exist.

### Releasing

```bash
git switch main && git pull
git tag -a v0.1.0 -m "Video Ninja 0.1.0"
git push origin v0.1.0
```

The tag runs the same CI, then publishes the multi-arch image to Docker Hub as
`0.1.0`, `0.1`, `0` and `latest`. Use [semantic versioning](https://semver.org):
`vMAJOR.MINOR.PATCH`. The Docker Hub credentials are the repository secrets
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.

### Working with Claude Code

`CLAUDE.md` holds the project's architecture and rules (security model, stack
choices, what not to use). Read it before larger changes; keep it up to date
when a decision changes.

## Production

> **Status:** only the backend image is published so far. The nginx + front-end
> image (static PWA, TLS, `X-Accel-Redirect` for media) is not built yet, so
> this is not yet a complete deployment. The steps below set up the backend,
> its data and its key; they will stay the same once the nginx image exists.

Target: Raspberry Pi 5 (arm64) or any amd64 host, with Docker Engine and the
Compose plugin, Docker data on a local SSD (SQLite must not be on NFS).

### 1. Directory and encryption key

```bash
sudo install -d -m 755 /opt/videoninja
cd /opt/videoninja
sudo install -d -m 700 secrets
sudo sh -c 'umask 077; openssl rand -base64 32 > secrets/videoninja_key'
# The container runs as UID 10001 and must be able to read the key.
sudo chown 10001 secrets/videoninja_key
sudo chmod 400 secrets/videoninja_key
```

The key encrypts the TOTP secrets in the database. It lives **outside** the
database volume, so a copy of the database alone reveals nothing.

**Back up the key separately from the database** (password manager, offline
copy). If the key is lost, no stored TOTP secret can be read and nobody can log
in.

### 2. `compose.yaml`

Replace `<dockerhub-user>` with the Docker Hub account CI publishes to.

```yaml
services:
  server:
    image: <dockerhub-user>/videoninja:0.1   # or a full version / latest
    container_name: videoninja
    restart: unless-stopped
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 256m
    tmpfs: [/tmp]
    volumes:
      - data:/data
    secrets:
      - videoninja_key
    ports:
      - "127.0.0.1:8000:8000"   # only nginx on this host may reach it
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

secrets:
  videoninja_key:
    file: ./secrets/videoninja_key   # mounted at /run/secrets/videoninja_key

volumes:
  data:   # holds /data/videoninja.db
```

Published tags, for a release `v1.2.3`: `1.2.3` (exact), `1.2` (receives patch
releases), `1` and `latest`. Pin `1.2` for safe updates, or `1.2.3` to stay put.
Only tagged releases are published.

### 3. First start

```bash
sudo docker compose up -d
sudo docker compose logs server | grep "Setup token"
```

Open the app over HTTPS, enter the setup token, create the admin account
(password + authenticator app), and log in. The setup wizard is then disabled.
The app must be served over HTTPS: the session cookie is `Secure`.

### 4. Updates

```bash
sudo docker compose pull
sudo docker compose up -d
```

### 5. Backups

Back up the database and the key **separately**.

```bash
# Consistent copy of the live database (safe while the app runs)
sudo docker compose exec server python -c \
  "import sqlite3; sqlite3.connect('/data/videoninja.db').backup(sqlite3.connect('/data/backup.db'))"
sudo docker compose cp server:/data/backup.db ./videoninja-$(date +%F).db
sudo docker compose exec server rm /data/backup.db
```

To restore: stop the service, copy the file back to `/data/videoninja.db` in
the `data` volume (with the same key in `secrets/`), start the service.

## License

GPL-3.0, see [LICENSE](LICENSE).
