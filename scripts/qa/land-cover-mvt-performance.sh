#!/usr/bin/env bash
#
# Read-only land-cover vector-tile (MVT) performance and compression probe
# (Phase 1B-LC9).
#
# Measures the PUBLIC serving path of the derived land-cover candidate-cell
# tiles: transferred bytes, decompressed bytes, compression ratio, time to first
# byte, total time, cache headers, ETag revalidation, and the decoded MVT
# contract (source layer, extent, feature count, property keys, duplicate
# candidate keys).
#
# It issues GET requests only. It never writes, never authenticates, never
# uploads, and never touches the database, so it is safe to run against
# production. Response bodies are written to a temporary directory OUTSIDE the
# repository and removed with it unless --out is given.
#
# The tile list is FIXED (literal z/x/y, never derived at run time) so a
# before-and-after comparison always requests byte-for-byte identical
# version-pinned URLs.
#
# Portability: POSIX-ish bash 3.2 (macOS) and bash 5 (Linux server).
#
# Usage:
#   scripts/qa/land-cover-mvt-performance.sh                          # local
#   scripts/qa/land-cover-mvt-performance.sh --base-url https://host
#   scripts/qa/land-cover-mvt-performance.sh --out /tmp/lc9-before --label before
#
# Options:
#   --base-url URL   origin to probe (default: http://localhost:8000)
#   --out DIR        report directory (default: a fresh mktemp -d, auto-removed)
#   --label NAME     free-text label recorded in the report
#   --version ID     statistics version to pin (default: resolved from /release)
#   --python PATH    interpreter that can import mapbox_vector_tile
#   --no-decode      skip MVT decoding (headers and byte counts only)
#
# Output:
#   $OUT/report.json     machine-readable report
#   $OUT/report.ndjson   one JSON object per tile
#   stdout               human-readable summary table

set -euo pipefail

BASE_URL="http://localhost:8000"
OUT_DIR=""
LABEL="unlabelled"
PIN_VERSION=""
PY=""
DECODE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="${2:?--base-url needs a value}"; shift 2 ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift 2 ;;
    --label) LABEL="${2:?--label needs a value}"; shift 2 ;;
    --version) PIN_VERSION="${2:?--version needs a value}"; shift 2 ;;
    --python) PY="${2:?--python needs a value}"; shift 2 ;;
    --no-decode) DECODE=0; shift ;;
    -h|--help) sed -n '2,42p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

BASE_URL="${BASE_URL%/}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -z "$PY" ]; then
  if [ -x "$REPO_ROOT/backend/.venv/bin/python" ]; then
    PY="$REPO_ROOT/backend/.venv/bin/python"
  else
    PY="$(command -v python3 || true)"
  fi
fi
[ -n "$PY" ] || { echo "FATAL: no python3 interpreter found" >&2; exit 1; }
if [ "$DECODE" -eq 1 ] && ! "$PY" -c 'import mapbox_vector_tile' >/dev/null 2>&1; then
  echo "note: mapbox_vector_tile unavailable via '$PY'; MVT decoding disabled" >&2
  DECODE=0
fi
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required" >&2; exit 1; }

CLEAN_OUT=0
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lc9-mvt-perf.XXXXXX")"
  CLEAN_OUT=1
  trap 'rm -rf "$OUT_DIR"' EXIT
fi
mkdir -p "$OUT_DIR/bodies"
NDJSON="$OUT_DIR/report.ndjson"
: >"$NDJSON"

API="$BASE_URL/api/v1/environment/land-cover/cell-statistics"

# --------------------------------------------------------------------------- #
# 1. Resolve the active statistics version from the PUBLIC release endpoint.
# --------------------------------------------------------------------------- #
RELEASE_JSON="$OUT_DIR/release.json"
RELEASE_CODE="$(curl -sS -o "$RELEASE_JSON" -w '%{http_code}' "$API/release" || echo 000)"
[ "$RELEASE_CODE" = "200" ] || { echo "FATAL: $API/release -> HTTP $RELEASE_CODE" >&2; exit 1; }

