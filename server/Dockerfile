FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY database/ database/

# The database lives on a volume; the rest of the filesystem can stay read-only.
ENV VIDEONINJA_DB=/data/videoninja.db \
    VIDEONINJA_KEY_FILE=/run/secrets/videoninja_key
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir /data && chown 10001 /data
VOLUME /data

USER 10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
