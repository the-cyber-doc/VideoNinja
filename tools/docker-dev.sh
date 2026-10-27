#!/usr/bin/env bash
# Build the production images (nginx, api, encoder, tusd) from this checkout and
# run them locally (docker-compose.dev.yaml) on the development backend's data
# in server/: dev.db, dev.key, catalog/, media/, uploads/.
#
#   tools/docker-dev.sh              build, then run in the foreground (Ctrl+C stops)
#   tools/docker-dev.sh up -d        any other "docker compose" arguments
#   tools/docker-dev.sh logs api | grep "Setup token"
#   tools/docker-dev.sh ps           the containers and their health
#   tools/docker-dev.sh down         stop and remove the containers (the data stays)
#
# Needs Docker with the Compose plugin (and sudo if your user is not in the
# docker group: sudo tools/docker-dev.sh), logged in to Docker Hardened Images
# once, as the same user: (sudo) docker login dhi.io (a free Docker account).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
server="$root/server"
[[ -f $server/dev.key ]] || {
	echo "No development key: $server/dev.key (README: Development, step 2)" >&2
	exit 1
}

# Missing folders would be created by Docker, owned by root: created here, as you.
# (Under sudo: as the owner of server/.)
owner=$(stat -c %u:%g "$server")
for dir in catalog media uploads; do
	[[ -d $server/$dir ]] || install -d -m 750 -o "${owner%:*}" -g "${owner#*:}" "$server/$dir"
done

# The containers run as the owner of server/: the API reads dev.key (not
# world-readable) and their new files stay yours.
export VIDEONINJA_UID=${owner%:*} VIDEONINJA_GID=${owner#*:}

# Shown on the About page (no .git in the image's build context).
commit=$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo unknown)
[[ -z $(git -C "$root" status --porcelain 2>/dev/null) ]] || commit+=-dirty
export APP_COMMIT=$commit

(($#)) || set -- up --build
exec docker compose -f "$root/docker-compose.dev.yaml" "$@"
