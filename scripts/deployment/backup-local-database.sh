#!/usr/bin/env bash
# Back up the LOCAL development PostGIS database to a custom-format dump for
# transfer to production. Uses the local dev compose stack (docker-compose.yml).
#
# The dump is written to ./backups/ (Git-ignored), timestamped. On success the
# file size and SHA-256 are printed; the dump CONTENTS and credentials are never
# printed. Fails non-zero on any error.
#
# The Compose project is PINNED (see PROJECT below) rather than derived from the
# working directory. Docker Compose defaults the project name to the basename of
# the directory it is invoked from, so running this from a Git worktree — whose
# basename differs from the primary checkout's — silently addresses a DIFFERENT
# project. The previous version then found no database service there and started
# one, creating an empty database and volume, and produced a valid-looking dump
# of the wrong database. A backup of the wrong database is worse than no backup.
#
# For the same reason this script never creates or starts anything. If the
# pinned project has no running database container it fails and tells the
# operator which command to run. Before pg_dump it verifies that the resolved
# container really holds the application database: expected database name,
# a readable Alembic migration head, the core application tables, and a
# non-empty regions table (an accidental empty Compose instance has none of
# these). These are deliberately generic application signals — this helper backs
# up the whole database and must not require any one feature's data.
#
# Usage:
#   scripts/deployment/backup-local-database.sh \
#     [--project waste-equity-platform] [--compose-file docker-compose.yml] \
#     [--env-file .env] [--out-dir backups]
#
# COMPOSE_PROJECT overrides the default project (same convention as
# scripts/deploy/import-land-cover-derived-package.sh); --project wins over it.
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root

COMPOSE_FILE="docker-compose.yml"
# The local dev stack's project name. It is the basename of the primary checkout,
# which is what Compose derived before this was pinned, so the default preserves
# the established local stack rather than introducing a new one.
PROJECT="${COMPOSE_PROJECT:-waste-equity-platform}"
ENV_FILE=".env"
BACKUP_DIR="backups"
SERVICE="database"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --out-dir) BACKUP_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "${PROJECT}" ]] || { echo "✗ --project must not be empty" >&2; exit 2; }
[[ -f "${COMPOSE_FILE}" ]] || { echo "✗ compose file not found: ${COMPOSE_FILE}" >&2; exit 1; }

# Credentials resolve caller environment first, then the local env file, then the
# compose defaults — the same precedence the compose file itself applies. Values
# are never printed.
CALLER_DB_USER="${POSTGRES_USER:-}"
CALLER_DB_NAME="${POSTGRES_DB:-}"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
DB_USER="${CALLER_DB_USER:-${POSTGRES_USER:-waste_equity}}"
DB_NAME="${CALLER_DB_NAME:-${POSTGRES_DB:-waste_equity}}"

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}")

echo "Backing up local database '${DB_NAME}' from Compose project '${PROJECT}'"

# --- resolve the target container without creating anything -----------------
# `ps -q` only reports containers that already exist for this project; it never
# creates one. An empty answer is a hard failure, not a reason to start a stack.
CID="$("${COMPOSE[@]}" ps -q "${SERVICE}" 2>/dev/null || true)"
CID="${CID%%$'\n'*}"
if [[ -z "${CID}" ]]; then
  {
    echo "✗ no '${SERVICE}' container in Compose project '${PROJECT}'"
    echo "  This script will NOT start one: an auto-started stack would be a new,"
    echo "  empty database and the resulting dump would be silently wrong."
    echo "  Start the intended stack yourself, then re-run:"
    echo "    docker compose -p ${PROJECT} -f ${COMPOSE_FILE} up -d ${SERVICE}"
    echo "  If the local stack really runs under another project name, pass it:"
    echo "    $0 --project <name>       (docker compose ls lists them)"
  } >&2
  exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "${CID}" 2>/dev/null || echo false)" != "true" ]]; then
  echo "✗ database container ${CID:0:12} exists but is not running" >&2
  echo "  Start it: docker compose -p ${PROJECT} -f ${COMPOSE_FILE} start ${SERVICE}" >&2
  exit 1
