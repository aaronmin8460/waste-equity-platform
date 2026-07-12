#!/usr/bin/env bash
# HTTP smoke test for a deployed stack. Exits non-zero on any required failure.
#
# Checks (same-origin through the reverse proxy):
#   GET /health                          -> 200
#   GET /api/v1/data-sources             -> 200
#   GET /api/v1/suitability/policies     -> 200 (no data required)
#   GET /                                -> 200 (frontend HTML)
# With --expect-data also:
#   GET /api/v1/suitability/runs/latest  -> 200
#   GET /api/v1/suitability/candidates?profile=baseline&limit=1 -> 200
#
# Usage:
#   scripts/deployment/smoke-test.sh [--base-url URL] [--insecure] [--expect-data]
# Default base URL: https://${PUBLIC_DOMAIN} (else http://localhost).
set -euo pipefail

BASE_URL="" ; INSECURE=0 ; EXPECT_DATA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --expect-data) EXPECT_DATA=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "${BASE_URL}" ]]; then
  BASE_URL="${PUBLIC_DOMAIN:+https://${PUBLIC_DOMAIN}}"
  BASE_URL="${BASE_URL:-http://localhost}"
fi
CURL=(curl -sS --max-time 20 -o /dev/null -w "%{http_code}")
[[ "${INSECURE}" -eq 1 ]] && CURL+=(-k)

echo "Smoke test against ${BASE_URL}"
FAIL=0
check() { # name path [expected_code]
  local name="$1" path="$2" want="${3:-200}" code
  code="$("${CURL[@]}" "${BASE_URL}${path}" || echo 000)"
  if [[ "${code}" == "${want}" ]]; then echo "  ✓ ${name} (${code}) ${path}";
  else echo "  ✗ ${name} expected ${want} got ${code} ${path}" >&2; FAIL=1; fi
}

check "backend health"        "/health"
check "data-sources API"      "/api/v1/data-sources"
check "suitability policies"  "/api/v1/suitability/policies"
check "frontend root"         "/"
if [[ "${EXPECT_DATA}" -eq 1 ]]; then
  check "latest suitability run" "/api/v1/suitability/runs/latest"
  check "suitability candidates" "/api/v1/suitability/candidates?profile=baseline&limit=1"
fi

# Health body should not report a database failure.
HBODY="$(curl -sS ${INSECURE:+-k} --max-time 20 "${BASE_URL}/health" 2>/dev/null || true)"
if echo "${HBODY}" | grep -q '"database":"ok"'; then echo "  ✓ database reachable via health";
else echo "  ✗ health does not report database ok: ${HBODY}" >&2; FAIL=1; fi

if [[ "${FAIL}" -ne 0 ]]; then echo "Smoke test FAILED." >&2; exit 1; fi
echo "Smoke test passed."