VERSION_ID="${PIN_VERSION:-$(jq -r '.statistics_version_id' "$RELEASE_JSON")}"
GRID_VERSION="$(jq -r '.candidate_grid_version // "?"' "$RELEASE_JSON")"
EXPECTED_CELLS="$(jq -r '.expected_cell_count // 0' "$RELEASE_JSON")"
RELEASE_STATUS="$(jq -r '.status // "?"' "$RELEASE_JSON")"
SCORING_USE="$(jq -r '.disclosures.used_in_suitability_scoring' "$RELEASE_JSON")"
[ -n "$VERSION_ID" ] && [ "$VERSION_ID" != "null" ] \
  || { echo "FATAL: no statistics_version_id in $API/release" >&2; exit 1; }

# --------------------------------------------------------------------------- #
# 2. Fixed representative tile set.
#
#   z7/108/49     lon 123.750..126.563 — the default fitted view (LC8 baseline)
#   z7/109/49     lon 126.563..129.375 — Seoul + almost all of Gyeonggi (worst case)
#   z8/218/99     capital region, one step in
#   z9/436/198    capital region
#   z10/873/396   Seoul (LC8 baseline)
#   z10/872/396   Incheon
#   z10/873/397   Suwon / southern Gyeonggi
#   z13/6985/3174 Seoul detail (LC8 baseline)
#   z10/868/397   Yellow Sea — expected empty / near-empty
#   z10/879/404   Busan — outside the capital-region grid, expected empty
# --------------------------------------------------------------------------- #
TILES="z07-default-view 7 108 49 low-zoom-default-view
z07-worst-case 7 109 49 low-zoom-worst-case-Seoul-Gyeonggi
z08-capital 8 218 99 low-zoom-capital-region
z09-capital 9 436 198 medium-zoom-capital-region
z10-seoul 10 873 396 medium-zoom-Seoul
z10-incheon 10 872 396 medium-zoom-Incheon
z10-gyeonggi 10 873 397 medium-zoom-southern-Gyeonggi
z13-seoul-detail 13 6985 3174 high-zoom-Seoul-detail
z10-empty-sea 10 868 397 near-empty-Yellow-Sea
z10-outside-grid 10 879 404 empty-outside-grid"

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
hdr() { # hdr <header-file> <name>  -> value (CR stripped, first match)
  tr -d '\r' <"$1" | awk -v n="$2" 'BEGIN{n=tolower(n)}
    tolower($0) ~ "^" n ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'
}

sha() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# fetch <slug> <url> <accept-encoding> [extra curl args...]
# echoes "code|ttfb|total|bytes"; leaves <slug>.body and <slug>.hdr in bodies/
fetch() {
  _slug="$1"; _url="$2"; _enc="$3"; shift 3
  curl -sS -o "$OUT_DIR/bodies/$_slug.body" -D "$OUT_DIR/bodies/$_slug.hdr" \
    -H "Accept-Encoding: $_enc" \
    -w '%{http_code}|%{time_starttransfer}|%{time_total}|%{size_download}' \
    "$@" "$_url" 2>/dev/null || printf '000|0|0|0'
}

printf 'LC9 MVT performance probe\n'
printf '  origin              %s\n' "$BASE_URL"
printf '  label               %s\n' "$LABEL"
printf '  statistics version  %s (status %s, grid %s, %s expected cells)\n' \
  "$VERSION_ID" "$RELEASE_STATUS" "$GRID_VERSION" "$EXPECTED_CELLS"
printf '  used_in_scoring     %s\n' "$SCORING_USE"
printf '  report directory    %s\n' "$OUT_DIR"
printf '  MVT decoding        %s\n\n' "$([ "$DECODE" -eq 1 ] && echo "on" || echo off)"

printf '%-17s %-2s %-8s %-4s %8s %11s %11s %6s %7s %7s %7s %4s\n' \
  TILE Z ENCODING HTTP FEATURES XFER_BYTES RAW_BYTES RATIO TTFB_S COLD_S WARM_S 304
