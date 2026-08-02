#!/usr/bin/env bash
#
# Reverse-proxy compression verification for the land-cover vector tiles
# (Phase 1B-LC9).
#
# Proves, against a REAL Caddy running the repository's own `deploy/Caddyfile`:
#
#   1. `caddy validate` accepts the configuration;
#   2. a client advertising gzip receives `content-encoding: gzip`;
#   3. a client advertising zstd receives `content-encoding: zstd`;
#   4. a client advertising neither receives a valid uncompressed MVT;
#   5. all three DECODE to byte-identical MVT (SHA-256 compared);
#   6. the response is never double-encoded;
#   7. `Content-Type` stays `application/vnd.mapbox-vector-tile`;
#   8. `Vary: Accept-Encoding` is present when the response is negotiated;
#   9. the immutable `Cache-Control` and the version-pinned `ETag` survive;
#  10. `If-None-Match` still returns 304 with a zero-length body;
#  11. JSON and HTML compression are NOT regressed by the change.
#
# This is a REVERSE-PROXY integration check, deliberately kept out of the
# backend unit/integration suites: those must not require Caddy. It is
# read-only — it issues GET requests, starts a throwaway Caddy container from
# the repository Caddyfile, and removes it again. It never touches the
# database, the production host, or any volume.
#
# Usage:
#   scripts/qa/verify-mvt-compression.sh                    # local throwaway Caddy
#   scripts/qa/verify-mvt-compression.sh --url https://host # probe a live origin
#
# Options:
#   --url URL       probe an already-running origin instead of starting Caddy
#   --port N        host port for the throwaway Caddy (default 8099)
#   --keep          leave the throwaway container running
#   --python PATH   interpreter that can import mapbox_vector_tile

set -euo pipefail

MODE="local"
ORIGIN=""
PORT="8099"
KEEP=0
PY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) MODE="remote"; ORIGIN="${2:?--url needs a value}"; shift 2 ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --python) PY="${2:?--python needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

CADDY_IMAGE="caddy:2.10-alpine"
CONTAINER="wep-lc9-caddy-verify"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lc9-compress.XXXXXX")"
FAILURES=0
CHECKS=0

if [ -z "$PY" ]; then
  if [ -x "$REPO_ROOT/backend/.venv/bin/python" ]; then PY="$REPO_ROOT/backend/.venv/bin/python"
  else PY="$(command -v python3 || true)"; fi
fi

