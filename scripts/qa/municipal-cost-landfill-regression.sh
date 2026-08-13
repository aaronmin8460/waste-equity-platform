#!/usr/bin/env bash
#
# Official Sudokwon Landfill regression guard for the municipal-cost release.
#
# The municipal indicator is a DIFFERENT accounting basis from the official
# landfill inbound fee, and the release must not move the official numbers by a
# single byte. This script captures a canonical baseline of the four official
# landfill endpoints before the release and re-compares them afterwards.
#
# Canonicalisation is `json.dumps(sort_keys=True, separators=(",", ":"))`, so a
# key-order change in the serializer cannot masquerade as a data change and a
# data change cannot hide behind key order.
#
# It also asserts that no official payload has acquired municipal content — the
# two datasets must stay separate on the wire, not merely in the database.
#
# GET requests only: nothing here writes, deploys, or touches a container.
#
# Usage:
#   scripts/qa/municipal-cost-landfill-regression.sh capture \
#     --base-url https://example --out ~/release-baselines/landfill-pre
#   scripts/qa/municipal-cost-landfill-regression.sh compare \
#     --base-url https://example --baseline ~/release-baselines/landfill-pre
#
# Exit codes: 0 identical, 1 a difference or a failed fetch, 2 usage error.

set -euo pipefail

MODE="${1:-}"
shift || true
case "$MODE" in
  capture|compare) ;;
  *) echo "usage: municipal-cost-landfill-regression.sh {capture|compare} --base-url URL ..." >&2
     exit 2 ;;
esac

BASE_URL="${PUBLIC_DOMAIN:+https://${PUBLIC_DOMAIN}}"
DEST=""
INSECURE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --out|--baseline) DEST="$2"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BASE_URL" ]] || { echo "✗ --base-url is required" >&2; exit 2; }
[[ -n "$DEST" ]] || { echo "✗ --out (capture) / --baseline (compare) is required" >&2; exit 2; }

ENDPOINTS=(summary trends composition flows)
CURL=(curl -sS --max-time 30 --fail)
[[ "$INSECURE" -eq 1 ]] && CURL+=(-k)

canonicalise() { # stdin JSON -> canonical JSON on stdout, fails on invalid JSON
  python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, ensure_ascii=False, separators=(",",":")))'
}

# GNU coreutils on the server, BSD/perl on macOS.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# Refuse to drop a baseline into a Git-tracked path: baselines are operational
# artifacts, not repository content.
guard_destination() {
  local target="$1" parent
  parent="$(dirname "$target")"
  [[ -d "$parent" ]] || return 0
  git -C "$parent" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if ! git -C "$parent" check-ignore -q "$target"; then
    echo "✗ refusing to write ${target}: inside a Git working tree and not Git-ignored." >&2
    echo "  Use a path outside the checkout (e.g. ~/release-baselines/…)." >&2
    exit 2
  fi
}

fetch_canonical() { # $1 endpoint -> canonical JSON on stdout
  "${CURL[@]}" "${BASE_URL}/api/v1/landfill/$1" | canonicalise
}

FAIL=0

if [[ "$MODE" == "capture" ]]; then
  guard_destination "$DEST"
  mkdir -p "$DEST"
  : > "${DEST}/SHA256SUMS"   # a re-capture replaces the manifest, never appends
  for endpoint in "${ENDPOINTS[@]}"; do
    fetch_canonical "$endpoint" > "${DEST}/${endpoint}.json"
    SUM="$(sha256_of "${DEST}/${endpoint}.json")"
    echo "${SUM}  ${endpoint}.json" >> "${DEST}/SHA256SUMS"
    echo "  captured ${endpoint} ${SUM}"
  done
  echo "✓ official landfill baseline written to ${DEST}"
  exit 0
fi

# --- compare ----------------------------------------------------------------
[[ -d "$DEST" ]] || { echo "✗ baseline directory not found: ${DEST}" >&2; exit 2; }
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

for endpoint in "${ENDPOINTS[@]}"; do
  BASELINE="${DEST}/${endpoint}.json"
  if [[ ! -f "$BASELINE" ]]; then
    echo "  ✗ ${endpoint}: no baseline captured" >&2; FAIL=1; continue
  fi
  if ! fetch_canonical "$endpoint" > "${WORK}/${endpoint}.json"; then
    echo "  ✗ ${endpoint}: fetch failed" >&2; FAIL=1; continue
  fi
  WANT="$(sha256_of "$BASELINE")"
  GOT="$(sha256_of "${WORK}/${endpoint}.json")"
  if [[ "$WANT" == "$GOT" ]]; then
    echo "  ✓ ${endpoint} byte-identical (${GOT})"
  else
    echo "  ✗ ${endpoint} CHANGED: baseline ${WANT} now ${GOT}" >&2
    diff <(python3 -m json.tool "$BASELINE") \
         <(python3 -m json.tool "${WORK}/${endpoint}.json") | head -40 >&2 || true
    FAIL=1
  fi

  # The two datasets must remain separate on the wire.
  if grep -q 'MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA\|MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT' \
       "${WORK}/${endpoint}.json"; then
    echo "  ✗ ${endpoint} now contains municipal-cost content" >&2
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "✗ official landfill regression DETECTED — treat as a hard no-go." >&2
  exit 1
fi
echo "✓ official landfill endpoints unchanged and free of municipal content."
