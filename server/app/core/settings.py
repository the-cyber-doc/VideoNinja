"""Every setting of the API and the encoder, read from the environment in one place,
typed and checked: `current()`. A wrong value refuses the start, every wrong one
named at once (RuntimeError). The README's table documents each variable.

Not here: the encryption key itself, VIDEONINJA_DB_KEY (crypto.py reads it once and
removes it from the environment: it must never sit in an object that could be
logged or shown).

Parsed once per distinct environment: production reads it at startup and keeps it;
tests change variables (monkeypatch.setenv) and get the new values.
"""

import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

# The ffmpeg demuxers an upload may use (VIDEONINJA_INPUT_FORMATS) → their files'
# extensions (lower case, without the dot).
INPUT_FORMATS = {
    "mov": ("mp4", "mov", "m4v", "3gp", "3g2"),  # phones, cameras, encode-videos.sh
    "matroska": ("mkv", "webm"),
    "avi": ("avi",),
    "mpegts": ("mts", "m2ts", "ts"),  # AVCHD camcorders
    "mpeg": ("mpg", "mpeg", "vob"),  # MPEG-PS, DVDs
    "dv": ("dv",),
    "asf": ("wmv", "asf"),
}
X265_PRESETS = (
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
    "placebo",
)
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")
LOG_FORMATS = ("text", "json")
DEFAULT_DB = "/data/videoninja.db"
DEFAULT_KEY_FILE = "/run/secrets/videoninja_key"
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024**3
DEFAULT_SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "encode-videos" / "encode-videos.sh"
_BASE_PATH = re.compile(r"(/[A-Za-z0-9._~-]+)*")


@dataclass(frozen=True)
class Settings:
    # Files and folders (the folders default to next to the database)
    db: Path  # VIDEONINJA_DB; its existence means "set up"
    key_file: Path  # VIDEONINJA_DB_KEY_FILE
    catalog_dir: Path  # VIDEONINJA_CATALOG_DIR: catalogue snapshots
    upload_dir: Path  # VIDEONINJA_UPLOAD_DIR: tusd's folder
    media_dir: Path  # VIDEONINJA_MEDIA_DIR: video/<h2>/<sha256>/…
    # Where the app is seen, and the other containers
    base_path: str  # VIDEONINJA_BASE_PATH: "" or e.g. "/videoninja"
    x_accel: bool  # VIDEONINJA_X_ACCEL=1: behind nginx, files sent by X-Accel-Redirect
    tusd_url: str | None  # VIDEONINJA_TUSD_URL: tusd in its own container
    api_url: str | None  # VIDEONINJA_API_URL: the encoder in its own container
    # What the API runs itself (development): tusd as a child, the encoder as a thread
    run_tusd: bool  # VIDEONINJA_TUSD (0: off)
    run_encoder: bool  # VIDEONINJA_ENCODER (0: off)
    tusd_bin: str | None  # VIDEONINJA_TUSD_BIN (else tusd on the PATH)
    tusd_host: str  # VIDEONINJA_TUSD_HOST
    tusd_port: int  # VIDEONINJA_TUSD_PORT
    app_port: int  # VIDEONINJA_APP_PORT: where tusd's hooks call the app
    # Uploads and encoding
    max_upload_bytes: int  # VIDEONINJA_MAX_UPLOAD_BYTES
    input_formats: tuple[str, ...]  # VIDEONINJA_INPUT_FORMATS: keys of INPUT_FORMATS
    encode_script: Path  # VIDEONINJA_ENCODE_SCRIPT
    x265_preset: str  # VIDEONINJA_X265_PRESET
    ffmpeg_timeout_s: float  # VIDEONINJA_FFMPEG_TIMEOUT_H, in seconds
    ffprobe_timeout_s: float  # VIDEONINJA_FFPROBE_TIMEOUT_MIN, in seconds
    # Requests, logs, time
    argon2_concurrency: int  # VIDEONINJA_ARGON2_CONCURRENCY
    log_level: str  # VIDEONINJA_LOG_LEVEL
    log_format: str  # VIDEONINJA_LOG_FORMAT
    time_zone: str | None  # TZ: an IANA name (clock.py; unusable: the system's)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """RuntimeError naming every wrong variable."""
        read = _Reader(env)
        db = Path(read.text("VIDEONINJA_DB") or DEFAULT_DB)
        settings = cls(
            db=db,
            key_file=Path(read.text("VIDEONINJA_DB_KEY_FILE") or DEFAULT_KEY_FILE),
            catalog_dir=read.folder("VIDEONINJA_CATALOG_DIR", db.parent / "catalog"),
            upload_dir=read.folder("VIDEONINJA_UPLOAD_DIR", db.parent / "uploads"),
            media_dir=read.folder("VIDEONINJA_MEDIA_DIR", db.parent / "media"),
            base_path=read.base_path("VIDEONINJA_BASE_PATH"),
            x_accel=read.text("VIDEONINJA_X_ACCEL") == "1",
            tusd_url=read.url("VIDEONINJA_TUSD_URL"),
            api_url=read.url("VIDEONINJA_API_URL"),
            run_tusd=read.text("VIDEONINJA_TUSD") != "0",
            run_encoder=read.text("VIDEONINJA_ENCODER") != "0",
            tusd_bin=read.text("VIDEONINJA_TUSD_BIN"),
            tusd_host=read.text("VIDEONINJA_TUSD_HOST") or "127.0.0.1",
            tusd_port=read.port("VIDEONINJA_TUSD_PORT", 1080),
            app_port=read.port("VIDEONINJA_APP_PORT", 8000),
            max_upload_bytes=read.number(
                "VIDEONINJA_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES, int, "must be a positive number of bytes"
            ),
            input_formats=read.formats("VIDEONINJA_INPUT_FORMATS"),
            encode_script=Path(read.text("VIDEONINJA_ENCODE_SCRIPT") or DEFAULT_SCRIPT),
            x265_preset=read.choice("VIDEONINJA_X265_PRESET", "medium", X265_PRESETS, str.lower),
            ffmpeg_timeout_s=read.number(
                "VIDEONINJA_FFMPEG_TIMEOUT_H", 24.0, float, "must be a positive number of hours"
            )
            * 3600,
            ffprobe_timeout_s=read.number(
                "VIDEONINJA_FFPROBE_TIMEOUT_MIN", 10.0, float, "must be a positive number of minutes"
            )
            * 60,
            argon2_concurrency=read.number(
                "VIDEONINJA_ARGON2_CONCURRENCY", 2, int, "must be a positive number of password checks"
            ),
            log_level=read.choice("VIDEONINJA_LOG_LEVEL", "INFO", LOG_LEVELS, str.upper),
            log_format=read.choice("VIDEONINJA_LOG_FORMAT", "text", LOG_FORMATS, str.lower),
            time_zone=read.text("TZ"),
        )
        if read.errors:
            raise RuntimeError("Wrong settings:\n" + "\n".join(read.errors))
        return settings


