#!/usr/bin/env bash
#
# Read-only land-cover / suitability database baseline.
#
# Emits a deterministic, ordered `key|value` report covering the suitability
# and land-cover (LC2/LC3) tables. It is used to prove that QA activity —
# running tests, rebuilding containers, browsing the map, issuing API and tile
# requests — leaves the local database byte-identical.
#
# The script issues SELECT statements only. It never writes, never creates a
# temporary object, and never touches the Docker volume. Run it once before QA
# and once after, then diff the two outputs.
#
# Usage:
#   scripts/qa/land-cover-db-baseline.sh > /tmp/baseline-pre.txt
#   ... perform QA ...
#   scripts/qa/land-cover-db-baseline.sh > /tmp/baseline-post.txt
#   diff /tmp/baseline-pre.txt /tmp/baseline-post.txt
#
# Environment:
#   DB_SERVICE  docker compose service name of the database (default: database)
#   DB_USER     PostgreSQL role (default: waste_equity)
#   DB_NAME     PostgreSQL database (default: waste_equity)

set -euo pipefail

DB_SERVICE="${DB_SERVICE:-database}"
DB_USER="${DB_USER:-waste_equity}"
DB_NAME="${DB_NAME:-waste_equity}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# `-t -A -F'|'` gives tuples-only, unaligned, pipe-separated output so the
# result is diffable without psql formatting noise.
docker compose exec -T "$DB_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -t -A -F'|' <<'SQL'
-- Guard: refuse to proceed if the session could write.
SET default_transaction_read_only = on;

