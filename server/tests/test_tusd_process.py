"""The tusd child process: command line, restart when it stops, stop with the app."""

import time

from app.domain import tusd


def stub(tmp_path, exit_code=None):
    """A fake tusd binary that records its arguments, then sleeps or exits."""
    script = tmp_path / "tusd"
    calls = tmp_path / "calls"
    script.write_text(
        "#!/bin/sh\n"
        f'echo "$@" >> "{calls}"\n'
        'echo "level=WARN event=Something message=hello"\n'
        + (f"exit {exit_code}\n" if exit_code is not None else "exec sleep 60\n")
    )
    script.chmod(0o755)
    return script, calls


def wait_for(condition, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.05)
    return False


def test_command_line(tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", "/bin/tusd")
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "up"))
    monkeypatch.setenv("VIDEONINJA_MAX_UPLOAD_BYTES", str(1024**3))
    cmd = tusd.Tusd().command()
    assert cmd[0] == "/bin/tusd"
    # Pairs up to the first flag without a value (-behind-proxy…): enough for -host and -port.
    args = dict(zip(cmd[1::2], cmd[2::2], strict=False))
    assert args["-host"] == "127.0.0.1" and args["-port"] == "1080"
    assert args["-upload-dir"] == str(tmp_path / "up") and args["-max-size"] == str(1024**3)
    assert args["-hooks-http"] == "http://127.0.0.1:8000/internal/tusd-hook"
    assert "-disable-download" in cmd and "-behind-proxy" in cmd


def test_runs_and_stops(tmp_path, monkeypatch):
    script, calls = stub(tmp_path)
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", str(script))
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "up"))
    process = tusd.Tusd()
    process.start()
    try:
        assert wait_for(lambda: calls.exists())
        assert (tmp_path / "up").is_dir()
    finally:
        process.stop()
    assert process.process.poll() is not None  # stopped
    assert not process.thread.is_alive()


def test_restarted_when_it_exits(tmp_path, monkeypatch):
    script, calls = stub(tmp_path, exit_code=1)
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", str(script))
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "up"))
    process = tusd.Tusd()
    process.start()
    try:
        assert wait_for(lambda: calls.exists() and len(calls.read_text().splitlines()) >= 2)  # 1 s backoff
    finally:
        process.stop()


def test_not_started_without_binary(monkeypatch, caplog):
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", "")
    monkeypatch.setenv("PATH", "/nonexistent")
    process = tusd.Tusd()
    process.start()
    assert process.thread is None
    assert "tusd not found" in caplog.text


def test_available(client, admin_secret, tmp_path, monkeypatch):
    from .test_auth import login

    login(client, admin_secret)
    # Run elsewhere (tests, a separate tusd): assumed up.
    assert client.get("/api/uploads/available").json() == {"available": True}

    monkeypatch.setenv("VIDEONINJA_TUSD", "1")
    monkeypatch.setattr(tusd, "process", tusd.Tusd())  # not started: binary missing, as in dev
    assert client.get("/api/uploads/available").json() == {"available": False}

    script, _calls = stub(tmp_path)
    monkeypatch.setenv("VIDEONINJA_TUSD_BIN", str(script))
    monkeypatch.setenv("VIDEONINJA_UPLOAD_DIR", str(tmp_path / "up"))
    running = tusd.Tusd()
    monkeypatch.setattr(tusd, "process", running)
    running.start()
    try:
        assert wait_for(lambda: tusd.available())
        assert client.get("/api/uploads/available").json() == {"available": True}
    finally:
        running.stop()
    assert client.get("/api/uploads/available").json() == {"available": False}
