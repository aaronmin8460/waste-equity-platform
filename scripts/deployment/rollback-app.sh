#!/usr/bin/env bash
# Roll the APPLICATION (backend + frontend + caddy) back to a previous Git ref.
#
# This rolls back application images/commit ONLY. It NEVER downgrades the
# database. If the target revision's migration head is BEHIND the database's
# current schema version (i.e. the DB has migrations the old code does not know),
# the app is incompatible with the live schema and the script STOPS visibly
# rather than running a destructive DB downgrade.
#
# Usage:
#   scripts/deployment/rollback-app.sh --ref PREVIOUS_GIT_REF \
#     [--env-file .env.production] [--compose-file docker-compose.prod.yml] \
#     [--project waste-equity-prod]
set -euo pipefail
cd "$(dirname "$0")/../.."

REF="" ; ENV_FILE=".env.production" ; COMPOSE_FILE="docker-compose.prod.yml"
PROJECT="waste-equity-prod"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "${REF}" ]] || { echo "✗ --ref PREVIOUS_GIT_REF is required" >&2; exit 2; }

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")
DB_USER="waste_equity"; DB_NAME="waste_equity"
if [[ -f "${ENV_FILE}" ]]; then
  set -a; # shellcheck disable=SC1090
  source "${ENV_FILE}"; set +a
  DB_USER="${POSTGRES_USER:-${DB_USER}}"; DB_NAME="${POSTGRES_DB:-${DB_NAME}}"
fi

# Current DB schema revision.
DB_REV="$("${COMPOSE[@]}" exec -T database psql -U "${DB_USER}" -d "${DB_NAME}" -tA \
  -c "SELECT version_num FROM alembic_version;" 2>/dev/null | tr -d '[:space:]' || true)"
echo "Current database schema revision: ${DB_REV:-unknown}"

git fetch --all --tags
# Does the target ref contain the migration file for the DB's current revision?
if [[ -n "${DB_REV}" ]]; then
  if ! git grep -qE "revision(: str)? *= *[\"']${DB_REV}[\"']" "${REF}" -- backend/alembic/versions 2>/dev/null; then
    echo "STOP — application revision ${REF} does not contain the current DB schema" >&2
    echo "revision ${DB_REV}; rolling the app back would require a destructive DB" >&2
    echo "downgrade. Aborting. Restore from a backup or roll the schema forward instead." >&2
    exit 1
  fi
fi

echo "Rolling application back to ${REF} (database schema unchanged)..."
git checkout "${REF}"
ROLLBACK_SHA="$(git rev-parse HEAD)"

"${COMPOSE[@]}" build backend frontend
# Recreate app containers only; database is left running/untouched.
"${COMPOSE[@]}" up -d backend frontend caddy

for _ in $(seq 1 40); do
  [[ "$("${COMPOSE[@]}" ps backend --format '{{.Health}}' 2>/dev/null || true)" == "healthy" ]] && break
  sleep 3
done
[[ "$("${COMPOSE[@]}" ps backend --format '{{.Health}}')" == "healthy" ]] \
  || { echo "✗ backend did not become healthy after rollback" >&2; exit 1; }

echo "✓ application rolled back to ${ROLLBACK_SHA}; database schema left at ${DB_REV:-unknown}"
