-- Idempotent production import of the derived land-cover package (Phase 1B-LC8).
--
-- Loads ONLY the derived dependency closure the public runtime needs:
--   * the land-cover dataset-release provenance row,
--   * the derived statistics release,
--   * its per-cell statistics and per-cell class-area rows.
--
-- It NEVER touches `environmental_land_cover_features` (6.9 M raw source polygons) or
-- `environmental_land_cover_map_sheets`. No original SHP file, raw source polygon, or
-- per-feature source record is imported.
--
-- IDENTITY. Local surrogate ids are never trusted. Production identity is resolved
-- from stable natural keys:
--   * dataset release  → UNIQUE (layer_name, provider_dataset_identifier,
--                                reference_period, source_checksum,
--                                transformation_version)
--   * statistics release → UNIQUE (input_signature)
--   * cell             → UNIQUE (statistics_version_id, candidate_grid_version,
--                                candidate_key)
--   * class row        → UNIQUE (cell_statistics_id, class_level, class_code)
--
-- IDEMPOTENCY. Every insert is ON CONFLICT DO NOTHING against those keys, so a second
-- run inserts zero logical rows and changes nothing material.
--
-- SAFETY. One transaction. No DELETE, no TRUNCATE, no DROP of a persistent object, no
-- constraint disabled, no unrelated row touched. Any failed gate raises and rolls the
-- whole thing back, leaving production exactly as it was.
--
-- Requires (all supplied by the wrapper script):
--   @CELLS_CSV@    placeholder, substituted with the path to cell_statistics.csv
--   @CLASSES_CSV@  placeholder, substituted with the path to class_areas.csv
--   :ds_json       psql variable holding the dataset_version.json payload
--   :sv_json       psql variable holding the stat_version.json payload
--
-- The two CSV paths are TEXT PLACEHOLDERS rather than psql variables because psql
-- performs no variable interpolation inside `\copy`: it takes the whole remainder of
-- the line literally. The wrapper substitutes them when it stages this file.
--
-- Usage (see scripts/deploy/import-land-cover-derived-package.sh).

\set ON_ERROR_STOP on

BEGIN;

-- Staging lives only for this transaction; nothing persistent is created.
CREATE TEMP TABLE _lc8_cells (
    candidate_grid_version text,
    candidate_key text,
    candidate_geometry_fingerprint text,
    sido_region_code text,
    sido_region_name text,
    sigungu_region_code text,
    sigungu_region_name text,
    cell_area_m2 double precision,
    evaluated_area_m2 double precision,
    uncovered_area_m2 double precision,
    coverage_ratio double precision,
    intersection_area_sum_m2 double precision,
    overlap_area_m2 double precision,
    coverage_status text,
    uncovered_residual_area_m2 double precision,
    topological_cover_predicate boolean,
    matched_feature_count integer,
    dominant_l1_code text,
    dominant_l1_name text,
    dominant_l2_code text,
    dominant_l2_name text,
    dominant_l3_code text,
    dominant_l3_name text,
    l1_class_count integer,
    l2_class_count integer,
    l3_class_count integer,
    l1_class_area_sum_m2 double precision,
    l2_class_area_sum_m2 double precision,
    l3_class_area_sum_m2 double precision,
    candidate_occurrence_count integer,
    representation_variant_count integer,
    guard_applied boolean,
    derivation_version text,
    area_crs text,
    created_at timestamptz
) ON COMMIT DROP;

CREATE TEMP TABLE _lc8_classes (
    candidate_key text,
    class_level smallint,
    class_code text,
    class_name text,
    class_area_m2 double precision,
    share_of_evaluated_area double precision,
    share_of_cell_area double precision,
    created_at timestamptz
) ON COMMIT DROP;

\copy _lc8_cells FROM '@CELLS_CSV@' WITH (FORMAT csv, HEADER true)
\copy _lc8_classes FROM '@CLASSES_CSV@' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE _lc8_input (
    dataset jsonb,
    stat jsonb
) ON COMMIT DROP;
INSERT INTO _lc8_input (dataset, stat) VALUES (:'ds_json'::jsonb, :'sv_json'::jsonb);

