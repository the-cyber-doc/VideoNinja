"""nginx in the app's container, started and watched by the app (like tusd).

It is the container's only entry point (port 8080, plain HTTP behind the TLS
proxy): the static frontend, X-Accel-Redirect for the catalogue and media, the
auth_request check before tusd. Its configuration: nginx/nginx.conf of the
repository (VIDEONINJA_NGINX_CONF, set by the Docker image). Without it
(development, tests), nginx is not started: Vite serves the frontend.

Environment: VIDEONINJA_NGINX=0 (off), VIDEONINJA_NGINX_CONF, VIDEONINJA_NGINX_BIN
(default: nginx on PATH).
"""

import logging
import os
import re
import shutil

from .children import Child

log = logging.getLogger("uvicorn.error")
# error_log lines: "2026/10/23 12:00:00 [warn] 12#12: …"
_PROBLEM = re.compile(r"\[(warn|error|crit|alert|emerg)\]")


class Nginx(Child):
    name = "nginx"
    missing = "not found: the app is not served (set VIDEONINJA_NGINX_BIN)"

    def __init__(self, config: str) -> None:
        super().__init__(os.environ.get("VIDEONINJA_NGINX_BIN") or shutil.which("nginx"))
        self.config = config

    def command(self) -> list[str]:
        # -e: the error log before the configuration is read (it then logs to stderr too).
        return [self.binary, "-c", self.config, "-e", "stderr", "-g", "daemon off;"]

    def log_line(self, line: str) -> None:
        if _PROBLEM.search(line):
            log.warning("nginx: %s", line)
        else:
            log.info("nginx: %s", line)  # access log


process: Nginx | None = None


def start() -> None:
    """At app startup, also before the setup (nginx serves the setup wizard)."""
    global process
    config = os.environ.get("VIDEONINJA_NGINX_CONF")
    if not config or os.environ.get("VIDEONINJA_NGINX", "1") == "0":
        return
    process = Nginx(config)
    process.start()


def stop() -> None:
    if process:
        process.stop()
