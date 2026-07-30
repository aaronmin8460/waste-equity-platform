"""Tests for the versioned candidate-cell land-cover statistics (Phase 1B-LC3).

Every fixture is **SYNTHETIC and clearly test-only**: a tiny land-cover release,
a tiny suitability run/candidate set, and hand-placed EPSG:5186 squares whose exact
areas are known by construction. The real 세분류 [2025] 토지피복지도 and the real
capital-region candidate grid are never read, written, or asserted about here, and
no raw source file, external drive, or physical path is touched.

The PostGIS tier requires ``TEST_DATABASE_URL`` and runs against the isolated test
database only; it creates its own synthetic release and candidate run and removes
them afterwards. Never point it at the loaded development database.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from typing import Any

import pytest

from waste_equity_ingestion import land_cover_cell_statistics as cs
from waste_equity_ingestion.land_cover_cell_statistics import (
    AREA_CRS,
    DERIVATION_VERSION,
    REGION_ALIASES,
    STATUS_COMPLETE_EXACT,
    STATUS_NO_COVERAGE,
    STATUS_PARTIAL,
    LandCoverCellStatisticsError,
    compute_input_signature,
    plan_uses_index_prefilter,
    run_land_cover_cell_statistics,
)

# --------------------------------------------------------------------------- #
# Pure-unit tests (no database)
# --------------------------------------------------------------------------- #


def test_input_signature_is_deterministic_and_input_sensitive() -> None:
    base = {
        "land_cover_dataset_version_id": 7,
        "land_cover_source_checksum": "a" * 64,
        "candidate_grid_version": "test-grid-v1",
        "candidate_grid_fingerprint": "b" * 64,
        "derivation_version": DERIVATION_VERSION,
        "area_crs": AREA_CRS,
        "expected_cell_count": 4,
    }
    first = compute_input_signature(**base)  # type: ignore[arg-type]
    assert first == compute_input_signature(**base)  # type: ignore[arg-type]
    assert len(first) == 64

    for field, value in (
        ("land_cover_dataset_version_id", 8),
        ("candidate_grid_fingerprint", "c" * 64),
        ("expected_cell_count", 5),
        ("derivation_version", "land-cover-cell-stats-v2"),
    ):
        changed = dict(base)
        changed[field] = value
        assert compute_input_signature(**changed) != first  # type: ignore[arg-type]


def test_derivation_version_is_not_a_suitability_version() -> None:
    """The derived product must never reuse or shadow a suitability version string."""

    assert DERIVATION_VERSION == "land-cover-cell-stats-v1"
    assert "suitability" not in DERIVATION_VERSION
    assert "policy" not in DERIVATION_VERSION
    assert AREA_CRS == "EPSG:5186"
    assert cs.PREFILTER_CRS == "EPSG:4326"


def test_region_aliases_map_to_official_sido_codes() -> None:
    assert REGION_ALIASES == {
        "seoul": "KR-SGIS-11",
        "incheon": "KR-SGIS-23",
        "gyeonggi": "KR-SGIS-31",
    }


def test_plan_uses_index_prefilter_detects_the_gist_scan() -> None:
    indexed = [
        "Insert on _lc_stage_l3",
        "  ->  Nested Loop",
        "        ->  Index Scan using idx_environmental_land_cover_features_geometry on "
        "environmental_land_cover_features f",
        "              Index Cond: (geometry && _lc_cell_canon.geometry_4326)",
    ]
    assert plan_uses_index_prefilter(indexed) is True
    assert (
        plan_uses_index_prefilter(
            ["Seq Scan on environmental_land_cover_features f  (cost=0.00..999999.00)"]
        )
        is False
    )


def test_filtered_write_is_prohibited() -> None:
    """A pilot subset must never create or activate a partial derived release."""

    for selector in ({"candidate_keys": ["k"]}, {"region": "seoul"}, {"max_cells": 5}):
        with pytest.raises(LandCoverCellStatisticsError, match="filtered/partial --write"):
            run_land_cover_cell_statistics(write=True, **selector)  # type: ignore[arg-type]


def test_invalid_batch_size_is_rejected() -> None:
    with pytest.raises(LandCoverCellStatisticsError, match="batch-size"):
        run_land_cover_cell_statistics(write=False, batch_size=0)


def test_guard_and_coverage_semantics_are_documented_exactly() -> None:
    """The one numerical guard is a non-negativity clamp — never a tolerance."""

    guard = cs.GUARD_DESCRIPTION
    assert "GREATEST(cell_area_m2 - evaluated_area_m2, 0)" in guard
    assert "No completeness, coverage, or overlap tolerance is applied" in guard
    semantics = cs.COVERAGE_SEMANTICS
    assert "EMPTY" in semantics
    assert "never promoted to COMPLETE_EXACT" in semantics
    # No percentage threshold may appear anywhere in the coverage contract.
    for forbidden in ("95%", "99%", "0.95", "0.99"):
        assert forbidden not in semantics
        assert forbidden not in guard


# --------------------------------------------------------------------------- #
# PostGIS tier (requires TEST_DATABASE_URL)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pg = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

#: Synthetic identity, deliberately unlike any official value.
FIXTURE_LAYER = "land_cover"
FIXTURE_GRID = "test-grid-500m-vTEST"
FIXTURE_SOURCE_ID = "egis_land_cover"
FIXTURE_CHECKSUM = "f" * 64
FIXTURE_TRANSFORMATION = "land-cover-vTEST"
FIXTURE_IDENTIFIER = "TEST-ONLY synthetic land-cover fixture (never official data)"

#: A 500 m EPSG:5186 test cell, tiled from a round origin so the geometry is exact.
CELL = 500.0
ORIGIN_X = 210000.0
ORIGIN_Y = 510000.0
#: Even columns only: the 500 m gap exceeds any feature overhang in the fixture.
CELL_COLUMNS = (0, 2, 4, 6)
KEY_COVERED, KEY_PARTIAL, KEY_EMPTY, KEY_OVERLAP = (
    f"{FIXTURE_GRID}:0_0",
    f"{FIXTURE_GRID}:2_0",
    f"{FIXTURE_GRID}:4_0",
    f"{FIXTURE_GRID}:6_0",
)
EXPECTED_KEYS = (KEY_COVERED, KEY_PARTIAL, KEY_EMPTY, KEY_OVERLAP)


def _reset_db_caches() -> None:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


@pytest.fixture
def db_session() -> Iterator[Any]:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not configured")
    _reset_db_caches()
    from waste_equity_backend.db import get_sessionmaker

    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def _sql(text_value: str) -> Any:
    from sqlalchemy import text as sa_text

    return sa_text(text_value)


def _wkt_box(x0: float, y0: float, x1: float, y1: float) -> str:
    return f"MULTIPOLYGON((({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0})))"


def _cell_wkt(i: int, j: int) -> str:
    x0 = ORIGIN_X + i * CELL
    y0 = ORIGIN_Y + j * CELL
    return _wkt_box(x0, y0, x0 + CELL, y0 + CELL)


class _Fixture:
    """Handles for the synthetic release + suitability run created for one test."""

    def __init__(self, session: Any) -> None:
        self.session = session
        self.dataset_version_id: int = 0
        self.other_layer_version_id: int = 0
        self.run_ids: list[int] = []
        self.statistics_version_ids: list[int] = []


def _create_release(
    session: Any,
    *,
    now: datetime.datetime,
    layer: str = FIXTURE_LAYER,
    source_id: str = FIXTURE_SOURCE_ID,
) -> int:
    return int(
        session.execute(
            _sql(
                """
                INSERT INTO environmental_dataset_versions (
                    layer_name, source_id, provider, official_dataset_name,
                    provider_dataset_identifier, reference_period, reference_date,
                    source_checksum, source_crs, target_crs, normalized_geometry_type,
                    transformation_version, source_files, is_active, created_at
                ) VALUES (
                    :layer, :source, 'TEST-ONLY provider', 'TEST-ONLY synthetic land cover',
                    :ident, '2025', NULL, :checksum, 'EPSG:5186', 'EPSG:4326', 'MultiPolygon',
                    :tv, '[]', true, :now
                ) RETURNING id
                """
            ),
            {
                "layer": layer,
                "source": source_id,
                "ident": FIXTURE_IDENTIFIER,
                "checksum": FIXTURE_CHECKSUM,
                "tv": FIXTURE_TRANSFORMATION,
                "now": now,
            },
        ).scalar_one()
    )


def _add_feature(
    session: Any,
    *,
    version_id: int,
    sheet: str,
    index: int,
    l1: tuple[str, str],
    l2: tuple[str, str],
    l3: tuple[str, str],
    wkt_5186: str,
    now: datetime.datetime,
) -> None:
    session.execute(
        _sql(
            """
            INSERT INTO environmental_land_cover_features (
                dataset_version_id, map_sheet_id, source_record_index,
                l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
                geometry, geometry_area_m2, source_geometry_valid, geometry_repair_status,
                discarded_component_count, source_geometry_fingerprint, feature_fingerprint,
                source_crs, target_crs, source_encoding, source_reference_period,
                transformation_version, raw_attributes, created_at
            ) VALUES (
                :v, :sheet, :idx, :l1c, :l1n, :l2c, :l2n, :l3c, :l3n,
                ST_Multi(ST_Transform(ST_GeomFromText(:wkt, 5186), 4326)),
                ST_Area(ST_GeomFromText(:wkt, 5186)), true, 'none', 0,
                :fp, :fp, 'EPSG:5186', 'EPSG:4326', 'cp949', '2025', :tv, '{}', :now
            )
            """
        ),
        {
            "v": version_id,
            "sheet": sheet,
            "idx": index,
            "l1c": l1[0],
            "l1n": l1[1],
            "l2c": l2[0],
            "l2n": l2[1],
            "l3c": l3[0],
            "l3n": l3[1],
            "wkt": wkt_5186,
            "fp": f"{version_id}-{sheet}-{index}".ljust(64, "0")[:64],
            "tv": FIXTURE_TRANSFORMATION,
            "now": now,
        },
    )


def _create_analysis_run(
    session: Any, *, now: datetime.datetime, signature: str, grid: str = FIXTURE_GRID
) -> int:
    return int(
        session.execute(
            _sql(
                """
                INSERT INTO suitability_analysis_runs (
                    derivation_version, policy_version, candidate_grid_version, reference_year,
                    boundary_vintage, weight_profile, analysis_signature, status,
                    candidate_count_total, candidate_count_eligible, candidate_count_review,
                    candidate_count_excluded, input_dataset_version_ids, input_provenance,
                    policy_snapshot, weight_profiles, weight_derivation, stability_definition,
                    started_at, created_at
                ) VALUES (
                    'TEST-ONLY-screening', 'TEST-ONLY-policy', :grid, 2024, '2024',
                    'baseline', :sig, 'SUCCEEDED', 0, 0, 0, 0,
                    '[]', '{}', '{}', '{}', '{}', '{}', :now, :now
                ) RETURNING id
                """
            ),
            {"grid": grid, "sig": signature, "now": now},
        ).scalar_one()
    )


def _add_candidate(
    session: Any,
    *,
    run_id: int,
    key: str,
    wkt_5186: str | None,
    now: datetime.datetime,
    sido: str | None = "KR-SGIS-11",
    empty: bool = False,
    null_geometry: bool = False,
) -> None:
    if null_geometry:
        geometry_sql = "NULL"
    elif empty:
        geometry_sql = "ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)"
    else:
        geometry_sql = "ST_Multi(ST_Transform(ST_GeomFromText(:wkt, 5186), 4326))"
    session.execute(
        _sql(
            f"""
            INSERT INTO suitability_candidates (
                analysis_run_id, candidate_key, sido_region_code, sido_region_name,
                status, profile_totals, profile_ranks, stability_membership, raw_components,
                exclusion_reasons, review_reasons, penalties, nearest_road_provenance,
                component_provenance, original_area_m2, clipped_area_m2, clipped_area_ratio,
                centroid, geometry, created_at
            ) VALUES (
                :run, :key, :sido, 'TEST-ONLY region', 'ELIGIBLE',
                '{{}}', '{{}}', '{{}}', '{{}}', '[]', '[]', '[]', '{{}}', '{{}}',
                250000, 250000, 1,
                ST_SetSRID(ST_Point(127.0, 37.5), 4326), {geometry_sql}, :now
            )
            """
        ),
        {"run": run_id, "key": key, "sido": sido, "wkt": wkt_5186 or "", "now": now},
    )


def _cleanup(fixture: _Fixture) -> None:
    session = fixture.session
    session.rollback()
    for version_id in fixture.statistics_version_ids:
        session.execute(
            _sql(
                "DELETE FROM environmental_land_cover_cell_class_areas "
                "WHERE statistics_version_id = :v"
            ),
            {"v": version_id},
        )
        session.execute(
            _sql(
                "DELETE FROM environmental_land_cover_cell_statistics "
                "WHERE statistics_version_id = :v"
            ),
            {"v": version_id},
        )
        session.execute(
            _sql("DELETE FROM environmental_land_cover_cell_stat_versions WHERE id = :v"),
            {"v": version_id},
        )
    for run_id in fixture.run_ids:
        session.execute(
            _sql("DELETE FROM suitability_candidates WHERE analysis_run_id = :r"), {"r": run_id}
        )
        session.execute(_sql("DELETE FROM suitability_analysis_runs WHERE id = :r"), {"r": run_id})
    for extra in (fixture.other_layer_version_id,):
        if extra:
            session.execute(
                _sql("DELETE FROM environmental_dataset_versions WHERE id = :v"), {"v": extra}
            )
    if fixture.dataset_version_id:
        session.execute(
            _sql("DELETE FROM environmental_land_cover_features WHERE dataset_version_id = :v"),
            {"v": fixture.dataset_version_id},
        )
        session.execute(
            _sql(
                "DELETE FROM environmental_land_cover_cell_stat_versions "
                "WHERE land_cover_dataset_version_id = :v"
            ),
            {"v": fixture.dataset_version_id},
        )
        session.execute(
            _sql("DELETE FROM environmental_dataset_versions WHERE id = :v"),
            {"v": fixture.dataset_version_id},
        )
    session.execute(
        _sql("DELETE FROM ingestion_runs WHERE source_id = :s AND transformation_version = :tv"),
        {"s": FIXTURE_SOURCE_ID, "tv": DERIVATION_VERSION},
    )
    session.commit()


@pytest.fixture
def scenario(db_session: Any) -> Iterator[_Fixture]:
    """A synthetic release + two analysis runs over four hand-built 500 m cells.

    Layout (EPSG:5186, exact by construction):

    * ``cell 0_0`` — fully covered by two 500×250 m halves of DIFFERENT L1 classes
      (100 시가화건조지역 / 200 농업지역), each 125,000 m² inside the cell.
    * ``cell 2_0`` — covered on its western 200 m only (100,000 m²) → PARTIAL.
    * ``cell 4_0`` — no land-cover feature at all → NO_COVERAGE.
    * ``cell 6_0`` — one feature of ONE class covering the whole cell, plus a second,
      *overlapping* feature of the same class (source-overlap audit).

    The four cells sit at even column indices so the 500 m gap between them is wider
    than any feature overhang: a feature can never bleed into a neighbouring test
    cell and silently change its expected composition.

    Every feature deliberately **overhangs** the cell, exactly as real land-cover
    polygons do: a source polygon almost never terminates on a grid line. That
    matters, because when a feature edge lies exactly on the cell edge the clipped
    union and the cell become two different polylines along that edge — the cell
    contributes a straight two-point chord while the features contribute an
    extra-vertex polyline, and EPSG:4326 storage plus the EPSG:5186 re-projection
    (a non-linear map) separates them by ~1e-7 m². That is a genuine geometric
    difference, so such a cell is honestly PARTIAL; overhanging features make the
    clip use the cell's own edges and close exactly.

    Every cell appears in BOTH analysis runs, so canonicalization is exercised.
    """

    fixture = _Fixture(db_session)
    now = datetime.datetime(2026, 7, 28, tzinfo=datetime.UTC)
    session = db_session
    try:
        fixture.dataset_version_id = _create_release(session, now=now)
        version_id = fixture.dataset_version_id
        # A second, non-land_cover synthetic release so the "explicit version id must
        # be a land_cover release" guard is actually exercised, not skipped.
        fixture.other_layer_version_id = _create_release(
            session, now=now, layer="wetland_inventory", source_id="nie_wetland_inventory"
        )
        urban = ("100", "시가화건조지역")
        urban2 = ("110", "주거지역")
        urban3 = ("111", "단독주거시설")
        farm = ("200", "농업지역")
        farm2 = ("210", "논")
        farm3 = ("211", "경작지")
        forest = ("300", "산림지역")
        forest2 = ("310", "활엽수림")
        forest3 = ("311", "활엽수림")

        x0, y0 = ORIGIN_X, ORIGIN_Y
        over = 100.0  # every feature overhangs its cell, as real polygons do
        top, bottom = y0 - over, y0 + CELL + over
        # cell 0_0: two halves split at the cell mid-line, different L1 classes.
        _add_feature(
            session,
            version_id=version_id,
            sheet="T1",
            index=0,
            l1=urban,
            l2=urban2,
            l3=urban3,
            wkt_5186=_wkt_box(x0 - over, top, x0 + CELL + over, y0 + CELL / 2),
            now=now,
        )
        _add_feature(
            session,
            version_id=version_id,
            sheet="T1",
            index=1,
            l1=farm,
            l2=farm2,
            l3=farm3,
            wkt_5186=_wkt_box(x0 - over, y0 + CELL / 2, x0 + CELL + over, bottom),
            now=now,
        )
        # cell 2_0 (x0 + 1000 .. x0 + 1500): western 200 m only.
        bx = x0 + 2 * CELL
        _add_feature(
            session,
            version_id=version_id,
            sheet="T1",
            index=2,
            l1=forest,
            l2=forest2,
            l3=forest3,
            wkt_5186=_wkt_box(bx - over, top, bx + 200.0, bottom),
            now=now,
        )
        # cell 6_0 (x0 + 3000 .. x0 + 3500): one class, two OVERLAPPING features.
        dx = x0 + 6 * CELL
        _add_feature(
            session,
            version_id=version_id,
            sheet="T1",
            index=3,
            l1=forest,
            l2=forest2,
            l3=forest3,
            wkt_5186=_wkt_box(dx - over, top, dx + CELL + over, bottom),
            now=now,
        )
        _add_feature(
            session,
            version_id=version_id,
            sheet="T1",
            index=4,
            l1=forest,
            l2=forest2,
            l3=forest3,
            wkt_5186=_wkt_box(dx - over, top, dx + 100.0, bottom),
            now=now,
        )

        for ordinal, signature in enumerate(("TESTSIGA", "TESTSIGB")):
            run_id = _create_analysis_run(session, now=now, signature=signature)
            fixture.run_ids.append(run_id)
            for i in CELL_COLUMNS:
                _add_candidate(
                    session,
                    run_id=run_id,
                    key=f"{FIXTURE_GRID}:{i}_0",
                    wkt_5186=_cell_wkt(i, 0),
                    now=now,
                    sido="KR-SGIS-11" if ordinal >= 0 else None,
                )
        session.commit()
        yield fixture
    finally:
        _cleanup(fixture)


def _derive(fixture: _Fixture, **kwargs: Any) -> Any:
    from waste_equity_backend.db import get_sessionmaker

    return run_land_cover_cell_statistics(
        candidate_grid_version=FIXTURE_GRID,
        dataset_version_id=fixture.dataset_version_id,
        batch_size=kwargs.pop("batch_size", 2),
        session_factory=get_sessionmaker(),
        explain=kwargs.pop("explain", False),
        **kwargs,
    )


@pg
def test_dry_run_measures_areas_in_5186_and_writes_nothing(scenario: _Fixture) -> None:
    report = _derive(scenario, write=False, explain=True)

    assert report.status == "SUCCEEDED"
    assert report.area_crs == "EPSG:5186"
    # Canonicalization: 8 candidate rows over 2 runs collapse to 4 unique cells.
    assert report.candidate_row_count == 8
    assert report.canonical_cell_count == 4
    assert report.duplicate_candidate_occurrence_count == 4
    assert report.geometry_conflict_count == 0
    assert report.distinct_analysis_runs == 2

    # Exact 500 m cells: area measured in metres, never degrees.
    assert report.cell_area_min_m2 == pytest.approx(250_000.0, abs=1.0)
    assert report.cell_area_max_m2 == pytest.approx(250_000.0, abs=1.0)

    assert report.complete_exact_count == 2  # cells 0_0 and 3_0
    assert report.partial_count == 1  # cell 1_0
    assert report.no_coverage_count == 1  # cell 2_0
    assert report.processed_cell_count == 4

    # The plan is always captured and always classified — never assumed. On this
    # five-row synthetic feature table PostgreSQL legitimately prefers a sequential
    # scan (it is genuinely cheaper), so what this tier proves is that the *guard*
    # works: an unindexed plan is detected and warned about rather than passing
    # silently. The indexed-plan classifier itself is unit-tested above, and the
    # real 6.9 M-row table is verified operationally (see
    # docs/LAND_COVER_CANDIDATE_CELL_STATISTICS.md §"Query plan").
    assert report.query_plan
    assert isinstance(report.plan_uses_index_prefilter, bool)
    if report.plan_uses_index_prefilter is False:
        assert any("index prefilter" in w for w in report.warnings)

    # Nothing persisted by a dry run.
    assert report.statistics_version_id is None
    assert report.inserted_cell_rows == 0
    stored = scenario.session.execute(
        _sql(
            "SELECT count(*) FROM environmental_land_cover_cell_stat_versions "
            "WHERE land_cover_dataset_version_id = :v"
        ),
        {"v": scenario.dataset_version_id},
    ).scalar_one()
    assert stored == 0


@pg
def test_full_write_then_identical_second_write_inserts_zero_rows(scenario: _Fixture) -> None:
    first = _derive(scenario, write=True)
    assert first.statistics_version_id is not None
    scenario.statistics_version_ids.append(first.statistics_version_id)

    assert first.status == "SUCCEEDED"
    assert first.statistics_version_created is True
    assert first.statistics_version_activated is True
    assert first.inserted_cell_rows == 4
    assert first.inserted_class_rows > 0
    assert first.materially_changed_rows == 0

    session = scenario.session
    session.commit()
    version_row = session.execute(
        _sql(
            """
            SELECT status, is_active, expected_cell_count, processed_cell_count,
                   complete_exact_count, partial_count, no_coverage_count, failed_cell_count,
                   area_crs, derivation_version, candidate_grid_version,
                   candidate_grid_fingerprint, completed_at
            FROM environmental_land_cover_cell_stat_versions WHERE id = :v
            """
        ),
        {"v": first.statistics_version_id},
    ).one()
    assert version_row.status == "SUCCEEDED"
    assert version_row.is_active is True
    assert version_row.expected_cell_count == 4
    assert version_row.processed_cell_count == 4
    assert version_row.failed_cell_count == 0
    assert version_row.area_crs == "EPSG:5186"
    assert version_row.derivation_version == DERIVATION_VERSION
    assert version_row.candidate_grid_version == FIXTURE_GRID
    assert len(version_row.candidate_grid_fingerprint) == 64
    assert version_row.completed_at is not None

    before = session.execute(
        _sql(
            """
            SELECT md5(string_agg(t, E'\\n' ORDER BY t)) AS h FROM (
              SELECT candidate_key || '|' || coverage_status || '|' || cell_area_m2 || '|'
                     || evaluated_area_m2 || '|' || uncovered_area_m2 || '|' || coverage_ratio
                     || '|' || coalesce(dominant_l1_code, '-') AS t
              FROM environmental_land_cover_cell_statistics WHERE statistics_version_id = :v) x
            """
        ),
        {"v": first.statistics_version_id},
    ).scalar_one()

    second = _derive(scenario, write=True)
    assert second.statistics_version_id == first.statistics_version_id
    assert second.statistics_version_created is False
    assert second.inserted_cell_rows == 0
    assert second.inserted_class_rows == 0
    assert second.materially_changed_rows == 0
    assert second.reused_cell_rows == 4

    session.commit()
    after = session.execute(
        _sql(
            """
            SELECT md5(string_agg(t, E'\\n' ORDER BY t)) AS h FROM (
              SELECT candidate_key || '|' || coverage_status || '|' || cell_area_m2 || '|'
                     || evaluated_area_m2 || '|' || uncovered_area_m2 || '|' || coverage_ratio
                     || '|' || coalesce(dominant_l1_code, '-') AS t
              FROM environmental_land_cover_cell_statistics WHERE statistics_version_id = :v) x
            """
        ),
        {"v": first.statistics_version_id},
    ).scalar_one()
    assert after == before

    # Exactly one active version — no false second release.
    active = session.execute(
        _sql(
            "SELECT count(*) FROM environmental_land_cover_cell_stat_versions "
            "WHERE land_cover_dataset_version_id = :v AND is_active"
        ),
        {"v": scenario.dataset_version_id},
    ).scalar_one()
    assert active == 1


@pg
def test_stored_rows_carry_exact_areas_shares_and_dominant_classes(scenario: _Fixture) -> None:
    report = _derive(scenario, write=True)
    assert report.statistics_version_id is not None
    scenario.statistics_version_ids.append(report.statistics_version_id)
    session = scenario.session
    session.commit()

    rows = {
        row.candidate_key: row
        for row in session.execute(
            _sql(
                """
                SELECT candidate_key, coverage_status, cell_area_m2, evaluated_area_m2,
                       uncovered_area_m2, coverage_ratio, intersection_area_sum_m2,
                       overlap_area_m2, uncovered_residual_area_m2,
                       dominant_l1_code, dominant_l1_name, dominant_l3_code,
                       l1_class_count, l2_class_count, l3_class_count,
                       l1_class_area_sum_m2, candidate_occurrence_count, area_crs,
                       derivation_version, candidate_geometry_fingerprint
                FROM environmental_land_cover_cell_statistics
                WHERE statistics_version_id = :v
                """
            ),
            {"v": report.statistics_version_id},
        ).all()
    }
    assert set(rows) == set(EXPECTED_KEYS)

    # --- multi-class, fully covered cell -----------------------------------
    covered = rows[KEY_COVERED]
    assert covered.coverage_status == STATUS_COMPLETE_EXACT
    assert covered.evaluated_area_m2 == pytest.approx(covered.cell_area_m2, rel=1e-9)
    assert covered.uncovered_area_m2 == pytest.approx(0.0, abs=1e-3)
    assert covered.coverage_ratio == pytest.approx(1.0, rel=1e-9)
    assert covered.l1_class_count == 2
    assert covered.l3_class_count == 2
    assert covered.candidate_occurrence_count == 2
    assert covered.area_crs == "EPSG:5186"
    assert covered.derivation_version == DERIVATION_VERSION
    assert len(covered.candidate_geometry_fingerprint) == 64
    # The dominant class is the largest STORED class area (the exact-tie rule has
    # its own test below, because two clipped halves never tie bit-for-bit).
    assert covered.dominant_l1_code in {"100", "200"}
    assert covered.dominant_l1_name in {"시가화건조지역", "농업지역"}

    l1_rows = {
        row.class_code: row
        for row in session.execute(
            _sql(
                """
                SELECT class_code, class_name, class_area_m2, share_of_evaluated_area,
                       share_of_cell_area
                FROM environmental_land_cover_cell_class_areas
                WHERE statistics_version_id = :v AND candidate_key = :k AND class_level = 1
                """
            ),
            {"v": report.statistics_version_id, "k": KEY_COVERED},
        ).all()
    }
    assert set(l1_rows) == {"100", "200"}
    for code in ("100", "200"):
        assert l1_rows[code].class_area_m2 == pytest.approx(125_000.0, rel=1e-3)
        assert l1_rows[code].share_of_evaluated_area == pytest.approx(0.5, rel=1e-3)
        assert l1_rows[code].share_of_cell_area == pytest.approx(0.5, rel=1e-3)
    # Official source names are preserved verbatim, never re-labelled.
    assert l1_rows["200"].class_name == "농업지역"
    largest = max(l1_rows.values(), key=lambda r: (r.class_area_m2, -int(r.class_code)))
    assert covered.dominant_l1_code == largest.class_code

    # --- partially covered cell --------------------------------------------
    partial = rows[KEY_PARTIAL]
    assert partial.coverage_status == STATUS_PARTIAL
    assert partial.evaluated_area_m2 == pytest.approx(100_000.0, rel=1e-3)
    assert partial.uncovered_area_m2 == pytest.approx(150_000.0, rel=1e-3)
    assert partial.uncovered_residual_area_m2 == pytest.approx(150_000.0, rel=1e-3)
    assert partial.coverage_ratio == pytest.approx(0.4, rel=1e-3)
    # Uncovered area is a coverage field — never an "unknown" land-cover class.
    partial_classes = session.execute(
        _sql(
            "SELECT count(*) FROM environmental_land_cover_cell_class_areas "
            "WHERE statistics_version_id = :v AND candidate_key = :k"
        ),
        {"v": report.statistics_version_id, "k": KEY_PARTIAL},
    ).scalar_one()
    assert partial_classes == 3  # exactly one class at each of the three levels
    partial_l1 = session.execute(
        _sql(
            "SELECT share_of_evaluated_area, share_of_cell_area FROM "
            "environmental_land_cover_cell_class_areas WHERE statistics_version_id = :v "
            "AND candidate_key = :k AND class_level = 1"
        ),
        {"v": report.statistics_version_id, "k": KEY_PARTIAL},
    ).one()
    # The two denominators are genuinely different and must not be conflated.
    assert partial_l1.share_of_evaluated_area == pytest.approx(1.0, rel=1e-6)
    assert partial_l1.share_of_cell_area == pytest.approx(0.4, rel=1e-3)

    # --- no-coverage cell ---------------------------------------------------
    empty = rows[KEY_EMPTY]
    assert empty.coverage_status == STATUS_NO_COVERAGE
    assert empty.evaluated_area_m2 == 0.0
    assert empty.uncovered_area_m2 == pytest.approx(empty.cell_area_m2, rel=1e-9)
    assert empty.uncovered_residual_area_m2 == pytest.approx(empty.cell_area_m2, rel=1e-9)
    assert empty.coverage_ratio == 0.0
    assert empty.dominant_l1_code is None
    assert empty.dominant_l3_code is None
    assert empty.l1_class_count == 0
    no_class_rows = session.execute(
        _sql(
            "SELECT count(*) FROM environmental_land_cover_cell_class_areas "
            "WHERE statistics_version_id = :v AND candidate_key = :k"
        ),
        {"v": report.statistics_version_id, "k": KEY_EMPTY},
    ).scalar_one()
    assert no_class_rows == 0

    # --- overlapping source features (union prevents double counting) -------
    overlap = rows[KEY_OVERLAP]
    assert overlap.coverage_status == STATUS_COMPLETE_EXACT
    assert overlap.l1_class_count == 1
    # Two features (500×500 and 100×500) overlap by 50,000 m². The union is one
    # cell area; the pre-union sum is 50,000 m² larger, and the difference is
    # recorded as overlap evidence rather than normalized away.
    assert overlap.evaluated_area_m2 == pytest.approx(250_000.0, rel=1e-3)
    assert overlap.intersection_area_sum_m2 == pytest.approx(300_000.0, rel=1e-3)
    assert overlap.overlap_area_m2 == pytest.approx(50_000.0, rel=1e-3)
    overlap_l1 = session.execute(
        _sql(
            "SELECT class_area_m2 FROM environmental_land_cover_cell_class_areas "
            "WHERE statistics_version_id = :v AND candidate_key = :k AND class_level = 1"
        ),
        {"v": report.statistics_version_id, "k": KEY_OVERLAP},
    ).scalar_one()
    assert overlap_l1 == pytest.approx(250_000.0, rel=1e-3)

    assert report.cells_with_source_overlap >= 1
    assert report.max_overlap_area_m2 == pytest.approx(50_000.0, rel=1e-3)


@pg
def test_l1_l2_l3_levels_all_present_and_reconcile(scenario: _Fixture) -> None:
    report = _derive(scenario, write=True)
    assert report.statistics_version_id is not None
    scenario.statistics_version_ids.append(report.statistics_version_id)
    scenario.session.commit()

    levels = {
        row.class_level: row
        for row in scenario.session.execute(
            _sql(
                """
                SELECT class_level, count(*) AS n, sum(class_area_m2) AS area
                FROM environmental_land_cover_cell_class_areas
                WHERE statistics_version_id = :v AND candidate_key = :k
                GROUP BY class_level
                """
            ),
            {"v": report.statistics_version_id, "k": KEY_COVERED},
        ).all()
    }
    assert set(levels) == {1, 2, 3}
    # Each level independently reconciles to the same evaluated area, because the
    # source partitions this cell.
    for level in (1, 2, 3):
        assert levels[level].area == pytest.approx(250_000.0, rel=1e-3)

    sums = scenario.session.execute(
        _sql(
            "SELECT l1_class_area_sum_m2 a1, l2_class_area_sum_m2 a2, l3_class_area_sum_m2 a3, "
            "evaluated_area_m2 e FROM environmental_land_cover_cell_statistics "
            "WHERE statistics_version_id = :v AND candidate_key = :k"
        ),
        {"v": report.statistics_version_id, "k": KEY_COVERED},
    ).one()
    for stored_sum in (sums.a1, sums.a2, sums.a3):
        assert stored_sum == pytest.approx(sums.e, rel=1e-9)


@pg
def test_batch_size_does_not_change_the_result(scenario: _Fixture) -> None:
    small = _derive(scenario, write=False, batch_size=1)
    large = _derive(scenario, write=False, batch_size=100)
    assert small.batch_count == 4
    assert large.batch_count == 1
    for field in (
        "processed_cell_count",
        "complete_exact_count",
        "partial_count",
        "no_coverage_count",
        "class_row_count",
        "candidate_grid_fingerprint",
        "input_signature",
    ):
        assert getattr(small, field) == getattr(large, field)
    assert small.total_evaluated_area_m2 == pytest.approx(large.total_evaluated_area_m2, rel=1e-9)


@pg
def test_repeated_key_with_identical_geometry_is_accepted_once(scenario: _Fixture) -> None:
    """The same cell in two runs is one canonical cell, not two."""

    report = _derive(scenario, write=False)
    assert report.candidate_row_count == 8
    assert report.canonical_cell_count == 4
    assert report.representation_variant_cell_count == 0
    assert report.geometry_conflict_count == 0


@pg
def test_conflicting_geometry_for_one_key_is_a_hard_failure(scenario: _Fixture) -> None:
    session = scenario.session
    now = datetime.datetime(2026, 7, 28, tzinfo=datetime.UTC)
    conflicting_run = _create_analysis_run(session, now=now, signature="TESTSIGC")
    scenario.run_ids.append(conflicting_run)
    # Same key, genuinely DIFFERENT geometry (shifted a full cell east).
    _add_candidate(
        session,
        run_id=conflicting_run,
        key=KEY_COVERED,
        wkt_5186=_cell_wkt(9, 9),
        now=now,
    )
    session.commit()

    with pytest.raises(LandCoverCellStatisticsError, match="conflicting geometry"):
        _derive(scenario, write=False)


@pg
def test_empty_candidate_geometry_is_a_hard_failure(scenario: _Fixture) -> None:
    session = scenario.session
    now = datetime.datetime(2026, 7, 28, tzinfo=datetime.UTC)
    bad_run = _create_analysis_run(session, now=now, signature="TESTSIG-EMPTY")
    scenario.run_ids.append(bad_run)
    _add_candidate(
        session, run_id=bad_run, key=f"{FIXTURE_GRID}:9_9", wkt_5186=None, now=now, empty=True
    )
    session.commit()

    with pytest.raises(LandCoverCellStatisticsError, match="failed verification"):
        _derive(scenario, write=False)


@pg
def test_null_candidate_geometry_cannot_exist(scenario: _Fixture) -> None:
    """NULL candidate geometry is impossible upstream, so prove the constraint holds.

    ``suitability_candidates.geometry`` is NOT NULL, so the derivation can never be
    handed a NULL-geometry cell. The canonicalization gate still counts NULLs (it
    must not assume the constraint), but the authoritative guarantee is here.
    """

    nullable = scenario.session.execute(
        _sql(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'suitability_candidates' AND column_name = 'geometry'"
        )
    ).scalar_one()
    assert nullable == "NO"

    from sqlalchemy.exc import IntegrityError

    now = datetime.datetime(2026, 7, 28, tzinfo=datetime.UTC)
    bad_run = _create_analysis_run(scenario.session, now=now, signature="TESTSIG-NULL")
    scenario.run_ids.append(bad_run)
    with pytest.raises(IntegrityError):
        _add_candidate(
            scenario.session,
            run_id=bad_run,
            key=f"{FIXTURE_GRID}:8_8",
            wkt_5186=None,
            now=now,
            null_geometry=True,
        )
    scenario.session.rollback()


@pg
def test_clipped_cell_keeps_its_actual_area(scenario: _Fixture) -> None:
    """A boundary-clipped cell is never assumed to be exactly 250,000 m²."""

    session = scenario.session
    now = datetime.datetime(2026, 7, 28, tzinfo=datetime.UTC)
    clipped_run = _create_analysis_run(session, now=now, signature="TESTSIG-CLIP")
    scenario.run_ids.append(clipped_run)
    x0 = ORIGIN_X + 10 * CELL
    y0 = ORIGIN_Y
    # A 500 × 150 m clipped remnant: 75,000 m², not 250,000 m².
    _add_candidate(
        session,
        run_id=clipped_run,
        key=f"{FIXTURE_GRID}:10_0",
        wkt_5186=_wkt_box(x0, y0, x0 + CELL, y0 + 150.0),
        now=now,
    )
    session.commit()

    report = _derive(scenario, write=False)
    assert report.canonical_cell_count == 5
    # The clipped remnant keeps its ACTUAL area; it is never rounded up to a full cell.
    assert report.cell_area_min_m2 == pytest.approx(75_000.0, rel=1e-3)
    assert report.cell_area_max_m2 == pytest.approx(250_000.0, rel=1e-3)
    stored_min = scenario.session.execute(
        _sql(
            """
            SELECT min(ST_Area(ST_Transform(geometry, 5186))) FROM suitability_candidates
            WHERE candidate_key = :k
            """
        ),
        {"k": f"{FIXTURE_GRID}:10_0"},
    ).scalar_one()
    assert float(stored_min) == pytest.approx(75_000.0, rel=1e-3)


@pg
def test_active_release_must_be_unambiguous(scenario: _Fixture) -> None:
    """Zero or several active land_cover releases must fail visibly, never guess."""

    from waste_equity_backend.db import get_sessionmaker

    session = scenario.session
    session.execute(
        _sql("UPDATE environmental_dataset_versions SET is_active = false WHERE id = :v"),
        {"v": scenario.dataset_version_id},
    )
    session.commit()
    try:
        with pytest.raises(LandCoverCellStatisticsError, match="No active land_cover release"):
            run_land_cover_cell_statistics(
                write=False,
                candidate_grid_version=FIXTURE_GRID,
                explain=False,
                session_factory=get_sessionmaker(),
            )
    finally:
        session.execute(
            _sql("UPDATE environmental_dataset_versions SET is_active = true WHERE id = :v"),
            {"v": scenario.dataset_version_id},
        )
        session.commit()


@pg
def test_explicit_version_id_must_be_a_land_cover_release(scenario: _Fixture) -> None:
    from waste_equity_backend.db import get_sessionmaker

    with pytest.raises(LandCoverCellStatisticsError, match="not a 'land_cover' release"):
        run_land_cover_cell_statistics(
            write=False,
            candidate_grid_version=FIXTURE_GRID,
            dataset_version_id=scenario.other_layer_version_id,
            explain=False,
            session_factory=get_sessionmaker(),
        )


@pg
def test_unknown_candidate_grid_version_is_rejected(scenario: _Fixture) -> None:
    from waste_equity_backend.db import get_sessionmaker

    with pytest.raises(LandCoverCellStatisticsError, match="is not present"):
        run_land_cover_cell_statistics(
            write=False,
            candidate_grid_version="no-such-grid-v1",
            dataset_version_id=scenario.dataset_version_id,
            explain=False,
            session_factory=get_sessionmaker(),
        )


@pg
def test_failed_derivation_is_not_activated(scenario: _Fixture, monkeypatch: Any) -> None:
    """A run that fails mid-write leaves a FAILED, inactive version — never active."""

    original = cs._run_batch_computation
    state = {"calls": 0}

    def exploding(session: Any, **kwargs: Any) -> None:
        state["calls"] += 1
        if state["calls"] > 1:
            raise RuntimeError("TEST-ONLY injected batch failure")
        original(session, **kwargs)

    monkeypatch.setattr(cs, "_run_batch_computation", exploding)
    with pytest.raises(RuntimeError, match="injected batch failure"):
        _derive(scenario, write=True, batch_size=1)

    session = scenario.session
    session.rollback()
    row = session.execute(
        _sql(
            """
            SELECT id, status, is_active FROM environmental_land_cover_cell_stat_versions
            WHERE land_cover_dataset_version_id = :v
            """
        ),
        {"v": scenario.dataset_version_id},
    ).one()
    scenario.statistics_version_ids.append(int(row.id))
    assert row.status == "FAILED"
    assert row.is_active is False
    # The failed attempt's ingestion run stays FAILED.
    run_status = session.execute(
        _sql(
            "SELECT status FROM ingestion_runs WHERE transformation_version = :tv "
            "ORDER BY run_id DESC LIMIT 1"
        ),
        {"tv": DERIVATION_VERSION},
    ).scalar_one()
    assert run_status == "FAILED"


@pg
def test_incomplete_derivation_cannot_activate(scenario: _Fixture, monkeypatch: Any) -> None:
    """Activation is proven from the persisted rows, not from in-process tallies."""

    session = scenario.session
    original_finalize = cs._finalize_version

    def sabotage(sess: Any, *, version_id: int, report: Any, grid: Any, now: Any) -> None:
        # Delete one stored cell before the completeness proof runs.
        sess.execute(
            _sql(
                "DELETE FROM environmental_land_cover_cell_class_areas "
                "WHERE statistics_version_id = :v AND candidate_key = :k"
            ),
            {"v": version_id, "k": KEY_EMPTY},
        )
        sess.execute(
            _sql(
                "DELETE FROM environmental_land_cover_cell_statistics "
                "WHERE statistics_version_id = :v AND candidate_key = :k"
            ),
            {"v": version_id, "k": KEY_EMPTY},
        )
        original_finalize(sess, version_id=version_id, report=report, grid=grid, now=now)

    monkeypatch.setattr(cs, "_finalize_version", sabotage)
    with pytest.raises(LandCoverCellStatisticsError, match="Refusing to activate"):
        _derive(scenario, write=True)

    session.rollback()
    row = session.execute(
        _sql(
            "SELECT id, status, is_active FROM environmental_land_cover_cell_stat_versions "
            "WHERE land_cover_dataset_version_id = :v"
        ),
        {"v": scenario.dataset_version_id},
    ).one()
    scenario.statistics_version_ids.append(int(row.id))
    assert row.status == "FAILED"
    assert row.is_active is False


@pg
def test_derivation_touches_no_suitability_score_or_candidate(scenario: _Fixture) -> None:
    """The whole point of the phase boundary, asserted against real stored rows."""

    session = scenario.session
    before = session.execute(
        _sql(
            """
            SELECT count(*) AS n,
                   md5(string_agg(candidate_key || '|' || status || '|' ||
                                  md5(ST_AsEWKB(geometry)), E'\\n' ORDER BY id)) AS h
            FROM suitability_candidates
            """
        )
    ).one()
    runs_before = session.execute(
        _sql(
            "SELECT count(*) AS n, md5(string_agg(policy_version || derivation_version || "
            "candidate_grid_version, E'\\n' ORDER BY id)) AS h FROM suitability_analysis_runs"
        )
    ).one()

    report = _derive(scenario, write=True)
    assert report.statistics_version_id is not None
    scenario.statistics_version_ids.append(report.statistics_version_id)
    session.commit()

    after = session.execute(
        _sql(
            """
            SELECT count(*) AS n,
                   md5(string_agg(candidate_key || '|' || status || '|' ||
                                  md5(ST_AsEWKB(geometry)), E'\\n' ORDER BY id)) AS h
            FROM suitability_candidates
            """
        )
    ).one()
    runs_after = session.execute(
        _sql(
            "SELECT count(*) AS n, md5(string_agg(policy_version || derivation_version || "
            "candidate_grid_version, E'\\n' ORDER BY id)) AS h FROM suitability_analysis_runs"
        )
    ).one()
    assert (after.n, after.h) == (before.n, before.h)
    assert (runs_after.n, runs_after.h) == (runs_before.n, runs_before.h)


@pg
def test_no_scoring_column_exists_on_the_new_tables(scenario: _Fixture) -> None:
    """The derived tables must carry no score/weight/rank/status/policy column."""

    forbidden = ("score", "weight", "rank", "exclusion", "penalt", "policy", "eligib")
    for table in (
        "environmental_land_cover_cell_stat_versions",
        "environmental_land_cover_cell_statistics",
        "environmental_land_cover_cell_class_areas",
    ):
        columns = [
            str(row.column_name)
            for row in scenario.session.execute(
                _sql("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": table},
            ).all()
        ]
        assert columns, f"{table} is missing"
        for column in columns:
            # ``coverage_status`` is a land-cover coverage label, not a candidate status.
            if column == "coverage_status":
                continue
            assert not any(token in column for token in forbidden), f"{table}.{column}"
        # No geometry is stored, so no spatial index may exist either.
        spatial = scenario.session.execute(
            _sql(
                "SELECT count(*) FROM pg_indexes WHERE tablename = :t AND indexdef ILIKE '%gist%'"
            ),
            {"t": table},
        ).scalar_one()
        assert spatial == 0


@pg
def test_dominant_class_tie_breaks_on_ascending_code(db_session: Any) -> None:
    """An exact area tie resolves on the ASCENDING official code, not row order.

    Two clipped halves of a real cell never tie bit-for-bit, so the tie-break is
    exercised here against a controlled fixture using the module's *actual*
    ``DOMINANT_ORDER_BY`` clause — the same string the derivation SQL is built from,
    asserted below to still be embedded in that SQL.
    """

    assert cs.DOMINANT_ORDER_BY in cs._STEP_CELLS

    session = db_session
    session.execute(
        _sql(
            "CREATE TEMP TABLE _tie (candidate_key text, class_level smallint, "
            "class_code text, class_name text, class_area_m2 double precision)"
        )
    )
    # Deliberately inserted in DESCENDING code order so that "database row order"
    # and "ascending code" disagree; the tie-break must ignore insertion order.
    session.execute(
        _sql(
            "INSERT INTO _tie VALUES "
            "('k', 1, '700', '수역', 125000.0), "
            "('k', 1, '400', '초지', 125000.0), "
            "('k', 1, '100', '시가화건조지역', 125000.0), "
            "('k', 1, '200', '농업지역', 100.0)"
        )
    )
    winner = session.execute(
        _sql(
            "SELECT DISTINCT ON (candidate_key, class_level) class_code, class_name "
            f"FROM _tie ORDER BY {cs.DOMINANT_ORDER_BY}"
        )
    ).one()
    assert winner.class_code == "100"
    assert winner.class_name == "시가화건조지역"
    session.rollback()


@pg
def test_failed_reverification_leaves_a_proven_release_active(
    scenario: _Fixture, monkeypatch: Any
) -> None:
    """A failed re-run does not unmake an earlier, already-proven complete release."""

    first = _derive(scenario, write=True)
    assert first.statistics_version_id is not None
    scenario.statistics_version_ids.append(first.statistics_version_id)
    assert first.statistics_version_activated is True
    session = scenario.session
    session.commit()
    before = session.execute(
        _sql(
            "SELECT status, is_active, completed_at, ingestion_run_id FROM "
            "environmental_land_cover_cell_stat_versions WHERE id = :v"
        ),
        {"v": first.statistics_version_id},
    ).one()

    original = cs._run_batch_computation

    def exploding(sess: Any, **kwargs: Any) -> None:
        raise RuntimeError("TEST-ONLY injected re-verification failure")

    monkeypatch.setattr(cs, "_run_batch_computation", exploding)
    with pytest.raises(RuntimeError, match="injected re-verification failure"):
        _derive(scenario, write=True)
    monkeypatch.setattr(cs, "_run_batch_computation", original)

    session.rollback()
    after = session.execute(
        _sql(
            "SELECT status, is_active, completed_at, ingestion_run_id FROM "
            "environmental_land_cover_cell_stat_versions WHERE id = :v"
        ),
        {"v": first.statistics_version_id},
    ).one()
    assert (after.status, after.is_active) == ("SUCCEEDED", True)
    assert after.completed_at == before.completed_at
    assert after.ingestion_run_id == before.ingestion_run_id
    # The failure is recorded honestly on this attempt's own run row.
    latest_run = session.execute(
        _sql(
            "SELECT status FROM ingestion_runs WHERE transformation_version = :tv "
            "ORDER BY run_id DESC LIMIT 1"
        ),
        {"tv": DERIVATION_VERSION},
    ).scalar_one()
    assert latest_run == "FAILED"
    # The stored rows are untouched.
    assert (
        session.execute(
            _sql(
                "SELECT count(*) FROM environmental_land_cover_cell_statistics "
                "WHERE statistics_version_id = :v"
            ),
            {"v": first.statistics_version_id},
        ).scalar_one()
        == 4
    )


@pg
def test_completed_at_is_the_completion_instant_not_the_start(scenario: _Fixture) -> None:
    """A multi-hour derivation must not report ``completed_at == started_at``.

    Every written row shares the run-start instant as ``created_at`` (so one release
    has one row timestamp), but the release's ``completed_at`` is taken when the
    completeness proof passes. On a fixture the two are milliseconds apart, so the
    assertion is ordering, not duration.
    """

    report = _derive(scenario, write=True)
    assert report.statistics_version_id is not None
    scenario.statistics_version_ids.append(report.statistics_version_id)
    scenario.session.commit()

    row = scenario.session.execute(
        _sql(
            "SELECT started_at, completed_at FROM "
            "environmental_land_cover_cell_stat_versions WHERE id = :v"
        ),
        {"v": report.statistics_version_id},
    ).one()
    assert row.completed_at is not None
    assert row.completed_at >= row.started_at