-- --------------------------------------------------------------------------- --
-- Gate 0 — this importer deploys DERIVED data only.
--
-- Asserted up front so a wrong target fails immediately instead of after loading a
-- million rows, and asserted again after the import as proof that nothing raw arrived.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM environmental_land_cover_features;
    IF n > 0 THEN
        RAISE EXCEPTION
          'target already holds % raw land-cover source features; this importer '
          'deploys derived statistics only and refuses to run here', n;
    END IF;
    SELECT count(*) INTO n FROM environmental_land_cover_map_sheets;
    IF n > 0 THEN
        RAISE EXCEPTION 'target already holds % land-cover map sheets; refusing', n;
    END IF;
    RAISE NOTICE 'gate 0 OK: no raw land-cover source rows in the target';
END $$;

-- --------------------------------------------------------------------------- --
-- Gate 1 — the package is internally whole.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    cells bigint;
    classes bigint;
    expected_cells integer;
    expected_classes integer;
    orphan bigint;
BEGIN
    SELECT count(*) INTO cells FROM _lc8_cells;
    SELECT count(*) INTO classes FROM _lc8_classes;
    SELECT (stat->>'expected_cell_count')::int, (stat->>'class_row_count')::int
      INTO expected_cells, expected_classes FROM _lc8_input;

    IF cells <> expected_cells THEN
        RAISE EXCEPTION 'package cell count % <> release expected_cell_count %',
            cells, expected_cells;
    END IF;
    IF classes <> expected_classes THEN
        RAISE EXCEPTION 'package class count % <> release class_row_count %',
            classes, expected_classes;
    END IF;
    -- Every class row must belong to a cell in the same package.
    SELECT count(*) INTO orphan
      FROM (SELECT DISTINCT candidate_key FROM _lc8_classes) c
      LEFT JOIN _lc8_cells s USING (candidate_key)
     WHERE s.candidate_key IS NULL;
    IF orphan > 0 THEN
        RAISE EXCEPTION 'package holds % class candidate_keys with no cell row', orphan;
    END IF;
    -- A NO_COVERAGE cell must carry no class row — the invariant the whole
    -- "unevaluated is not empty land" contract rests on.
    SELECT count(*) INTO orphan
      FROM _lc8_cells s
      JOIN _lc8_classes c USING (candidate_key)
     WHERE s.coverage_status = 'NO_COVERAGE';
    IF orphan > 0 THEN
        RAISE EXCEPTION 'package holds % class rows on NO_COVERAGE cells', orphan;
    END IF;
    RAISE NOTICE 'gate 1 OK: % cells, % class rows', cells, classes;
END $$;

-- --------------------------------------------------------------------------- --
-- Gate 2 — the PRODUCTION candidate grid is the grid the package was derived on.
--
-- Recomputes, from production's own suitability_candidates, exactly the fingerprint
-- LC3 computed locally: per canonical occurrence (lowest analysis_run_id, id),
-- sha256(EWKB || 'grid:key'), aggregated in candidate_key order. If the grids differ
-- in ANY cell geometry or in the key set, this refuses before writing anything.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    grid text;
    want_fp text;
    got_fp text;
    got_count bigint;
    missing bigint;
    extra bigint;
