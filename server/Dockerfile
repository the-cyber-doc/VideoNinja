# Video Ninja: the whole app in one image. nginx (port 8080, the only entry
# point: frontend, media, uploads), the API, tusd and the encoding queue
# (encode-videos.sh); the app starts and watches nginx and tusd. Behind your TLS
# proxy, under BASE_PATH (default /videoninja, as https://example.org/videoninja/).
# Built from the repository root (it needs frontend/, nginx/, tools/):
#   docker build -f server/Dockerfile .
#   docker build -f server/Dockerfile --build-arg BASE_PATH=/other .
#
# Everything is built in the stages before the last one; the final image only
# copies their results onto the runtime base: no build step, no build tool
# (no Node, no pip, no compiler), only what serves the app.

# tusd: official release, checksums pinned per architecture. (The official
# image's binary is built on Alpine; the release binary is static.)
FROM python:3.15-slim AS tusd
ARG TARGETARCH
ARG TUSD_VERSION=v2.10.1
ARG TUSD_SHA256_amd64=e8c8d7738275d2d9377db953aecbc242262d3620e77fbd3c1491361d9cea6ac8
ARG TUSD_SHA256_arm64=134e575a6524698b54d989958c680f0a4ec243d9622c1926e30e27c2a86e4752
RUN python - <<PY
import hashlib, tarfile, urllib.request
arch = "${TARGETARCH}"
expected = {"amd64": "${TUSD_SHA256_amd64}", "arm64": "${TUSD_SHA256_arm64}"}[arch]
url = f"https://github.com/tus/tusd/releases/download/${TUSD_VERSION}/tusd_linux_{arch}.tar.gz"
data = urllib.request.urlopen(url, timeout=60).read()
assert hashlib.sha256(data).hexdigest() == expected, "tusd checksum mismatch"
open("/tmp/tusd.tar.gz", "wb").write(data)
with tarfile.open("/tmp/tusd.tar.gz") as t:
    t.extract(f"tusd_linux_{arch}/tusd", "/tmp", filter="data")
PY
RUN mv /tmp/tusd_linux_*/tusd /usr/local/bin/tusd && /usr/local/bin/tusd -version

# The frontend, built for the base path (links, API and media URLs, service worker).
FROM node:24.22.1-slim AS frontend
ARG BASE_PATH=/videoninja
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY server/app/validation.json /src/server/app/validation.json
RUN BASE_PATH="${BASE_PATH}" npm run build

# The app's Python packages, in a virtual environment that the final image
# copies as is (same base image: same interpreter path). pip itself is removed.
FROM python:3.15-slim AS python-packages
COPY server/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && /opt/venv/bin/pip uninstall --yes pip

# What runs the app: Python, and the tools the app starts. Catalogue snapshots
# are precompressed with the command-line tools (no Python 3.15 wheels of
# brotli / zopfli for arm64). ffmpeg: Debian's build has libx265, nnedi
# (deinterlacing), zscale + tonemap (HDR). nginx: Debian's has the mp4,
# auth_request, gzip_static and realip modules; brotli_static is a separate
# package. The base image's pip goes too: nothing is installed at run time.
FROM python:3.15-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends brotli zopfli ffmpeg nginx libnginx-mod-http-brotli-static \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip uninstall --yes pip \
    && useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /data /srv/catalog /srv/uploads /srv/media \
    && chown 10001 /data /srv/catalog /srv/uploads /srv/media

# nginx's configuration for the base path (nginx.conf is written for
# /videoninja/), checked by the very nginx of the runtime (nginx -t): a broken
# configuration fails the build, not the start.
FROM runtime AS nginx-config
ARG BASE_PATH=/videoninja
COPY nginx/nginx.conf /etc/videoninja/nginx.conf
RUN sed -i "s#/videoninja/#${BASE_PATH}/#g" /etc/videoninja/nginx.conf \
    && nginx -t -c /etc/videoninja/nginx.conf -e stderr

# The image: the runtime plus the results of the stages above. No RUN.
FROM runtime
ARG BASE_PATH=/videoninja

COPY --from=tusd /usr/local/bin/tusd /usr/local/bin/tusd
COPY --from=python-packages /opt/venv /opt/venv
COPY --from=frontend /src/frontend/build/ /srv/www${BASE_PATH}/
COPY --from=nginx-config /etc/videoninja/nginx.conf /app/nginx/nginx.conf

WORKDIR /app
COPY server/app/ app/
COPY server/database/ database/
COPY --chmod=755 tools/encode-videos/encode-videos.sh /app/encode/
COPY tools/encode-videos/nnedi3_weights.bin /app/encode/

# The encryption key: the Docker secret /run/secrets/videoninja_key (the app's
# default), or VIDEONINJA_DB_KEY_FILE (another file), or VIDEONINJA_DB_KEY (the key
# itself). Not set here: setting both refuses the start.
# Volumes: database, catalogue snapshots, media, uploads waiting to be encoded.
# The rest of the filesystem can stay read-only (nginx's temporary files: /tmp).
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_CATALOG_DIR=/srv/catalog \
    VIDEONINJA_UPLOAD_DIR=/srv/uploads \
    VIDEONINJA_MEDIA_DIR=/srv/media \
    VIDEONINJA_ENCODE_SCRIPT=/app/encode/encode-videos.sh \
    VIDEONINJA_X_ACCEL=1 \
    VIDEONINJA_NGINX_CONF=/app/nginx/nginx.conf \
    VIDEONINJA_BASE_PATH=${BASE_PATH}
VOLUME ["/data", "/srv/catalog", "/srv/uploads", "/srv/media"]

USER 10001

# nginx, plain HTTP for your TLS proxy. The app (8000) and tusd (1080) listen on
# the container's loopback only: nginx is the way in.
EXPOSE 8080

# No HEALTHCHECK: the compose file sets it (README, docker-compose.yaml).

CMD ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]
