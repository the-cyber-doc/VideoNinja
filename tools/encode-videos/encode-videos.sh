#!/usr/bin/env bash
# encode-videos.sh — Re-encode videos to MP4 (H.265 8-bit + AAC) for web playback.
#
#  - Encodes on the NVIDIA GPU (hevc_nvenc), with CUDA decoding
#  - Keeps the original dimensions (no scaling)
#  - Detects interlaced sources and deinterlaces them with NNEDI3 (nnedi filter)
#      * stream field_order metadata first, idet analysis when metadata is missing
#  - Detects HDR (HLG, PQ/HDR10, Dolby Vision) and tone-maps to SDR BT.709
#      * libplacebo (GPU via Vulkan, best quality) when available
#      * zscale + tonemap (CPU) as fallback, also used automatically if libplacebo fails
#  - Keyframe every second, every 0.5 s above 30 fps (precise cuts / nginx mp4 module, smooth seeking)
#  - hvc1 tag (Safari), faststart, metadata stripped (incl. GPS; -m keeps it)
#  - AAC audio: mono stays mono, more channels are downmixed to stereo
#  - Writes to a temporary file, then renames: no half-written outputs
#
# Usage: encode-videos.sh [options] <file|dir>...
#   Directories are scanned recursively; their structure is kept under the output dir.

set -Eeuo pipefail

# ---------- defaults ----------
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
OUT_DIR="./out"
CQ=26                 # quality: lower = better/bigger (NVENC -cq, x265 -crf)
PRESET="p6"           # NVENC preset p1 (fast) .. p7 (best)
AUDIO_BITRATE="128k"
GOP_SECONDS=auto       # keyframe interval: auto = 1 s up to 30 fps, 0.5 s above
TONEMAP="auto"        # auto | libplacebo | zscale
DEINT="auto"          # auto | on | off
DOUBLE_RATE=0         # 1 = one output frame per field (50/60p from 25/30i)
WEIGHTS=""            # nnedi3_weights.bin; default: next to script, then current dir
IDET_FRAMES=500       # frames analysed by idet when field order is unknown
FORCE=0
DRY_RUN=0
USE_CPU=0             # 1 = libx265 instead of NVENC (testing / no GPU)
X265_PRESET="medium"  # libx265 preset (-c): ultrafast .. placebo, slower = smaller
PROGRESS=""           # file for ffmpeg's -progress output (key=value, e.g. out_time_us)
KEEP_METADATA=0       # 1 = keep tags (GPS location, dates, device…) and chapters
FORMATS="mov,matroska,avi,mpegts,mpeg,dv,asf"  # ffmpeg demuxers allowed for inputs
TIME_LIMIT=0          # seconds per ffmpeg run, 0 = none
PROBE_LIMIT=0         # seconds per ffprobe run, 0 = none
EXTENSIONS="mov|mp4|m4v|mkv|avi|mts|m2ts|webm|3gp|mpg|mpeg|vob|ts|dv"

