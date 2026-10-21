#!/bin/sh
# Backend for the end-to-end tests: fresh database and key in frontend/.e2e/,
# output in .e2e/server.log (the tests read the setup token from it).
# PYTHON: interpreter with server/requirements.txt (default: server/.venv).
set -eu
port=$1
dir="$(pwd)/.e2e"
server="$(cd ../server && pwd)"
python=${PYTHON:-$server/.venv/bin/python}

rm -rf "$dir"
mkdir -p "$dir"
"$python" -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())" > "$dir/key"

cd "$server"
VIDEONINJA_DB="$dir/videoninja.db" VIDEONINJA_KEY_FILE="$dir/key" \
	exec "$python" -m uvicorn app.main:app --port "$port" > "$dir/server.log" 2>&1
