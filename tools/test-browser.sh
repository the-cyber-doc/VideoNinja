#!/usr/bin/env bash
# Run the browser tests (every project: Chromium, WebKit, PWA, e2e, subpath)
# with the browsers in Playwright's own Docker image: also where Playwright's
# WebKit cannot start (e.g. Ubuntu 25.10: it is built for Ubuntu 24.04 and needs
# libicu74 and libxml2.so.2), and with the same browsers and system libraries as
# CI's. The tests, the preview servers and the test backend run here as usual,
# and connect to them (PW_TEST_CONNECT_WS_ENDPOINT).
#
#   tools/test-browser.sh                               every browser test, once
#   tools/test-browser.sh --project=webkit              any playwright test arguments
#   tools/test-browser.sh tests/mocked/login.spec.ts -g "TOTP"
#
# Run it as yourself, not with sudo (the build and test files would belong to
# root): it uses "sudo docker" by itself if your user cannot reach Docker.
# The image's version is the installed @playwright/test's: they must match.
# PW_PORT: the browser server's port on localhost (default 3123).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
frontend="$root/frontend"
port=${PW_PORT:-3123}
name="videoninja-browsers-$$"

if ((EUID == 0)); then
	echo "Run tools/test-browser.sh as yourself, not as root (it calls sudo docker itself)." >&2
	exit 1
fi
version=$(cd "$frontend" && node -p "require('@playwright/test/package.json').version" 2>/dev/null) || {
	echo "@playwright/test not installed: run npm ci in frontend/ first." >&2
	exit 1
}
docker=(docker)
docker info >/dev/null 2>&1 || docker=(sudo docker)

# The browser server, on this host's network: it reaches https://localhost:4183
# like a local browser would. Stopped on exit, whatever happens.
# --unsafe: the projects' browser arguments are passed on (pwa and subpath need
# --ignore-certificate-errors: Chrome registers no service worker with the
# preview's self-signed certificate otherwise). Acceptable here: the server
# listens on 127.0.0.1 only, lives for this run, and what a client asks for runs
# in the container.
"${docker[@]}" run -d --rm --name "$name" --network host --init --ipc=host \
	"mcr.microsoft.com/playwright:v$version-noble" \
	npx -y "playwright@$version" run-server --unsafe --port "$port" --host 127.0.0.1 >/dev/null
trap '"${docker[@]}" stop "$name" >/dev/null 2>&1 || true' EXIT

echo "Browsers of Playwright $version in Docker, on ws://127.0.0.1:$port/ …"
for _ in $(seq 1 90); do
	"${docker[@]}" logs "$name" 2>&1 | grep -q "Listening on" && break
	if ! "${docker[@]}" inspect "$name" >/dev/null 2>&1; then
		echo "The browser server stopped:" >&2
		exit 1
	fi
	sleep 1
done
"${docker[@]}" logs "$name" 2>&1 | grep -q "Listening on" || {
	echo "The browser server did not start within 90 s." >&2
	exit 1
}

cd "$frontend"
PW_TEST_CONNECT_WS_ENDPOINT="ws://127.0.0.1:$port/" npx playwright test "$@"