printf -- '---------------------------------------------------------------------------------------------------------\n'

echo "$TILES" | while read -r label z x y note; do
  [ -n "$label" ] || continue
  url="$API/tiles/$VERSION_ID/$z/$x/$y.mvt"

  # ---- (a) identity: the uncompressed reference body ----------------------
  r="$(fetch "$label-identity" "$url" "identity")"
  id_code="${r%%|*}"; r="${r#*|}"
  id_ttfb="${r%%|*}"; r="${r#*|}"
  id_total="${r%%|*}"; id_bytes="${r#*|}"
  id_hdr="$OUT_DIR/bodies/$label-identity.hdr"
  id_body="$OUT_DIR/bodies/$label-identity.body"
  ctype="$(hdr "$id_hdr" content-type)"
  cenc_id="$(hdr "$id_hdr" content-encoding)"
  clen_id="$(hdr "$id_hdr" content-length)"
  etag="$(hdr "$id_hdr" etag)"
  cachectl="$(hdr "$id_hdr" cache-control)"
  vary_id="$(hdr "$id_hdr" vary)"
  id_sha="$(sha "$id_body")"

  # ---- (b) gzip: cold, then an immediate warm repeat -----------------------
  r="$(fetch "$label-gzip" "$url" "gzip")"
  gz_code="${r%%|*}"; r="${r#*|}"
  gz_ttfb="${r%%|*}"; r="${r#*|}"
  gz_total="${r%%|*}"; gz_bytes="${r#*|}"
  gz_hdr="$OUT_DIR/bodies/$label-gzip.hdr"
  gz_body="$OUT_DIR/bodies/$label-gzip.body"
  cenc_gz="$(hdr "$gz_hdr" content-encoding)"
  vary_gz="$(hdr "$gz_hdr" vary)"

  r="$(fetch "$label-gzip-warm" "$url" "gzip")"
  gz2_code="${r%%|*}"; r="${r#*|}"
  r="${r#*|}"
  gz2_total="${r%%|*}"; gz2_bytes="${r#*|}"

  gz_raw_bytes="$gz_bytes"; gz_sha=""
  if [ "$cenc_gz" = "gzip" ]; then
    if gzip -dc "$gz_body" >"$gz_body.raw" 2>/dev/null; then
      gz_raw_bytes="$(wc -c <"$gz_body.raw" | tr -d ' ')"
      gz_sha="$(sha "$gz_body.raw")"
    fi
  else
    gz_sha="$(sha "$gz_body")"
  fi

  # ---- (c) zstd -----------------------------------------------------------
  r="$(fetch "$label-zstd" "$url" "zstd")"
  zs_code="${r%%|*}"; r="${r#*|}"
  zs_ttfb="${r%%|*}"; r="${r#*|}"
  zs_total="${r%%|*}"; zs_bytes="${r#*|}"
  zs_hdr="$OUT_DIR/bodies/$label-zstd.hdr"
  zs_body="$OUT_DIR/bodies/$label-zstd.body"
  cenc_zs="$(hdr "$zs_hdr" content-encoding)"
  zs_raw_bytes="$zs_bytes"; zs_sha=""
  if [ "$cenc_zs" = "zstd" ] && command -v zstd >/dev/null 2>&1; then
    if zstd -dqc "$zs_body" >"$zs_body.raw" 2>/dev/null; then
      zs_raw_bytes="$(wc -c <"$zs_body.raw" | tr -d ' ')"
      zs_sha="$(sha "$zs_body.raw")"
    fi
  elif [ -z "$cenc_zs" ]; then
    zs_sha="$(sha "$zs_body")"
  fi

  # ---- (d) conditional revalidation --------------------------------------
  nm_code="n/a"; nm_bytes=0; nm_total=0
  if [ -n "$etag" ]; then
    r="$(fetch "$label-304" "$url" "gzip" -H "If-None-Match: $etag")"
    nm_code="${r%%|*}"; r="${r#*|}"
    r="${r#*|}"
    nm_total="${r%%|*}"; nm_bytes="${r#*|}"
  fi

  # ---- (e) decode the identity body --------------------------------------
  decoded_json='{"layers":[],"features":0,"extent":null,"property_keys":[],"duplicate_candidate_keys":0}'
  if [ "$DECODE" -eq 1 ]; then
    decoded_json="$("$PY" - "$id_body" <<'PYEOF'