usage() {
  cat <<EOF
Usage: ${0##*/} [options] <file|dir>...

Options:
  -o DIR    Output directory (default: $OUT_DIR)
  -q N      Quality, lower = better (default: $CQ)
  -p PRESET NVENC preset p1..p7 (default: $PRESET)
  -g SEC    Keyframe interval in seconds, or auto: 1 s up to 30 fps, 0.5 s
            above (of the output: double-rate deinterlacing doubles it)
            (default: $GOP_SECONDS)
  -t MODE   HDR tone mapper: auto|libplacebo|zscale (default: $TONEMAP)
  -d MODE   Deinterlacing: auto|on|off (default: $DEINT)
  -2        Double-rate deinterlacing (one frame per field, smoother motion)
  -w FILE   NNEDI3 weights file (default: nnedi3_weights.bin next to the
            script, else in the current directory)
  -f        Overwrite existing outputs
  -n        Dry run: show detection and ffmpeg commands only
  -c        CPU encoding with libx265 (no NVIDIA GPU needed)
  -x PRESET libx265 preset with -c (default: $X265_PRESET)
  -P FILE   Write ffmpeg's progress (key=value lines, out_time_us…) to FILE
  -m        Keep the metadata (GPS location, dates, device, title…) and
            chapters; default: removed. Other streams are dropped either way.
  -W LIST   ffmpeg demuxers allowed for the inputs, comma-separated; files are
            read from local files only (default: $FORMATS)
  -T SEC    Stop any ffmpeg run after SEC seconds, 0 = never
            (default: $TIME_LIMIT)
  -L SEC    Stop any ffprobe run after SEC seconds, 0 = never
            (default: $PROBE_LIMIT)
  -h        Help
EOF
}

log()  { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

# ---------- options ----------
while getopts ":o:q:p:g:t:d:w:x:P:W:T:L:2fncmh" opt; do
  case $opt in
    o) OUT_DIR=$OPTARG ;;
    q) CQ=$OPTARG ;;
    p) PRESET=$OPTARG ;;
    g) GOP_SECONDS=$OPTARG ;;
    t) TONEMAP=$OPTARG ;;
    d) DEINT=$OPTARG ;;
    2) DOUBLE_RATE=1 ;;
    w) WEIGHTS=$OPTARG ;;
    f) FORCE=1 ;;
    n) DRY_RUN=1 ;;
    c) USE_CPU=1 ;;
    x) X265_PRESET=$OPTARG ;;
    P) PROGRESS=$OPTARG ;;
    m) KEEP_METADATA=1 ;;
    W) FORMATS=$OPTARG ;;
    T) TIME_LIMIT=$OPTARG ;;
    L) PROBE_LIMIT=$OPTARG ;;
    h) usage; exit 0 ;;
    :) die "Option -$OPTARG needs a value" ;;
    *) usage; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
(( $# > 0 )) || { usage; exit 2; }

[[ $CQ =~ ^[0-9]+$ ]]           || die "-q must be an integer"
[[ $GOP_SECONDS == auto || $GOP_SECONDS =~ ^[0-9.]+$ ]] || die "-g must be a number or auto"
[[ $TONEMAP =~ ^(auto|libplacebo|zscale)$ ]] || die "-t must be auto, libplacebo or zscale"
[[ $DEINT =~ ^(auto|on|off)$ ]]              || die "-d must be auto, on or off"
[[ $X265_PRESET =~ ^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|placebo)$ ]] \
  || die "-x must be a libx265 preset (ultrafast .. placebo)"
[[ $FORMATS =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]] || die "-W must be a comma-separated list of ffmpeg demuxers"
[[ $TIME_LIMIT =~ ^[0-9]+$ ]]   || die "-T must be a number of seconds"
[[ $PROBE_LIMIT =~ ^[0-9]+$ ]]  || die "-L must be a number of seconds"
DR_SUFFIX=""; (( DOUBLE_RATE )) && DR_SUFFIX=" double-rate"
# Every input: a local file in one of the allowed formats (no network, no playlists).
INPUT_OPTS=(-protocol_whitelist file -format_whitelist "$FORMATS")
# Every ffmpeg/ffprobe run on an input: with its time limit, if any (SIGTERM, then SIGKILL 30 s later).
limited() {
  local limit=$TIME_LIMIT
  [[ $1 == ffprobe ]] && limit=$PROBE_LIMIT
  if (( limit > 0 )); then timeout -k 30 "$limit" "$@"; else "$@"; fi
}

# ---------- dependency checks ----------
command -v ffmpeg  >/dev/null || die "ffmpeg not found"
command -v ffprobe >/dev/null || die "ffprobe not found"

ENCODERS=$(ffmpeg -hide_banner -encoders 2>/dev/null)
FILTERS=$(ffmpeg -hide_banner -filters 2>/dev/null | awk '{print $2}')
has_encoder() { grep -qw -- "$1" <<<"$ENCODERS"; }
has_filter()  { grep -qx -- "$1" <<<"$FILTERS"; }

if (( USE_CPU )); then
  has_encoder libx265 || die "libx265 encoder not available in this ffmpeg build"
  VENC=(-c:v libx265 -preset "$X265_PRESET" -crf "$CQ" -profile:v main -forced-idr 1 -x265-params log-level=error)
else
  has_encoder hevc_nvenc || die "hevc_nvenc not available (NVIDIA driver / ffmpeg build?). Use -c for CPU."
  VENC=(-c:v hevc_nvenc -preset "$PRESET" -tune hq -rc vbr -cq "$CQ" -b:v 0
        -profile:v main -forced-idr 1)
fi

HAS_LIBPLACEBO=0; has_filter libplacebo && HAS_LIBPLACEBO=1
HAS_ZSCALE=0;     { has_filter zscale && has_filter tonemap; } && HAS_ZSCALE=1

# Deinterlacer: nnedi filter + weights file (checked once, used only when needed)
DEINT_READY=0; DEINT_ERR=""
if [[ $DEINT != off ]]; then
  if ! has_filter nnedi; then
    DEINT_ERR="nnedi filter not in this ffmpeg build"
  else
    if [[ -z $WEIGHTS ]]; then
      for c in "$SCRIPT_DIR/nnedi3_weights.bin" "./nnedi3_weights.bin"; do
        [[ -f $c ]] && { WEIGHTS=$c; break; }
      done
    fi
    if [[ -z $WEIGHTS || ! -f $WEIGHTS ]]; then
      DEINT_ERR="weights file nnedi3_weights.bin not found (use -w)"
    else
      WEIGHTS=$(cd -- "$(dirname -- "$WEIGHTS")" && pwd -P)/$(basename -- "$WEIGHTS")
      [[ $WEIGHTS == *"'"* ]] && die "weights path must not contain a single quote: $WEIGHTS"
      DEINT_READY=1
    fi
  fi
  # Forced deinterlacing must work for every file: fail early
  [[ $DEINT == on && $DEINT_READY -eq 0 ]] && die "Deinterlacing forced (-d on) but $DEINT_ERR"
fi

# Ordered list of tone mappers to try for a given HDR type
tonemappers_for() {   # $1 = hlg | pq | dv
  local -a list=()
  case $TONEMAP in
    auto)       (( HAS_LIBPLACEBO )) && list+=(libplacebo)
                [[ $1 != dv ]] && (( HAS_ZSCALE )) && list+=(zscale) ;;
    libplacebo) (( HAS_LIBPLACEBO )) && list+=(libplacebo) ;;
    zscale)     [[ $1 != dv ]] && (( HAS_ZSCALE )) && list+=(zscale) ;;
  esac
  echo "${list[*]:-}"
}

