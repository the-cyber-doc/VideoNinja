#!/usr/bin/env bash
# The e2e tests against the real containers (nginx, api, encoder, tusd), then
# tests/stack (an upload through tusd and the encoder, served by nginx). On a
# throwaway instance: empty database, folders and key in a temporary folder,
# deleted at the end with the containers. Never your development data, never a
# real installation (the tests create users and change their passwords).
#
#   tools/test-e2e-stack.sh                  images built from this checkout
#   tools/test-e2e-stack.sh --images 1.2.3   the published images of a release
#                                            (thecyberdoc/videoninja-*:1.2.3)
#   tools/test-e2e-stack.sh -- -g "comments" any playwright test arguments, after --
#
# Run it as yourself, not with sudo (the test files would belong to root): it
# uses "sudo docker" by itself if your user cannot reach Docker. Building needs
# `docker login dhi.io` once (README, Docker images). The browsers run in
# Playwright's Docker image (tools/test-browser.sh). Port 8080 must be free:
# stop tools/docker-dev.sh first.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
images=""
while (($#)); do
	case $1 in
		--images) images=${2:?--images needs a version, e.g. 1.2.3}; shift 2 ;;
		--) shift; break ;;
		*) echo "Unknown option $1 (playwright arguments go after --)" >&2; exit 2 ;;
	esac
done

if ((EUID == 0)); then
	echo "Run tools/test-e2e-stack.sh as yourself, not as root (it calls sudo docker itself)." >&2
	exit 1
fi
sudo=()
docker info >/dev/null 2>&1 || sudo=(sudo)
if (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then
	echo "Port 8080 is in use (tools/docker-dev.sh still running?): stop it first." >&2
	exit 1
fi

# The instance's data: an empty folder per volume, a new key, no database (setup mode).
# Not in /tmp: often a small RAM disk, and uploads and encodings fill it.
cache=${XDG_CACHE_HOME:-$HOME/.cache}
mkdir -p "$cache"
work=$(mktemp -d "$cache/videoninja-e2e.XXXXXX")
mkdir -p "$work"/{data,catalog,media,uploads}
head -c 32 /dev/urandom | base64 > "$work/key"
chmod 600 "$work/key"

# The development compose file (the four containers, production settings) on that
# data, as a project of its own; --images: the published images instead of a build.
image() {
	[[ -z $images ]] || printf '    image: thecyberdoc/videoninja-%s:%s\n    pull_policy: always\n' "$1" "$images"
}
# Its own internal subnet (and nginx's address on it): the development stack's may exist.
cat > "$work/override.yaml" <<YAML
services:
  nginx:
$(image nginx)
    volumes: ["$work/catalog:/srv/catalog:ro", "$work/media:/srv/media:ro"]
    networks:
      backend: { ipv4_address: 172.30.83.10 }
  api:
$(image api)
    environment: { VIDEONINJA_DB: /data/videoninja.db, FORWARDED_ALLOW_IPS: 172.30.83.10 }
    volumes: ["$work/data:/data", "$work/key:/run/secrets/videoninja_key:ro", "$work/catalog:/srv/catalog"]
  encoder:
$(image encoder)
    environment: { VIDEONINJA_DB: /data/videoninja.db }
    volumes: ["$work/data:/data", "$work/media:/srv/media", "$work/uploads:/srv/uploads"]
  tusd:
$(image tusd)
    volumes: ["$work/uploads:/srv/uploads"]
networks:
  backend:
    ipam:
      config:
        - subnet: 172.30.83.0/24
YAML

# The containers run as you (the data folders are yours), as a project of their own.
run_compose() {
	"${sudo[@]}" env VIDEONINJA_UID="$(id -u)" VIDEONINJA_GID="$(id -g)" \
		APP_COMMIT="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
		docker compose -p videoninja-e2e -f "$root/docker-compose.dev.yaml" -f "$work/override.yaml" "$@"
}

cleanup() {
	run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT

if [[ -n $images ]]; then
	echo "Starting the published images $images …"
	run_compose up -d --no-build
else
	echo "Building and starting the images from this checkout …"
	run_compose up -d --build
fi

# Up when /health answers through nginx (200: before the setup, "not_set_up").
for _ in $(seq 1 90); do
	curl -sf -o /dev/null http://127.0.0.1:8080/videoninja/health && break
	sleep 1
done
curl -sf -o /dev/null http://127.0.0.1:8080/videoninja/health || {
	echo "The containers did not answer within 90 s:" >&2
	run_compose ps >&2
	exit 1
}
token=$(run_compose logs api 2>&1 | sed -n 's/.*Setup token: \([^ ]*\).*/\1/p' | tail -n 1)
[[ -n $token ]] || {
	echo "No setup token in the API's log." >&2
	exit 1
}

echo "Testing http://localhost:8080/videoninja/ …"
rm -f "$root/frontend/.e2e/admin.json"
E2E_BASE_URL=http://localhost:8080/videoninja/ E2E_SETUP_TOKEN=$token \
	"$root/tools/test-browser.sh" "$@" || {
	status=$?
	echo "Failed. The containers' last log lines:" >&2
	run_compose logs --tail 40 >&2 || true
	exit $status
}
