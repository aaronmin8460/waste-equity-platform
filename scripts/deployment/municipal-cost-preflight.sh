#!/usr/bin/env bash
#
# Read-only production preflight for the municipal-cost demo release.
#
# Records the exact state of the production host BEFORE anything changes, and
# fails loudly on every condition that must block a deployment. It issues only
# SELECT statements and read-only Docker/Git queries: it never builds, never
# starts or recreates a container, never writes a row, and never touches a
# volume. Run it twice — once before the deploy to capture the baseline, once
# after with --expect-sha to prove the intended code is live.
#
# It complements, and does not replace, the reviewed scripts:
#   check-production-env.sh   env validation      (run by deploy.sh)
#   smoke-test.sh             HTTP health         (run by deploy.sh)
#   verify-production-data.sh equity/suitability regression counts
#
# Usage:
#   scripts/deployment/municipal-cost-preflight.sh [--expect-sha SHA] \
#     [--env-file .env.production] [--compose-file docker-compose.prod.yml] \
#     [--project waste-equity-prod] [--min-disk-gb 10] [--allow-dirty]
#
# Output: deterministic `key|value` lines on stdout, diffable between runs.
# Exit codes: 0 all gates pass, 1 a gate failed, 2 usage error.

set -euo pipefail

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
PROJECT="waste-equity-prod"
EXPECT_SHA=""
MIN_DISK_GB=10
ALLOW_DIRTY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-sha) EXPECT_SHA="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --min-disk-gb) MIN_DISK_GB="$2"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
emit() { printf '%s|%s\n' "$1" "${2:-}"; }
fail() { echo "  ✗ $*" >&2; FAIL=1; }

# --- 1. release identity ----------------------------------------------------
HEAD_SHA="$(git rev-parse HEAD)"
emit "git.head" "$HEAD_SHA"
emit "git.branch" "$(git rev-parse --abbrev-ref HEAD)"
emit "git.describe_detached" "$(git symbolic-ref -q HEAD >/dev/null && echo no || echo yes)"

DIRTY="$(git status --porcelain | wc -l | tr -d '[:space:]')"
emit "git.dirty_paths" "$DIRTY"
if [[ "$DIRTY" != "0" && "$ALLOW_DIRTY" -eq 0 ]]; then
  fail "working tree has ${DIRTY} modified path(s); deploy.sh would check out over them"
fi

if [[ -n "$EXPECT_SHA" ]]; then
  emit "git.expected_head" "$EXPECT_SHA"
  if [[ "$HEAD_SHA" != "$EXPECT_SHA" ]]; then
    fail "deployed SHA ${HEAD_SHA} != expected ${EXPECT_SHA}"
  fi
fi

# --- 2. single Alembic head in the CODE -------------------------------------
# Computed from the revision graph itself so no container has to be started.
REVISIONS="$(grep -hoE '^revision(: str)? *= *["'"'"'][0-9a-zA-Z_]+["'"'"']' \
  backend/alembic/versions/*.py | grep -oE '["'"'"'][0-9a-zA-Z_]+["'"'"']$' | tr -d "\"'" | sort -u)"
DOWN="$(grep -hoE '^down_revision(: [^=]*)? *= *["'"'"'][0-9a-zA-Z_]+["'"'"']' \
  backend/alembic/versions/*.py | grep -oE '["'"'"'][0-9a-zA-Z_]+["'"'"']$' | tr -d "\"'" | sort -u)"
CODE_HEADS="$(comm -23 <(echo "$REVISIONS") <(echo "$DOWN") | tr '\n' ',' | sed 's/,$//')"
CODE_HEAD_COUNT="$(comm -23 <(echo "$REVISIONS") <(echo "$DOWN") | grep -c . || true)"
emit "alembic.code_heads" "$CODE_HEADS"
emit "alembic.code_head_count" "$CODE_HEAD_COUNT"
[[ "$CODE_HEAD_COUNT" == "1" ]] || fail "code has ${CODE_HEAD_COUNT} Alembic heads; exactly 1 is required"

# --- 3. host capacity -------------------------------------------------------
DISK_AVAIL_GB="$(df -Pk . | awk 'NR==2 {printf "%d", $4/1024/1024}')"
emit "host.disk_available_gb" "$DISK_AVAIL_GB"
emit "host.disk_use_percent" "$(df -Pk . | awk 'NR==2 {print $5}')"
if [[ "$DISK_AVAIL_GB" -lt "$MIN_DISK_GB" ]]; then
  fail "only ${DISK_AVAIL_GB} GB free; a build + backup needs at least ${MIN_DISK_GB} GB"
fi

if command -v free >/dev/null 2>&1; then
  emit "host.memory_total_mb" "$(free -m | awk '/^Mem:/ {print $2}')"
  emit "host.memory_available_mb" "$(free -m | awk '/^Mem:/ {print $7}')"
else
  emit "host.memory_total_mb" "unavailable"
  emit "host.memory_available_mb" "unavailable"
fi
emit "host.load_average" "$(uptime | sed 's/.*load average[s]*: //' | tr -d ' ')"

# --- 4. compose services ----------------------------------------------------
[[ -f "$COMPOSE_FILE" ]] || { echo "✗ compose file not found: $COMPOSE_FILE" >&2; exit 2; }
COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")
[[ -f "$ENV_FILE" ]] && COMPOSE+=(--env-file "$ENV_FILE")
emit "compose.project" "$PROJECT"
emit "compose.file" "$COMPOSE_FILE"
emit "compose.env_file" "$ENV_FILE"

