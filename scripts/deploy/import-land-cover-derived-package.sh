#!/usr/bin/env bash
#
# Import the derived land-cover deployment package into a target database
# (Phase 1B-LC8). Runs `import-land-cover-derived-package.sql` in ONE transaction.
#
# What it does NOT do, by construction:
#   * it never imports raw land-cover source features or map sheets;
#   * it never deletes, truncates, or updates an unrelated row;
#   * it never disables a constraint;
#   * it never drops a volume, database, or schema.
#
# Every gate lives inside the transaction, so a failure rolls the whole import back and
# leaves the database exactly as it was. Re-running the same package inserts zero
# logical rows.
#
# Usage:
#   scripts/deploy/import-land-cover-derived-package.sh <package-dir>
#
# Environment:
#   COMPOSE_PROJECT  docker compose project name (default: none — plain `docker compose`)
#   DB_SERVICE       database compose service (default: database)
#   DB_USER          PostgreSQL role   (default: waste_equity)
#   DB_NAME          PostgreSQL database (default: waste_equity)

set -euo pipefail

PKG_DIR="${1:?usage: import-land-cover-derived-package.sh <package-dir>}"
DB_SERVICE="${DB_SERVICE:-database}"
DB_USER="${DB_USER:-waste_equity}"
DB_NAME="${DB_NAME:-waste_equity}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_FILE="$REPO_ROOT/scripts/deploy/import-land-cover-derived-package.sql"
cd "$REPO_ROOT"

if [ -n "${COMPOSE_PROJECT:-}" ]; then
  DC=(docker compose -p "$COMPOSE_PROJECT")
else
  DC=(docker compose)
fi

for f in dataset_version.json stat_version.json cell_statistics.csv class_areas.csv SHA256SUMS; do
  [ -f "$PKG_DIR/$f" ] || { echo "missing package file: $PKG_DIR/$f" >&2; exit 1; }
done

echo "== verifying package checksums =="
# GNU coreutils on the server, BSD `shasum` on a maintainer's macOS. Both read the
# same SHA256SUMS format, so the package is verified identically either way.
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$PKG_DIR" && sha256sum -c SHA256SUMS )
else
  ( cd "$PKG_DIR" && shasum -a 256 -c SHA256SUMS )
fi

CID="$("${DC[@]}" ps -q "$DB_SERVICE")"
[ -n "$CID" ] || { echo "database service '$DB_SERVICE' is not running" >&2; exit 1; }

# `\copy` is a CLIENT-side command, so the CSVs must exist where psql runs. Staging
# them inside the database container (not bind-mounting the repo) keeps the package out
# of every image and volume; the staging directory is removed on exit, success or not.
STAGE="/tmp/lc8-import-$$"
cleanup() { docker exec "$CID" rm -rf "$STAGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== staging package inside the database container =="
docker exec "$CID" mkdir -p "$STAGE"
docker cp "$PKG_DIR/cell_statistics.csv" "$CID:$STAGE/cell_statistics.csv"
docker cp "$PKG_DIR/class_areas.csv" "$CID:$STAGE/class_areas.csv"
# psql performs no variable interpolation inside `\copy`, so the two CSV paths are
# substituted into a temporary copy of the script rather than passed as psql variables.
RENDERED="$(mktemp "${TMPDIR:-/tmp}/lc8-import-sql.XXXXXX")"
trap 'cleanup; rm -f "$RENDERED"' EXIT
sed -e "s#@CELLS_CSV@#$STAGE/cell_statistics.csv#" \
    -e "s#@CLASSES_CSV@#$STAGE/class_areas.csv#" "$SQL_FILE" > "$RENDERED"
docker cp "$RENDERED" "$CID:$STAGE/import.sql"

DS_JSON="$(cat "$PKG_DIR/dataset_version.json")"
SV_JSON="$(cat "$PKG_DIR/stat_version.json")"

echo "== importing (single transaction) =="
docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -v "ds_json=$DS_JSON" \
  -v "sv_json=$SV_JSON" \
  -f "$STAGE/import.sql"

echo "== import complete =="