# ---------- output dir ----------
mkdir -p -- "$OUT_DIR"
OUT_ABS=$(cd -- "$OUT_DIR" && pwd -P)

# ---------- interlace detection ----------
# Prints: progressive | tff | bff
detect_interlace() {   # $1 = file, $2 = field_order from ffprobe
  case $2 in
    tt|tb) echo tff; return ;;
    bb|bt) echo bff; return ;;
    progressive) echo progressive; return ;;
  esac
  # Unknown field order: analyse the content with idet
  local out tff bff prog
  out=$(limited ffmpeg -hide_banner -nostdin "${INPUT_OPTS[@]}" -i "file:$1" -map 0:v:0 -an -sn -dn \
          -frames:v "$IDET_FRAMES" -vf idet -f null - 2>&1 | grep 'Multi frame detection' | tail -n1) || true
  tff=$(sed -n 's/.*TFF: *\([0-9]*\).*/\1/p' <<<"$out"); tff=${tff:-0}
  bff=$(sed -n 's/.*BFF: *\([0-9]*\).*/\1/p' <<<"$out"); bff=${bff:-0}
  prog=$(sed -n 's/.*Progressive: *\([0-9]*\).*/\1/p' <<<"$out"); prog=${prog:-0}
  # Interlaced if interlaced frames clearly dominate progressive ones
  if (( tff + bff > prog )); then
    (( tff >= bff )) && echo tff || echo bff
  else
    echo progressive
  fi
}

# ---------- filters ----------
# $1 = sdr | zscale | libplacebo, $2 = input transfer (zscale), $3 = progressive|tff|bff|unknown
build_vf() {
  local -a f=()
  if [[ $3 != progressive ]]; then
    local field
    case $3 in
      tff) field=t ;;
      bff) field=b ;;
      *)   field=a ;;   # parity from frame flags
    esac
    # double rate: tf / bf / af = one output frame per field
    if (( DOUBLE_RATE )); then
      case $field in t) field=tf ;; b) field=bf ;; a) field=af ;; esac
    fi
    f+=("nnedi=weights='$WEIGHTS':deint=all:field=$field")
  fi
  # 4:2:0 needs even dimensions; no-op for normal sources
  f+=("crop=trunc(iw/2)*2:trunc(ih/2)*2")
  case $1 in
    sdr)
      f+=("format=yuv420p") ;;
    zscale)
      f+=("zscale=tin=$2:pin=bt2020:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p") ;;
    libplacebo)
      f+=("libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p") ;;
  esac
  local IFS=,; echo "${f[*]}"
}

