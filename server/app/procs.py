"""The external tools the app runs (ffmpeg, ffprobe, encode-videos.sh, brotli, zopfli):
never left running, never left unreaped.

- Each runs in its own process group (session): stopping it stops what it started
  too (encode-videos.sh's ffmpeg).
- It dies with the app's process (setpriv --pdeathsig, util-linux): an encoder or
  API killed or crashed leaves no ffmpeg behind, encoding for hours.
- A time limit (VIDEONINJA_FFMPEG_TIMEOUT_H, default 24 h: the Pi is slow; ffprobe,
  which only reads headers: VIDEONINJA_FFPROBE_TIMEOUT_MIN, default 10 min), then
  SIGTERM to the group, SIGKILL after GRACE_S, and always a wait (no zombie).
- In the containers, tini is PID 1 and reaps whatever is re-parented to it.
"""

import os
import shutil
import signal
import subprocess  # this module's purpose (docstring)  # nosec B404
import tempfile
from collections.abc import Sequence

from . import settings

GRACE_S = 30


class Timeout(Exception):
    """The process ran longer than its time limit (it was stopped)."""


def _command(cmd: Sequence[str]) -> list[str]:
    setpriv = shutil.which("setpriv")
    return [setpriv, "--pdeathsig", "KILL", "--", *cmd] if setpriv else list(cmd)


def popen(cmd: Sequence[str], **kwargs) -> subprocess.Popen:
    """Start cmd in its own process group, killed if the app's process dies.
    The caller must end with stop() (also after a normal exit)."""
    # An argument list (no shell) built by the app, never from a request.
    return subprocess.Popen(_command(cmd), start_new_session=True, **kwargs)  # nosec B603


def stop(process: subprocess.Popen) -> None:
    """Stop the process and everything left in its group, and reap it."""
    if process.poll() is None:
        _signal_group(process, signal.SIGTERM)
        try:
            process.wait(GRACE_S)
        except subprocess.TimeoutExpired:
            _signal_group(process, signal.SIGKILL)
            process.wait()
    # Its children may outlive it (re-parented to PID 1): the group still exists
    # then, and its ID cannot be reused while it does.
    _signal_group(process, signal.SIGKILL)


def _signal_group(process: subprocess.Popen, sig: int) -> None:
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


def run(cmd: Sequence[str], timeout: float | None = None) -> subprocess.CompletedProcess:
    """Run to the end and capture its output (text). Timeout (default: the settings'
    ffprobe_timeout_s for ffprobe, else ffmpeg_timeout_s)
    raises Timeout, the process group stopped. The output goes through temporary
    files, not pipes: a child left behind holding a pipe would keep run() waiting."""
    if timeout is None:
        limits = settings.current()
        timeout = limits.ffprobe_timeout_s if os.path.basename(cmd[0]) == "ffprobe" else limits.ffmpeg_timeout_s
    limit = timeout
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        process = popen(cmd, stdout=out, stderr=err)
        try:
            process.wait(limit)
        except subprocess.TimeoutExpired:
            raise Timeout(f"{cmd[0]} stopped after {_duration(limit)}") from None
        finally:
            stop(process)
        out.seek(0)
        err.seek(0)
        return subprocess.CompletedProcess(list(cmd), process.returncode, _text(out.read()), _text(err.read()))


def _duration(seconds: float) -> str:
    return f"{seconds / 3600:g} h" if seconds >= 3600 else f"{seconds / 60:g} min"


def _text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")
