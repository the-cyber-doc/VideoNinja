"""Programs run by the app as child processes (tusd, nginx): restarted if they
stop (with a backoff), stopped with the app; their output goes to the app's log."""

import logging
import subprocess  # tusd in development: its own command line, no shell  # nosec B404
import threading
import time

log = logging.getLogger("uvicorn.error")


class Child:
    """Subclasses give name, binary (None: not found, not started), command()."""

    MAX_BACKOFF_S = 30
    name = "child"
    missing = "not found"  # logged when the binary is missing

    def __init__(self, binary: str | None) -> None:
        self.binary = binary
        self.stopping = threading.Event()
        self.process: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None

    def command(self) -> list[str]:
        raise NotImplementedError

    def prepare(self) -> None:
        """Before the first start (folders…)."""

    def log_line(self, line: str) -> None:
        log.debug("%s: %s", self.name, line)

    def start(self) -> None:
        if not self.binary:
            log.warning("%s %s", self.name, self.missing)
            return
        self.prepare()
        self.thread = threading.Thread(target=self.run, name=self.name, daemon=True)
        self.thread.start()

    def run(self) -> None:
        backoff = 1.0
        while not self.stopping.is_set():
            started = time.monotonic()
            self.process = subprocess.Popen(  # command(): the app's argument list  # nosec B603
                self.command(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
            )
            log.info("%s started (pid %s)", self.name, self.process.pid)
            for line in self.process.stdout:  # until it exits
                self.log_line(line.rstrip())
            code = self.process.wait()
            if self.stopping.is_set():
                break
            if time.monotonic() - started > 60:
                backoff = 1.0  # it had been running fine: restart at once
            log.warning("%s exited (code %s), restarting in %.0f s", self.name, code, backoff)
            self.stopping.wait(backoff)
            backoff = min(backoff * 2, self.MAX_BACKOFF_S)

    def stop(self) -> None:
        self.stopping.set()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.thread:
            self.thread.join(timeout=15)

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None