BEGIN
    SELECT stat->>'candidate_grid_version', stat->>'candidate_grid_fingerprint'
      INTO grid, want_fp FROM _lc8_input;

    CREATE TEMP TABLE _lc8_canon ON COMMIT DROP AS
    WITH occurrence AS (
        SELECT c.candidate_key, c.geometry, c.analysis_run_id, c.id
          FROM suitability_candidates c
          JOIN suitability_analysis_runs r ON r.id = c.analysis_run_id
         WHERE r.candidate_grid_version = grid
    ), canonical AS (
        SELECT DISTINCT ON (candidate_key) *
          FROM occurrence
         ORDER BY candidate_key, analysis_run_id, id
    )
    SELECT candidate_key,
           encode(sha256(ST_AsEWKB(geometry)
                         || convert_to(grid || ':' || candidate_key, 'UTF8')), 'hex') AS gfp
      FROM canonical;

    SELECT count(*),
           encode(sha256(convert_to(
             string_agg(candidate_key || '=' || gfp, E'\n' ORDER BY candidate_key),
             'UTF8')), 'hex')
      INTO got_count, got_fp FROM _lc8_canon;

    IF got_fp IS DISTINCT FROM want_fp THEN
        RAISE EXCEPTION
          'production candidate grid fingerprint % <> package fingerprint % (cells: %)',
          got_fp, want_fp, got_count;
    END IF;

    SELECT count(*) INTO missing
      FROM _lc8_cells s LEFT JOIN _lc8_canon k USING (candidate_key)
     WHERE k.candidate_key IS NULL;
    SELECT count(*) INTO extra
      FROM _lc8_canon k LEFT JOIN _lc8_cells s USING (candidate_key)
     WHERE s.candidate_key IS NULL;
    IF missing > 0 OR extra > 0 THEN
        RAISE EXCEPTION 'candidate-key coverage mismatch: % package-only, % production-only',
            missing, extra;
    END IF;

    -- The per-cell geometry fingerprint each measurement was taken on must match too.
    SELECT count(*) INTO missing
      FROM _lc8_cells s JOIN _lc8_canon k USING (candidate_key)
     WHERE s.candidate_geometry_fingerprint IS DISTINCT FROM k.gfp;
    IF missing > 0 THEN
        RAISE EXCEPTION '% cells have a different production geometry fingerprint', missing;
    END IF;

    RAISE NOTICE 'gate 2 OK: production grid % matches fingerprint % (% cells)',
        grid, got_fp, got_count;
END $$;

-- --------------------------------------------------------------------------- --
-- Gate 3 — the canonical run the public tile endpoint will pin must be servable.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    grid text;
    expected integer;
    run record;
BEGIN
    SELECT stat->>'candidate_grid_version', (stat->>'expected_cell_count')::int
      INTO grid, expected FROM _lc8_input;
    SELECT id, status, candidate_count_total INTO run
      FROM suitability_analysis_runs
     WHERE candidate_grid_version = grid
     ORDER BY id LIMIT 1;
    IF run IS NULL THEN
        RAISE EXCEPTION 'no suitability analysis run exists for grid %', grid;
    END IF;
    IF run.status <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'lowest run % for grid % has status %', run.id, grid, run.status;
    END IF;
    IF run.candidate_count_total IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'canonical run % holds % candidates, release expects %',
            run.id, run.candidate_count_total, expected;
    END IF;
    RAISE NOTICE 'gate 3 OK: canonical run % is SUCCEEDED with % candidates',
        run.id, run.candidate_count_total;
END $$;

-- --------------------------------------------------------------------------- --
-- 1. Dataset release identity — resolve by natural key, create only if absent.
-- --------------------------------------------------------------------------- --
CREATE TEMP TABLE _lc8_ids (dataset_version_id bigint, stat_version_id bigint,
                            ingestion_run_id bigint) ON COMMIT DROP;

DO $$
DECLARE
    ds jsonb;
    found_id bigint;