WITH
alembic AS (
    SELECT
        (SELECT string_agg(version_num, ',' ORDER BY version_num)
           FROM alembic_version) AS revision,
        (SELECT count(*) FROM alembic_version) AS head_count
),
-- Suitability -------------------------------------------------------------
suit_runs AS (
    SELECT
        count(*) AS run_count,
        md5(string_agg(
            id::text || ':' || derivation_version || ':' || policy_version || ':'
              || candidate_grid_version || ':' || weight_profile || ':' || status,
            '|' ORDER BY id)) AS run_checksum,
        md5(string_agg(policy_version, '|' ORDER BY id)) AS policy_version_checksum,
        md5(string_agg(derivation_version, '|' ORDER BY id)) AS derivation_version_checksum,
        md5(string_agg(candidate_grid_version, '|' ORDER BY id)) AS grid_version_checksum
    FROM suitability_analysis_runs
),
suit_cands AS (
    SELECT
        count(*) AS candidate_count,
        md5(string_agg(
            coalesce(total_score::text, 'NULL') || ':'
              || coalesce(provisional_score::text, 'NULL') || ':'
              || coalesce(zoning_score::text, 'NULL') || ':'
              || coalesce(road_score::text, 'NULL') || ':'
              || coalesce(equity_score::text, 'NULL') || ':'
              || coalesce(demand_score::text, 'NULL'),
            '|' ORDER BY analysis_run_id, candidate_key)) AS score_checksum,
        md5(string_agg(coalesce(rank::text, 'NULL'),
            '|' ORDER BY analysis_run_id, candidate_key)) AS rank_checksum,
        md5(string_agg(status,
            '|' ORDER BY analysis_run_id, candidate_key)) AS status_checksum,
        md5(string_agg(
            coalesce(exclusion_reasons::text, 'NULL') || ':'
              || coalesce(review_reasons::text, 'NULL') || ':'
              || coalesce(penalties::text, 'NULL'),
            '|' ORDER BY analysis_run_id, candidate_key)) AS exclusion_review_checksum,
        md5(string_agg(md5(ST_AsEWKB(geometry)::text) || ':' || md5(ST_AsEWKB(centroid)::text),
            '' ORDER BY analysis_run_id, candidate_key)) AS geometry_checksum,
        md5(string_agg(
            coalesce(stability_class, 'NULL') || ':' || coalesce(stable_count::text, 'NULL'),
            '|' ORDER BY analysis_run_id, candidate_key)) AS stability_checksum
    FROM suitability_candidates
),
-- Land cover: LC3 statistics versions --------------------------------------
lc_versions AS (
    SELECT
        count(*) AS version_count,
        count(*) FILTER (WHERE is_active) AS active_version_count,
        md5(string_agg(
            id::text || ':' || derivation_version || ':' || candidate_grid_version || ':'
              || candidate_grid_fingerprint || ':' || input_signature || ':' || status || ':'
              || is_active::text || ':' || area_crs || ':'
              || expected_cell_count::text || ':' || processed_cell_count::text || ':'
              || complete_exact_count::text || ':' || partial_count::text || ':'
              || no_coverage_count::text || ':' || failed_cell_count::text || ':'
              || candidate_row_count::text || ':' || class_row_count::text,
            '|' ORDER BY id)) AS version_checksum
    FROM environmental_land_cover_cell_stat_versions
),
lc_active AS (
    SELECT id, status, is_active, derivation_version, candidate_grid_version,
           area_crs, land_cover_dataset_version_id,
           expected_cell_count, processed_cell_count,
           complete_exact_count, partial_count, no_coverage_count,
           failed_cell_count, candidate_row_count, class_row_count
    FROM environmental_land_cover_cell_stat_versions
    WHERE is_active
    ORDER BY id
    LIMIT 1
),
-- Land cover: LC3 cell statistics ------------------------------------------
lc_cells AS (
    SELECT
        count(*) AS cell_count,
        md5(string_agg(md5(
            candidate_key || ':' || coverage_status || ':'
              || cell_area_m2::text || ':' || evaluated_area_m2::text || ':'
              || uncovered_area_m2::text || ':' || coverage_ratio::text || ':'
              || coalesce(dominant_l1_code, 'NULL') || ':'
              || coalesce(dominant_l2_code, 'NULL') || ':'
              || coalesce(dominant_l3_code, 'NULL') || ':'
              || l1_class_count::text || ':' || l2_class_count::text || ':'
              || l3_class_count::text),
            '' ORDER BY statistics_version_id, candidate_key)) AS cell_checksum
    FROM environmental_land_cover_cell_statistics
),
lc_cell_status AS (
    SELECT
        count(*) FILTER (WHERE coverage_status = 'COMPLETE_EXACT') AS complete_exact,
        count(*) FILTER (WHERE coverage_status = 'PARTIAL') AS partial,
        count(*) FILTER (WHERE coverage_status = 'NO_COVERAGE') AS no_coverage
    FROM environmental_land_cover_cell_statistics
),
-- Land cover: LC3 class areas ----------------------------------------------
lc_classes AS (
    SELECT
        count(*) AS class_row_count,
        md5(string_agg(md5(
            candidate_key || ':' || class_level::text || ':' || class_code || ':'
              || class_name || ':' || class_area_m2::text || ':'
              || share_of_evaluated_area::text || ':' || share_of_cell_area::text),
            '' ORDER BY statistics_version_id, candidate_key, class_level, class_code))
            AS class_checksum
    FROM environmental_land_cover_cell_class_areas
),
-- Land cover: LC2 raw source ------------------------------------------------
lc_raw AS (
    SELECT
        (SELECT count(*) FROM environmental_land_cover_features) AS feature_count,
        (SELECT count(*) FROM environmental_land_cover_map_sheets) AS map_sheet_count,
        (SELECT count(*) FROM environmental_dataset_versions
          WHERE layer_name = 'land_cover') AS dataset_version_count
),
lc_dataset AS (
    SELECT id, reference_period, license_note, is_active, transformation_version,
           total_feature_count, accepted_feature_count, rejected_feature_count,
           source_crs, target_crs, source_encoding
    FROM environmental_dataset_versions
    WHERE layer_name = 'land_cover'
    ORDER BY id
    LIMIT 1
)
SELECT * FROM (
    SELECT 1 AS ord, 'alembic.revision'                  AS k, revision              AS v FROM alembic
    UNION ALL SELECT 2,  'alembic.head_count',              head_count::text          FROM alembic
    UNION ALL SELECT 10, 'suitability.run_count',           run_count::text           FROM suit_runs
    UNION ALL SELECT 11, 'suitability.run_checksum',        run_checksum              FROM suit_runs
    UNION ALL SELECT 12, 'suitability.policy_version_checksum', policy_version_checksum FROM suit_runs
    UNION ALL SELECT 13, 'suitability.derivation_version_checksum', derivation_version_checksum FROM suit_runs
    UNION ALL SELECT 14, 'suitability.grid_version_checksum', grid_version_checksum   FROM suit_runs
    UNION ALL SELECT 20, 'suitability.candidate_count',     candidate_count::text     FROM suit_cands
    UNION ALL SELECT 21, 'suitability.score_checksum',      score_checksum            FROM suit_cands
    UNION ALL SELECT 22, 'suitability.rank_checksum',       rank_checksum             FROM suit_cands
    UNION ALL SELECT 23, 'suitability.status_checksum',     status_checksum           FROM suit_cands
    UNION ALL SELECT 24, 'suitability.exclusion_review_checksum', exclusion_review_checksum FROM suit_cands
    UNION ALL SELECT 25, 'suitability.geometry_checksum',   geometry_checksum         FROM suit_cands
    UNION ALL SELECT 26, 'suitability.stability_checksum',  stability_checksum        FROM suit_cands
    UNION ALL SELECT 30, 'lc3.version_count',               version_count::text       FROM lc_versions
    UNION ALL SELECT 31, 'lc3.active_version_count',        active_version_count::text FROM lc_versions
    UNION ALL SELECT 32, 'lc3.version_checksum',            version_checksum          FROM lc_versions
    UNION ALL SELECT 33, 'lc3.active_version_id',           id::text                  FROM lc_active
    UNION ALL SELECT 34, 'lc3.active_status',               status                    FROM lc_active
    UNION ALL SELECT 35, 'lc3.active_derivation_version',   derivation_version        FROM lc_active
    UNION ALL SELECT 36, 'lc3.active_candidate_grid_version', candidate_grid_version  FROM lc_active
    UNION ALL SELECT 37, 'lc3.active_area_crs',             area_crs                  FROM lc_active
    UNION ALL SELECT 38, 'lc3.active_dataset_version_id',   land_cover_dataset_version_id::text FROM lc_active
    UNION ALL SELECT 39, 'lc3.active_expected_cell_count',  expected_cell_count::text FROM lc_active
    UNION ALL SELECT 40, 'lc3.active_processed_cell_count', processed_cell_count::text FROM lc_active
    UNION ALL SELECT 41, 'lc3.active_complete_exact_count', complete_exact_count::text FROM lc_active
    UNION ALL SELECT 42, 'lc3.active_partial_count',        partial_count::text       FROM lc_active
    UNION ALL SELECT 43, 'lc3.active_no_coverage_count',    no_coverage_count::text   FROM lc_active
    UNION ALL SELECT 44, 'lc3.active_failed_cell_count',    failed_cell_count::text   FROM lc_active
    UNION ALL SELECT 45, 'lc3.active_candidate_row_count',  candidate_row_count::text FROM lc_active
    UNION ALL SELECT 46, 'lc3.active_class_row_count',      class_row_count::text     FROM lc_active
    UNION ALL SELECT 50, 'lc3.cell_count',                  cell_count::text          FROM lc_cells
    UNION ALL SELECT 51, 'lc3.cell_checksum',               cell_checksum             FROM lc_cells
    UNION ALL SELECT 52, 'lc3.cells_complete_exact',        complete_exact::text      FROM lc_cell_status
    UNION ALL SELECT 53, 'lc3.cells_partial',               partial::text             FROM lc_cell_status
    UNION ALL SELECT 54, 'lc3.cells_no_coverage',           no_coverage::text         FROM lc_cell_status
    UNION ALL SELECT 60, 'lc3.class_row_count',             class_row_count::text     FROM lc_classes
    UNION ALL SELECT 61, 'lc3.class_checksum',              class_checksum            FROM lc_classes
    UNION ALL SELECT 70, 'lc2.feature_count',               feature_count::text       FROM lc_raw
    UNION ALL SELECT 71, 'lc2.map_sheet_count',             map_sheet_count::text     FROM lc_raw
    UNION ALL SELECT 72, 'lc2.dataset_version_count',       dataset_version_count::text FROM lc_raw
    UNION ALL SELECT 73, 'lc2.dataset_version_id',          id::text                  FROM lc_dataset
    UNION ALL SELECT 74, 'lc2.dataset_reference_period',    reference_period          FROM lc_dataset
    UNION ALL SELECT 75, 'lc2.dataset_licence_note_md5',    md5(license_note)         FROM lc_dataset
    UNION ALL SELECT 76, 'lc2.dataset_is_active',           is_active::text           FROM lc_dataset
    UNION ALL SELECT 77, 'lc2.dataset_transformation_version', transformation_version FROM lc_dataset
    UNION ALL SELECT 78, 'lc2.dataset_total_feature_count', total_feature_count::text FROM lc_dataset
    UNION ALL SELECT 79, 'lc2.dataset_accepted_feature_count', accepted_feature_count::text FROM lc_dataset
    UNION ALL SELECT 80, 'lc2.dataset_rejected_feature_count', rejected_feature_count::text FROM lc_dataset
    UNION ALL SELECT 81, 'lc2.dataset_source_crs',          source_crs                FROM lc_dataset
    UNION ALL SELECT 82, 'lc2.dataset_target_crs',          target_crs                FROM lc_dataset
    UNION ALL SELECT 83, 'lc2.dataset_source_encoding',     source_encoding           FROM lc_dataset
) rows
ORDER BY ord;
SQL
