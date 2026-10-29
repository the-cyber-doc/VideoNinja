"""The encoder: one video at a time, encoded (or only stripped of its metadata) and
published; segment thumbnails redone after the Videos page; a heartbeat for /health.

- queue.py: the worker (Encoder) and its start / stop: the job loop, encoding, publishing.
- checks.py: ffprobe / ffmpeg runs and the checks of files (needs_encoding…).
- thumbnails.py: taking thumbnails, redoing those of changed segments.
- heartbeat.py: its liveness (healthy: /health and the container's healthcheck).
- notify.py: telling the API that the catalogue changed.
- cli.py (python -m app.encoder): its own container.

The API uses start, stop and healthy.
"""

from .heartbeat import healthy
from .queue import start, stop

__all__ = ["healthy", "start", "stop"]
