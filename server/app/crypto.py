"""Encryption at rest for secrets the server must read back (TOTP secrets).

Format: "v1:<nonce>:<ciphertext+tag>" (base64url), AES-256-GCM. The "v1" prefix
names the key version, so the key can be rotated later. The caller passes
associated data (e.g. the user ID) so a ciphertext copied to another row fails.

The key is 32 random bytes, base64, in a file kept apart from the database
(a Docker secret in production). Without it the app does not start.
"""

import base64
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DEFAULT_KEY_FILE = "/run/secrets/videoninja_key"
VERSION = "v1"

_aead: AESGCM | None = None


def key_file() -> Path:
    return Path(os.environ.get("VIDEONINJA_KEY_FILE", DEFAULT_KEY_FILE))


def load_key() -> None:
    """Read the key file. Raises RuntimeError with a clear message if missing or invalid."""
    global _aead
    path = key_file()
    try:
        key = base64.b64decode(path.read_text(encoding="utf-8").strip(), validate=True)
    except FileNotFoundError:
        raise RuntimeError(
            f"Encryption key file not found: {path} (README: Development step 2, Production step 1)"
        ) from None
    except ValueError:
        raise RuntimeError(f"Encryption key file is not valid base64: {path}") from None
    if len(key) != 32:
        raise RuntimeError(f"Encryption key must be 32 bytes, got {len(key)}: {path}")
    _aead = AESGCM(key)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode()


def _cipher() -> AESGCM:
    if _aead is None:
        raise RuntimeError("Encryption key not loaded")
    return _aead


def encrypt(plaintext: str, associated_data: str) -> str:
    nonce = secrets.token_bytes(12)
    ct = _cipher().encrypt(nonce, plaintext.encode(), associated_data.encode())
    return f"{VERSION}:{_b64(nonce)}:{_b64(ct)}"


def decrypt(token: str, associated_data: str) -> str:
    """Raises cryptography.exceptions.InvalidTag if tampered with or on the wrong row."""
    version, nonce, ct = token.split(":")
    if version != VERSION:
        raise ValueError(f"Unknown encryption version {version!r}")
    plain = _cipher().decrypt(base64.urlsafe_b64decode(nonce), base64.urlsafe_b64decode(ct), associated_data.encode())
    return plain.decode()


def totp_aad(user_id: int) -> str:
    """Associated data for user.totp: binds the ciphertext to its row and purpose."""
    return f"user:{user_id}:totp"