# ---------- encode one file with a given mode ----------
run_encode() {   # in out mode tin interlace
  local in=$1 out=$2 mode=$3 tin=${4:-} il=${5:-progressive}
  local tmp="${out%.*}.part.mp4"
  local -a cmd=(limited ffmpeg -hide_banner -nostdin -loglevel error -stats -y)
  (( USE_CPU )) || cmd+=(-hwaccel cuda)
  [[ -n $PROGRESS ]] && cmd+=(-progress "file:$PROGRESS")
  cmd+=("${INPUT_OPTS[@]}" -i "file:$in" -map 0:v:0 -map '0:a:0?')
  if (( KEEP_METADATA )); then
    cmd+=(-map_metadata 0 -map_chapters 0)
  else
    # Global and stream tags, chapters, and ffmpeg's own encoder/handler strings.
    cmd+=(-map_metadata -1 -map_metadata:s -1 -map_chapters -1
          -fflags +bitexact -flags:v +bitexact -flags:a +bitexact)
  fi
  cmd+=(-vf "$(build_vf "$mode" "$tin" "$il")"
        "${VENC[@]}")
  [[ $mode != sdr ]] && cmd+=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
  cmd+=(-force_key_frames "expr:gte(t,n_forced*$gop)"
        -tag:v hvc1
        -c:a aac -b:a "$AUDIO_BITRATE" -af 'aformat=channel_layouts=mono|stereo'
        -movflags +faststart
        -f mp4 "file:$tmp")

  if (( DRY_RUN )); then
    printf '  '; printf '%q ' "${cmd[@]}"; echo
    return 0
  fi
  if "${cmd[@]}"; then
    mv -f -- "$tmp" "$out"
  else
    rm -f -- "$tmp"
    return 1
  fi
}

# ---------- process one file ----------
N_OK=0; N_SKIP=0; N_FAIL=0; N_HDR=0; N_DEINT=0

