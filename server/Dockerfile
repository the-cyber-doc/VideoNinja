FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Catalogue snapshots are precompressed with the command-line tools
# (no Python 3.15 wheels of brotli / zopfli for arm64).
RUN apt-get update \
    && apt-get install -y --no-install-recommends brotli zopfli \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY database/ database/

# The database and the catalogue snapshots live on volumes; the rest of the
# filesystem can stay read-only. /srv/catalog is also mounted read-only into nginx,
# which serves the files after the app's check (X-Accel-Redirect).
ENV VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_KEY_FILE=/run/secrets/videoninja_key \
    VIDEONINJA_CATALOG_DIR=/srv/catalog \
    VIDEONINJA_X_ACCEL=1
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir /data /srv/catalog && chown 10001 /data /srv/catalog
VOLUME ["/data", "/srv/catalog"]

USER 10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
