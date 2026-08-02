#!/usr/bin/env bash
#
# Export the SANITIZED, derived land-cover deployment package (Phase 1B-LC8).
#
# Exports exactly the dependency closure the PUBLIC runtime needs and nothing more.
# Verified from the router source and its SQL before this script was written: the
# public endpoints and the MVT tiles read only
#
#   environmental_land_cover_cell_stat_versions
#   environmental_land_cover_cell_statistics
#   environmental_land_cover_cell_class_areas
#   environmental_dataset_versions              (release provenance)
#   suitability_candidates / suitability_analysis_runs   (already in production)
#
# and NEVER `environmental_land_cover_features` (6.9 M raw source polygons) or
# `environmental_land_cover_map_sheets`. Those two tables are therefore NOT exported,
# and no original SHP file, raw source polygon, or per-feature source record leaves
# this machine.
#
# Surrogate ids are deliberately NOT exported: production resolves identity from
# stable natural keys — the dataset release key
# (layer_name, provider_dataset_identifier, reference_period, source_checksum,
# transformation_version) and the statistics release's UNIQUE `input_signature`.
# `id`, `statistics_version_id`, `land_cover_dataset_version_id`, `cell_statistics_id`
# and `ingestion_run_id` are all re-resolved on import.
#
# Read-only: the session is set read-only and only COPY ... TO / SELECT run.
#
# Usage:
#   scripts/deploy/export-land-cover-derived-package.sh <output-dir>
#
# Environment:
#   DB_SERVICE  docker compose service name of the database (default: database)
#   DB_USER     PostgreSQL role (default: waste_equity)
#   DB_NAME     PostgreSQL database (default: waste_equity)

set -euo pipefail

OUT_DIR="${1:?usage: export-land-cover-derived-package.sh <output-dir>}"
DB_SERVICE="${DB_SERVICE:-database}"
DB_USER="${DB_USER:-waste_equity}"
DB_NAME="${DB_NAME:-waste_equity}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

mkdir -p "$OUT_DIR"

# Read-only is enforced by the SERVER for the whole session (PGOPTIONS), not by an
# in-band `SET` statement — psql echoes "SET" onto stdout, which would corrupt the
# single-value outputs and the CSV files this script writes.
psql_ro() {
  docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' "$DB_SERVICE" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

echo "== resolving the active statistics release =="
ACTIVE=$(psql_ro -tA <<'SQL'
SELECT id || '|' || input_signature || '|' || candidate_grid_version || '|'
       || candidate_grid_fingerprint || '|' || derivation_version
FROM environmental_land_cover_cell_stat_versions
WHERE is_active
ORDER BY id;
SQL
)
if [ "$(printf '%s\n' "$ACTIVE" | grep -c .)" != "1" ]; then
  echo "REFUSING: expected exactly one active statistics release, got:" >&2
  printf '%s\n' "$ACTIVE" >&2
  exit 1
fi
VERSION_ID="${ACTIVE%%|*}"
echo "active statistics version id (local surrogate, NOT exported): $VERSION_ID"
# --- 1. Dataset release (provenance) -----------------------------------------
# `ingestion_run_id` is excluded: it names a LOCAL run that has no meaning in
# production, and inventing a production run for a raw ingestion that never happened
# there would be false.
echo "== exporting dataset release =="
psql_ro -tA > "$OUT_DIR/dataset_version.json" <<SQL
SELECT jsonb_pretty(to_jsonb(t) - 'id' - 'ingestion_run_id')
FROM (
  SELECT * FROM environmental_dataset_versions
  WHERE id = (SELECT land_cover_dataset_version_id
                FROM environmental_land_cover_cell_stat_versions WHERE id = $VERSION_ID)
) t;
SQL

# --- 2. Statistics release ----------------------------------------------------
echo "== exporting statistics release =="
psql_ro -tA > "$OUT_DIR/stat_version.json" <<SQL
SELECT jsonb_pretty(to_jsonb(t) - 'id' - 'land_cover_dataset_version_id' - 'ingestion_run_id')
FROM (
  SELECT * FROM environmental_land_cover_cell_stat_versions WHERE id = $VERSION_ID
) t;
SQL

# --- 3. Cell statistics -------------------------------------------------------
# Ordered by candidate_key so the file is byte-deterministic across exports.
echo "== exporting cell statistics =="
psql_ro -tA -c "COPY (
  SELECT candidate_grid_version, candidate_key, candidate_geometry_fingerprint,
         sido_region_code, sido_region_name, sigungu_region_code, sigungu_region_name,
         cell_area_m2, evaluated_area_m2, uncovered_area_m2, coverage_ratio,
         intersection_area_sum_m2, overlap_area_m2, coverage_status,
         uncovered_residual_area_m2, topological_cover_predicate, matched_feature_count,
         dominant_l1_code, dominant_l1_name, dominant_l2_code, dominant_l2_name,
         dominant_l3_code, dominant_l3_name,
         l1_class_count, l2_class_count, l3_class_count,
         l1_class_area_sum_m2, l2_class_area_sum_m2, l3_class_area_sum_m2,
         candidate_occurrence_count, representation_variant_count, guard_applied,
         derivation_version, area_crs, created_at
  FROM environmental_land_cover_cell_statistics
  WHERE statistics_version_id = $VERSION_ID
  ORDER BY candidate_key
) TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" > "$OUT_DIR/cell_statistics.csv"