process_file() {   # in relative_path
  local in=$1 rel=$2
  local out="$OUT_ABS/${rel%.*}.mp4"
  mkdir -p -- "$(dirname -- "$out")"

  if [[ -e $out && $FORCE -eq 0 ]]; then
    log "SKIP (exists): $rel"; N_SKIP=$((N_SKIP + 1)); return 0
  fi

  local info trc pixfmt fo hdr="" tin="" il=progressive
  if ! info=$(limited ffprobe -v error "${INPUT_OPTS[@]}" -select_streams v:0 -show_streams \
                -of default=noprint_wrappers=1 "file:$in" 2>/dev/null) || [[ -z $info ]]; then
    log "FAIL (no video stream / unreadable): $rel"; N_FAIL=$((N_FAIL + 1)); return 0
  fi
  trc=$(sed -n 's/^color_transfer=//p' <<<"$info" | head -n1)
  pixfmt=$(sed -n 's/^pix_fmt=//p' <<<"$info" | head -n1)
  fo=$(sed -n 's/^field_order=//p' <<<"$info" | head -n1)
  local rate; rate=$(sed -n 's/^avg_frame_rate=//p' <<<"$info" | head -n1)
  [[ $rate =~ ^[1-9][0-9]*/[1-9][0-9]*$ ]] || rate=$(sed -n 's/^r_frame_rate=//p' <<<"$info" | head -n1)

  # --- interlacing ---
  case $DEINT in
    off)  il=progressive ;;
    on)   il=$(detect_interlace "$in" "$fo")
          [[ $il == progressive ]] && il=unknown ;;   # forced: deinterlace anyway, parity from frame flags
    auto) il=$(detect_interlace "$in" "$fo") ;;
  esac
  if [[ $il != progressive && $DEINT_READY -eq 0 ]]; then
    log "FAIL (interlaced, cannot deinterlace: $DEINT_ERR): $rel"
    N_FAIL=$((N_FAIL + 1)); return 0
  fi
  local il_msg="progressive"
  [[ $il != progressive ]] && il_msg="interlaced $il -> nnedi$DR_SUFFIX"

  # --- keyframe interval (used by run_encode) ---
  local fps gop=$GOP_SECONDS
  fps=$(awk -F/ '{ printf "%.3f", ($2 > 0 ? $1 / $2 : 0) }' <<<"${rate:-0/0}")
  [[ $il != progressive && $DOUBLE_RATE -eq 1 ]] && fps=$(awk '{ printf "%.3f", $1 * 2 }' <<<"$fps")
  if [[ $gop == auto ]]; then
    gop=1
    awk '{ exit !($1 > 30) }' <<<"$fps" && gop=0.5
  fi
  il_msg+=", ${fps%.000} fps, keyframe every ${gop} s"

  # --- HDR ---
  case $trc in
    arib-std-b67) hdr=hlg; tin=arib-std-b67 ;;
    smpte2084)    hdr=pq;  tin=smpte2084 ;;
  esac
  # Dolby Vision profile 5 has no HLG/PQ-compatible base layer: needs libplacebo
  if [[ -z $hdr ]] && grep -q 'DOVI configuration record' <<<"$info"; then
    hdr=dv
  fi

  if [[ -z $hdr ]]; then
    log "SDR  ($pixfmt, $il_msg): $rel"
    if run_encode "$in" "$out" sdr "" "$il"; then
      N_OK=$((N_OK + 1)); [[ $il != progressive ]] && N_DEINT=$((N_DEINT + 1))
    else
      log "FAIL: $rel"; N_FAIL=$((N_FAIL + 1))
    fi
    return 0
  fi

  local mappers; mappers=$(tonemappers_for "$hdr")
  if [[ -z $mappers ]]; then
    log "FAIL (HDR $hdr, no usable tone mapper; need libplacebo, or zscale for HLG/PQ): $rel"
    N_FAIL=$((N_FAIL + 1)); return 0
  fi

  local m
  for m in $mappers; do
    log "HDR  ($hdr, $pixfmt, $il_msg) -> SDR via $m: $rel"
    if run_encode "$in" "$out" "$m" "$tin" "$il"; then
      N_OK=$((N_OK + 1)); N_HDR=$((N_HDR + 1))
      [[ $il != progressive ]] && N_DEINT=$((N_DEINT + 1))
      return 0
    fi
    log "  $m failed, trying next tone mapper if any"
  done
  log "FAIL: $rel"; N_FAIL=$((N_FAIL + 1))
}

# ---------- main ----------
log "Encoder: $([[ $USE_CPU -eq 1 ]] && echo "libx265 $X265_PRESET" || echo "hevc_nvenc $PRESET") | CQ $CQ | original size | keyframes ${GOP_SECONDS}$([[ $GOP_SECONDS == auto ]] && echo " (1 s up to 30 fps, 0.5 s above)" || echo " s")"
log "Tone mappers: libplacebo=$HAS_LIBPLACEBO zscale=$HAS_ZSCALE (mode: $TONEMAP)"
if [[ $DEINT == off ]]; then
  log "Deinterlacing: off"
elif (( DEINT_READY )); then
  log "Deinterlacing: $DEINT, nnedi$DR_SUFFIX, weights $WEIGHTS"
else
  log "Deinterlacing: $DEINT, UNAVAILABLE ($DEINT_ERR) — interlaced files will fail"
fi

for arg in "$@"; do
  if [[ -d $arg ]]; then
    base=$(cd -- "$arg" && pwd -P)
    while IFS= read -r -d '' f; do
      process_file "$f" "${f#"$base"/}"
    done < <(find "$base" -path "$OUT_ABS" -prune -o -type f \
               -regextype posix-extended -iregex ".*\.($EXTENSIONS)$" \
               ! -name '*.part.mp4' -print0 | sort -z)
  elif [[ -f $arg ]]; then
    process_file "$arg" "$(basename -- "$arg")"
  else
    log "SKIP (not found): $arg"; N_SKIP=$((N_SKIP + 1))
  fi
done

PREFIX=""; (( DRY_RUN )) && PREFIX="Dry run — would have: "
log "${PREFIX}Done: $N_OK encoded ($N_HDR tone-mapped, $N_DEINT deinterlaced), $N_SKIP skipped, $N_FAIL failed"
(( N_FAIL == 0 ))