import json, sys
path = sys.argv[1]
raw = open(path, "rb").read()
out = {"layers": [], "features": 0, "extent": None,
       "property_keys": [], "duplicate_candidate_keys": 0,
       "distinct_candidate_keys": 0}
if raw:
    import mapbox_vector_tile as mvt
    decoded = dict(mvt.decode(raw))
    out["layers"] = sorted(decoded)
    total, keys, seen, dup = 0, set(), set(), 0
    extent = None
    for name in out["layers"]:
        layer = decoded[name]
        extent = layer.get("extent", extent)
        for f in layer.get("features", []):
            total += 1
            props = f.get("properties", {})
            keys |= set(props)
            ck = props.get("candidate_key")
            if ck is not None:
                if ck in seen:
                    dup += 1
                seen.add(ck)
    out.update(features=total, extent=extent, property_keys=sorted(keys),
               duplicate_candidate_keys=dup, distinct_candidate_keys=len(seen))
print(json.dumps(out))
PYEOF
)"
  fi
  feat_count="$(printf '%s' "$decoded_json" | jq -r '.features')"
  layers_csv="$(printf '%s' "$decoded_json" | jq -r '.layers | join(",")')"

  # ---- (f) best served encoding -------------------------------------------
  best_enc="identity"; best_bytes="$id_bytes"
  if [ -n "$cenc_gz" ] && [ "$gz_bytes" -lt "$best_bytes" ]; then best_enc="gzip"; best_bytes="$gz_bytes"; fi
  if [ -n "$cenc_zs" ] && [ "$zs_bytes" -lt "$best_bytes" ]; then best_enc="$cenc_zs"; best_bytes="$zs_bytes"; fi
  ratio="$(awk -v a="$best_bytes" -v b="$id_bytes" 'BEGIN{ if (b>0) printf "%.3f", a/b; else print "n/a" }')"

  printf '%-17s %-2s %-8s %-4s %8s %11s %11s %6s %7s %7s %7s %4s\n' \
    "$label" "$z" "$best_enc" "$id_code" "$feat_count" "$best_bytes" "$id_bytes" \
    "$ratio" "$id_ttfb" "$id_total" "$gz2_total" "$nm_code"

  LABEL_V="$label" NOTE_V="$note" Z_V="$z" X_V="$x" Y_V="$y" URL_V="$url" \
  ID_CODE="$id_code" ID_CT="$ctype" ID_CE="$cenc_id" ID_CL="$clen_id" \
  ID_BYTES="$id_bytes" ID_SHA="$id_sha" ID_TTFB="$id_ttfb" ID_TOTAL="$id_total" \
  ETAG_V="$etag" CACHE_V="$cachectl" VARY_ID="$vary_id" \
  GZ_CODE="$gz_code" GZ_CE="$cenc_gz" GZ_VARY="$vary_gz" GZ_BYTES="$gz_bytes" \
  GZ_RAW="$gz_raw_bytes" GZ_SHA="$gz_sha" GZ_TTFB="$gz_ttfb" GZ_TOTAL="$gz_total" \
  GZ2_CODE="$gz2_code" GZ2_TOTAL="$gz2_total" GZ2_BYTES="$gz2_bytes" \
  ZS_CODE="$zs_code" ZS_CE="$cenc_zs" ZS_BYTES="$zs_bytes" ZS_RAW="$zs_raw_bytes" \
  ZS_SHA="$zs_sha" ZS_TTFB="$zs_ttfb" ZS_TOTAL="$zs_total" \
  NM_CODE="$nm_code" NM_BYTES="$nm_bytes" NM_TOTAL="$nm_total" \
  BEST_ENC="$best_enc" BEST_BYTES="$best_bytes" RATIO="$ratio" \
  DECODED="$decoded_json" LAYERS="$layers_csv" \
  "$PY" - >>"$NDJSON" <<'PYEOF'
