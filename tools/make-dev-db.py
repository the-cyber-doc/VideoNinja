#!/usr/bin/env python3
"""Build a development database without the setup wizard: the latest
db_vN.sql + db_vN_init.sql (as the wizard does) and an admin user with the
fixed password and TOTP secret below, so every rebuild logs in the same way.

For development and test instances only: the credentials below are public.
Never use a database built with it in production.

Run with the backend's virtual environment, the app stopped:

    server/.venv/bin/python tools/make-dev-db.py             # server/dev.db, key server/dev.key
    server/.venv/bin/python tools/make-dev-db.py --force     # replace an existing server/dev.db
    server/.venv/bin/python tools/make-dev-db.py --db other.db --key other.key

The app rebuilds the catalogue snapshot at its next start.
"""

import argparse
import os
import re
import sys
from pathlib import Path

USERNAME = "admin"
PASSWORD = "XhvqKL3zKA7S"
TOTP_SECRET = "J3BFCBSLVAZSG3M7POCBI235XUL35XUQ"  # base32: add it to your authenticator once

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))


def fail(message: str) -> None:
    sys.exit(f"make-dev-db: {message}")


def check(name: str, value: str) -> None:
    """The app's own input rules (validation.json): the wizard would refuse anything else."""
    from app.validation import RULES

    rule = RULES[name]
    if not rule.get("min_length", 0) <= len(value) <= rule["max_length"] or not re.fullmatch(
        rule.get("pattern", ".*"), value
    ):
        fail(f"{name} {value!r} does not follow server/app/validation.json: {rule}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", type=Path, default=SERVER / "dev.db",
                        help="database to create (default: server/dev.db)")
    parser.add_argument("--key", type=Path, default=SERVER / "dev.key", help="encryption key (default: server/dev.key)")
    parser.add_argument("--force", action="store_true", help="replace an existing database")
    args = parser.parse_args()

    if not args.key.is_file():
        fail(f"no encryption key: {args.key} (README: Development, step 2)")
    # The key from this file only, whatever the environment says.
    os.environ.pop("VIDEONINJA_DB_KEY", None)
    os.environ["VIDEONINJA_DB_KEY_FILE"] = str(args.key.resolve())
    os.environ["VIDEONINJA_DB"] = str(args.db.resolve())

    from app import crypto, db, security

    try:
        crypto.load_key()
    except RuntimeError as e:
        fail(str(e))
    check("username", USERNAME)
    check("password", PASSWORD)
    check("totp_secret", TOTP_SECRET)

    if db.is_initialized():
        if not args.force:
            fail(f"{args.db} exists (--force replaces it; stop the app first)")
        for suffix in ("", "-wal", "-shm"):
            Path(f"{args.db}{suffix}").unlink(missing_ok=True)

    for step in db.create_database(USERNAME, USERNAME, security.hash_password(PASSWORD), TOTP_SECRET):
        print(f"  {step}")
    print(f"Created {args.db}: user {USERNAME!r}, password {PASSWORD!r}")
    print(f"TOTP: {security.totp_uri(TOTP_SECRET, USERNAME)}")


if __name__ == "__main__":
    main()