class _Reader:
    """Reads the variables, collecting the errors (a placeholder value is returned)."""

    def __init__(self, env: Mapping[str, str]) -> None:
        self.env = env
        self.errors: list[str] = []

    def _wrong(self, name: str, value: str, must: str) -> None:
        self.errors.append(f"{name}={value!r}: {must}")

    def text(self, name: str) -> str | None:
        """The value, None if unset or empty."""
        return self.env.get(name) or None

    def folder(self, name: str, default: Path) -> Path:
        value = self.text(name)
        return Path(value) if value else default

    def base_path(self, name: str) -> str:
        """Where the browser sees the app, e.g. "/videoninja" ("": the domain's root)."""
        value = (self.text(name) or "").rstrip("/")
        if not _BASE_PATH.fullmatch(value):
            self._wrong(name, value, "must look like /videoninja")
        return value

    def url(self, name: str) -> str | None:
        """Another container's address, without a trailing slash. http(s) only: urllib
        would also open file: or ftp: URLs."""
        value = self.text(name)
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            self._wrong(name, value, "must be an http(s) URL, e.g. http://api:8000")
        return value.rstrip("/")

    def number[N: (int, float)](self, name: str, default: N, kind: Callable[[str], N], must: str) -> N:
        value = self.env.get(name)  # set but empty: wrong, not the default
        if value is None:
            return default
        try:
            number = kind(value.strip())
        except ValueError:
            number = kind("0")
        if not number > 0:
            self._wrong(name, value, must)
            return default
        return number

    def port(self, name: str, default: int) -> int:
        number = self.number(name, default, int, "must be a port number, 1 to 65535")
        if number > 65535:
            self._wrong(name, str(number), "must be a port number, 1 to 65535")
            return default
        return number

    def choice(self, name: str, default: str, allowed: tuple[str, ...], normalise: Callable[[str], str]) -> str:
        """Case, spaces and quotes ignored."""
        raw = self.env.get(name, default)
        value = normalise(raw.strip().strip("\"'").strip())
        if value not in allowed:
            self._wrong(name, raw, f"must be one of {', '.join(allowed)}")
            return default
        return value

    def formats(self, name: str) -> tuple[str, ...]:
        raw = self.env.get(name, ",".join(INPUT_FORMATS))
        names = tuple(n.strip().lower() for n in raw.split(",") if n.strip())
        if not names or any(n not in INPUT_FORMATS for n in names):
            self._wrong(name, raw, f"must list some of {','.join(INPUT_FORMATS)}")
            return tuple(INPUT_FORMATS)
        return names


# The variables read (the cache's key). VIDEONINJA_DB_KEY is not one: crypto.py.
VARIABLES = (
    "VIDEONINJA_DB",
    "VIDEONINJA_DB_KEY_FILE",
    "VIDEONINJA_CATALOG_DIR",
    "VIDEONINJA_UPLOAD_DIR",
    "VIDEONINJA_MEDIA_DIR",
    "VIDEONINJA_BASE_PATH",
    "VIDEONINJA_X_ACCEL",
    "VIDEONINJA_TUSD_URL",
    "VIDEONINJA_API_URL",
    "VIDEONINJA_TUSD",
    "VIDEONINJA_ENCODER",
    "VIDEONINJA_TUSD_BIN",
    "VIDEONINJA_TUSD_HOST",
    "VIDEONINJA_TUSD_PORT",
    "VIDEONINJA_APP_PORT",
    "VIDEONINJA_MAX_UPLOAD_BYTES",
    "VIDEONINJA_INPUT_FORMATS",
    "VIDEONINJA_ENCODE_SCRIPT",
    "VIDEONINJA_X265_PRESET",
    "VIDEONINJA_FFMPEG_TIMEOUT_H",
    "VIDEONINJA_FFPROBE_TIMEOUT_MIN",
    "VIDEONINJA_ARGON2_CONCURRENCY",
    "VIDEONINJA_LOG_LEVEL",
    "VIDEONINJA_LOG_FORMAT",
    "TZ",
)
_cache: dict[tuple[str | None, ...], Settings] = {}


def current() -> Settings:
    """The settings of the current environment (RuntimeError if one is wrong)."""
    key = tuple(os.environ.get(name) for name in VARIABLES)
    settings = _cache.get(key)
    if settings is None:
        env = {name: value for name, value in zip(VARIABLES, key, strict=True) if value is not None}
        settings = Settings.from_env(env)
        if len(_cache) > 64:  # tests: many environments; production: one
            _cache.clear()
        _cache[key] = settings
    return settings
