#!/usr/bin/env bash
#
# Read-only verification of the public municipal-cost API.
#
# Issues GET requests only. It proves the served payload matches the frozen
# GOLDEN_LOCAL_RESULT municipality by municipality, that the 66-row 2024
# registry is complete, that a missing value is served as `null` and never as
# `0`, that the indicator is never presented as the official Sudokwon Landfill
# inbound fee, that invalid inputs are rejected rather than reinterpreted, and
# that no private filesystem path appears in a citizen-facing payload.
#
# It is deliberately separate from smoke-test.sh: that script proves the stack
# is up, this one proves the municipal numbers are the reviewed ones.
#
# Usage:
#   scripts/deployment/municipal-cost-verify-api.sh --base-url URL \
#     [--golden path/to/golden.json] [--insecure] \
#     [--expect-available N] [--expect-partial N] [--expect-unavailable N]
#
# Exit codes: 0 every check passed, 1 a check failed, 2 usage error.

set -euo pipefail

BASE_URL="${PUBLIC_DOMAIN:+https://${PUBLIC_DOMAIN}}"
GOLDEN=""
INSECURE=0
EXPECT_AVAILABLE=""
EXPECT_PARTIAL=""
EXPECT_UNAVAILABLE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --golden) GOLDEN="$2"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --expect-available) EXPECT_AVAILABLE="$2"; shift 2 ;;
    --expect-partial) EXPECT_PARTIAL="$2"; shift 2 ;;
    --expect-unavailable) EXPECT_UNAVAILABLE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BASE_URL" ]] || { echo "✗ --base-url is required" >&2; exit 2; }

CURL=(curl -sS --max-time 30)
[[ "$INSECURE" -eq 1 ]] && CURL+=(-k)
API="/api/v1/landfill/municipal-costs"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

FAIL=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*" >&2; FAIL=1; }

status_of() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL}$1" || echo 000; }

echo "Municipal-cost API verification against ${BASE_URL}"

# --- 1. the year this release publishes -------------------------------------
CODE="$(status_of "${API}?year=2024")"
if [[ "$CODE" == "200" ]]; then ok "GET ${API}?year=2024 → 200"; else
  bad "GET ${API}?year=2024 → ${CODE} (expected 200)"
  echo "✗ municipal-cost API verification FAILED." >&2; exit 1
fi
"${CURL[@]}" -o "${WORK}/all.json" "${BASE_URL}${API}?year=2024"

# --- 2. invalid inputs must be rejected, never silently reinterpreted --------
for query in "year=2023" "year=abc" "year=2024&sido=99" "year=2024&status=BOGUS" \
             "year=2024&sort=bogus"; do
  CODE="$(status_of "${API}?${query}")"
  if [[ "$CODE" == "422" ]]; then ok "${query} → 422"; else bad "${query} → ${CODE} (expected 422)"; fi
done

# --- 3. metropolitan scopes --------------------------------------------------
for sido in 11 28 41; do
  "${CURL[@]}" -o "${WORK}/sido_${sido}.json" "${BASE_URL}${API}?year=2024&sido=${sido}"
done

# --- 4. payload assertions ---------------------------------------------------
set +e
GOLDEN_PATH="$GOLDEN" \
EXPECT_AVAILABLE="$EXPECT_AVAILABLE" \
EXPECT_PARTIAL="$EXPECT_PARTIAL" \
EXPECT_UNAVAILABLE="$EXPECT_UNAVAILABLE" \
WORK="$WORK" \
python3 - <<'PY'
import json
import os
import sys
from decimal import Decimal, InvalidOperation

INDICATOR = "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA"
BASIS = "MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT"
EXPECTED_TOTAL = 66
EXPECTED_BY_SIDO = {"11": 25, "28": 10, "41": 31}
PATH_MARKERS = ("/home/", "/Users/", "/srv/", "/root/")

work = os.environ["WORK"]
problems, passed = [], []


def dec(value):
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


with open(f"{work}/all.json", encoding="utf-8") as handle:
    payload = json.load(handle)

