# Video Ninja: four images, one per container, from one Dockerfile (--target):
#   nginx    the only entry point (port 8080): the frontend, media and catalogue
#            files after the API's X-Accel-Redirect, uploads after its check
#   api      the FastAPI app: sessions, the database, the catalogue snapshots
#   encoder  the encoding queue (encode-videos.sh, ffmpeg) and segment thumbnails
#   tusd     resumable uploads (tusd built from its source, nothing else)
# Behind your TLS proxy, under BASE_PATH (default /videoninja, as
# https://example.org/videoninja/). Built from the repository root (it needs
# frontend/, nginx/, tools/):
#   docker build -f server/Dockerfile --target api .
#   docker build -f server/Dockerfile --target nginx --build-arg BASE_PATH=/other .
#
# Everything is built in the stages before the final ones; a final image only
# copies their results onto its runtime: no build step, no build tool (no Node,
# no pip, no compiler), only what that container runs. All run as UID 10001.
#
# Base images: Docker Hardened Images (dhi.io) where one fits: nginx, tusd's base
# (static), and the build stages (alpine-base, node, nginx -dev variants).
# Building needs `docker login dhi.io` (a free Docker account). The API and the
# encoder use the official python Alpine image: the hardened Python images stop
# at 3.14 and have no package manager (ffmpeg, brotli, zopfli, tini are needed).
# Versions pinned; update them together with their checksums below.

# tusd, built from its release's source (pinned SHA-256): the release binaries are
# built with older Go and libraries than their security fixes (the weekly scan). The
# latest Go, and the libraries below at their fixed versions; every module checked by
# Go against go.sum and its checksum database (sum.golang.org). Static, no cgo.
FROM dhi.io/golang:1.27.3-alpine3.24-dev AS tusd-build
USER 0:0
ARG TUSD_VERSION=2.10.1
ARG TUSD_COMMIT=388a27cb81c33b2349e0308b5e97e23797e86fd9
ARG TUSD_SHA256=ab47dd763c7d5269b13738cc731ea85b0670b62f49bccf046587b2588e71bd95
# Raised above tusd's own go.mod: its release still has the vulnerable ones.
ARG TUSD_MODULES="golang.org/x/net@v0.60.0 golang.org/x/crypto@v0.57.0 google.golang.org/grpc@v1.83.2 go.opentelemetry.io/otel/sdk@v1.45.0 github.com/go-jose/go-jose/v4@v4.1.6"
ENV CGO_ENABLED=0 GOFLAGS=-trimpath GOTOOLCHAIN=local
WORKDIR /tmp/build
RUN wget -q -O tusd.tar.gz "https://github.com/tus/tusd/archive/refs/tags/v${TUSD_VERSION}.tar.gz" \
    && echo "${TUSD_SHA256}  tusd.tar.gz" | sha256sum -c - \
    && tar xzf tusd.tar.gz \
    && cd "tusd-${TUSD_VERSION}" \
    && go get ${TUSD_MODULES} \
    && go mod tidy \
    && go build -ldflags "-s -w -X github.com/tus/tusd/v2/cmd/tusd/cli.VersionName=v${TUSD_VERSION} -X github.com/tus/tusd/v2/cmd/tusd/cli.GitCommit=${TUSD_COMMIT}" \
        -o /out/usr/local/bin/tusd ./cmd/tusd \
    && /out/usr/local/bin/tusd -version \
    && mkdir -p /out/srv/uploads

# The frontend, built for the base path (links, API and media URLs, service worker).
FROM dhi.io/node:26.12.1-alpine3.24-dev AS frontend
USER root
ARG BASE_PATH=/videoninja
# Shown on the About page: the release ("0.0.5") and the commit (CI passes both).
ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY server/app/validation.json /src/server/app/validation.json
RUN BASE_PATH="${BASE_PATH}" APP_VERSION="${APP_VERSION}" APP_COMMIT="${APP_COMMIT}" npm run build

# The app's Python packages, in a virtual environment that the final images
# copy as is (same base image: same interpreter path). pip itself is removed.
# Compilers for the packages without a musl wheel for Python 3.15: here only.
FROM python:3.15.2-alpine3.24 AS python-packages
COPY server/requirements.txt /tmp/requirements.txt
RUN apk add --no-cache build-base libffi-dev cargo \
    && python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt \
    && /opt/venv/bin/pip uninstall --yes pip

