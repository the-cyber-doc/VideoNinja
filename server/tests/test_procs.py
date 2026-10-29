"""procs: external tools never left running, never left unreaped."""

import os
import re
import subprocess
import sys
import time

import pytest

from app.core import procs, settings


def gone(pid: int, timeout=5.0) -> bool:
    """The process no longer exists (killed and reaped by its parent or by init)."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.05)
    return False


def test_output_and_exit_code():
    result = procs.run(["sh", "-c", "echo out; echo err >&2; exit 3"])
    assert (result.returncode, result.stdout, result.stderr) == (3, "out\n", "err\n")


def test_time_limit_stops_the_whole_group(tmp_path):
    """Like encode-videos.sh waiting for its ffmpeg: both go."""
    pid_file = tmp_path / "child"
    with pytest.raises(procs.Timeout, match="stopped after"):
        procs.run(["bash", "-c", f"sleep 60 & echo $! > {pid_file}; wait"], timeout=0.5)
    assert gone(int(pid_file.read_text()))


def test_children_left_behind_are_stopped(tmp_path):
    """A tool that exits leaving a child running (re-parented to init): stopped too."""
    pid_file = tmp_path / "child"
    procs.run(["bash", "-c", f"sleep 60 & echo $! > {pid_file}"])
    assert gone(int(pid_file.read_text()))


def test_dies_with_the_app(tmp_path):
    """The worker is killed (SIGKILL: no clean-up of its own): its ffmpeg is not left
    running for hours (setpriv --pdeathsig)."""
    if procs.shutil.which("setpriv") is None:
        pytest.skip("setpriv (util-linux) missing")
    pid_file = tmp_path / "child"
    worker = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import time; from app.core import procs\n"
                f"p = procs.popen(['sleep', '60']); open({str(pid_file)!r}, 'w').write(str(p.pid)); time.sleep(60)"
            ),
        ]
    )
    for _ in range(100):
        if pid_file.exists() and pid_file.read_text():
            break
        time.sleep(0.05)
    child = int(pid_file.read_text())  # setpriv, which became sleep (exec)
    worker.kill()
    worker.wait()
    assert gone(child)


def test_stop_reaps(tmp_path):
    process = procs.popen(["sleep", "60"])
    procs.stop(process)
    assert process.returncode is not None  # reaped: no zombie


@pytest.mark.parametrize("value, seconds", [("24", 86400), ("0.5", 1800)])
def test_time_limit_setting(monkeypatch, value, seconds):
    monkeypatch.setenv("VIDEONINJA_FFMPEG_TIMEOUT_H", value)
    assert settings.current().ffmpeg_timeout_s == seconds


@pytest.mark.parametrize("value", ["0", "-1", "a day", ""])
def test_invalid_time_limit_refuses_start(monkeypatch, value):
    monkeypatch.setenv("VIDEONINJA_FFMPEG_TIMEOUT_H", value)
    with pytest.raises(RuntimeError, match="VIDEONINJA_FFMPEG_TIMEOUT_H"):
        settings.current()


def test_no_zombie_after_many_runs():
    for _ in range(20):
        procs.run(["true"])
    out = subprocess.run(["ps", "-o", "stat=", "--ppid", str(os.getpid())], capture_output=True, text=True).stdout
    assert "Z" not in out


def test_ffprobe_has_its_own_shorter_limit(tmp_path, monkeypatch):
    """ffprobe only reads headers: 10 minutes by default, whatever the 24 h of ffmpeg."""
    monkeypatch.delenv("VIDEONINJA_FFPROBE_TIMEOUT_MIN", raising=False)
    assert settings.current().ffprobe_timeout_s == 600
    probe = tmp_path / "ffprobe"
    probe.write_text("#!/bin/sh\nexec sleep 60\n")
    probe.chmod(0o755)
    monkeypatch.setenv("VIDEONINJA_FFPROBE_TIMEOUT_MIN", "0.01")  # 0.6 s
    started = time.monotonic()
    with pytest.raises(procs.Timeout, match=re.escape("ffprobe stopped after 0.01 min")):
        procs.run([str(probe), "-v", "error"])
    assert time.monotonic() - started < 5


@pytest.mark.parametrize("value", ["0", "ten", ""])
def test_invalid_ffprobe_limit_refuses_start(monkeypatch, value):
    monkeypatch.setenv("VIDEONINJA_FFPROBE_TIMEOUT_MIN", value)
    with pytest.raises(RuntimeError, match="VIDEONINJA_FFPROBE_TIMEOUT_MIN"):
        settings.current()
