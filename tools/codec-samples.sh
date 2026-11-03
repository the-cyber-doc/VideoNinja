#!/usr/bin/env bash
# The sample clips of the "Test local codecs" page (/upload/codecs): 4 s, 640x360,
# 30 fps (120 frames), a test pattern and a 440 Hz tone, in the common video/audio pairs,
# so every device decodes and encodes the same real files. Written to
# frontend/static/format-samples/ (served with the app's static files, public: test
# patterns only; left out of the service worker's precache). Needs an ffmpeg with libx264,
# libx265, libvpx, libaom, libopus, libvorbis (e.g. Ubuntu's). The files are committed;
# run this again after changing a format, and update SAMPLES in
# frontend/src/lib/codecs/samples.ts to match.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/frontend/static/format-samples"
mkdir -p "$out"

src=(-f lavfi -i "testsrc2=size=640x360:rate=30:duration=4" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=4")
common=(-map 0:v -map 1:a -ac 2 -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -g 30 -y)

encode() { # name, then the codec options
	local name=$1
	shift
	ffmpeg -hide_banner -loglevel error "${src[@]}" "${common[@]}" "$@" "$out/$name"
	printf '%-26s %6s KB\n' "$name" "$(($(stat -c %s "$out/$name") / 1024))"
}

encode h264-aac.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 28 -c:a aac -b:a 96k -movflags +faststart
encode h265-aac.mp4 -c:v libx265 -tag:v hvc1 -profile:v main -pix_fmt yuv420p -crf 30 -x265-params log-level=error \
	-c:a aac -b:a 96k -movflags +faststart
encode h265-10bit-aac.mp4 -c:v libx265 -tag:v hvc1 -profile:v main10 -pix_fmt yuv420p10le -crf 30 \
	-x265-params log-level=error -c:a aac -b:a 96k -movflags +faststart
encode vp8-vorbis.webm -c:v libvpx -b:v 400k -c:a libvorbis -q:a 3
encode vp9-opus.webm -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -c:a libopus -b:a 96k
encode av1-opus.webm -c:v libaom-av1 -crf 40 -cpu-used 8 -row-mt 1 -c:a libopus -b:a 96k
encode av1-opus.mp4 -c:v libaom-av1 -crf 40 -cpu-used 8 -row-mt 1 -c:a libopus -b:a 96k -movflags +faststart