# --- 4. Class areas -----------------------------------------------------------
# `cell_statistics_id` is NOT exported: production re-resolves it from
# (statistics_version_id, candidate_key), which is UNIQUE there.
echo "== exporting class areas =="
psql_ro -tA -c "COPY (
  SELECT candidate_key, class_level, class_code, class_name, class_area_m2,
         share_of_evaluated_area, share_of_cell_area, created_at
  FROM environmental_land_cover_cell_class_areas
  WHERE statistics_version_id = $VERSION_ID
  ORDER BY candidate_key, class_level, class_code
) TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)" > "$OUT_DIR/class_areas.csv"

# --- 5. Expected-state manifest ----------------------------------------------
# The same content checksums `scripts/qa/land-cover-db-baseline.sh` computes, so the
# import can be proven to have reproduced the local content EXACTLY rather than merely
# the right row counts.
echo "== exporting expected state =="
psql_ro -tA > "$OUT_DIR/expected_state.json" <<SQL
SELECT jsonb_pretty(jsonb_build_object(
  'candidate_grid_version', (SELECT candidate_grid_version
                               FROM environmental_land_cover_cell_stat_versions
                              WHERE id = $VERSION_ID),
  'candidate_grid_fingerprint', (SELECT candidate_grid_fingerprint
                                   FROM environmental_land_cover_cell_stat_versions
                                  WHERE id = $VERSION_ID),
  'input_signature', (SELECT input_signature
                        FROM environmental_land_cover_cell_stat_versions
                       WHERE id = $VERSION_ID),
  'cell_count', (SELECT count(*) FROM environmental_land_cover_cell_statistics
                  WHERE statistics_version_id = $VERSION_ID),
  'class_row_count', (SELECT count(*) FROM environmental_land_cover_cell_class_areas
                       WHERE statistics_version_id = $VERSION_ID),
  'coverage_status_counts', (SELECT jsonb_object_agg(coverage_status, n)
                               FROM (SELECT coverage_status, count(*) AS n
                                       FROM environmental_land_cover_cell_statistics
                                      WHERE statistics_version_id = $VERSION_ID
                                      GROUP BY coverage_status) s),
  'cell_checksum', (
      SELECT md5(string_agg(md5(
          candidate_key || ':' || coverage_status || ':'
            || cell_area_m2::text || ':' || evaluated_area_m2::text || ':'
            || uncovered_area_m2::text || ':' || coverage_ratio::text || ':'
            || coalesce(dominant_l1_code, 'NULL') || ':'
            || coalesce(dominant_l2_code, 'NULL') || ':'
            || coalesce(dominant_l3_code, 'NULL') || ':'
            || l1_class_count::text || ':' || l2_class_count::text || ':'
            || l3_class_count::text),
          '' ORDER BY candidate_key))
        FROM environmental_land_cover_cell_statistics
       WHERE statistics_version_id = $VERSION_ID),
  'class_checksum', (
      SELECT md5(string_agg(md5(
          candidate_key || ':' || class_level::text || ':' || class_code || ':'
            || class_name || ':' || class_area_m2::text || ':'
            || share_of_evaluated_area::text || ':' || share_of_cell_area::text),
          '' ORDER BY candidate_key, class_level, class_code))
        FROM environmental_land_cover_cell_class_areas
       WHERE statistics_version_id = $VERSION_ID),
  'candidate_key_set_md5', (
      SELECT md5(string_agg(candidate_key, '|' ORDER BY candidate_key))
        FROM environmental_land_cover_cell_statistics
       WHERE statistics_version_id = $VERSION_ID)
));
SQL

# --- 6. Checksums -------------------------------------------------------------
echo "== computing SHA-256 checksums =="
(
  cd "$OUT_DIR"
  shasum -a 256 dataset_version.json stat_version.json cell_statistics.csv \
                class_areas.csv expected_state.json > SHA256SUMS
  cat SHA256SUMS
)

echo
echo "package written to: $OUT_DIR"
ls -la "$OUT_DIR"