BEGIN
    SELECT dataset INTO ds FROM _lc8_input;

    SELECT id INTO found_id FROM environmental_dataset_versions
     WHERE layer_name = ds->>'layer_name'
       AND provider_dataset_identifier = ds->>'provider_dataset_identifier'
       AND reference_period = ds->>'reference_period'
       AND source_checksum = ds->>'source_checksum'
       AND transformation_version = ds->>'transformation_version';

    IF found_id IS NULL THEN
        -- `ingestion_run_id` stays NULL: the RAW ingestion happened on the local
        -- development database, never in production, and naming a production run for
        -- it would be false. The counts below describe the acquired source release
        -- (what LC2 measured), not what is stored in production — the raw features
        -- are deliberately not deployed, which the deployment report states plainly.
        INSERT INTO environmental_dataset_versions (
            layer_name, source_id, provider, official_dataset_name,
            provider_dataset_identifier, official_source_url, reference_date,
            source_archive_filename, source_filename, source_archive_checksum,
            source_checksum, source_crs, target_crs, source_encoding,
            source_geometry_type, normalized_geometry_type, declared_feature_count,
            total_feature_count, accepted_feature_count, rejected_feature_count,
            transformation_version, license_note, ingestion_run_id, retrieved_at,
            acquired_on, source_files, retrieval_metadata, is_active, created_at,
            reference_period
        )
        SELECT ds->>'layer_name', ds->>'source_id', ds->>'provider',
               ds->>'official_dataset_name', ds->>'provider_dataset_identifier',
               ds->>'official_source_url', (ds->>'reference_date')::date,
               ds->>'source_archive_filename', ds->>'source_filename',
               ds->>'source_archive_checksum', ds->>'source_checksum',
               ds->>'source_crs', ds->>'target_crs', ds->>'source_encoding',
               ds->>'source_geometry_type', ds->>'normalized_geometry_type',
               (ds->>'declared_feature_count')::int, (ds->>'total_feature_count')::int,
               (ds->>'accepted_feature_count')::int, (ds->>'rejected_feature_count')::int,
               ds->>'transformation_version', ds->>'license_note', NULL,
               (ds->>'retrieved_at')::timestamptz, (ds->>'acquired_on')::date,
               ds->'source_files', ds->'retrieval_metadata',
               (ds->>'is_active')::boolean, now(), ds->>'reference_period'
        RETURNING id INTO found_id;
        RAISE NOTICE 'created production dataset release id %', found_id;
    ELSE
        RAISE NOTICE 'reusing existing production dataset release id %', found_id;
    END IF;

    INSERT INTO _lc8_ids (dataset_version_id) VALUES (found_id);
END $$;

-- --------------------------------------------------------------------------- --
-- 2. Statistics release identity — resolve by UNIQUE input_signature.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    sv jsonb;
    ds_id bigint;
    found_id bigint;
    run_id bigint;
BEGIN
    SELECT stat INTO sv FROM _lc8_input;
    SELECT dataset_version_id INTO ds_id FROM _lc8_ids;

    SELECT id INTO found_id FROM environmental_land_cover_cell_stat_versions
     WHERE input_signature = sv->>'input_signature';

    IF found_id IS NULL THEN
        -- One honest production ingestion_runs row records THIS import. It describes
        -- the transfer that actually happened here — not the local derivation.
        INSERT INTO ingestion_runs (
            source_id, started_at, completed_at, status,
            rows_received, rows_inserted, rows_updated, rows_rejected,
            reference_period, transformation_version
        )
        SELECT (SELECT dataset->>'source_id' FROM _lc8_input), now(), now(), 'SUCCEEDED',
               (SELECT count(*) FROM _lc8_cells) + (SELECT count(*) FROM _lc8_classes),
               (SELECT count(*) FROM _lc8_cells) + (SELECT count(*) FROM _lc8_classes),
               0, 0, sv->>'derivation_version', sv->>'derivation_version'
        RETURNING ingestion_runs.run_id INTO run_id;

        INSERT INTO environmental_land_cover_cell_stat_versions (
            land_cover_dataset_version_id, candidate_grid_version,
            candidate_grid_fingerprint, derivation_version, area_crs, input_signature,
            status, expected_cell_count, processed_cell_count, complete_exact_count,
            partial_count, no_coverage_count, failed_cell_count, candidate_row_count,
            duplicate_candidate_occurrence_count, representation_variant_cell_count,
            total_cell_area_m2, total_evaluated_area_m2, total_uncovered_area_m2,
            aggregate_coverage_ratio, total_intersection_area_m2, total_overlap_area_m2,
            cells_with_source_overlap, max_overlap_area_m2, max_overlap_ratio,
            guard_applied_cell_count, max_guard_adjustment_m2, class_row_count,
            batch_size, ingestion_run_id, derivation_metadata, is_active,
            started_at, completed_at, created_at
        )
        SELECT ds_id, sv->>'candidate_grid_version', sv->>'candidate_grid_fingerprint',
               sv->>'derivation_version', sv->>'area_crs', sv->>'input_signature',
               sv->>'status', (sv->>'expected_cell_count')::int,
               (sv->>'processed_cell_count')::int, (sv->>'complete_exact_count')::int,
               (sv->>'partial_count')::int, (sv->>'no_coverage_count')::int,
               (sv->>'failed_cell_count')::int, (sv->>'candidate_row_count')::int,
               (sv->>'duplicate_candidate_occurrence_count')::int,
               (sv->>'representation_variant_cell_count')::int,
               (sv->>'total_cell_area_m2')::double precision,
               (sv->>'total_evaluated_area_m2')::double precision,
               (sv->>'total_uncovered_area_m2')::double precision,
               (sv->>'aggregate_coverage_ratio')::double precision,
               (sv->>'total_intersection_area_m2')::double precision,
               (sv->>'total_overlap_area_m2')::double precision,
               (sv->>'cells_with_source_overlap')::int,
               (sv->>'max_overlap_area_m2')::double precision,
               (sv->>'max_overlap_ratio')::double precision,
               (sv->>'guard_applied_cell_count')::int,
               (sv->>'max_guard_adjustment_m2')::double precision,
               (sv->>'class_row_count')::int, (sv->>'batch_size')::int,
               run_id, sv->'derivation_metadata', (sv->>'is_active')::boolean,
               (sv->>'started_at')::timestamptz, (sv->>'completed_at')::timestamptz, now()
        RETURNING id INTO found_id;
        RAISE NOTICE 'created production statistics release id % (import run %)',
            found_id, run_id;
    ELSE
        RAISE NOTICE 'reusing existing production statistics release id %', found_id;
    END IF;

    UPDATE _lc8_ids SET stat_version_id = found_id, ingestion_run_id = run_id;
