#!/usr/bin/env bash
# The API's types, from the backend to the frontend, after a change of an endpoint
# or a model (the tests and `npm run check` fail until it is run):
#   server/openapi.json                  python -m app.api.openapi (the app's schema)
#   frontend/src/lib/api/schema.d.ts     openapi-typescript (npm run api:types)
# Both are committed: review them with the change that made them.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
python=${PYTHON:-$root/server/.venv/bin/python}
(cd "$root/server" && "$python" -m app.api.openapi > openapi.json.tmp && mv openapi.json.tmp openapi.json)
(cd "$root/frontend" && npm run --silent api:types)
echo "Updated server/openapi.json and frontend/src/lib/api/schema.d.ts"
