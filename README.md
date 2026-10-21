# Video Ninja

Installable web app (PWA) for Ninjutsu technique videos, organised by
school (ryu) → level → technique → video segments, with annotations.
Self-hosted on a Raspberry Pi 5 with Docker behind nginx.

- [Layout](#layout)
- [Development](#development)
- [Releasing](#releasing)
- [Production](#production)
- [License](#license)

## Layout

| Path | Content |
|---|---|
| `server/app/` | Backend: Python 3.15 + FastAPI |
| `server/tests/` | Backend tests (pytest) |
| `server/database/` | `db_vN.sql` (schema) + `db_vN_init.sql` (initial data) |
| `frontend/` | SvelteKit PWA (`adapter-static`, Svelte 5, TypeScript) |
| `frontend/src/**/*.test.ts` | Frontend unit tests (Vitest) |
| `frontend/tests/` | Browser tests (Playwright): `mocked/` (fake API), `e2e/` (real backend) |
| `server/app/validation.json` | Input rules (lengths, patterns) shared by backend and frontend |
| `tools/encode-videos/` | `encode-videos.sh` (ffmpeg H.265 encoding) + NNEDI3 weights |
| `.github/workflows/ci-cd.yml` | CI: tests + builds on every push; images published only for `v*` tags |

## Development

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Git | any recent | |
| Python | 3.15 | Same as the Docker image and CI. Easiest via [uv](https://docs.astral.sh/uv/) |
| Node.js | ≥ 22.17 (24 LTS recommended) | Required by SvelteKit 3; CI uses 24. Easiest via [fnm](https://github.com/Schniz/fnm), see [Frontend](#3-frontend-terminal-2) |
| ffmpeg | recent, with the `nnedi` filter | Only for `tools/encode-videos/` |
| Docker | optional | Only to build/run the image locally |

### 1. Get the code

```bash
git clone git@github.com:the-cyber-doc/VideoNinja.git
cd VideoNinja
```

Everything happens on `main`, for development and releases. Commit to `main`
directly, or use a short-lived feature branch and a pull request to `main`.

Every push, on any branch, runs CI: backend tests, frontend type-check and
build, and the Docker image build for amd64 and arm64. Nothing is published.
Keep `main` green. Users only get what is released with a tag (see
[Releasing](#releasing)).

### 2. Backend (terminal 1)

```bash
cd server
# uv downloads Python 3.15 if needed; --seed puts pip in the venv.
# (With a system Python 3.15: python3.15 -m venv .venv)
uv venv --python 3.15 --seed .venv
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

### 3. Frontend (terminal 2)

SvelteKit needs Node.js ≥ 22.17; distribution packages are often older
(`npm ci` then fails with `EBADENGINE`). Install Node.js 24 LTS in your home
directory with [fnm](https://github.com/Schniz/fnm), no sudo needed:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
exec $SHELL                 # reload the shell so fnm is on PATH
fnm install 24
fnm default 24
node --version              # v24.x
```

[nvm](https://github.com/nvm-sh/nvm) works too (`nvm install 24 && nvm alias default 24`).
A system Node.js can stay installed: fnm's comes first on `PATH`.

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

# Frontend, in frontend/
npm run check
npm run test:unit
npm run build
npm run test:browser      # see Frontend tests below
```

### 6. Frontend tests

Two levels, both run by CI on every push:

| Command | Tool | What | Speed |
|---|---|---|---|
| `npm run test:unit` | [Vitest](https://vitest.dev) | Plain functions, files `src/**/*.test.ts` next to the code | milliseconds |
| `npm run test:browser` | [Playwright](https://playwright.dev) | Pages in real browsers, files in `tests/` | seconds |

`npm test` runs both.

Browser tests come in two kinds:

- **`tests/mocked/`**: the API is faked with `page.route`, no backend needed.
  For page behaviour and error cases that are hard to produce for real. Run
  in Chromium and WebKit (Safari's engine).
- **`tests/e2e/`**: full flows against the real backend (setup → login →
  logout → profile: name, password, authenticator). Playwright starts a fresh backend on port 8001
  (`tests/e2e/backend.sh`: new database and key in `frontend/.e2e/`, setup
  token read from `.e2e/server.log`), so a dev backend on 8000 is not
  affected. Chromium only; the tests run in order.

Playwright also builds the app and serves it with `vite preview` on
`https://localhost:4173`. The e2e backend needs the backend's virtual
environment (`server/.venv`, see [Backend](#2-backend-terminal-1)), or another
Python with the dependencies in `PYTHON`.

First run, in `frontend/`:

```bash
npx playwright install chromium webkit   # browsers, in ~/.cache/ms-playwright
npm run test:browser
```

Useful options:

```bash
npx playwright test --project chromium --project e2e   # skip WebKit
npx playwright test --ui              # interactive: step through, see each action
npx playwright test --headed          # watch the browser
npx playwright codegen https://localhost:4173   # record clicks as test code
```

WebKit needs system libraries (`sudo npx playwright install-deps webkit`).
Playwright officially supports Ubuntu 22.04 and 24.04 LTS; on other
distributions WebKit may not start, so run Chromium locally and let CI
(`ubuntu-latest`) run WebKit. On failure, CI uploads the HTML report (with a
trace of each step) and the backend log as the `playwright-report` artifact;
open it with `npx playwright show-report <folder>`.

Writing tests:

- Find elements as a user does: `getByLabel('Username')`,
  `getByRole('button', { name: 'Log in' })`, not CSS classes.
- Wait with `await expect(…)` (it retries), never with fixed sleeps.
- One behaviour per test. Mocked tests for most cases; keep e2e flows few.
- TOTP codes in e2e tests are computed from the secret shown by the setup
  wizard (`otpauth`).

### Database schema

The schema is designed in [drawdb](https://drawdb.app) and exported to
`server/database/db_v1.sql`. drawdb does not export `AUTOINCREMENT`: after each
export, re-add `"id" INTEGER PRIMARY KEY AUTOINCREMENT` on `video`, `segment`,
`user` and `comment`. On first start the app uses the highest
`N` for which both `db_vN.sql` and `db_vN_init.sql` exist.

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

## Production

> **Status:** only the backend image is published so far. The nginx + frontend
> image (static PWA, TLS, `X-Accel-Redirect` for media) is not built yet, so
> this is not yet a complete deployment. The steps below set up the backend,
> its data and its key; they will stay the same once the nginx image exists.
> The intended nginx configuration is in [6. nginx](#6-nginx).

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

### Users

Users are added by invitation, from **User Management** in the user menu
(top right; only for roles with the `user_mgmt` access, i.e. admins):

1. Enter a username, choose a role, click **Create**. The app shows an
   invitation link (`https://<host>/register#<token>`), valid for **one week**,
   and copies it to the clipboard. Send it to the user.
2. The user opens the link and chooses a display name (optional), a password
   and an authenticator app. The link then stops working.

In the user list, the first column shows the state: a green check
(registered), nothing (invitation pending: the copy button gives the link
again) or a red cross (invitation expired). The reset button issues a new
link. For a registered user, reset also removes the password and
authenticator and logs the user out: that is how a lost password or
authenticator is recovered. Every user must use an authenticator app; there
is no way to log in without one. Admins cannot reset their own account.

The invitation token is in the URL fragment (`#…`), which browsers never send
to the server: it does not appear in nginx logs or `Referer` headers.

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

### 6. nginx

Reference configuration for the coming nginx + frontend image. It shows the
directives that matter; adapt paths, certificates and networks to the host.

#### Required modules

```bash
nginx -V 2>&1 | tr ' ' '\n' | grep -E 'mp4|gzip_static|brotli'
```

`--with-http_mp4_module` and `--with-http_gzip_static_module` must be listed.
`brotli_static` comes from the third-party `ngx_brotli` module. It is not in
nginx.org's packages: use a distribution's dynamic module package, or build it
from Google's source (`load_module modules/ngx_http_brotli_static_module.so;`).
Without it, remove the `brotli_static` lines; browsers then get the `.gz` file.

#### Compression: precompressed only

nginx never compresses at request time (`gzip off`). Every compressible file is
compressed once, when it is written, and nginx picks the variant that matches
the browser's `Accept-Encoding` (`brotli_static` / `gzip_static`, with
`Vary: Accept-Encoding`):

| File | Written by | Variants |
|---|---|---|
| `catalog.<lang>.<hash>.json`, `annotations/<id>.<hash>.json` | the app, on each snapshot | `.br` (`brotli -q 11`), `.gz` (Zopfli) |
| `/_app/immutable/*`, `index.html`, `sw.js` | `npm run build` (`precompress: true` in adapter-static) | `.br`, `.gz` |
| Videos, thumbnails, filmstrips | — | none: already compressed |

Brotli at maximum level is slow but runs only when the catalogue changes, and
is typically 15–25 % smaller than gzip on JSON. Zopfli writes standard gzip
files about 5 % smaller than `gzip -9`, as the fallback. Zstandard and
Compression Dictionary Transport are not used: no reliable Safari support, and
ETag + `304` already makes updates cheap.

Check, through nginx with a valid session cookie:

```bash
curl -sI -H 'Accept-Encoding: br' -b '__Host-session=…' https://videoninja.example/api/catalog \
  | grep -iE 'content-encoding|vary|etag'
# Content-Encoding: br, Vary: Accept-Encoding, ETag: "…"
```

#### Catalogue updates

- `/api/catalog` (session check, then `X-Accel-Redirect` to
  `/protected-catalog/catalog.<lang>.<hash>.json`) has a stable URL and is
  served `private, no-cache` with an ETag. It must not be `no-store`: the
  browser keeps it and revalidates with `If-None-Match`.
- The service worker uses stale-while-revalidate: it shows the cached
  catalogue at once and revalidates in the background, usually getting a
  `304` of a few bytes.
- A few thousand segments is a few hundred KB of JSON, typically under 100 KB
  compressed. Past roughly 1–2 MB compressed, split it by school
  (`catalog.<ryu>.<lang>.<hash>.json` plus a small index file), still as
  pre-generated static files.

#### How media access works

Media and catalogue files are served with **`X-Accel-Redirect`**:

1. The browser requests `/media/segment/42` (with its session cookie;
   browsers send cookies on `<video>` requests).
2. nginx proxies it to the app. The app checks the session, looks up the
   segment and computes start/end itself.
3. The app answers with an empty body and
   `X-Accel-Redirect: /protected/ab/<sha256>/video.mp4?start=12&end=27`, or
   `401`/`403`/`404`.
4. nginx serves the file from an `internal` location. With `start`/`end`, the
   `mp4` module returns a valid standalone MP4 for just that range: it rebuilds
   the index (`moov` atom) and streams the relevant bytes, with no transcoding.

The `Range` header survives the internal redirect, so every seek is a
`206 Partial Content` from nginx, and every seek goes through the app check
again. The mp4 output is deterministic (same file, same start/end, same
bytes), so successive range requests fit together.

Alternatives considered:
- `auth_request`: also one app call per request, but the app cannot choose
  the file or the range; the client would have to send them.
- `secure_link`: nginx checks an HMAC itself, with no app call per seek, which
  is the lightest option for a Pi. If used, the signed string must include the
  range (`$secure_link_expires$uri$arg_start$arg_end secret`) so nobody can
  widen it. **Not used for now:** a signed link stays valid after logout,
  session expiry or account removal until it expires, which breaks the rule
  that the app decides on every request. The per-seek cost of
  `X-Accel-Redirect` is one SQLite lookup, small at this scale.

#### `nginx.conf` (excerpt)

```nginx
# --- http {} context -------------------------------------------------------
server_tokens off;

# Never compress at request time: only precompressed files are served
# (gzip_static / brotli_static per location). Videos and images are never
# compressed.
gzip      off;
gzip_vary on;     # Vary: Accept-Encoding on the precompressed responses

# Files (videos included) go from disk to the socket in the kernel.
sendfile   on;
tcp_nopush on;

# MIME types missing from (or wrong in) older mime.types. Declared after
# `include mime.types;`; a duplicate extension only logs a warning and the
# later entry wins.
types {
    application/manifest+json  webmanifest;
    text/vtt                   vtt;
}

# Access log without query strings ($args): no tokens or ranges in logs.
# $request would include them, so log the path only.
map $request_uri $request_path {
    ~^(?<p>[^?]*)  $p;
}
log_format videoninja '$remote_addr [$time_iso8601] '
                      '"$request_method $request_path $server_protocol" '
                      '$status $body_bytes_sent rt=$request_time '
                      'ua="$http_user_agent"';
access_log /var/log/nginx/access.log videoninja;
# The error log still quotes the full request line: keep it at warn/error.
error_log  /var/log/nginx/error.log warn;

upstream videoninja_app {
    # Today: the app port published on 127.0.0.1 (see compose.yaml).
    # Target: a Unix socket on a volume shared by the two containers
    # (server unix:/run/videoninja/app.sock;), or mTLS, so that only
    # nginx can reach the app.
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name videoninja.example;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name videoninja.example;

    ssl_certificate     /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    root /srv/www;              # SvelteKit build (static shell, no data)
    client_max_body_size 1m;    # API requests only; uploads go to tusd

    # Security headers: see snippets/security-headers.conf below. add_header
    # is NOT inherited by a location that has its own add_header, so every
    # such location includes the snippet again.
    include snippets/security-headers.conf;

    # --- Static shell (public) ----------------------------------------------
    location / {
        try_files $uri $uri/index.html /index.html;   # SPA fallback
        gzip_static   on;
        brotli_static on;
        add_header Cache-Control "no-cache" always;
        include snippets/security-headers.conf;
    }

    # Hashed build assets: cache forever. Missing file = 404, never index.html
    # (the service worker must not cache HTML as a script).
    location ^~ /_app/immutable/ {
        try_files $uri =404;
        gzip_static   on;
        brotli_static on;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        include snippets/security-headers.conf;
    }

    # Service worker and manifest: always revalidate, or users get stuck on
    # an old version.
    location = /sw.js {
        gzip_static   on;
        brotli_static on;
        add_header Cache-Control "no-cache" always;
        include snippets/security-headers.conf;
    }
    location = /manifest.webmanifest {
        add_header Cache-Control "no-cache" always;
        include snippets/security-headers.conf;
    }

    # Editor route: only if the multithreaded ffmpeg.wasm fallback is used
    # (SharedArrayBuffer needs cross-origin isolation). Scoped to the editor
    # because COEP breaks cross-origin embeds elsewhere. Only applies on a
    # full page load of /editor: links to it need data-sveltekit-reload.
    # location ^~ /editor {
    #     try_files $uri $uri/index.html /index.html;
    #     add_header Cache-Control "no-cache" always;
    #     add_header Cross-Origin-Opener-Policy   "same-origin"  always;
    #     add_header Cross-Origin-Embedder-Policy "require-corp" always;
    #     include snippets/security-headers.conf;
    # }

    # --- App (session check on every request) -------------------------------
    # No network restriction on any endpoint: every feature, admin included,
    # works from anywhere. The app checks session, access and TOTP itself.
    location /api/ {
        include snippets/proxy-app.conf;
    }

    # Logout: wipe the browser's HTTP cache and storage (Cache API,
    # IndexedDB, service worker) for this origin.
    location = /api/auth/logout {
        add_header Clear-Site-Data '"cache", "storage"' always;
        include snippets/security-headers.conf;
        include snippets/proxy-app.conf;
    }

    # /media/segment/<id>: the app answers with X-Accel-Redirect.
    location /media/ {
        include snippets/proxy-app.conf;
    }

    # --- Internal locations (reachable only through X-Accel-Redirect) -------
    # Derived media, mounted read-only into the nginx container.
    location ^~ /protected/ {
        internal;
        alias /srv/media/derived/;

        # The clip URL (/media/segment/<id>) has no content hash and a
        # segment's bounds can be edited, so the browser must not reuse it.
        # The service worker stores downloaded clips explicitly.
        # (To make clips long-lived: put a version in the clip URL, e.g.
        # ?v=<hash of video sha256 + begin + end>, then use
        # "private, max-age=31536000, immutable".)
        add_header Cache-Control "private, no-store" always;
        include snippets/security-headers.conf;

        location ~ \.mp4$ {
            mp4;
            mp4_start_key_frame on;     # start on the IDR keyframe (every 1 s)
            mp4_buffer_size     1m;
            mp4_max_buffer_size 20m;    # the moov atom of long sources must fit
            add_header Cache-Control "private, no-store" always;
            include snippets/security-headers.conf;
        }
    }

    # Catalogue and annotation snapshots. `current` is a symlink swapped
    # atomically by the app (leave open_file_cache off for this path).
    # Stable API URLs, so revalidate with ETag (304 when unchanged).
    # The app writes .br and .gz next to each JSON file.
    location ^~ /protected-catalog/ {
        internal;
        alias /srv/catalog/current/;
        gzip_static   on;
        brotli_static on;
        add_header Cache-Control "private, no-cache" always;
        include snippets/security-headers.conf;
    }
}
```

`snippets/proxy-app.conf`:

```nginx
proxy_pass http://videoninja_app;
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, never append
proxy_set_header X-Forwarded-Proto $scheme;
# Buffer app responses by default; the app turns it off per response with
# X-Accel-Buffering: no when it streams progress (e.g. the setup wizard).
# Never add X-Accel-Buffering to proxy_ignore_headers.
# Media is not proxied: after X-Accel-Redirect nginx streams the file itself.
proxy_buffering on;
# The app sends no Cache-Control on X-Accel-Redirect answers: the internal
# location sets it.
```

`snippets/security-headers.conf`:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Referrer-Policy           "no-referrer"   always;
add_header X-Content-Type-Options    "nosniff"       always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header Permissions-Policy        "camera=(), microphone=(), geolocation=()" always;
# blob: for media (local files in the editor, clips from the cache) and
# workers; 'wasm-unsafe-eval' only while the ffmpeg.wasm fallback is kept.
# 'unsafe-inline' for styles only (Svelte transitions, wavesurfer.js, Konva).
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; media-src 'self' blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
```

#### Frontend side of the contract

- **Range requests from the cache:** a clip played from the Cache API needs
  proper `206 Partial Content` answers, or seeking and even playback break
  (Safari in particular). The service worker uses Workbox's range-requests
  plugin. Download clips for offline use **without** a `Range` header, so
  that the full `200` response is stored; the plugin slices it.
- **Cookie:** `__Host-session`, `HttpOnly; Secure; SameSite=Strict`. Works with
  `<video>`, since browsers send cookies on same-origin media requests.
- **Least privilege:** media is mounted read-only into nginx; the app has no
  access to video files.
- **Audit trail:** nginx logs the final status of every request (`401`/`403` =
  denied); the app logs each allow/deny decision with user and segment ID.

## License

GPL-3.0, see [LICENSE](LICENSE).