END $$;

-- --------------------------------------------------------------------------- --
-- 3. Cell statistics — idempotent insert against the UNIQUE natural key.
-- --------------------------------------------------------------------------- --
INSERT INTO environmental_land_cover_cell_statistics (
    statistics_version_id, land_cover_dataset_version_id, candidate_grid_version,
    candidate_key, candidate_geometry_fingerprint, sido_region_code, sido_region_name,
    sigungu_region_code, sigungu_region_name, cell_area_m2, evaluated_area_m2,
    uncovered_area_m2, coverage_ratio, intersection_area_sum_m2, overlap_area_m2,
    coverage_status, uncovered_residual_area_m2, topological_cover_predicate,
    matched_feature_count, dominant_l1_code, dominant_l1_name, dominant_l2_code,
    dominant_l2_name, dominant_l3_code, dominant_l3_name, l1_class_count,
    l2_class_count, l3_class_count, l1_class_area_sum_m2, l2_class_area_sum_m2,
    l3_class_area_sum_m2, candidate_occurrence_count, representation_variant_count,
    guard_applied, derivation_version, area_crs, created_at
)
SELECT i.stat_version_id, i.dataset_version_id, s.candidate_grid_version,
       s.candidate_key, s.candidate_geometry_fingerprint, s.sido_region_code,
       s.sido_region_name, s.sigungu_region_code, s.sigungu_region_name, s.cell_area_m2,
       s.evaluated_area_m2, s.uncovered_area_m2, s.coverage_ratio,
       s.intersection_area_sum_m2, s.overlap_area_m2, s.coverage_status,
       s.uncovered_residual_area_m2, s.topological_cover_predicate,
       s.matched_feature_count, s.dominant_l1_code, s.dominant_l1_name,
       s.dominant_l2_code, s.dominant_l2_name, s.dominant_l3_code, s.dominant_l3_name,
       s.l1_class_count, s.l2_class_count, s.l3_class_count, s.l1_class_area_sum_m2,
       s.l2_class_area_sum_m2, s.l3_class_area_sum_m2, s.candidate_occurrence_count,
       s.representation_variant_count, s.guard_applied, s.derivation_version,
       s.area_crs, s.created_at