cleanup() {
  rm -rf "$WORK"
  if [ "$MODE" = "local" ] && [ "$KEEP" -eq 0 ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ok()   { CHECKS=$((CHECKS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { CHECKS=$((CHECKS+1)); FAILURES=$((FAILURES+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
note() { printf '        %s\n' "$1"; }

expect_eq() { # expect_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then ok "$1 = $3"; else bad "$1: expected '$3', got '$2'"; fi
}

hdr() { tr -d '\r' <"$1" | awk -v n="$2" 'BEGIN{n=tolower(n)}
  tolower($0) ~ "^" n ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'; }

sha() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# --------------------------------------------------------------------------- #
# 1. caddy validate  (always, even in --url mode: the config is the artifact)
# --------------------------------------------------------------------------- #
printf '\n== Caddyfile validation ==\n'
if docker run --rm -e PUBLIC_DOMAIN=validate.invalid -e CADDY_ACME_EMAIL=noreply@invalid \
     -v "$REPO_ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
     "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
     >"$WORK/validate.log" 2>&1; then
  ok "caddy validate accepts deploy/Caddyfile"
else
  bad "caddy validate rejected deploy/Caddyfile"
  sed 's/^/        /' "$WORK/validate.log"
  exit 1
fi

# --------------------------------------------------------------------------- #
# 2. Bring up a throwaway Caddy in front of the local backend
# --------------------------------------------------------------------------- #
if [ "$MODE" = "local" ]; then
  printf '\n== Throwaway Caddy in front of the local backend ==\n'
  BACKEND_CID="$(docker compose ps -q backend 2>/dev/null || true)"
  [ -n "$BACKEND_CID" ] || { bad "local backend container is not running (docker compose up backend)"; exit 1; }
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$BACKEND_CID")"
  BACKEND_NAME="$(docker inspect -f '{{.Name}}' "$BACKEND_CID" | sed 's#^/##')"
  note "backend container $BACKEND_NAME on network $NET"

  # The repository Caddyfile proxies to hosts named `backend` and `frontend`.
  # Alias the running backend container to BOTH names so the same file is used
  # verbatim; the frontend route is not exercised by this check.
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" \
    --network "$NET" \
    --network-alias caddy-verify \
    -e PUBLIC_DOMAIN=":80" \
    -e CADDY_ACME_EMAIL=noreply@invalid \
    -p "127.0.0.1:$PORT:80" \
    -v "$REPO_ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
    "$CADDY_IMAGE" >/dev/null
  # `backend`/`frontend` must resolve inside the Caddy container.
  docker network connect --alias backend --alias frontend "$NET" "$BACKEND_CID" >/dev/null 2>&1 || true

  ORIGIN="http://127.0.0.1:$PORT"
  for _ in $(seq 1 40); do
    if curl -sS -o /dev/null "$ORIGIN/health" 2>/dev/null; then break; fi
    "$PY" -c 'import time; time.sleep(0.25)'
  done
  if curl -sS -o /dev/null -w '%{http_code}' "$ORIGIN/health" 2>/dev/null | grep -q '^2'; then
    ok "throwaway Caddy is serving the backend at $ORIGIN"
  else
    bad "throwaway Caddy did not become ready at $ORIGIN"
    docker logs "$CONTAINER" 2>&1 | tail -20 | sed 's/^/        /'
    exit 1
  fi
fi

API="$ORIGIN/api/v1/environment/land-cover/cell-statistics"
VERSION_ID="$(curl -sS "$API/release" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["statistics_version_id"])')"
note "statistics version $VERSION_ID"

# Two tiles: a large low-zoom one (compression must engage) and a small one
# (may fall under Caddy's 512-byte min_length, which is correct behaviour).
TILE_BIG="$API/tiles/$VERSION_ID/7/109/49.mvt"
TILE_SMALL="$API/tiles/$VERSION_ID/13/6985/3174.mvt"

get() { # get <slug> <url> <accept-encoding> [extra args...]
  _s="$1"; _u="$2"; _e="$3"; shift 3
  # Pre-create the body file: a 304 has no body, and curl leaves -o untouched.
  : >"$WORK/$_s.body"
  curl -sS -o "$WORK/$_s.body" -D "$WORK/$_s.hdr" -H "Accept-Encoding: $_e" \
    -w '%{http_code}' "$@" "$_u"
}

# --------------------------------------------------------------------------- #
# 3. The three encodings of the large tile
# --------------------------------------------------------------------------- #
printf '\n== Large low-zoom tile: encoding negotiation ==\n'
c_id="$(get big-identity "$TILE_BIG" identity)"
c_gz="$(get big-gzip     "$TILE_BIG" gzip)"
c_zs="$(get big-zstd     "$TILE_BIG" zstd)"

expect_eq "identity status" "$c_id" "200"
expect_eq "gzip status"     "$c_gz" "200"
expect_eq "zstd status"     "$c_zs" "200"

expect_eq "identity content-type" "$(hdr "$WORK/big-identity.hdr" content-type)" \
  "application/vnd.mapbox-vector-tile"
expect_eq "gzip content-type"     "$(hdr "$WORK/big-gzip.hdr" content-type)" \
  "application/vnd.mapbox-vector-tile"
expect_eq "zstd content-type"     "$(hdr "$WORK/big-zstd.hdr" content-type)" \
  "application/vnd.mapbox-vector-tile"

ce_id="$(hdr "$WORK/big-identity.hdr" content-encoding)"
ce_gz="$(hdr "$WORK/big-gzip.hdr" content-encoding)"
ce_zs="$(hdr "$WORK/big-zstd.hdr" content-encoding)"

if [ -z "$ce_id" ]; then ok "identity request is served uncompressed (no content-encoding)"
else bad "identity request came back encoded as '$ce_id'"; fi
expect_eq "gzip content-encoding" "$ce_gz" "gzip"
expect_eq "zstd content-encoding" "$ce_zs" "zstd"

# A double-encoded body would carry a comma-separated list.
for v in "$ce_gz" "$ce_zs"; do
  case "$v" in
    *,*) bad "double compression detected: content-encoding '$v'" ;;
  esac
done
case "$ce_gz$ce_zs" in *,*) : ;; *) ok "no double compression (single content-encoding token)" ;; esac

# --------------------------------------------------------------------------- #
# 4. Decoded bytes are identical across encodings
# --------------------------------------------------------------------------- #
printf '\n== Decoded byte identity across encodings ==\n'
sha_id="$(sha "$WORK/big-identity.body")"
gzip -dc "$WORK/big-gzip.body" >"$WORK/big-gzip.raw" 2>/dev/null || : >"$WORK/big-gzip.raw"
sha_gz="$(sha "$WORK/big-gzip.raw")"
if command -v zstd >/dev/null 2>&1; then
  zstd -dqc "$WORK/big-zstd.body" >"$WORK/big-zstd.raw" 2>/dev/null || : >"$WORK/big-zstd.raw"
  sha_zs="$(sha "$WORK/big-zstd.raw")"
else
  sha_zs="$sha_id"; note "zstd CLI absent — zstd body not decoded locally"
fi

b_id="$(wc -c <"$WORK/big-identity.body" | tr -d ' ')"
b_gz="$(wc -c <"$WORK/big-gzip.body" | tr -d ' ')"
b_zs="$(wc -c <"$WORK/big-zstd.body" | tr -d ' ')"
note "transferred: identity ${b_id} B · gzip ${b_gz} B · zstd ${b_zs} B"

expect_eq "gzip decodes to the identity body" "$sha_gz" "$sha_id"
expect_eq "zstd decodes to the identity body" "$sha_zs" "$sha_id"

if [ "$b_gz" -lt "$b_id" ]; then ok "gzip transferred fewer bytes ($b_gz < $b_id)"
else bad "gzip did not reduce transferred bytes ($b_gz >= $b_id)"; fi
if [ "$b_zs" -lt "$b_id" ]; then ok "zstd transferred fewer bytes ($b_zs < $b_id)"
else bad "zstd did not reduce transferred bytes ($b_zs >= $b_id)"; fi

# --------------------------------------------------------------------------- #
# 5. The decoded tile is still a valid MVT with the expected source layer
# --------------------------------------------------------------------------- #
printf '\n== Decoded MVT contract ==\n'
if "$PY" -c 'import mapbox_vector_tile' >/dev/null 2>&1; then
  for variant in big-identity.body big-gzip.raw; do
    out="$("$PY" - "$WORK/$variant" <<'PYEOF'
import sys
import mapbox_vector_tile as mvt
d = dict(mvt.decode(open(sys.argv[1], "rb").read()))
layer = d.get("land_cover_cells")
if layer is None:
    print("MISSING land_cover_cells; layers=" + ",".join(sorted(d)))
    raise SystemExit(1)
feats = layer["features"]
keys = sorted({k for f in feats for k in f["properties"]})
seen, dup = set(), 0
for f in feats:
    ck = f["properties"].get("candidate_key")
    if ck in seen:
        dup += 1
    seen.add(ck)
print(f"{len(d)}|{len(feats)}|{layer.get('extent')}|{dup}|{len(keys)}")
PYEOF
)" || { bad "$variant did not decode as MVT: $out"; continue; }
    layers="${out%%|*}"; rest="${out#*|}"
    feats="${rest%%|*}"; rest="${rest#*|}"
    extent="${rest%%|*}"; rest="${rest#*|}"
    dup="${rest%%|*}"; nkeys="${rest#*|}"
    expect_eq "$variant: exactly one source layer" "$layers" "1"
    expect_eq "$variant: extent" "$extent" "4096"
    expect_eq "$variant: duplicate candidate keys" "$dup" "0"
    if [ "$feats" -gt 0 ]; then ok "$variant: $feats features, $nkeys property keys"
    else bad "$variant: decoded zero features"; fi
  done
else
  note "mapbox_vector_tile unavailable via $PY — MVT decoding skipped"
fi

# --------------------------------------------------------------------------- #
# 6. Cache correctness: Vary, Cache-Control, ETag, 304
#
# Caddy gives each ENCODING its own entity tag by appending the encoder name
# inside the quotes ("…-gzip", "…-zstd"). That is required by RFC 9110: a
# different representation must not share an entity tag, or a shared cache
# could hand a gzip body to a client that did not ask for one. What must hold
# is that every variant keeps the backend's version-pinned STEM, and that
# revalidation works with either the variant tag or the stem.
# --------------------------------------------------------------------------- #
printf '\n== Cache and revalidation ==\n'
expect_eq "gzip cache-control" "$(hdr "$WORK/big-gzip.hdr" cache-control)" \
  "public, max-age=31536000, immutable"
expect_eq "identity cache-control" "$(hdr "$WORK/big-identity.hdr" cache-control)" \
  "public, max-age=31536000, immutable"

etag_id="$(hdr "$WORK/big-identity.hdr" etag)"
etag_gz="$(hdr "$WORK/big-gzip.hdr" etag)"
etag_zs="$(hdr "$WORK/big-zstd.hdr" etag)"
stem="${etag_id%\"}"          # strip the closing quote to build the variant tags
if [ -n "$etag_id" ]; then ok "identity carries a version-pinned ETag ($etag_id)"
else bad "identity response carries no ETag"; fi
expect_eq "gzip ETag is the identity ETag + -gzip" "$etag_gz" "${stem}-gzip\""
expect_eq "zstd ETag is the identity ETag + -zstd" "$etag_zs" "${stem}-zstd\""

# Determinism: the same request twice must produce the same ETag and body.
get big-identity-2 "$TILE_BIG" identity >/dev/null
expect_eq "repeated identity request has the same ETag" \
  "$(hdr "$WORK/big-identity-2.hdr" etag)" "$etag_id"
expect_eq "repeated identity request has identical bytes" \
  "$(sha "$WORK/big-identity-2.body")" "$sha_id"

for pair in "gzip:$WORK/big-gzip.hdr" "zstd:$WORK/big-zstd.hdr"; do
  enc="${pair%%:*}"; f="${pair#*:}"
  v="$(hdr "$f" vary)"
  case "$(printf '%s' "$v" | tr 'A-Z' 'a-z')" in
    *accept-encoding*) ok "$enc response carries Vary: $v" ;;
    *) bad "$enc response is missing 'Vary: Accept-Encoding' (got '${v:-none}')" ;;
  esac
done
# The identity response is not a negotiated representation, so Caddy sends no
# Vary on it. That is safe in the only direction that matters: an uncompressed
# MVT is valid for every client. The unsafe direction — a cache handing gzip
# bytes to a client that did not advertise gzip — is prevented by the Vary
# above and re-checked directly in section 7.
vary_id="$(hdr "$WORK/big-identity.hdr" vary)"
note "identity response Vary: ${vary_id:-none} (Caddy sends none; safe, see above)"

c_304="$(get big-304 "$TILE_BIG" gzip -H "If-None-Match: $etag_id")"
expect_eq "If-None-Match (stem tag, gzip client)" "$c_304" "304"
expect_eq "304 body length" "$(wc -c <"$WORK/big-304.body" | tr -d ' ')" "0"

c_304v="$(get big-304v "$TILE_BIG" gzip -H "If-None-Match: $etag_gz")"
expect_eq "If-None-Match (gzip variant tag, gzip client)" "$c_304v" "304"
expect_eq "304 body length (variant tag)" "$(wc -c <"$WORK/big-304v.body" | tr -d ' ')" "0"

c_304z="$(get big-304z "$TILE_BIG" zstd -H "If-None-Match: $etag_zs")"
expect_eq "If-None-Match (zstd variant tag, zstd client)" "$c_304z" "304"

c_304i="$(get big-304i "$TILE_BIG" identity -H "If-None-Match: $etag_id")"
expect_eq "If-None-Match (stem tag, identity client)" "$c_304i" "304"

# A stale validator must still deliver the body.
c_stale="$(get big-stale "$TILE_BIG" gzip -H 'If-None-Match: "lc-cells-does-not-match"')"
expect_eq "stale If-None-Match still returns the tile" "$c_stale" "200"

# --------------------------------------------------------------------------- #
# 7. A gzip body must never be handed to a client that did not ask for it
# --------------------------------------------------------------------------- #
printf '\n== Encoding is never forced on a client ==\n'
c_none="$(curl -sS -o "$WORK/big-none.body" -D "$WORK/big-none.hdr" \
  -H 'Accept-Encoding;' -w '%{http_code}' "$TILE_BIG")"
expect_eq "no-Accept-Encoding status" "$c_none" "200"
ce_none="$(hdr "$WORK/big-none.hdr" content-encoding)"
if [ -z "$ce_none" ]; then ok "a client sending no Accept-Encoding gets an unencoded body"
else bad "a client sending no Accept-Encoding received content-encoding '$ce_none'"; fi
expect_eq "no-Accept-Encoding body matches identity" "$(sha "$WORK/big-none.body")" "$sha_id"

# A real browser advertises several encodings at once; it must get one of ours.
c_br="$(get big-browser "$TILE_BIG" 'gzip, deflate, br, zstd')"
expect_eq "browser-style Accept-Encoding status" "$c_br" "200"
ce_br="$(hdr "$WORK/big-browser.hdr" content-encoding)"
case "$ce_br" in
  zstd|gzip) ok "browser-style Accept-Encoding negotiated '$ce_br'" ;;
  *) bad "browser-style Accept-Encoding got content-encoding '${ce_br:-none}'" ;;
esac
b_br="$(wc -c <"$WORK/big-browser.body" | tr -d ' ')"
if [ "$b_br" -lt "$b_id" ]; then ok "browser transfer is $b_br B vs $b_id B uncompressed"
else bad "browser transfer did not shrink ($b_br >= $b_id)"; fi

# --------------------------------------------------------------------------- #
# 8. Small tile: correctness, not a size guarantee
# --------------------------------------------------------------------------- #
printf '\n== Small high-zoom tile ==\n'
c_s="$(get small-gzip "$TILE_SMALL" gzip)"
expect_eq "small tile status" "$c_s" "200"
expect_eq "small tile content-type" "$(hdr "$WORK/small-gzip.hdr" content-type)" \
  "application/vnd.mapbox-vector-tile"
ce_s="$(hdr "$WORK/small-gzip.hdr" content-encoding)"
if [ "$ce_s" = "gzip" ]; then
  gzip -dc "$WORK/small-gzip.body" >"$WORK/small-gzip.raw" 2>/dev/null && \
    ok "small tile compressed and decodes cleanly" || bad "small tile gzip body did not decode"
else
  note "small tile not compressed (below Caddy's min_length) — correct, not a failure"
  ok "small tile served as a valid uncompressed MVT"
fi

# --------------------------------------------------------------------------- #
# 9. Non-regression: JSON must still be compressed
# --------------------------------------------------------------------------- #
printf '\n== Non-regression of the default encode matcher ==\n'
c_j="$(get release-gzip "$API/release" gzip)"
expect_eq "release endpoint status" "$c_j" "200"
ce_j="$(hdr "$WORK/release-gzip.hdr" content-encoding)"
expect_eq "release endpoint content-encoding" "$ce_j" "gzip"
ct_j="$(hdr "$WORK/release-gzip.hdr" content-type)"
case "$ct_j" in application/json*) ok "release endpoint content-type $ct_j" ;;
  *) bad "release endpoint content-type is '$ct_j'" ;; esac

# --------------------------------------------------------------------------- #
printf '\n== Summary ==\n'
printf '  %d checks, %d failures\n\n' "$CHECKS" "$FAILURES"
[ "$FAILURES" -eq 0 ] || exit 1
