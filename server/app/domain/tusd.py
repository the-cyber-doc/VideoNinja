"""Uploads through tusd (resumable uploads), decided by the app.

tusd runs in its own container in production (VIDEONINJA_TUSD=0, reached at
VIDEONINJA_TUSD_URL), and as a child of the app in development (Tusd below).

- /internal/upload-auth: nginx asks it before forwarding ANY request to tusd
  (auth_request: create, every chunk, resume, cancel): session, "upload" access,
  and for an existing upload, that it is the user's own.
- /internal/tusd-hook: tusd's hooks. pre-create checks the request again (the
  forwarded session cookie) and the announced file, and names the upload;
  post-finish marks it complete.

nginx routes neither from outside (/internal/ is not proxied; the auth
subrequest is an internal location). The encoder checks every file (size,
SHA-256) before encoding it.
"""

import logging
import shutil
import urllib.error
import urllib.request


from ..core import paths, settings
from ..core.children import Child

log = logging.getLogger(__name__)


def files_path() -> str:
    """tusd's -base-path: where the browser sends uploads, nginx forwarding it as is."""
    return f"{settings.current().base_path}/files/"


# --- the tusd process ---


class Tusd(Child):
    """tusd as a child process (children.py).

    Environment: VIDEONINJA_TUSD=0 (off), VIDEONINJA_TUSD_BIN (default: tusd on
    PATH; not found = no uploads, logged), VIDEONINJA_TUSD_HOST (default
    127.0.0.1: only nginx, in the same container, reaches it),
    VIDEONINJA_TUSD_PORT (1080), VIDEONINJA_APP_PORT (8000: where its hooks call).
    """

    name = "tusd"
    missing = "not found: uploads are not possible (set VIDEONINJA_TUSD_BIN)"

    def __init__(self) -> None:
        config = settings.current()
        super().__init__(config.tusd_bin or shutil.which("tusd"))
        self.host = config.tusd_host
        self.port = str(config.tusd_port)
        self.app_port = config.app_port

    def command(self) -> list[str]:
        return [
            self.binary, "-host", self.host, "-port", self.port,
            "-upload-dir", str(paths.upload_dir()), "-base-path", files_path(),
            "-behind-proxy", "-disable-download", "-max-size", str(settings.current().max_upload_bytes),
            "-hooks-http", f"http://127.0.0.1:{self.app_port}/internal/tusd-hook",
            "-hooks-enabled-events", "pre-create,post-finish",
            "-hooks-http-forward-headers", "Cookie",
        ]

    def prepare(self) -> None:
        paths.upload_dir().mkdir(parents=True, exist_ok=True)

    def log_line(self, line: str) -> None:
        if "level=ERROR" in line or "level=WARN" in line:
            log.warning("tusd: %s", line)
        else:
            log.debug("tusd: %s", line)


process = Tusd()


def start() -> None:
    """Start tusd (app startup, or after setup). VIDEONINJA_TUSD=0: off."""
    global process
    if not settings.current().run_tusd or (process.thread and process.thread.is_alive()):
        return
    process = Tusd()  # settings from the current environment
    process.start()


def stop() -> None:
    process.stop()


def available() -> bool:
    """Whether tusd takes uploads now. Its own container (VIDEONINJA_TUSD_URL): it
    answers a tus OPTIONS request. Run by the app: its process is running (False
    when the binary is missing, or it crashed and is restarting). Neither (tests,
    tusd run by hand): assumed up."""
    url = settings.current().tusd_url
    if url:
        return _answers(url + files_path())
    if not settings.current().run_tusd:
        return True
    return process.running()


def _answers(url: str) -> bool:
    try:
        request = urllib.request.Request(url, method="OPTIONS")
        with urllib.request.urlopen(request, timeout=2) as r:  # http(s) only (paths)  # nosec B310
            return bool(r.headers.get("Tus-Version"))
    except (OSError, urllib.error.URLError):
        return False