FROM _lc8_cells s CROSS JOIN _lc8_ids i
ON CONFLICT ON CONSTRAINT uq_land_cover_cell_statistics_version_key DO NOTHING;

-- --------------------------------------------------------------------------- --
-- 4. Class areas — joined to the PRODUCTION cell id, idempotent on the cell key.
-- --------------------------------------------------------------------------- --
INSERT INTO environmental_land_cover_cell_class_areas (
    statistics_version_id, cell_statistics_id, candidate_key, class_level, class_code,
    class_name, class_area_m2, share_of_evaluated_area, share_of_cell_area, created_at
)
SELECT i.stat_version_id, cs.id, c.candidate_key, c.class_level, c.class_code,
       c.class_name, c.class_area_m2, c.share_of_evaluated_area, c.share_of_cell_area,
       c.created_at
FROM _lc8_classes c
CROSS JOIN _lc8_ids i
JOIN environmental_land_cover_cell_statistics cs
  ON cs.statistics_version_id = i.stat_version_id
 AND cs.candidate_key = c.candidate_key
ON CONFLICT ON CONSTRAINT uq_land_cover_cell_class_areas_cell_level_code DO NOTHING;

-- --------------------------------------------------------------------------- --
-- 5. Activation — exactly one active land-cover statistics release.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    target bigint;
    others bigint;
BEGIN
    SELECT stat_version_id INTO target FROM _lc8_ids;
    SELECT count(*) INTO others FROM environmental_land_cover_cell_stat_versions
     WHERE is_active AND id <> target;
    IF others > 0 THEN
        -- Deliberately NOT auto-deactivated: another active release would mean a
        -- second land-cover derivation exists in production that this phase does not
        -- know about. Refuse and let a human look.
        RAISE EXCEPTION '% other land-cover statistics releases are already active', others;
    END IF;
    UPDATE environmental_land_cover_cell_stat_versions
       SET is_active = true WHERE id = target AND NOT is_active;
END $$;

-- --------------------------------------------------------------------------- --
-- 6. Post-import gates — all inside the same transaction, so any failure rolls back.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
    target bigint;
    sv jsonb;
    n bigint;
    got text;
    want text;
