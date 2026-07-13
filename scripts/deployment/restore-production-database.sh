#!/usr/bin/env bash
# Restore a custom-format dump into the PRODUCTION database (or a disposable test
# stack). Destructive: requires an explicit dump path AND --confirm-production.
#
# Safety:
#   - validates the dump exists and is non-empty
#   - targets a specific compose file + project (never the local dev DB by accident)
#   - if the target DB already holds data, takes a safety backup first
#   - restores with pg_restore (--clean --if-exists into the existing DB)
#   - never deletes the source dump
#   - reports completion and a row count
#
# Usage:
#   scripts/deployment/restore-production-database.sh \
#     --dump backups/waste_equity_local_YYYYMMDD_HHMMSS.dump \
#     --confirm-production \
#     [--compose-file docker-compose.prod.yml] [--project waste-equity-prod] \
#     [--env-file .env.production]
set -euo pipefail
cd "$(dirname "$0")/../.."

DUMP="" ; CONFIRM=0
COMPOSE_FILE="docker-compose.prod.yml"
PROJECT="waste-equity-prod"
ENV_FILE=".env.production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2 ;;
    --confirm-production) CONFIRM=1; shift ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "${DUMP}" ]] || { echo "✗ --dump PATH is required" >&2; exit 2; }
[[ "${CONFIRM}" -eq 1 ]] || { echo "✗ refusing to restore without --confirm-production" >&2; exit 2; }
[[ -f "${DUMP}" && -s "${DUMP}" ]] || { echo "✗ dump not found or empty: ${DUMP}" >&2; exit 1; }
[[ -f "${COMPOSE_FILE}" ]] || { echo "✗ compose file not found: ${COMPOSE_FILE}" >&2; exit 1; }

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}")
[[ -f "${ENV_FILE}" ]] && COMPOSE+=(--env-file "${ENV_FILE}")

# Resolve DB creds from the env file (never printed).
DB_USER="waste_equity"; DB_NAME="waste_equity"
if [[ -f "${ENV_FILE}" ]]; then
  set -a; # shellcheck disable=SC1090
  source "${ENV_FILE}"; set +a
  DB_USER="${POSTGRES_USER:-${DB_USER}}"; DB_NAME="${POSTGRES_DB:-${DB_NAME}}"
fi

echo "Restore target: project='${PROJECT}' compose='${COMPOSE_FILE}' db='${DB_NAME}' user='${DB_USER}'"
echo "Source dump:    ${DUMP}"

# Ensure the database service is up and healthy.
"${COMPOSE[@]}" up -d database
for _ in $(seq 1 30); do
  "${COMPOSE[@]}" exec -T database pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1 && break
  sleep 2
done

# Safety backup if the target already has data.
EXISTING="$("${COMPOSE[@]}" exec -T database psql -U "${DB_USER}" -d "${DB_NAME}" -tA \
  -c "SELECT to_regclass('public.regions') IS NOT NULL AND (SELECT count(*) FROM regions) > 0;" 2>/dev/null || echo f)"
if [[ "${EXISTING}" == "t" ]]; then
  mkdir -p backups
  SAFETY="backups/pre_restore_${PROJECT}_$(date +%Y%m%d_%H%M%S).dump"
  echo "  ! target already contains data — taking a safety backup first: ${SAFETY}"
  "${COMPOSE[@]}" exec -T database pg_dump --format=custom --no-owner --no-privileges \
    -U "${DB_USER}" -d "${DB_NAME}" > "${SAFETY}" || { echo "✗ safety backup failed; aborting" >&2; exit 1; }
  echo "  ✓ safety backup written (${SAFETY})"
fi

echo "Restoring (pg_restore --clean --if-exists)..."
if ! "${COMPOSE[@]}" exec -T database \
      pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
      -U "${DB_USER}" -d "${DB_NAME}" < "${DUMP}"; then
  echo "✗ pg_restore failed" >&2
  exit 1
fi

REGIONS="$("${COMPOSE[@]}" exec -T database psql -U "${DB_USER}" -d "${DB_NAME}" -tA \
  -c "SELECT count(*) FROM regions;" 2>/dev/null || echo '?')"
echo "  ✓ restore complete — regions row count: ${REGIONS}"
echo "The source dump was NOT deleted: ${DUMP}"
echo "Run verify-production-data.sh to confirm all expected counts."