for service in database backend frontend caddy; do
  STATE="$("${COMPOSE[@]}" ps "$service" --format '{{.State}}' 2>/dev/null | head -1)"
  HEALTH="$("${COMPOSE[@]}" ps "$service" --format '{{.Health}}' 2>/dev/null | head -1)"
  emit "service.${service}.state" "${STATE:-absent}"
  emit "service.${service}.health" "${HEALTH:-none}"
  if [[ "${STATE:-absent}" != "running" ]]; then
    fail "service ${service} is '${STATE:-absent}', expected running"
  fi
  # caddy defines no healthcheck in this repository; an empty value is expected.
  if [[ -n "${HEALTH}" && "${HEALTH}" != "healthy" ]]; then
    fail "service ${service} health is '${HEALTH}', expected healthy"
  fi
  NAME="$("${COMPOSE[@]}" ps "$service" --format '{{.Name}}' 2>/dev/null | head -1)"
  if [[ -n "$NAME" ]]; then
    RESTARTS="$(docker inspect -f '{{.RestartCount}}' "$NAME" 2>/dev/null || echo unknown)"
    emit "service.${service}.restarts" "$RESTARTS"
    if [[ "$RESTARTS" =~ ^[0-9]+$ && "$RESTARTS" -gt 0 ]]; then
      fail "service ${service} has restarted ${RESTARTS} time(s) — investigate before deploying"
    fi
  fi
done

emit "volumes" "$( { docker volume ls --format '{{.Name}}' | grep "^${PROJECT}_" || true; } \
  | sort | tr '\n' ',' | sed 's/,$//')"

# --- 5. database state (read-only) ------------------------------------------
DB_USER="waste_equity"; DB_NAME="waste_equity"
if [[ -f "$ENV_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
  DB_USER="${POSTGRES_USER:-$DB_USER}"; DB_NAME="${POSTGRES_DB:-$DB_NAME}"
fi
q() { "${COMPOSE[@]}" exec -T database psql -U "$DB_USER" -d "$DB_NAME" -tA \
        -c "SET default_transaction_read_only = on; $1" 2>/dev/null | tr -d '[:space:]'; }

ALEMBIC_ROWS="$(q 'SELECT count(*) FROM alembic_version;')"
ALEMBIC_REV="$(q "SELECT string_agg(version_num, ',' ORDER BY version_num) FROM alembic_version;")"
emit "alembic.db_rows" "${ALEMBIC_ROWS:-unknown}"
emit "alembic.db_revision" "${ALEMBIC_REV:-unknown}"
if [[ "${ALEMBIC_ROWS:-0}" != "1" ]]; then
  fail "alembic_version holds ${ALEMBIC_ROWS:-unknown} row(s); exactly 1 head is required"
fi

# Official landfill baseline — must be byte-identical after the release.
emit "landfill.rows" "$(q 'SELECT count(*) FROM landfill_inbound_monthly;')"
emit "landfill.accounting_bases" \
  "$(q "SELECT count(DISTINCT accounting_basis) FROM landfill_inbound_monthly;")"
emit "landfill.sum_quantity_kg" "$(q 'SELECT coalesce(sum(quantity_kg),0) FROM landfill_inbound_monthly;')"
emit "landfill.sum_inbound_fee_krw" \
  "$(q 'SELECT coalesce(sum(inbound_fee_krw),0) FROM landfill_inbound_monthly;')"
emit "landfill.non_metropolitan_rows" \
  "$(q "SELECT count(*) FROM landfill_inbound_monthly WHERE accounting_basis <> 'VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW';")"
emit "regions.rows" "$(q 'SELECT count(*) FROM regions;')"
emit "regional_population.rows" "$(q 'SELECT count(*) FROM regional_population;')"

# Municipal tables: absent before migration 0021, populated after ingestion.
for table in municipal_cost_geographies municipal_cost_geography_components \
             municipal_cost_source_files municipal_waste_contracts \
             municipal_waste_quantities municipal_cost_indicator_values; do
  PRESENT="$(q "SELECT to_regclass('public.${table}') IS NOT NULL;")"
  if [[ "$PRESENT" == "t" ]]; then
    emit "municipal.${table}" "$(q "SELECT count(*) FROM ${table};")"
  else
    emit "municipal.${table}" "absent"
  fi
done

# A stored 0 would mean "missing" had been written as a real value. Before
# migration 0021 the table does not exist yet, which is not a failure.
if [[ "$(q "SELECT to_regclass('public.municipal_cost_indicator_values') IS NOT NULL;")" == "t" ]]; then
  ZEROS="$(q 'SELECT count(*) FROM municipal_cost_indicator_values WHERE value = 0;')"
  emit "municipal.indicator_zero_values" "${ZEROS:-unknown}"
  [[ "${ZEROS:-0}" == "0" ]] || fail "${ZEROS} indicator row(s) store 0 — missing must never be zero"
  ORPHAN="$(q "SELECT count(*) FROM municipal_cost_indicator_values WHERE status = 'UNAVAILABLE' AND value IS NOT NULL;")"
  emit "municipal.unavailable_with_value" "${ORPHAN:-unknown}"
  [[ "${ORPHAN:-0}" == "0" ]] || fail "${ORPHAN} UNAVAILABLE row(s) hold a value"
else
  emit "municipal.indicator_zero_values" "absent"
  emit "municipal.unavailable_with_value" "absent"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "✗ preflight FAILED — do not deploy until every gate above passes." >&2
  exit 1
fi
echo "✓ preflight passed (record the key|value block above as the pre-change baseline)."
