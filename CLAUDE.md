# Video Ninja — project context for Claude Code

Web app (installable PWA) for Ninjutsu technique videos, organised by
school (ryu) → category → (weapon) → section → technique → video segments, with annotations.
Self-hosted on a Raspberry Pi 5 with Docker behind nginx. Small scale:
a few hundred techniques, a few thousand segments.

## Guiding principles
- Pi-friendly: reads are static files where possible. The Pi encodes uploads
  itself, but in one queue (one video at a time, low priority, published when done).
- Zero trust: nginx enforces, the app decides, on EVERY request (incl. range requests).
- One frontend toolchain only: Svelte. No Hugo, no second build system.
- Simple over clever: plain JSON, plain readable IDs (no encoding).

## Stack
| Piece | Choice |
|---|---|
| Reverse proxy | nginx in its own container (hardened `dhi.io/nginx:<version>-alpine3.24`, pinned; `nginx/nginx.conf`: `mp4`, `auth_request`, `gzip_static`, and `brotli_static` compiled in the Dockerfile (`-dev` variant) from pinned `ngx_brotli` + nginx sources; a new nginx version needs `NGINX_SOURCE` + `NGINX_SHA256`), behind the user's own TLS proxy |
| Backend | Python 3.15 + FastAPI + uvicorn (pytest for tests) |
| Database | SQLite, WAL mode, on local SSD (never on NFS) |
| Frontend | SvelteKit with `adapter-static`, PWA (service worker) |
| i18n | One `messages.json` + own `t()` helper (UI strings, no Paraglide); `translation` table (content) |
| Search | Client-side (MiniSearch) over the catalogue snapshot |
| Uploads | tus resumable uploads (tusd, its own container; a child of the app in development), originals checked (SHA-256, `ffprobe`) and encoded by the encoder (its own container; a thread of the app in development) with `tools/encode-videos/encode-videos.sh` |
| Containers | Docker, four images (`videoninja-{nginx,api,encoder,tusd}`, one Dockerfile, `--target`), multi-arch (`linux/amd64` + `linux/arm64`), published to Docker Hub by GitHub Actions |

PocketBase was evaluated and rejected. Do not use Caddy, GraphQL, MessagePack,
or ID encoding (Base62/Sqids).

## Access model
- All logged-in users can read everything. Only admins can write.
  Accesses (`access` table, via `role_has_access`): `user_mgmt` = User
  Management page + `/api/admin/users…` (checked by `require_access` on every
  call; the UI only hides the menu entry). `/api/auth/me` returns the list.
  `comment` (every role) = write comments (`POST /api/techniques/<id>/comments`,
  `PATCH`/`DELETE /api/comments/<id>`); edit/delete only one's own (403
  otherwise, no admin override). Comments carry `created_at` + `modified_at`
  (list ordered by `modified_at`) and `mine` (no user IDs exposed).
  `video_mgmt` (role `video_mgmt` = every access but `user_mgmt`; admins too) =
  Videos page: `GET /api/videos`, `GET`/`PUT /api/videos/<id>/annotations`
  (segments by ID: update / insert / delete; new or re-timed ones get a new
  thumbnail), `/media/video/<id>[/thumbnail]` (whole video). Performers and tags
  accept `upload` or `video_mgmt` (`require_access` takes several, any one).
  The annotation panel (`$lib/upload/AnnotationPanel.svelte`, type `Annotation`)
  is shared by the upload and Videos pages; on the server, `app/domain/segments.py` (models + `check`:
  techniques/performers looked up once for all segments, `queries.catalog.known_techniques` / `queries.performers.known_performers` with `json_each`; tag
  rules from `tags.value_error` as error codes) by `api.videos.submit` (before waiting for the upload) and
  `api.video_mgmt.save_annotations` (inside its write). Role accesses come with the session row
  (`queries.sessions.session_user`: `User.access`, from a JSON array): no extra query per `require_access`, tusd
  hook or owner check. Test: `tests/test_segments.py` (query counts constant). The service worker deletes saved
  clips/thumbnails of segments removed or re-timed when the catalogue changes.
  Exception: every user edits their OWN profile (`/api/profile/…`: display name,
  password, TOTP; never the username or role). Credential changes require the
  current password and log out the user's other sessions (same transaction).
- Every read: session check in the app → `X-Accel-Redirect` to an nginx
  `internal` location. Never serve media or catalogue files from a public location.
- Session cookie `HttpOnly; Secure; SameSite=Strict`: `__Host-session` (Path=/) at the
  domain's root, `__Secure-session` with Path=<base path> under a subfolder
  (`security.session_cookie()`; read via the `api.deps.session_token` dependency). The `session`
  table stores only the SHA-256 of the token. Sliding 30-day idle expiry, 1-year
  absolute cap; expired rows purged at startup and on login.
- TOTP is mandatory for every user, no exception and no bypass: login always
  requires password + code; a user without a TOTP secret cannot log in, and
  the profile can replace the authenticator but never remove it.
  Lost password or lost authenticator: an admin must intervene (reset), there
  is no self-service recovery.
