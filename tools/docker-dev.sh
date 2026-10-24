#!/usr/bin/env bash
# Build the production image from this checkout and run it locally
# (docker-compose.dev.yaml) on the development backend's data in server/:
# dev.db, dev.key, catalog/, media/, uploads/.
#
#   tools/docker-dev.sh              build, then run in the foreground (Ctrl+C stops)
#   tools/docker-dev.sh up -d        any other "docker compose" arguments
#   tools/docker-dev.sh logs server | grep "Setup token"
#   tools/docker-dev.sh down         stop and remove the container (the data stays)
#
# Needs Docker with the Compose plugin (and sudo if your user is not in the
# docker group: sudo tools/docker-dev.sh).
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

# The container runs as the owner of server/: it reads dev.key (not
# world-readable) and its new files stay yours.
export VIDEONINJA_UID=${owner%:*} VIDEONINJA_GID=${owner#*:}

(($#)) || set -- up --build
exec docker compose -f "$root/docker-compose.dev.yaml" "$@"