meta = payload.get("meta", {})
rows = payload.get("municipalities", [])

# --- registry completeness ---
if len(rows) == EXPECTED_TOTAL:
    passed.append(f"{EXPECTED_TOTAL} municipality rows served")
else:
    problems.append(f"{len(rows)} rows served, expected {EXPECTED_TOTAL}")
for field, want in (("expected_count", EXPECTED_TOTAL), ("returned_count", EXPECTED_TOTAL)):
    if meta.get(field) != want:
        problems.append(f"meta.{field} is {meta.get(field)}, expected {want}")
keys = [row.get("municipality_key") for row in rows]
if len(set(keys)) != len(keys):
    problems.append("duplicate municipality_key in the payload")

by_sido = {}
for row in rows:
    by_sido[row.get("metropolitan_code")] = by_sido.get(row.get("metropolitan_code"), 0) + 1
for code, want in EXPECTED_BY_SIDO.items():
    if by_sido.get(code) != want:
        problems.append(f"metropolitan {code} has {by_sido.get(code)} rows, expected {want}")

# --- the indicator is not the official landfill fee ---
if meta.get("indicator_code") != INDICATOR:
    problems.append(f"meta.indicator_code is {meta.get('indicator_code')!r}, expected {INDICATOR!r}")
if meta.get("accounting_basis") != BASIS:
    problems.append(f"meta.accounting_basis is {meta.get('accounting_basis')!r}, expected {BASIS!r}")
if meta.get("is_official_landfill_fee") is not False:
    problems.append(
        f"meta.is_official_landfill_fee is {meta.get('is_official_landfill_fee')!r}, must be false"
    )
else:
    passed.append("is_official_landfill_fee is false")
difference = meta.get("difference_from_official_landfill_fee") or ""
if "LANDFILL_INBOUND_FEE_PER_CAPITA" not in difference:
    problems.append("meta.difference_from_official_landfill_fee does not name the official indicator")
else:
    passed.append("the difference-from-official statement is served verbatim")

# --- status distribution ---
observed = {"AVAILABLE": 0, "PARTIAL": 0, "UNAVAILABLE": 0}
for row in rows:
    status = row.get("status")
    if status not in observed:
        problems.append(f"{row.get('municipality_key')}: unknown status {status!r}")
    else:
        observed[status] += 1
for status, field in (
    ("AVAILABLE", "available_count"),
    ("PARTIAL", "partial_count"),
    ("UNAVAILABLE", "unavailable_count"),
):
    if meta.get(field) != observed[status]:
        problems.append(f"meta.{field}={meta.get(field)} disagrees with {observed[status]} rows")
    expected = os.environ.get(f"EXPECT_{status}")
    if expected:
        if observed[status] != int(expected):
            problems.append(f"{status} is {observed[status]}, expected {expected}")
        else:
            passed.append(f"{status} = {observed[status]} as expected")
if sum(observed.values()) != EXPECTED_TOTAL:
    problems.append(f"status buckets sum to {sum(observed.values())}, expected {EXPECTED_TOTAL}")

# --- missing is null, never zero ---
zeros, unavailable_with_value = [], []
for row in rows:
    key = row.get("municipality_key")
    per_capita = dec(row.get("payment_per_capita_krw"))
    total = dec(row.get("total_eligible_payment_krw"))
    if row.get("status") == "UNAVAILABLE":
        if row.get("payment_per_capita_krw") is not None or row.get("total_eligible_payment_krw") is not None:
            unavailable_with_value.append(key)
    else:
        if per_capita is None or total is None:
            problems.append(f"{key}: {row.get('status')} but a money field is null")
    if (per_capita is not None and per_capita == 0) or (total is not None and total == 0):
        zeros.append(key)
if zeros:
    problems.append(f"{len(zeros)} row(s) serve 0 instead of null: {zeros[:5]}")
else:
    passed.append("no row serves 0 for a missing value")