fi

if ! docker exec -i "${CID}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
  echo "✗ database '${DB_NAME}' in ${CID:0:12} is not accepting connections" >&2
  exit 1
fi

# --- verify this is the application database, before pg_dump ----------------
# Every check below runs against the resolved container. pg_dump is reached only
# if all of them pass, so an empty or unrelated database can never be dumped.
psql_q() {
  docker exec -i "${CID}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAX -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null
}

fail_verify() {
  echo "✗ refusing to dump: $1" >&2
  echo "  Target: project '${PROJECT}', container ${CID:0:12}, database '${DB_NAME}'." >&2
  echo "  This does not look like the application database. Check that '${PROJECT}'" >&2
  echo "  is the stack you meant (docker compose ls) rather than an empty one." >&2
  exit 1
}

ACTUAL_DB="$(psql_q "SELECT current_database();" || true)"
[[ "${ACTUAL_DB}" == "${DB_NAME}" ]] \
  || fail_verify "connected database is '${ACTUAL_DB:-<unreadable>}', expected '${DB_NAME}'"

[[ "$(psql_q "SELECT to_regclass('public.alembic_version') IS NOT NULL;" || true)" == "t" ]] \
  || fail_verify "no alembic_version table — the schema was never migrated"

ALEMBIC_HEAD="$(psql_q "SELECT version_num FROM alembic_version;" || true)"
ALEMBIC_HEAD="${ALEMBIC_HEAD%%$'\n'*}"
[[ -n "${ALEMBIC_HEAD}" ]] \
  || fail_verify "alembic_version is empty — no migration head to read"

# Core application tables, present in every migrated database regardless of which
# datasets have been ingested. Feature-specific tables are deliberately not required.
for table in regions data_sources ingestion_runs; do
  [[ "$(psql_q "SELECT to_regclass('public.${table}') IS NOT NULL;" || true)" == "t" ]] \
    || fail_verify "core table '${table}' is missing"
done

REGION_COUNT="$(psql_q "SELECT count(*) FROM regions;" || true)"
REGION_COUNT="${REGION_COUNT%%$'\n'*}"
[[ "${REGION_COUNT}" =~ ^[0-9]+$ && "${REGION_COUNT}" -gt 0 ]] \
  || fail_verify "regions is empty (${REGION_COUNT:-<unreadable>} rows) — this is an empty Compose instance, not the dev database"

echo "  ✓ verified target: container ${CID:0:12}, alembic head ${ALEMBIC_HEAD}, ${REGION_COUNT} regions"

# --- dump -------------------------------------------------------------------
mkdir -p "${BACKUP_DIR}"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/waste_equity_local_${TS}.dump"

# --format=custom is compressed and restorable selectively by pg_restore.
if ! docker exec -i "${CID}" \
      pg_dump --format=custom --no-owner --no-privileges -U "${DB_USER}" -d "${DB_NAME}" > "${OUT}"; then
  echo "  ✗ pg_dump failed" >&2
  rm -f "${OUT}"
  exit 1
fi

if [[ ! -s "${OUT}" ]]; then
  echo "  ✗ dump is empty" >&2
  rm -f "${OUT}"
  exit 1
fi

SIZE="$(du -h "${OUT}" | cut -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "${OUT}" | cut -d' ' -f1)"
else
  SHA="$(shasum -a 256 "${OUT}" | cut -d' ' -f1)"
fi

echo "  ✓ backup complete"
echo "    file:   ${OUT}"
echo "    size:   ${SIZE}"
echo "    sha256: ${SHA}"
echo "    source: project '${PROJECT}', alembic head ${ALEMBIC_HEAD}"
echo "Transfer this file securely (e.g. scp) to the production server, then run"
echo "restore-production-database.sh there."