# The app's sources, readable by the containers' user whatever the umask of the
# checkout they come from (COPY keeps the files' modes).
FROM dhi.io/alpine-base:3.24-alpine3.24-dev AS sources
USER root
COPY server/app/ /out/app/
COPY server/database/ /out/database/
COPY tools/encode-videos/encode-videos.sh tools/encode-videos/nnedi3_weights.bin /out/encode/
RUN chmod -R u=rwX,go=rX /out && chmod 755 /out/encode/encode-videos.sh

# --- Runtimes: the system packages of each container, and its user ---

# nginx: the hardened nginx (dhi.io), with the mp4, auth_request, gzip_static
# and realip modules. brotli_static is not among them: compiled here, in its
# -dev variant, against the image's own nginx (same version, --with-compat),
# from pinned sources. Only brotli_static (serves the .br files written
# beforehand): it links no library. A new nginx image needs NGINX_SHA256 of its
# version.
FROM dhi.io/nginx:1.31.8-alpine3.24-dev AS brotli-module
USER root
ARG NGINX_SOURCE=1.31.8
ARG NGINX_SHA256=0652b760b3b772d2ec17b47c2fc15d9a95e6fe35cd5b877eadc1a62d9bc75af1
ARG NGX_BROTLI_COMMIT=a71f9312c2deb28875acc7bacfdd5695a111aa53
ARG NGX_BROTLI_SHA256=1d21be34f3b7b6d05a8142945e59b3a47665edcdfe0f3ee3d3dbef121f90c08c
WORKDIR /tmp/build
RUN apk add --no-cache build-base pcre2-dev zlib-dev \
    && wget -q -O nginx.tar.gz "https://nginx.org/download/nginx-${NGINX_SOURCE}.tar.gz" \
    && wget -q -O ngx_brotli.tar.gz "https://github.com/google/ngx_brotli/archive/${NGX_BROTLI_COMMIT}.tar.gz" \
    && printf '%s  nginx.tar.gz\n%s  ngx_brotli.tar.gz\n' "$NGINX_SHA256" "$NGX_BROTLI_SHA256" | sha256sum -c - \
    && tar xzf nginx.tar.gz && tar xzf ngx_brotli.tar.gz \
    && cd "nginx-${NGINX_SOURCE}" \
    && ./configure --with-compat --add-dynamic-module="../ngx_brotli-${NGX_BROTLI_COMMIT}/static" \
    && make modules \
    && install -D -m 644 objs/ngx_http_brotli_static_module.so /out/ngx_http_brotli_static_module.so

FROM dhi.io/nginx:1.31.8-alpine3.24 AS runtime-nginx
COPY --from=brotli-module /out/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/

# Python for the API and the encoder. tini: PID 1, reaps what is re-parented to
# it and passes SIGTERM on. setpriv: child processes die with the app
# (app/procs.py). The base image's pip goes too: nothing is installed at run time.
FROM python:3.15.2-alpine3.24 AS runtime-python
RUN apk add --no-cache tini setpriv \
    && python -m pip uninstall --yes pip \
    && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /data /srv/catalog /srv/uploads /srv/media \
    && chown 10001:10001 /data /srv/catalog /srv/uploads /srv/media

# The API: catalogue snapshots are precompressed with the command-line tools (no
# Python 3.15 wheels of brotli / zopfli for arm64). No ffmpeg: thumbnails are
# the encoder's.
FROM runtime-python AS runtime-api
RUN apk add --no-cache brotli zopfli

# The encoder: Alpine's ffmpeg (libx265, nnedi, zscale + tonemap) and bash for
# encode-videos.sh. Checked here: the build fails if one is missing.
FROM runtime-python AS runtime-encoder
RUN apk add --no-cache ffmpeg bash \
    && ffmpeg -hide_banner -encoders | grep -q libx265 \
    && ffmpeg -hide_banner -filters | grep -qw nnedi \
    && ffmpeg -hide_banner -filters | grep -qw zscale \
    && ffmpeg -hide_banner -filters | grep -qw tonemap