if unavailable_with_value:
    problems.append(f"UNAVAILABLE rows carrying a value: {unavailable_with_value[:5]}")
else:
    passed.append("every UNAVAILABLE row serves null in both money fields")

# --- no private path leaks into a citizen-facing payload ---
blob = json.dumps(payload, ensure_ascii=False)
leaked = [marker for marker in PATH_MARKERS if marker in blob]
if leaked:
    problems.append(f"payload contains private path fragment(s): {leaked}")
else:
    passed.append("payload contains no absolute filesystem path")

# --- scoped queries ---
for code, want in EXPECTED_BY_SIDO.items():
    with open(f"{work}/sido_{code}.json", encoding="utf-8") as handle:
        scoped = json.load(handle)
    got = len(scoped.get("municipalities", []))
    if got != want:
        problems.append(f"sido={code} returned {got} rows, expected {want}")
if not any(p.startswith("sido=") for p in problems):
    passed.append("sido=11/28/41 return 25/10/31")

# --- equality with the frozen golden result ---
golden_path = os.environ.get("GOLDEN_PATH") or ""
if golden_path:
    with open(golden_path, encoding="utf-8") as handle:
        golden_doc = json.load(handle)
    golden = golden_doc.get("comparable", {})
    expected_rows = {item["municipality_key"]: item for item in golden.get("municipalities", [])}
    served = {row.get("municipality_key"): row for row in rows}
    missing = sorted(set(expected_rows) - set(served))
    extra = sorted(set(served) - set(expected_rows))
    if missing:
        problems.append(f"municipalities in the golden result but not served: {missing[:5]}")
    if extra:
        problems.append(f"municipalities served but not in the golden result: {extra[:5]}")
    mismatched = []
    for key, want_row in expected_rows.items():
        row = served.get(key)
        if row is None:
            continue
        if row.get("status") != want_row.get("status"):
            mismatched.append(f"{key}: status {row.get('status')} != {want_row.get('status')}")
        if dec(row.get("payment_per_capita_krw")) != dec(want_row.get("value")):
            mismatched.append(
                f"{key}: payment_per_capita_krw {row.get('payment_per_capita_krw')} "
                f"!= golden {want_row.get('value')}"
            )
        if dec(row.get("total_eligible_payment_krw")) != dec(want_row.get("numerator_krw")):
            mismatched.append(
                f"{key}: total_eligible_payment_krw {row.get('total_eligible_payment_krw')} "
                f"!= golden {want_row.get('numerator_krw')}"
            )
    if mismatched:
        problems.append(f"{len(mismatched)} value(s) differ from the golden result:")
        problems.extend(f"    {line}" for line in mismatched[:10])
    else:
        passed.append(f"all {len(expected_rows)} municipalities match the golden result exactly")

    # meta.source_coverage counts every stored source file for the year, not
    # the files this run loaded. A superseded delivery left behind in the
    # database therefore shows up here — and only here — as inflated coverage.
    coverage = meta.get("source_coverage", {})
    golden_files = golden.get("source_files", {})
    for served_field, golden_field in (
        ("discovered_file_count", "discovered"),
        ("accepted_file_count", "accepted"),
        ("rejected_file_count", "rejected"),
    ):
        served_value = coverage.get(served_field)
        golden_value = golden_files.get(golden_field)
        if served_value != golden_value:
            problems.append(
                f"meta.source_coverage.{served_field} is {served_value}, golden says "
                f"{golden_value} — stale rows from a superseded delivery are the usual cause"
            )
    if not any("source_coverage" in problem for problem in problems):
        passed.append("served source coverage equals the golden source-file accounting")

for line in passed:
    print(f"  ✓ {line}")
for line in problems:
    print(f"  ✗ {line}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
PY_STATUS=$?
set -e
[[ "$PY_STATUS" -eq 0 ]] || FAIL=1

if [[ "$FAIL" -ne 0 ]]; then
  echo "✗ municipal-cost API verification FAILED." >&2
  exit 1
fi
echo "✓ municipal-cost API verification passed."
