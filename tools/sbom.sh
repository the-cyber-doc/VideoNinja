#!/usr/bin/env bash
# SPDX SBOMs of the four images built from this checkout (tools/docker-dev.sh build)
# and of the sources (package-lock.json, requirements*.txt), into sbom/; with --scan,
# their known vulnerabilities too (Grype). The same as CI's weekly Security workflow.
#
#   tools/sbom.sh            sbom/videoninja-{nginx,api,encoder,tusd,sources}.spdx.json
#   tools/sbom.sh --scan     … and a vulnerability table per SBOM (sbom/*.vulns.txt)
#
# Syft and Grype run from their official images, pinned by digest (update both lines
# together with the versions). They read `docker save` archives, never the Docker
# socket, and write as you. Grype's vulnerability database is cached in
# ~/.cache/videoninja-grype-db (downloaded on the first --scan).
set -euo pipefail

SYFT=anchore/syft:v1.54.1@sha256:3eb5379ba7b409c3f4069b686110527af0c47df993fa5c10d13e7cf34f49b1aa
GRYPE=anchore/grype:v0.120.1@sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe

root=$(cd "$(dirname "$0")/.." && pwd)
scan=0
[[ ${1:-} == --scan ]] && scan=1
sudo=()
docker info >/dev/null 2>&1 || sudo=(sudo)
out="$root/sbom"
mkdir -p "$out"
work=$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/videoninja-sbom.XXXXXX")
trap 'rm -rf "$work"' EXIT
db="${XDG_CACHE_HOME:-$HOME/.cache}/videoninja-grype-db"
mkdir -p "$db"

run() {  # an analysis tool, as you, with only these folders
	# A writable /tmp: Grype downloads and updates its database through it (else it
	# fails on the first run and keeps the old database on the next ones).
	"${sudo[@]}" docker run --rm --tmpfs /tmp:mode=1777 --user "$(id -u):$(id -g)" -e HOME=/tmp \
		-e SYFT_CHECK_FOR_APP_UPDATE=false -e GRYPE_CHECK_FOR_APP_UPDATE=false -e GRYPE_DB_CACHE_DIR=/db \
		-v "$work:/in:ro" -v "$root:/src:ro" -v "$out:/out" -v "$db:/db" "$@"
}

for image in nginx api encoder tusd; do
	if ! "${sudo[@]}" docker image inspect "videoninja-$image:dev" >/dev/null 2>&1; then
		echo "videoninja-$image:dev not built: run tools/docker-dev.sh build first." >&2
		exit 1
	fi
	echo "SBOM of videoninja-$image …"
	"${sudo[@]}" docker save "videoninja-$image:dev" -o "$work/$image.tar"
	"${sudo[@]}" chmod a+r "$work/$image.tar"
	run "$SYFT" scan "docker-archive:/in/$image.tar" --source-name "videoninja-$image" \
		-o "spdx-json=/out/videoninja-$image.spdx.json"
	rm -f "$work/$image.tar"
done
echo "SBOM of the sources …"
run "$SYFT" scan dir:/src --source-name videoninja-sources \
	--exclude './frontend/node_modules/**' --exclude './server/.venv/**' --exclude './sbom/**' \
	-o spdx-json=/out/videoninja-sources.spdx.json

if ((scan)); then
	for sbom in "$out"/videoninja-*.spdx.json; do
		name=$(basename "$sbom" .spdx.json)
		echo "Vulnerabilities of $name …"
		run "$GRYPE" "sbom:/out/$name.spdx.json" -o table > "$out/$name.vulns.txt"
		grep -cE ' (Critical|High) ' "$out/$name.vulns.txt" | xargs printf '  critical or high: %s\n' || true
	done
fi
echo "Done: $out"