# nginx's configuration for the base path (nginx.conf is written for
# /videoninja/), checked by the very nginx of the runtime (nginx -t): a broken
# configuration fails the build, not the start.
FROM runtime-nginx AS nginx-config
# Numeric: the hardened runtime's passwd file has no root entry.
USER 0:0
ARG BASE_PATH=/videoninja
COPY nginx/nginx.conf /etc/videoninja/nginx.conf
RUN sed -i "s#/videoninja/#${BASE_PATH}/#g" /etc/videoninja/nginx.conf \
    && chmod 644 /etc/videoninja/nginx.conf \
    && nginx -t -c /etc/videoninja/nginx.conf -e stderr

# --- The images: a runtime plus the results of the stages above. No RUN. ---

# The hardened static base: CA certificates and a passwd file, nothing else.
FROM dhi.io/static:20261020-alpine3.24 AS tusd
COPY --from=tusd-build /out/usr/local/bin/tusd /usr/local/bin/tusd
COPY --from=tusd-build --chown=10001:10001 /out/srv/uploads /srv/uploads
VOLUME ["/srv/uploads"]
USER 10001:10001
# Its arguments (base path, hooks, size limit) come from the compose file.
ENTRYPOINT ["/usr/local/bin/tusd"]

FROM runtime-nginx AS nginx
ARG BASE_PATH=/videoninja
COPY --from=frontend /src/frontend/build/ /srv/www${BASE_PATH}/
COPY --from=nginx-config /etc/videoninja/nginx.conf /etc/videoninja/nginx.conf
USER 10001:10001
# Plain HTTP for your TLS proxy. Writes only to /tmp (tmpfs).
EXPOSE 8080
# Not the image's docker-entrypoint.sh: its scripts rewrite /etc/nginx/conf.d,
# unused here (our own configuration) and read-only anyway.
ENTRYPOINT []
CMD ["nginx", "-c", "/etc/videoninja/nginx.conf", "-e", "stderr", "-g", "daemon off;"]

FROM runtime-api AS api
ARG BASE_PATH=/videoninja
COPY --from=python-packages /opt/venv /opt/venv
WORKDIR /app
COPY --from=sources /out/app/ app/
COPY --from=sources /out/database/ database/
# The encryption key: the Docker secret /run/secrets/videoninja_key (the app's
# default), or VIDEONINJA_DB_KEY_FILE (another file), or VIDEONINJA_DB_KEY (the
# key itself). Not set here: setting both refuses the start. Only this
# container gets it.
# tusd and the encoder run in their own containers (VIDEONINJA_TUSD=0,
# VIDEONINJA_ENCODER=0). FORWARDED_ALLOW_IPS (uvicorn): nginx's address, set by
# the compose file, so that the client's address is the one nginx saw.
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_CATALOG_DIR=/srv/catalog \
    VIDEONINJA_UPLOAD_DIR=/srv/uploads \
    VIDEONINJA_MEDIA_DIR=/srv/media \
    VIDEONINJA_X_ACCEL=1 \
    VIDEONINJA_TUSD=0 \
    VIDEONINJA_TUSD_URL=http://tusd:1080 \
    VIDEONINJA_ENCODER=0 \
    VIDEONINJA_BASE_PATH=${BASE_PATH} \
    VIDEONINJA_LOG_FORMAT=json
VOLUME ["/data", "/srv/catalog"]
USER 10001:10001
# On the compose file's internal network only: nginx is the way in.
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime-encoder AS encoder
COPY --from=python-packages /opt/venv /opt/venv
WORKDIR /app
COPY --from=sources /out/app/ app/
COPY --from=sources /out/encode/ /app/encode/
# No encryption key: it never reads the encrypted columns. VIDEONINJA_API_URL:
# where it asks for a catalogue rebuild after publishing.
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_UPLOAD_DIR=/srv/uploads \
    VIDEONINJA_MEDIA_DIR=/srv/media \
    VIDEONINJA_ENCODE_SCRIPT=/app/encode/encode-videos.sh \
    VIDEONINJA_API_URL=http://api:8000 \
    VIDEONINJA_LOG_FORMAT=json
VOLUME ["/data", "/srv/uploads", "/srv/media"]
USER 10001:10001
ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "app.encoder"]
