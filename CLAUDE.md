# Video Ninja — project context for Claude Code

Web app (installable PWA) for Ninjutsu technique videos, organised by
school (ryu) → level → technique → video segments, with annotations.
Self-hosted on a Raspberry Pi 5 with Docker behind nginx. Small scale:
a few hundred techniques, a few thousand segments.

## Guiding principles
- Pi-friendly: the Pi never transcodes; reads are static files where possible.
- Zero trust: nginx enforces, the app decides, on EVERY request (incl. range requests).
- One front-end toolchain only: Svelte. No Hugo, no second build system.
- Simple over clever: plain JSON, plain readable IDs (no encoding).

## Stack
| Piece | Choice |
|---|---|
| Reverse proxy | nginx (`ngx_http_mp4_module`, `gzip_static`, `brotli_static`) |
| Backend | Python 3.12 + FastAPI + uvicorn (pytest for tests) |
| Database | SQLite, WAL mode, on local SSD (never on NFS) |
| Front-end | SvelteKit with `adapter-static`, PWA (service worker) |
| i18n | Paraglide JS (UI strings); translation tables (content) |
| Search | Client-side (MiniSearch) over the catalogue snapshot |
| Uploads | tus resumable uploads (tusd), validated server-side with `ffprobe` |
| Containers | Docker, multi-arch (`linux/amd64` + `linux/arm64`), published to Docker Hub by GitHub Actions |

PocketBase was evaluated and rejected. Do not use Caddy, GraphQL, MessagePack,
or ID encoding (Base62/Sqids).

## Access model
- All logged-in users can read everything. Only admins can write.
- Every read: session check in the app → `X-Accel-Redirect` to an nginx
  `internal` location. Never serve media or catalogue files from a public location.
- Session cookie `__Host-session`: `HttpOnly; Secure; SameSite=Strict`. The `session`
  table stores only the SHA-256 of the token. Sliding 30-day idle expiry, 1-year
  absolute cap; expired rows purged at startup and on login.
- TOTP secrets are encrypted at rest (AES-256-GCM, `v1:` prefix for key rotation,
  user ID as associated data). Key: `VIDEONINJA_KEY_FILE` (Docker secret
  `/run/secrets/videoninja_key`), never in the DB volume or its backups. No key → no start.
- First start (no database file): one-time setup token in the server logs →
  wizard creates the admin (password + TOTP) and builds the DB from the latest
  `db_vN.sql` + `init_db_vN.sql`. `/api/setup/*` returns 404 afterwards.
- Admin API under `/api/admin/…`: role check, restricted to LAN/VPN at nginx,
  passkeys (WebAuthn) or TOTP.
- No `$args` in nginx access logs; `Referrer-Policy: no-referrer`.

## Data model
Schema: `server/database/db_v1.sql` (designed in drawdb, which does not export
`AUTOINCREMENT`: re-add it on the INTEGER IDs after every export).
- Tables: `ryu` (school), `level`, `technique` (→ `ryu` + `level`), `video`
  (source video), `segment` (→ `video`, `technique`, `performer`), `comment`,
  `tag` + `video_has_tags` / `segment_has_tags`, `user`, `role`, `access`,
  `role_has_access`, `performer`, `translation`, `config`, `session`.
- IDs (on purpose, two kinds):
  - Small reference tables (`ryu`, `level`, `technique`, `tag`, `role`, `access`,
    `performer`, `translation`, `config`) use readable TEXT IDs: few rows, much
    easier debugging.
  - Growing tables (`video`, `segment`, `user`, `comment`) use
    `INTEGER PRIMARY KEY AUTOINCREMENT`: IDs are never reused (PWA caches rely on it).
  - The same ID is used in DB, JSON, URLs and cache keys. No ID encoding.
- Japanese names are canonical, language-neutral columns (`kanji` + `romaji`).
- Translations: ONE `translation` table for all translated text, one column per
  language (`en` required, `fr`, …). Entities point to it by translation ID
  (e.g. `ryu.description`). Fallback: requested language → `en` → romaji.
- Segment = `video` + `begin_s` + `end_s` (whole seconds; no ms precision needed).
  Annotations store timestamps relative to the SOURCE video and are converted
  for display.

## Read path (static snapshots)
- On any admin write, regenerate (debounced) `catalog.<lang>.<hash>.json`
  (+ `.br`, `.gz`), write to a versioned folder, atomically swap a symlink.
- Heavy per-segment data (drawings, long notes, VTT) is lazy-loaded:
  `annotations/<segment-id>.<hash>.json`.
- Endpoints: `/api/catalog`, `/api/annotations/<id>`, `/media/segment/<id>`.
- `/media/segment/<id>`: app looks up the segment and computes start/end itself
  (client never supplies them), then redirects to
  `/protected/<path>.mp4?start=…&end=…` served by the nginx mp4 module.

## Media storage
```
/srv/media/
  originals/<h2>/<sha256>.<ext>
  derived/<h2>/<sha256>/{video.mp4, thumb.jpg, filmstrip.jpg, notes.<lang>.vtt}
```
- `<h2>` = first two hex chars of the SHA-256. Original filenames are DB metadata
  only, never used in paths. Derived files must be regenerable.
- Encoding: `tools/encode-videos/encode-videos.sh` — H.265 Main 8-bit (`hvc1` tag), AAC stereo,
  `+faststart`, IDR keyframe every 1 s, metadata stripped, original dimensions,
  HDR tone-mapped to BT.709, interlaced sources deinterlaced with NNEDI3.

## Front-end / PWA
- Static shell is public (no data in it). Catalogue and media need a session.
- Service worker: stale-while-revalidate for the catalogue (ETag/304);
  downloaded clips in Cache API keyed by segment ID; 206 range responses
  (Workbox range-requests plugin) — required for Safari.
- `navigator.storage.persist()`; clear Cache API + IndexedDB on logout.
- Editor (online only): file picker → WebCodecs + Mediabunny on device
  (ffmpeg.wasm fallback only) → wavesurfer.js regions + thumbnail filmstrip
  for segment selection → Konva.js overlay for drawings (stored as JSON).

## Deployment
- Containers: non-root, read-only rootfs, `cap_drop: [ALL]`, `no-new-privileges`,
  memory limits, log rotation, healthchecks. Never mount the Docker socket.
- Media mounted read-only into nginx; the app needs no access to video bytes.
- `sw.js` served `no-cache`; hashed assets `immutable`.

## CI/CD (`.github/workflows/ci-cd.yml`)
- Single branch: `main` (development and releases; feature branches optional).
- Every push (any branch) and PR to `main`: tests, front-end build (workflow
  artifact), per-arch image builds on native runners (`ubuntu-latest`,
  `ubuntu-24.04-arm`), not published.
- Tag `vX.Y.Z`: same builds, pushed by digest, merged manifest published as
  `X.Y.Z`, `X.Y`, `X`, `latest`. Only tags publish what users run.
- Registry: Docker Hub (`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets).
- Keep this structure when adding the second image (nginx + static front-end).

## Working agreements for Claude Code
- Propose a plan before large changes; keep PRs small.
- Every change keeps the CI chain green: tests → build → publish images.
- Never commit secrets; never weaken a security control to make something work —
  flag it instead.
