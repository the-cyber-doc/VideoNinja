# Video Ninja server: API, uploads (tusd, started by the app) and the encoding
# queue (encode-videos.sh). Built from the repository root (it needs tools/):
#   docker build -f server/Dockerfile .

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

FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Catalogue snapshots are precompressed with the command-line tools
# (no Python 3.15 wheels of brotli / zopfli for arm64). ffmpeg: Debian's build
# has libx265, nnedi (deinterlacing), zscale + tonemap (HDR).
RUN apt-get update \
    && apt-get install -y --no-install-recommends brotli zopfli ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tusd /usr/local/bin/tusd /usr/local/bin/tusd

WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/app/ app/
COPY server/database/ database/
COPY --chmod=755 tools/encode-videos/encode-videos.sh /app/encode/
COPY tools/encode-videos/nnedi3_weights.bin /app/encode/

# Volumes: database, catalogue snapshots and media (read-only for nginx),
# uploads waiting to be encoded. The rest of the filesystem can stay read-only.
ENV VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_KEY_FILE=/run/secrets/videoninja_key \
    VIDEONINJA_CATALOG_DIR=/srv/catalog \
    VIDEONINJA_UPLOAD_DIR=/srv/uploads \
    VIDEONINJA_MEDIA_DIR=/srv/media \
    VIDEONINJA_ENCODE_SCRIPT=/app/encode/encode-videos.sh \
    VIDEONINJA_X_ACCEL=1 \
    VIDEONINJA_TUSD_HOST=0.0.0.0
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /data /srv/catalog /srv/uploads /srv/media \
    && chown 10001 /data /srv/catalog /srv/uploads /srv/media
VOLUME ["/data", "/srv/catalog", "/srv/uploads", "/srv/media"]

USER 10001

# 8000: the app (API); 1080: tusd (uploads). Both for nginx only.
EXPOSE 8000 1080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