import json, os
e = os.environ
def num(v, d=0.0):
    try: return float(v)
    except Exception: return d
def i(v, d=0):
    try: return int(v)
    except Exception: return d
print(json.dumps({
  "label": e["LABEL_V"], "note": e["NOTE_V"],
  "z": i(e["Z_V"]), "x": i(e["X_V"]), "y": i(e["Y_V"]), "url": e["URL_V"],
  "identity": {
    "status": e["ID_CODE"], "content_type": e["ID_CT"],
    "content_encoding": e["ID_CE"] or None,
    "content_length_header": e["ID_CL"] or None,
    "transferred_bytes": i(e["ID_BYTES"]), "sha256": e["ID_SHA"],
    "ttfb_s": num(e["ID_TTFB"]), "total_s": num(e["ID_TOTAL"]),
    "etag": e["ETAG_V"] or None, "cache_control": e["CACHE_V"] or None,
    "vary": e["VARY_ID"] or None,
  },
  "gzip": {
    "status": e["GZ_CODE"], "content_encoding": e["GZ_CE"] or None,
    "vary": e["GZ_VARY"] or None,
    "transferred_bytes": i(e["GZ_BYTES"]), "decompressed_bytes": i(e["GZ_RAW"]),
    "decompressed_sha256": e["GZ_SHA"] or None,
    "ttfb_s": num(e["GZ_TTFB"]), "total_s": num(e["GZ_TOTAL"]),
    "warm_status": e["GZ2_CODE"], "warm_total_s": num(e["GZ2_TOTAL"]),
    "warm_transferred_bytes": i(e["GZ2_BYTES"]),
  },
  "zstd": {
    "status": e["ZS_CODE"], "content_encoding": e["ZS_CE"] or None,
    "transferred_bytes": i(e["ZS_BYTES"]), "decompressed_bytes": i(e["ZS_RAW"]),
    "decompressed_sha256": e["ZS_SHA"] or None,
    "ttfb_s": num(e["ZS_TTFB"]), "total_s": num(e["ZS_TOTAL"]),
  },
  "if_none_match": {"status": e["NM_CODE"], "transferred_bytes": i(e["NM_BYTES"]),
                    "total_s": num(e["NM_TOTAL"])},
  "decoded": json.loads(e["DECODED"]),
  "best": {"encoding": e["BEST_ENC"], "transferred_bytes": i(e["BEST_BYTES"]),
           "ratio": e["RATIO"]},
}))
PYEOF
done

# --------------------------------------------------------------------------- #
# 3. Machine-readable report
# --------------------------------------------------------------------------- #
LABEL_V="$LABEL" BASE_V="$BASE_URL" VER_V="$VERSION_ID" GRID_V="$GRID_VERSION" \
STATUS_V="$RELEASE_STATUS" CELLS_V="$EXPECTED_CELLS" SCORING_V="$SCORING_USE" \
NDJSON_V="$NDJSON" "$PY" - >"$OUT_DIR/report.json" <<'PYEOF'
import json, os
e = os.environ
tiles = [json.loads(line) for line in open(e["NDJSON_V"]) if line.strip()]
print(json.dumps({
    "label": e["LABEL_V"],
    "base_url": e["BASE_V"],
    "statistics_version_id": int(e["VER_V"]),
    "candidate_grid_version": e["GRID_V"],
    "release_status": e["STATUS_V"],
    "expected_cell_count": int(e["CELLS_V"]),
    "used_in_suitability_scoring": e["SCORING_V"],
    "tiles": tiles,
}, indent=2))
PYEOF

printf '\nReport: %s\n' "$OUT_DIR/report.json"
[ "$CLEAN_OUT" -eq 1 ] && printf 'NOTE: this temp directory is removed on exit; pass --out DIR to keep it.\n'
exit 0
