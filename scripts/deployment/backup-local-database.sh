#!/usr/bin/env bash
# Back up the LOCAL development PostGIS database to a custom-format dump for
# transfer to production. Uses the local dev compose stack (docker-compose.yml).
#
# The dump is written to ./backups/ (Git-ignored), timestamped. On success the
# file size and SHA-256 are printed; the dump CONTENTS and credentials are never
# printed. Fails non-zero on any error.
#
# Usage: scripts/deployment/backup-local-database.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root

COMPOSE_FILE="docker-compose.yml"
SERVICE="database"
DB_USER="${POSTGRES_USER:-waste_equity}"
DB_NAME="${POSTGRES_DB:-waste_equity}"
BACKUP_DIR="backups"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/waste_equity_local_${TS}.dump"

mkdir -p "${BACKUP_DIR}"

echo "Backing up local database '${DB_NAME}' (user ${DB_USER}) -> ${OUT}"
if ! docker compose -f "${COMPOSE_FILE}" ps "${SERVICE}" 2>/dev/null | grep -q "Up\|running"; then
  echo "  ! local database container is not running; starting it..." >&2
  docker compose -f "${COMPOSE_FILE}" up -d "${SERVICE}"
  # brief readiness wait
  for _ in $(seq 1 30); do
    if docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

# --format=custom is compressed and restorable selectively by pg_restore.
if ! docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE}" \
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
echo "Transfer this file securely (e.g. scp) to the production server, then run"
echo "restore-production-database.sh there."