BEGIN
    SELECT stat_version_id INTO target FROM _lc8_ids;
    SELECT stat INTO sv FROM _lc8_input;

    SELECT count(*) INTO n FROM environmental_land_cover_cell_stat_versions WHERE is_active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 active release, found %', n; END IF;

    SELECT count(*) INTO n FROM environmental_land_cover_cell_statistics
     WHERE statistics_version_id = target;
    IF n <> (sv->>'expected_cell_count')::int THEN
        RAISE EXCEPTION 'imported % cells, expected %', n, sv->>'expected_cell_count';
    END IF;

    SELECT count(*) INTO n FROM environmental_land_cover_cell_class_areas
     WHERE statistics_version_id = target;
    IF n <> (sv->>'class_row_count')::int THEN
        RAISE EXCEPTION 'imported % class rows, expected %', n, sv->>'class_row_count';
    END IF;

    -- No orphan child rows, in either direction.
    SELECT count(*) INTO n FROM environmental_land_cover_cell_class_areas a
      LEFT JOIN environmental_land_cover_cell_statistics s ON s.id = a.cell_statistics_id
     WHERE a.statistics_version_id = target AND s.id IS NULL;
    IF n > 0 THEN RAISE EXCEPTION '% orphan class rows', n; END IF;

    SELECT count(*) INTO n FROM environmental_land_cover_cell_statistics s
      LEFT JOIN _lc8_canon k ON k.candidate_key = s.candidate_key
     WHERE s.statistics_version_id = target AND k.candidate_key IS NULL;
    IF n > 0 THEN RAISE EXCEPTION '% cell rows with no production candidate', n; END IF;

    -- Coverage-state counts must match the package exactly.
    SELECT count(*) INTO n FROM environmental_land_cover_cell_statistics
     WHERE statistics_version_id = target AND coverage_status = 'COMPLETE_EXACT';
    IF n <> (sv->>'complete_exact_count')::int THEN
        RAISE EXCEPTION 'COMPLETE_EXACT % <> %', n, sv->>'complete_exact_count'; END IF;
    SELECT count(*) INTO n FROM environmental_land_cover_cell_statistics
     WHERE statistics_version_id = target AND coverage_status = 'PARTIAL';
    IF n <> (sv->>'partial_count')::int THEN
        RAISE EXCEPTION 'PARTIAL % <> %', n, sv->>'partial_count'; END IF;
    SELECT count(*) INTO n FROM environmental_land_cover_cell_statistics
     WHERE statistics_version_id = target AND coverage_status = 'NO_COVERAGE';
    IF n <> (sv->>'no_coverage_count')::int THEN
        RAISE EXCEPTION 'NO_COVERAGE % <> %', n, sv->>'no_coverage_count'; END IF;

    -- Content checksums, not just row counts: the imported values must be the local
    -- values, digit for digit.
    SELECT md5(string_agg(md5(
        candidate_key || ':' || coverage_status || ':'
          || cell_area_m2::text || ':' || evaluated_area_m2::text || ':'
          || uncovered_area_m2::text || ':' || coverage_ratio::text || ':'
          || coalesce(dominant_l1_code, 'NULL') || ':'
          || coalesce(dominant_l2_code, 'NULL') || ':'
          || coalesce(dominant_l3_code, 'NULL') || ':'
          || l1_class_count::text || ':' || l2_class_count::text || ':'
          || l3_class_count::text), '' ORDER BY candidate_key))
      INTO got FROM environmental_land_cover_cell_statistics
     WHERE statistics_version_id = target;
    SELECT md5(string_agg(md5(
        candidate_key || ':' || coverage_status || ':'
          || cell_area_m2::text || ':' || evaluated_area_m2::text || ':'
          || uncovered_area_m2::text || ':' || coverage_ratio::text || ':'
          || coalesce(dominant_l1_code, 'NULL') || ':'
          || coalesce(dominant_l2_code, 'NULL') || ':'
          || coalesce(dominant_l3_code, 'NULL') || ':'
          || l1_class_count::text || ':' || l2_class_count::text || ':'
          || l3_class_count::text), '' ORDER BY candidate_key))
      INTO want FROM _lc8_cells;
    IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'cell content checksum mismatch: production % <> package %',
            got, want;
    END IF;

    SELECT md5(string_agg(md5(
        candidate_key || ':' || class_level::text || ':' || class_code || ':'
          || class_name || ':' || class_area_m2::text || ':'
          || share_of_evaluated_area::text || ':' || share_of_cell_area::text),
        '' ORDER BY candidate_key, class_level, class_code))
      INTO got FROM environmental_land_cover_cell_class_areas
     WHERE statistics_version_id = target;
    SELECT md5(string_agg(md5(
        candidate_key || ':' || class_level::text || ':' || class_code || ':'
          || class_name || ':' || class_area_m2::text || ':'
          || share_of_evaluated_area::text || ':' || share_of_cell_area::text),
        '' ORDER BY candidate_key, class_level, class_code))
      INTO want FROM _lc8_classes;
    IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'class content checksum mismatch: production % <> package %',
            got, want;
    END IF;

    -- The raw source tables must remain EMPTY: this phase deploys derived data only.
    SELECT count(*) INTO n FROM environmental_land_cover_features;
    IF n > 0 THEN RAISE EXCEPTION 'raw land-cover features present (%): refusing', n; END IF;
    SELECT count(*) INTO n FROM environmental_land_cover_map_sheets;
    IF n > 0 THEN RAISE EXCEPTION 'land-cover map sheets present (%): refusing', n; END IF;

    RAISE NOTICE 'post-import gates OK for statistics release %', target;
END $$;

SELECT 'imported_statistics_version_id' AS k, stat_version_id::text AS v FROM _lc8_ids
UNION ALL
SELECT 'imported_dataset_version_id', dataset_version_id::text FROM _lc8_ids
UNION ALL
SELECT 'import_ingestion_run_id', coalesce(ingestion_run_id::text, '(reused, none created)')
  FROM _lc8_ids;

COMMIT;