- Request guards: nginx `limit_req` per address (credentials POSTs 60/min burst 30 — login, setup/,
  register/, profile/password|totp —, api 20/s burst 100, media 50/s burst 300, uploads 10/s
  burst 50; nginx's own 429 = JSON `{"code":"rate_limited","detail":"Too many requests","params":{}}`
  + Retry-After 5, frontend `error.rate_limited`). Argon2 capped (`security._argon2` semaphore,
  `VIDEONINJA_ARGON2_CONCURRENCY` 2, wait 10 s → `security.Busy` → 503 + Retry-After, code
  `busy`). Writes (not GET/HEAD/OPTIONS) to /api, /media and uploads (upload_auth on
  X-Original-Method) refused 403 unless `Sec-Fetch-Site: same-origin`, else Origin's host = Host;
  neither header → allowed (not a browser) (`security.cross_site`, middleware in main.py).
- Brute force: credential failures throttled per client address
  (`app/domain/throttle.py`, dependency `credential_guard(<failure status>)` on login,
  profile password checks, setup and invitation tokens): 10 / 15 min → 429 code `throttled`
  (`params.minutes`) + Retry-After, in memory, IPv6 per /64. Never other 401/403 (expired sessions,
  accesses). Client address = `request.client.host` (uvicorn's `FORWARDED_ALLOW_IPS`: production
  README compose `"*"`, no fixed IPs (user's choice: network segmentation guarantees only nginx reaches
  the API); docker-compose.dev.yaml / test-e2e-stack.sh: nginx's fixed address).
- One clip download per user at a time: clips redirect to
  `/protected-clip/<user id>/…` (nginx `limit_conn` 1, 429), whole videos to
  `/protected-video/<user id>/…` (4: the editor's three video elements + the service worker's save);
  `/protected/` serves thumbnails only. The service worker never sends two
  requests for one clip (Range answered from the single download); the player
  checks a failed load with HEAD (429 → "another video is still downloading").
- TOTP secrets are encrypted at rest (AES-256-GCM, `v1:` prefix for key rotation,
  user ID as associated data). Key: `VIDEONINJA_DB_KEY_FILE` (default: Docker secret
  `/run/secrets/videoninja_key`) or `VIDEONINJA_DB_KEY` (the key itself, popped from
  `os.environ` once read so child processes don't inherit it; both set → no start;
  not set in the Dockerfile), never in the DB volume or its backups. No key → no start.
- First start (no database file): one-time setup token in the server logs →
  wizard creates the admin (password + TOTP) and builds the DB from the latest
  `db_vN.sql` + `db_vN_init.sql`. `/api/setup/*` returns 404 afterwards.
- Admin API under `/api/admin/…`: access check in the app (`require_access`).
  No network restriction in nginx on any endpoint: every feature, admin
  included, must work from anywhere.
- No `$args` in nginx access logs; `Referrer-Policy: no-referrer`.

## Data model
Schema: `server/database/db_v<N>.sql` + `db_v<N>_init.sql`, current N = `db.EXPECTED_VERSION` (3)
(designed in drawdb, which does not export `AUTOINCREMENT`: re-add it on the INTEGER IDs after every
export). Versions: v1 = efae32a (v0.0.6), v2 = + `heartbeat`, `video.thumbs_dirty`; v3 = + indexes
(growing tables' lookup and foreign-key columns, chosen from the query plans; catalogue/translation
tables: none on purpose). Released `db_v<N>`
files are frozen: a schema change = new `db_v<N+1>.sql` + `_init.sql` + `migrations/v<N>_to_v<N+1>.sql`
and `v<N+1>_to_v<N>.sql` (one transaction each, ending with `UPDATE config … db_version`) +
`EXPECTED_VERSION` (`test_migrations.py` then runs every step up and down: migrated schema == fresh
schema, index columns included, data kept). The API runs
`db.migrate()` at startup (backup `<db>.v<old>-<time>.bak` first; missing step → no start; up or down);
the encoder waits for the version; `/health` fails on a mismatch.
- Catalogue (fixed, each school's own organisation): `ryu` → `category` (taijutsu, muto_dori,
  buki) → `weapon` (only under buki; CHECK) → `section` (a school's scroll/group: Jo Ryaku no Maki,
  Shoden Gata…; levels are sections) → `technique` (→ `section`). IDs: section
  `<ryu>.<category>[.<weapon>].<name>`, technique `<section>.<name>`. Content: edit
  `server/database/catalog/techniques.json` (en/fr meanings, sources), then
  `tools/catalog-sql.py` regenerates its marked block in the newest `db_v<N>_init.sql` (pytest `--check`).
  URLs `/schools/<ryu>/<category>/<section>/<technique>`, `/schools/<ryu>/buki/<weapon>/…`
  (`$lib/catalog.svelte.ts`: `CatalogPath`, `resolvePath`, `catalogHref`, `pathOf`; pages in
  `$lib/browse/`); every step has its page. Emblems per kind (`$lib/{categories,weapons,sections}/emblems/`,
  sections by name or kind via `KIND` in `sections/emblems.ts`); techniques have none.
  Annotation: one select per step (weapon only under buki), single choices filled in.
- Tables: `ryu` (school), `category`, `weapon`, `section`, `technique`, `video`
  (source video), `segment` (→ `video`, `technique`, `performer`), `comment`,
  `tag` + `tag_value` + `video_has_tags` / `segment_has_tags`, `user`, `role`, `access`,
  `role_has_access`, `performer`, `translation`, `config`, `session`, `invite`, `heartbeat` (the
  encoder's liveness, for `/health`).
- `user.pw_hash` / `user.totp` are NULL until the user registers (invited or
  reset users); such users cannot log in. `invite`: one row per pending user,
  SHA-256 of the token (lookup) + token encrypted like TOTP (AAD
  `user:<id>:invite`, so the admin can copy the link again), 1-week expiry,
  deleted on registration (single use). Status shown to admins:
  registered / invited / expired.
- IDs (on purpose, two kinds):
  - Small reference tables (`ryu`, `category`, `weapon`, `section`, `technique`, `tag`, `tag_value`, `role`, `access`,
    `performer`, `translation`, `config`) use readable TEXT IDs: few rows, much
    easier debugging.
  - Growing tables (`video`, `segment`, `user`, `comment`) use
    `INTEGER PRIMARY KEY AUTOINCREMENT`: IDs are never reused (PWA caches rely on it).
  - The same ID is used in DB, JSON, URLs and cache keys. No ID encoding.
- Japanese names (`kanji` + `romaji`) are universal, not translations: shown as
  is in every language, never stored in `translation`, never translated or used
  as a translation fallback.
- Translations: ONE `translation` table for all translated text, one column per
  language (`en` required, `fr`, …). Entities point to it by translation ID
  (e.g. `ryu.description`; also `role.name`, `access.name`). Fallback: requested
  language → `en`.
- Supported languages: `en` (default), `fr`. Adding one: a column in `translation`,
  `LANGS` in `server/app/core/i18n.py`, `LANGUAGES` + a flag in the frontend, and the
  translations in `messages.json` (a unit test fails if one is missing).
- Request language: the frontend sends `Accept-Language: <lang>` on every API call;
  the `i18n.language` dependency resolves it. Queries select every language column
  as `<key>_<lang>` and `i18n.pick` chooses (a column name can't be a `?` parameter).
- Dates: columns `…_at` declared `DATETIME`, UTF-8 ISO 8601 text with the UTC
  offset in ONE format everywhere (DB, Python, JSON, TS):
  `2026-10-23T12:13:38+02:00`, via `server/app/core/clock.py`. Written in the user's
  timezone: browser's `Time-Zone` header on every API call, saved in
  `user.time_zone` (tusd hooks); else the server's (`TZ`). Mixed offsets: SQL
  compares and sorts through `datetime()`, never as text. Compute in UTC, convert
  when writing (DST). Durations stay `…_S` seconds.
- `video.original_filename`: the uploaded file's name, metadata only.
- Authors: `video.uploaded_by`, `segment.created_by` (set on insert, at upload or on the Videos
  page; kept on edits; `ON DELETE SET NULL`). `GET /api/videos/<id>/annotations` adds
  `original_filename`, `uploaded_by` and per segment `created_by` as display names (`name`, else
  `username`; null = unknown), never IDs; output-only models, the PUT ignores them. Shown by the
  annotation panel: file name above the video, uploader opposite, "Created by" left of each
  segment's delete button (new segments and the upload page: the current user).
- Databases are migrated, never rebuilt (see Schema above).
- Queries: `app/queries/` package, one module per table or purpose (users, sessions, invites, config,
  catalog, comments, performers, tags, uploads, videos, segments, queue, thumbnails); called by module,
  `queries.users.insert_user(…)` (no flat re-export). Every SQL statement there, `?` parameters only
  (column lists built from constants carry `# nosec B608` with the reason). The logged-in user is the frozen
  `queries.users.User` (id, username, name, role, time_zone, `access` frozenset; never credentials:
  `Credentials` for the login only), from `security.session_user` / `api.deps.current_user` / `require_access`:
  `me.id`, `me.access`; `clock.user_zone(user.time_zone, zone)`. Other rows stay `sqlite3.Row` (each read
  in one module). Test: `tests/test_queries.py` (every query used; User without credentials).
- Packages (`server/app/`): `api/` (HTTP) → `domain/` (rules, stores without HTTP: security, invites,
  throttle, audit, segments, tags, catalog, snapshot, tusd) → `queries/` (SQL) and `core/` (settings, logs,
  middleware, errors, db, clock, crypto, i18n, validation, paths, limits, procs, children); `encoder/` uses
  domain/queries/core. Never upward: core imports only `queries` (db.py: setup's admin, version), domain never
  api. `validation.json` stays at `app/` (the frontend, the Dockerfile and tools read it there). Loggers
  follow module paths, except two fixed operator names: `app.audit`, `app.middleware`. Module-level state kept
  on purpose (callers without a request: the encoder thread, the setup stream): snapshot timer, throttle
  counters (`throttle.reset()`), Argon2 semaphore, tusd/encoder singletons, health's cache.
- API types: `server/openapi.json` (committed) = `app/api/openapi.py` `schema(app)` (FastAPI's, 422 removed,
  every operation's `default` = `ApiError` from `core/errors.ErrorOut`; also served at /openapi.json) →
  `frontend/src/lib/api/schema.d.ts` (openapi-typescript 7.13.0, exact; `overrides` lets it use TS 6). After any
  endpoint/model change: `tools/api-types.sh`, commit both. Checks: `tests/test_openapi.py` (file current,
  errors declared, unique operation IDs, every JSON answer typed but the files/streams in `UNTYPED`) and
  `npm run check` (`--check`). GET+HEAD = two decorators (one operation ID each).
- HTTP layer (`app/api/`): one router per module (about, auth, catalog, comments, health, media,
  performers, profile, register, setup, tags, upload_hooks, users, video_mgmt, videos), `api.ROUTERS`
  included by main.py in that order; `api/deps.py` = the dependencies (`session_token`, `current_user`,
  `user_zone`, `require_access`, `rebuild_after_write`). Rules and storage stay outside (`app/domain/snapshot.py`,
  `tusd.py` (the process), `tags.py` (rules), `segments.py`…) and never import `api` (only main.py does).
  Routers call those modules qualified (`snapshot.rebuild_now()`), so tests patch the owning module.
  Loggers `app.api.<module>` (the setup token's: `app.api.setup`).
- Encoder package (`app/encoder/`): `queue.py` (`Encoder` worker: job loop, encode, publish, fail;
  module `start`/`stop`/`running`), `checks.py` (ffprobe/ffmpeg runs, `needs_encoding`, `strip_metadata`,
  `JobError`…), `thumbnails.py` (`thumbnail`, `middle`, `refresh` of marked videos), `heartbeat.py`
  (`beat`, `run`, `healthy`), `notify.py` (`catalog_changed`), `cli.py` (`main`; `__main__.py` calls it:
  `python -m app.encoder [--health]`). The API uses `encoder.start/stop/healthy` (package exports). Calls
  between them are module-qualified (`checks.probe_duration(…)`), so tests patch the owning module
  (`monkeypatch.setattr(thumbnails, "thumbnail", …)`, `"app.encoder.thumbnails.thumbnail"`). Loggers
  `app.encoder.<module>`. `db.transaction()`: own connection + write (not a request).
- Transactions: `db.connect()` is autocommit (`autocommit=True`, `db.Connection` makes `with con:`
  raise). Writes / check-then-write: `with db.write(con):` (BEGIN IMMEDIATE, rollback on any
  exception); consistent multi-reads: `with db.read(con):`. No nesting; Argon2 and other slow work
  before the write. Helpers like `security.delete_other_sessions` / `invites.create` run inside the
  caller's write. Test: `tests/test_db.py` (concurrent read-modify-write).
- Tags: `tag.name` and `tag_value.name` are translation IDs (`tag.<id>.name`,
  `tag_value.<tag>.<id>.name`). A tag with `tag_value` rows takes one of them
  (`*_has_tags.value` = the value's ID, never its name; shown sorted by name);
  without, text stored as typed (not translated) in `tag.value_format`: NULL =
  any, `year` = 100 years ago … this year (user's timezone). Seeded: location,
  event, year, country (ISO 3166-1 alpha-3 IDs), source (youtube, onmitsukage, kanninkan). `/api/tags` sends names in the request's
  language; the frontend keeps IDs and shows names.
- Segment = `video` + `begin_s` + `end_s` (whole seconds; no ms precision needed).
  Annotations store timestamps relative to the SOURCE video and are converted
  for display.

## Read path (static snapshots)
- The client loads the whole catalogue once, caches it, and checks cheaply for
  updates. Navigation, filtering and search (MiniSearch) run in memory; no
  server-side search (no FTS5).
- One file per language: `catalog.<lang>.<hash>.json` with schools, categories, weapons, sections,
  techniques, segments (IDs, times, titles) and short notes, in that language
  only (fallback already applied).
- On any admin write, regenerate (debounced) the snapshot, write it to a
  versioned folder, atomically swap a symlink.
- Heavy per-segment data (drawings, long notes, VTT) is lazy-loaded when a
  segment is opened: `annotations/<segment-id>.<hash>.json`.
- Snapshot JSON shape: same IDs as the DB (no remapping, see IDs above);
  times in whole seconds; names stored once and referenced by ID; nulls and
  default values omitted. Plain objects, no columnar layout (readability first).
- Precompress at generation time: `.br` (`brotli -q 11`) and `.gz` (Zopfli)
  next to each JSON file. nginx serves them with `brotli_static` / `gzip_static`
  and never compresses at request time (`gzip off`); no zstd, no MessagePack/CBOR.
- Updates: served `private, no-cache` with an ETag (also behind
  `X-Accel-Redirect`); the service worker does stale-while-revalidate and
  usually gets a `304`.
- Size: a few thousand segments ≈ a few hundred KB, < 100 KB compressed. Past
  ~1–2 MB compressed, split by school (`catalog.<ryu>.<lang>.<hash>.json` +
  a small index), still static files.
- Read endpoints: `/api/catalog`, `/api/annotations/<id>`, `/media/segment/<id>`:
  each a session check then `X-Accel-Redirect` to a static file.
- Write endpoints: admin only, fine-grained REST under `/api/admin/…`
  (e.g. `POST /api/admin/techniques`, `PATCH /api/admin/segments/<id>`). Each
  successful write triggers the debounced snapshot regeneration.
- `/media/segment/<id>`: app looks up the segment and computes start/end itself
  (client never supplies them), then redirects to
  `/protected/<path>.mp4?start=…&end=…` served by the nginx mp4 module.

## Media storage
```
/srv/media/
  video/<h2>/<sha256>/{video.mp4, thumb.jpg, segment-<id>.jpg, filmstrip.jpg, notes.<lang>.vtt}
```
- One folder per video, named after the encoded file's SHA-256 (`paths.video_dir()`);
  `<h2>` = its first two hex chars. If originals are kept one day, the original
  goes alongside, in the same folder (e.g. `original.<ext>`); today it is deleted
  once published. Original filenames are DB metadata only, never used in paths.
  Everything but an original must be regenerable.
- Encoding: `tools/encode-videos/encode-videos.sh` — H.265 Main 8-bit (`hvc1` tag), AAC (mono
  stays mono, more → stereo), `+faststart`, IDR keyframe every 1 s (0.5 s above 30 fps; `-g` sets it), metadata stripped (global +
  stream tags, chapters, bitexact; `-m` keeps them, never used by the server), original dimensions,
  HDR tone-mapped to BT.709, interlaced sources deinterlaced with NNEDI3.
- An original already in that format (`encoder.checks.needs_encoding`: format only,
  incl. faststart, AAC mono or stereo; metadata ignored) is not encoded: `encoder.checks.strip_metadata`
  copies its first video + audio streams into a new MP4 without metadata, chapters or other
  streams (rotation side data kept), then the format is checked again. Published files never keep
  metadata (GPS!), so `sha256sum` ≠ `original_sha256`; duplicates are refused on either hash.
- Every ffmpeg / ffprobe (and the script's): `-protocol_whitelist file -format_whitelist <formats>`
  (`app/core/limits.py`: uploads `VIDEONINJA_INPUT_FORMATS`, default mov,matroska,avi,mpegts,mpeg,dv,asf, which
  also give the accepted extensions; the app's own MP4s `mov`). Run through `app/core/procs.py` (never
  subprocess directly): own process group, `setpriv --pdeathsig KILL`, time limit
  `VIDEONINJA_FFMPEG_TIMEOUT_H` (24 h), ffprobe `VIDEONINJA_FFPROBE_TIMEOUT_MIN` (10 min) (a timeout
  fails the video for good; the script: `-T` / `-L`), output via temporary files,
  group killed and reaped at the end. Uploads ≤ `VIDEONINJA_MAX_UPLOAD_BYTES` (20 GiB; tusd `-max-size`
  too); tusd's pre-create hook refuses other extensions (415); the page knows both (`/api/uploads/limits`).
- Segment thumbnails after the Videos page: the API only sets `segment.thumbnail` NULL (new/re-timed) and
  increments `video.thumbs_dirty`; the encoder's thumbnails thread makes them, deletes orphan
  `segment-*.jpg`, decrements by what it saw. The API has no ffmpeg and no media mount.

## Frontend / PWA
- Static shell is public (no data in it). Catalogue and media need a session.
- Routes: `src/routes/(app)/` = logged-in application (full-size layout, header:
  app icon + name left (phones ≤ 40rem: icon only; main nav `$lib/MainNav.svelte`
  folded into a drop-down named after the current page), user icon top right → menu: Profile first, User Management if `user_mgmt`,
  About, Log out always last); its layout loads the user into `$lib/session.svelte.ts`.
  `/login`, `/setup`, `/register` are outside the group (no shell). `/setup`
  and `/register#<token>` share `$lib/AccountWizard.svelte`.
- Icons: inline SVG via `$lib/Icon.svelte` (no icon library); icon-only buttons
  have `title` (tooltip) + `aria-label`. Flags: inline SVG via `$lib/Flag.svelte`
  (never emoji: Windows shows them as letters).
- UI strings: `src/lib/messages.json`, one entry per message with every language
  (`{"key": {"en": …, "fr": …}}`, `{name}` placeholders), via `t()` from
  `$lib/i18n.svelte.ts`. Language: saved choice (`localStorage`) → browser/system
  → `en`. Chooser: flag menu left of the user icon (`$lib/LanguageMenu.svelte`).
- Input rules (lengths, patterns) live once in `server/app/validation.json`:
  pydantic fields via `app/core/validation.py`, HTML form attributes via
  `src/lib/validation.ts` (build-time import). The backend always re-validates.
- Service worker: stale-while-revalidate for the catalogue (ETag/304); every
  clip played saved in cache `media`, keyed by `/media/segment/<id>` (no times
  in the URL: editing segments later must replace saved clips); 206 range responses from the saved
  clip (own `src/service-worker/range.ts`, no Workbox) — required for Safari.
  Thumbnails (segments and videos): cache first + background check. Whole videos
  (`/media/video/<id>`) saved in `media` too, but by the Videos page (`saveVideo` in
  `$lib/offline.svelte.ts`), never by the SW: browsers stop a SW after ~30 s (Firefox, even with
  waitUntil), which cut every video passing through it. The SW answers only saved ones (from the
  Blob, survives the SW; sync `savedVideos` set, reloaded on `media-changed` from the page) and
  never calls respondWith for the others. nginx allows 4 (3 editor elements + the save).
  Videos page title: phone button (`removeVideos`, `savedVideos` in `$lib/offline.svelte.ts`) deletes
  every saved whole video (not thumbnails, not clips), `media-changed` to the SW; hidden without a SW.
  Regression test: tests/pwa "whole videos: the service worker never stands between…" (CDP
  stopAllWorkers).
  The SW posts `media-saved` / `media-deleted`; `$lib/offline.svelte.ts` (SvelteSet of saved
  paths) feeds `$lib/OfflineToggle.svelte` on every catalogue card and segment thumbnail (the
  branch's segments, `segmentsUnder`): phone = all clips saved (click: remove), cloud = one missing
  (click: download all; confirm above 20), ring = progress (click: stop). One app-wide queue, one
  clip at a time (nginx limit; 429 retried 5× every 2 s), fetched by the page through the SW (which
  saves it), thumbnail too; `stopDownloads` on logout; hidden without a SW controller. Card = div
  with the link (`.face`) and the button as siblings. Videos page keeps `SavedBadge` (no button).
- Frame steps (player + editor): `$lib/frames.ts` — `frameDuration` = median gap per presented
  frame over `FRAME_SAMPLES` callbacks (not the smallest: WebKit adds one on a speed change),
  `frameStep` = next/previous frame on the grid. The editor measures with a hidden video IN the
  page (WebKit reports no frames otherwise; `aria-hidden`, tests select `video:not([aria-hidden])`).
- `navigator.storage.persist()`; clear Cache API + IndexedDB on logout.
- New versions: `$lib/pwa.ts` calls `registration.update()` on `visibilitychange` (visible) and
  hourly; `onAppUpdated` (controllerchange, not the first install) → `$lib/UpdateBanner.svelte`
  (root layout): "new version" + Reload, never an automatic reload.
- Upload page (online only, `upload` access): file opened locally, SHA-256
  checked against the server (duplicates refused) → own film-strip timeline
  (drag, edges, I/O keys) for segments → tus upload of the original → server
  queue encodes and publishes. Drafts in IndexedDB, deleted on logout.
  Later: Konva.js overlay for drawings (stored as JSON).

## Deployment
- Containers: non-root (UID 10001), read-only rootfs, `cap_drop: [ALL]`, `no-new-privileges`,
  memory limits, logs to journald (example), healthchecks in the compose file (api: `<base
  path>/health` through nginx; encoder: `python -m app.encoder --health`; none in the images).
  tini is PID 1 in api and encoder. Never mount the Docker socket.
- Four containers: nginx (port 8080, the only entry point; catalogue + media `ro`), api (database,
  catalogue, the key: only it), encoder (database, uploads, media; no key), tusd (uploads; hardened
  static image). Network `backend` internal (no egress), nginx alone also on `edge`. nginx finds `api:8000`
  and `tusd:1080` via Docker DNS (`resolver 127.0.0.11`, variables in proxy_pass), never forwards
  `/internal/`. The encoder asks the API to rebuild the catalogue (`POST /internal/catalog-changed`,
  harmless: only schedules). API and encoder share SQLite (same host, local disk). In development
  the API runs tusd (`children.py`) and the encoder thread itself; the api image sets both off.
- `/health` (`app/api/health.py`): database (query + version every call; `quick_check` at the first call then
  hourly, `INTEGRITY_EVERY_S`, result cached per file), encoder (heartbeat table, < 2 min,
  written every 30 s by the encoder), tusd (tus OPTIONS at `VIDEONINJA_TUSD_URL`); 503 if one fails,
  `not_set_up` before the setup. nginx serves the
  frontend, X-Accel-Redirect media/catalogue, auth_request on every upload request.
  The user's TLS proxy only terminates TLS, sends HSTS and forwards `/videoninja/`
  unchanged (overwriting X-Forwarded-For); config in the README.
- Base path: served under `/videoninja` (build arg `BASE_PATH`, env
  `VIDEONINJA_BASE_PATH`). Frontend: every app URL through `$lib/base.ts` `url()`;
  manifest paths relative; service worker derives the base from its own URL.
  nginx strips the base before /api and /media; tusd's base path includes it.
  Subfolder = origin shared with the domain's other sites (accepted, documented;
  Clear-Site-Data kept on purpose). Dev and most tests at the root; Playwright
  project `subpath` re-runs the PWA tests under /videoninja.
- Images: one multi-stage Dockerfile; everything is built in earlier stages (frontend, Python venv,
  tusd, nginx.conf + `nginx -t`, sources made readable whatever the checkout's umask), the final
  stages have no RUN and no build tools (no Node, no pip). Keep it that way. Bases: Docker Hardened
  Images (`dhi.io`: nginx, static for tusd, `-dev` variants for build stages; needs `docker login
  dhi.io`, CI too) wherever one fits; api + encoder on `python:<3.15.x>-alpine3.24` (no hardened
  Python 3.15, and no apk in hardened runtimes). All versions pinned, latest when last updated.
  Hardened runtimes have no `root` in passwd: `USER 0:0` in their build stages.
- Test admin: `tools/make-dev-db.py` (outside the image) builds a database with `db.create_database`
  and fixed, public test credentials (variables in the script); `server/dev.key` required, `--force`
  replaces. Development and test instances only.
- Browser tests, all projects once, browsers in Playwright's Docker image: `tools/test-browser.sh`
  (run-server `--unsafe` on 127.0.0.1 for the PWA projects' `--ignore-certificate-errors`; image
  version = installed `@playwright/test`). Needed where Playwright's WebKit can't start (Ubuntu 25.10).
- e2e on the real containers: `tools/test-e2e-stack.sh [--images X.Y.Z]` (throwaway instance: empty DB,
  folders, key in a temp dir; compose project `videoninja-e2e`; token from the api log). Playwright:
  `E2E_BASE_URL` → only projects `e2e` + `stack` (tests/stack: upload → tusd → encoder → nginx clip,
  thumbnails, /health), no webServer; `E2E_SETUP_TOKEN`. e2e paths are relative to the base URL
  ('login', './'); account.spec leaves `.e2e/admin.json` (final credentials) for tests/stack.
- Local test of the images: `tools/docker-dev.sh` (builds `docker-compose.dev.yaml`: the four
  containers, production settings on the development data: `server/` → `/data` (`dev.db`), `dev.key` →
  the api's default secret path, `server/{catalog,media,uploads}` → `/srv/…`; runs as the owner of
  `server/`; http://localhost:8080/videoninja/).
- About (`/about`, `$lib/about.ts`): version, commit and date baked in at build time (vite `define`
  from `APP_VERSION` / `APP_COMMIT`, build arguments of the image set by CI from the tag and SHA; else
  git, else `dev`/`unknown`); database version at runtime from `GET /api/about` (`config.db_version`,
  and the latest `db_vN.sql` shipped). GitHub, Docker Hub (hub.docker.com/u/thecyberdoc) and GPL-3.0 links.
- `sw.js` served `no-cache`; hashed assets `immutable`.
- Settings (`app/core/settings.py`): every `VIDEONINJA_*` variable + `TZ` read ONLY there (test: no
  `os.environ`/`getenv` elsewhere but `crypto.py`, which pops `VIDEONINJA_DB_KEY`: never a setting).
  `settings.current()` → frozen `Settings` (typed, defaults resolved: folders next to the DB), parsed once
  per distinct environment (`VARIABLES` = the cache key; tests' `monkeypatch.setenv` just works); wrong
  values → one RuntimeError naming each (`main.lifespan`, encoder `main()`). Allowed values live there:
  `INPUT_FORMATS`, `X265_PRESETS`, `LOG_LEVELS`/`LOG_FORMATS`. Kept helpers derive from it (`db.db_path`,
  `paths.*_dir`, `snapshot.catalog_dir`, `limits.extensions`/`ffmpeg_input`). A new variable: field +
  `from_env` + `VARIABLES` + README table (test: every variable documented). Test: `tests/test_settings.py`.
- Logging (`app/core/logs.py`): every module `logging.getLogger(__name__)` (never uvicorn's logger);
  `logs.configure()` at the import of `app.main` and in the encoder's `main()`, uvicorn's loggers
  through the same root handler (`StderrHandler`: `sys.stderr` at each write). `VIDEONINJA_LOG_FORMAT`
  `text` (default, dev) | `json` (images: `ts` in clock's format, `level`, `logger`, `msg`, extras,
  `exc`); `VIDEONINJA_LOG_LEVEL` (INFO); bad value → no start. The setup token's line is read by
  tools/test-e2e-stack.sh (sed on the token's characters). Test: `tests/test_logs.py`.
- Request IDs: nginx's `$request_id` → `X-Request-ID` to the api (server-level proxy_set_header),
  tusd and the auth subrequest; `rid=` in nginx's log; `add_header X-Request-ID` to the browser.
  `app/core/middleware.py` `RequestLog` (pure ASGI, added last = outermost): takes a valid ID
  (`[A-Za-z0-9-]{1,64}`) or makes one (then adds the header itself), `logs.start(request_id=…)` for
  the rest of the task (uvicorn's traceback included), one line per request (`app.middleware`:
  method, route TEMPLATE, status, `duration_ms`; healthy /health DEBUG); uvicorn's access log off.
  Context: `logs.start` / `logs.bind(**f)` (contextmanager) / `logs.add(**f)` (mutates the bound dict:
  FastAPI's sync dependencies run in context copies) + `ContextFilter`; `api.deps.current_user` and login
  `add(user_id=…)`; tusd hook adopts the event's `X-Request-Id`; encoder jobs and thumbnails
  `bind(video_id=…)`; `catalog_changed` sends its own ID. Frontend: `ApiError.requestId` (answer header,
  tus too; shown later by the shared error display). Test: `tests/test_middleware.py`.
- Audit (`app/domain/audit.py`): security events only through `audit.event("<name>", **fields)` on logger
  `app.audit`, names fixed in `EVENTS` (with their level; KeyError otherwise; AST test). Who = the
  request's `user_id` (context) or a field (registration, logout: `security.delete_session` returns the
  session's user); what = `target_user_id`, `video_id`, `comment_id`… Never passwords, tokens, TOTP
  secrets/codes, nor a failed login's username (`client` = `throttle.client_key`). Test:
  `tests/test_audit.py` (a whole account flow scanned for every secret). README "Logs": fields, jq
  recipes, the event list (keep it in sync with `EVENTS`).
- Buffering: nginx buffers app responses by default; an app endpoint that
  streams progress sends `X-Accel-Buffering: no` (the app decides, nginx
  follows). Media bytes never go through the app: nginx streams them itself
  after `X-Accel-Redirect`.

## Security tooling
- SBOM (SPDX JSON): releases attach SBOM + SLSA provenance (build-push-action `sbom`/`provenance`);
  `.github/workflows/security.yml` weekly: four images (amd64) + sources → Syft SBOM artifacts →
  Grype → SARIF in code scanning (never fails); `tools/sbom.sh [--scan]` the same locally (Syft/Grype
  images pinned by digest, `docker save` archives, never the socket; output `sbom/`, git-ignored).
- Python deps: edit `server/requirements{,-dev}.in`; `requirements{,-dev}.txt` are generated (`uv pip compile
  <in> --universal --python-version 3.15 --generate-hashes -o <txt>`), every transitive package pinned
  with hashes, installed with `--require-hashes` (Dockerfile, CI, README). Dev tools there too (pytest,
  bandit, flake8).
- Code scanning: CodeQL = GitHub's default setup (repository settings; python, javascript-typescript,
  actions). No CodeQL workflow: GitHub refuses advanced-setup results while the default setup is on.
  Bandit in CI's server job (`bandit -r app -q`, fails on a finding). Reviewed
  findings: `# <reason>  # nosec <id>` on the line, never file-wide. Service URLs only via
  `paths.service_url` (http(s) only, checked at startup).
- `.github/dependabot.yml`: pip, npm, docker (dhi.io registry), github-actions; weekly, cooldown 14 days.
  TypeScript majors ignored while svelte-check's peer range stops below them (7: not yet).
- tusd is built from source (stage tusd-build: dhi.io/golang, pinned source SHA-256, `TUSD_MODULES`
  raised to the versions the scan's fixes need); its release binaries lag on Go security fixes.
  New third-party actions: pinned by commit SHA with the tag in a comment.

## CI/CD (`.github/workflows/ci-cd.yml`)
- Single branch: `main` (development and releases; feature branches optional).
- Every push (any branch) and PR to `main`: tests, frontend build (workflow
  artifact), image builds (matrix: image × arch) on native runners (`ubuntu-latest`,
  `ubuntu-24.04-arm`), not published.
- Tag `vX.Y.Z`: same builds, pushed by digest, merged manifest per image published as
  `<user>/videoninja-<image>:X.Y.Z`, `X.Y`, `X`, `latest`. Only tags publish what users run.
- Registry: Docker Hub (`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets).

## Working agreements for Claude Code
- Propose a plan before large changes; keep PRs small.
- Every change keeps the CI chain green: tests → build → publish images.
- Never commit secrets; never weaken a security control to make something work —
  flag it instead.
- API errors: `ApiError("<code>", **params)` with the code in `ERRORS` (`server/app/core/errors.py`:
  status + English `detail`), answered `{"code", "detail", "params"}` (also validation
  `validation.<kind>`, routing, 500 `internal`, tusd hook bodies, nginx 429 `rate_limited`). Each
  code needs `error.<code>` in messages.json (en + fr; `tests/test_errors.py`: also every code raised
  in `app/` is in the table, no bare `HTTPException`). `detail` is never for users. Setup stream:
  `{"error": {code, detail, params}}`. Frontend: `$lib/api.ts` `ApiError(status, code, params)`,
  `message` = `t('error.<code>')` (`errorText`; unknown code → `error.http_error` {status}; no JSON →
  code from the status, `BY_STATUS`; fetch failure → `network`); pages show `e.message`. tus:
  `uploadError` (`$lib/upload/upload.ts`). Tests: `src/lib/api.test.ts`, mocked specs send coded bodies.
  Not yet coded: the encoder's `video.error` (English, shown in My uploads).
- Translate everything, in every supported language (`en`, `fr`), as part of the
  change that adds it, never as a follow-up:
  - Frontend: no hard-coded user-visible text. Every string (labels, buttons,
    headings, hints, messages, `title`, `aria-label`, `alt`, `placeholder`,
    `confirm()` texts) goes in `src/lib/messages.json` and is shown with `t()`.
  - Database: every new row with translated text (seed data in `db_vN_init.sql`,
    admin writes) gets its `translation` row with all languages filled, and the
    entity points to it by translation ID (`<table>.<id>.<column>`, e.g.
    `role.admin.name`). New translatable columns are translation IDs, never plain
    text. Kanji and romaji are not translated.
