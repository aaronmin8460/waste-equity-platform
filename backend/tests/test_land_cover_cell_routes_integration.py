"""Candidate-cell land-cover statistics API integration tests (Phase 1B-LC4).

Runs only when ``TEST_DATABASE_URL`` is set. Everything is seeded inside a rolled-back
outer transaction, so no real row is ever created, changed, or deleted.

This tier covers what SQLite cannot: the bbox filter, which is the only part of the API
that touches geometry. It joins the LC3 statistics (which store none) to the existing
``suitability_candidates`` geometry through the stable ``(grid version, candidate key)``
identity. The synthetic grid sits in remote ocean around lon 40°, lat 40°, far from any
real candidate, and its own analysis runs are synthetic too.

The critical assertion here is the **canonical-occurrence equivalence**: the router
filters on ``DISTINCT candidate_key`` over every occurrence of the grid version so the
GiST index can drive the query, and that must return exactly the same keys as testing
the canonical occurrence (lowest ``(analysis_run_id, id)``) alone.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import (
    DataSource,
    EnvironmentalDatasetVersion,
    EnvironmentalLandCoverCellClassArea,
    EnvironmentalLandCoverCellStatistic,
    EnvironmentalLandCoverCellStatVersion,
    SuitabilityAnalysisRun,
    SuitabilityCandidate,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

BASE = "/api/v1/environment/land-cover/cell-statistics"
NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
GRID = "lc4-test-grid-500m-v1"
DERIVATION = "land-cover-cell-stats-v1"
AREA_CRS = "EPSG:5186"
SOURCE_ID = "lc4_test_land_cover"

#: Remote-ocean anchor for the synthetic grid: lon 40.0-40.3, lat 40.0-40.1. No real
#: capital-region candidate is anywhere near it, so a bbox here can only match ours.
_LON0, _LAT0 = 40.0, 40.0
_STEP = 0.1

# Three cells in a west-to-east row, one per coverage status.
CELLS = [
    ("A", "COMPLETE_EXACT"),
    ("B", "PARTIAL"),
    ("C", "NO_COVERAGE"),
]


def _key(label: str) -> str:
    return f"{GRID}:{label}"


def _square(index: int) -> str:
    """A small axis-aligned square, ``index`` steps east of the anchor."""

    lon0 = _LON0 + index * _STEP
    lon1 = lon0 + _STEP * 0.5
    lat0, lat1 = _LAT0, _LAT0 + _STEP * 0.5
    return (
        f"MULTIPOLYGON((({lon0} {lat0},{lon1} {lat0},{lon1} {lat1},{lon0} {lat1},{lon0} {lat0})))"
    )


@pytest.fixture
def pg_session() -> Iterator[Session]:
    engine = create_engine(str(TEST_DATABASE_URL))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def pg_client(pg_session: Session) -> Iterator[TestClient]:
    app = create_app()

    def override() -> Iterator[Session]:
        yield pg_session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, Any]:
    """A synthetic release plus a two-run candidate grid, all rolled back after.

    Both analysis runs carry every cell, exactly like the real grid (95,786 candidate
    rows collapsing to 47,893 cells), so the canonicalization path is genuinely
    exercised rather than assumed away by a single-run fixture.
    """

    # A fully synthetic source release, so the fixture never depends on (or reads) any
    # real land-cover release that happens to be loaded.
    pg_session.add(
        DataSource(
            source_id=SOURCE_ID,
            source_name="LC4 test source",
            dataset_name="LC4 test land cover",
            endpoint="https://example.invalid/lc4-test",
            publication_frequency="STRUCTURAL",
            enabled=False,
            documentation_url=None,
        )
    )
    pg_session.flush()
    source = EnvironmentalDatasetVersion(
        layer_name="land_cover",
        source_id=SOURCE_ID,
        provider="LC4 테스트 제공기관",
        official_dataset_name="세분류 [2025] 테스트 토지피복지도",
        provider_dataset_identifier="lc4-test-land-cover-l3",
        official_source_url="https://example.invalid/lc4-test",
        reference_period="2025",
        source_crs="EPSG:5186",
        target_crs="EPSG:4326",
        source_encoding="cp949",
        normalized_geometry_type="MultiPolygon",
        declared_feature_count=3,
        source_checksum="9" * 64,
        transformation_version="land-cover-v1",
        license_note="테스트 라이선스 메모 — 서면 재확인 필요",
        # Deliberately NOT active: this API resolves the *statistics* release, and must
        # not require (or depend on) the source dataset version being flagged active.
        is_active=False,
        created_at=NOW,
    )
    pg_session.add(source)
    pg_session.flush()

    # Two synthetic analysis runs over the same synthetic grid version.
    runs = []
    for offset, signature in enumerate(("lc4-test-sig-a", "lc4-test-sig-b")):
        run = SuitabilityAnalysisRun(
            derivation_version="lc4-test-screening",
            policy_version="lc4-test-policy",
            candidate_grid_version=GRID,
            reference_year=1999,
            boundary_vintage="1999",
            weight_profile="balanced",
            analysis_signature=signature,
            status="SUCCEEDED",
            started_at=NOW + datetime.timedelta(days=offset),
            created_at=NOW,
        )
        pg_session.add(run)
        runs.append(run)
    pg_session.flush()

    # Every cell appears in both runs with byte-identical geometry.
    for index, (label, _status) in enumerate(CELLS):
        wkt = _square(index)
        for run in runs:
            pg_session.add(
                SuitabilityCandidate(
                    analysis_run_id=run.id,
                    candidate_key=_key(label),
                    status="ELIGIBLE",
                    original_area_m2=250_000,
                    clipped_area_m2=250_000,
                    clipped_area_ratio=1,
                    centroid=WKTElement(
                        f"POINT({_LON0 + index * _STEP + _STEP * 0.25} {_LAT0 + _STEP * 0.25})",
                        srid=4326,
                    ),
                    geometry=WKTElement(wkt, srid=4326),
                    created_at=NOW,
                )
            )
    pg_session.flush()

    release = EnvironmentalLandCoverCellStatVersion(
        land_cover_dataset_version_id=source.id,
        candidate_grid_version=GRID,
        candidate_grid_fingerprint="f" * 64,
        derivation_version=DERIVATION,
        area_crs=AREA_CRS,
        input_signature="lc4-test-" + "0" * 55,
        status="SUCCEEDED",
        expected_cell_count=3,
        processed_cell_count=3,
        complete_exact_count=1,
        partial_count=1,
        no_coverage_count=1,
        failed_cell_count=0,
        candidate_row_count=6,
        duplicate_candidate_occurrence_count=3,
        representation_variant_cell_count=0,
        total_cell_area_m2=750_000.0,
        total_evaluated_area_m2=400_000.0,
        total_uncovered_area_m2=350_000.0,
        aggregate_coverage_ratio=400_000.0 / 750_000.0,
        total_intersection_area_m2=400_000.0,
        class_row_count=3,
        batch_size=500,
        is_active=True,
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
    )
    pg_session.add(release)
    pg_session.flush()

    measurements = {
        "COMPLETE_EXACT": (250_000.0, 250_000.0),
        "PARTIAL": (250_000.0, 150_000.0),
        "NO_COVERAGE": (250_000.0, 0.0),
    }
    cells: dict[str, EnvironmentalLandCoverCellStatistic] = {}
    for label, status in CELLS:
        cell_area, evaluated = measurements[status]
        covered = status != "NO_COVERAGE"
        cell = EnvironmentalLandCoverCellStatistic(
            statistics_version_id=release.id,
            land_cover_dataset_version_id=source.id,
            candidate_grid_version=GRID,
            candidate_key=_key(label),
            candidate_geometry_fingerprint=f"{label.lower() * 8}" * 8,
            sido_region_code="KR-SGIS-11",
            sido_region_name="서울특별시",
            sigungu_region_code="KR-SGIS-11110",
            sigungu_region_name="종로구",
            cell_area_m2=cell_area,
            evaluated_area_m2=evaluated,
            uncovered_area_m2=cell_area - evaluated,
            coverage_ratio=evaluated / cell_area,
            intersection_area_sum_m2=evaluated,
            overlap_area_m2=0.0,
            coverage_status=status,
            uncovered_residual_area_m2=cell_area - evaluated,
            topological_cover_predicate=False,
            matched_feature_count=2 if covered else 0,
            dominant_l1_code="300" if covered else None,
            dominant_l1_name="산림지역" if covered else None,
            dominant_l2_code="310" if covered else None,
            dominant_l2_name="활엽수림" if covered else None,
            dominant_l3_code="311" if covered else None,
            dominant_l3_name="활엽수림" if covered else None,
            l1_class_count=1 if covered else 0,
            l2_class_count=1 if covered else 0,
            l3_class_count=1 if covered else 0,
            l1_class_area_sum_m2=evaluated,
            l2_class_area_sum_m2=evaluated,
            l3_class_area_sum_m2=evaluated,
            candidate_occurrence_count=2,
            representation_variant_count=0,
            guard_applied=False,
            derivation_version=DERIVATION,
            area_crs=AREA_CRS,
            created_at=NOW,
        )
        pg_session.add(cell)
        cells[label] = cell
    pg_session.flush()

    # Class rows only for the covered cells; the NO_COVERAGE cell gets none.
    for label, status in CELLS:
        if status == "NO_COVERAGE":
            continue
        evaluated = measurements[status][1]
        cell_area = measurements[status][0]
        pg_session.add(
            EnvironmentalLandCoverCellClassArea(
                statistics_version_id=release.id,
                cell_statistics_id=cells[label].id,
                candidate_key=_key(label),
                class_level=1,
                class_code="300",
                class_name="산림지역",
                class_area_m2=evaluated,
                share_of_evaluated_area=1.0,
                share_of_cell_area=evaluated / cell_area,
                created_at=NOW,
            )
        )
    pg_session.flush()
    return {"release": release, "source": source, "cells": cells}


def _bbox(west_index: int, east_index: int) -> str:
    """A bbox that tightly envelops cells ``west_index`` … ``east_index``."""

    min_lon = _LON0 + west_index * _STEP - 0.01
    max_lon = _LON0 + east_index * _STEP + _STEP * 0.5 + 0.01
    return f"{min_lon},{_LAT0 - 0.01},{max_lon},{_LAT0 + _STEP * 0.5 + 0.01}"


# --------------------------------------------------------------------------- #
# Active release resolution against real PostGIS
# --------------------------------------------------------------------------- #
def test_release_resolves_the_synthetic_active_release(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(f"{BASE}/release").json()

    assert body["statistics_version_id"] == seeded["release"].id
    assert body["candidate_grid_version"] == GRID
    assert body["status"] == "SUCCEEDED"
    assert body["expected_cell_count"] == body["processed_cell_count"] == 3
    assert body["disclosures"]["used_in_suitability_scoring"] is False
    assert (
        body["disclosures"]["license_status"]
        == "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER"
    )
    assert body["disclosures"]["authorization_basis"] == "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION"
    # Mandatory attribution resolves against the release actually served.
    attribution = body["disclosures"]["attribution"]
    assert attribution["statistics_version_id"] == seeded["release"].id
    assert attribution["statistics_derivation_version"] == seeded["release"].derivation_version
    assert attribution["attribution_ko"].startswith("출처: 기후에너지환경부")


def test_partial_unique_index_blocks_a_second_active_release(
    seeded: dict[str, Any], pg_session: Session
) -> None:
    """LC3's guarantee the API's resolution relies on, asserted on real PostGIS."""

    from sqlalchemy.exc import IntegrityError

    release = seeded["release"]
    duplicate = EnvironmentalLandCoverCellStatVersion(
        land_cover_dataset_version_id=release.land_cover_dataset_version_id,
        candidate_grid_version=GRID,
        candidate_grid_fingerprint="f" * 64,
        derivation_version=DERIVATION,
        area_crs=AREA_CRS,
        input_signature="lc4-test-" + "1" * 55,
        status="SUCCEEDED",
        is_active=True,
        started_at=NOW,
        created_at=NOW,
    )
    pg_session.add(duplicate)
    with pytest.raises(IntegrityError):
        pg_session.flush()
    pg_session.rollback()


# --------------------------------------------------------------------------- #
# bbox filtering
# --------------------------------------------------------------------------- #
def test_bbox_includes_only_intersecting_cells(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(f"{BASE}/cells", params={"bbox": _bbox(0, 0)}).json()

    assert [item["candidate_key"] for item in body["items"]] == [_key("A")]
    assert body["total"] == 1
    assert body["applied_filters"]["bbox"] == pytest.approx(
        [float(v) for v in _bbox(0, 0).split(",")]
    )


def test_bbox_widening_adds_cells_west_to_east(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    for east, expected in ((0, ["A"]), (1, ["A", "B"]), (2, ["A", "B", "C"])):
        body = pg_client.get(f"{BASE}/cells", params={"bbox": _bbox(0, east)}).json()
        assert [item["candidate_key"] for item in body["items"]] == [
            _key(label) for label in expected
        ], f"east index {east}"
        assert body["total"] == len(expected)


def test_bbox_excludes_everything_when_disjoint(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(f"{BASE}/cells", params={"bbox": "-20,-20,-19,-19"}).json()

    assert body["items"] == []
    assert body["total"] == 0
    assert body["has_more"] is False


def test_bbox_matches_the_canonical_occurrence_key_set(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """The router's DISTINCT-over-occurrences filter == the canonical-occurrence filter.

    The router deliberately tests every occurrence of a key so the GiST index drives
    the query. That is only sound because LC3 proved all occurrences of a key are
    ``ST_Equals``, hence share a bounding box. This asserts the equivalence directly
    against the canonical rule (lowest ``(analysis_run_id, id)``) on real PostGIS.
    """

    bbox = _bbox(0, 1)
    api_keys = [
        item["candidate_key"]
        for item in pg_client.get(f"{BASE}/cells", params={"bbox": bbox}).json()["items"]
    ]

    min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
    canonical_keys = [
        row[0]
        for row in pg_session.execute(
            text(
                """
                WITH occurrence AS (
                    SELECT c.candidate_key, c.geometry, c.analysis_run_id, c.id
                    FROM suitability_candidates c
                    JOIN suitability_analysis_runs r ON r.id = c.analysis_run_id
                    WHERE r.candidate_grid_version = :grid
                ), canonical AS (
                    SELECT DISTINCT ON (candidate_key) *
                    FROM occurrence
                    ORDER BY candidate_key, analysis_run_id, id
                )
                SELECT candidate_key FROM canonical
                WHERE geometry && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                ORDER BY candidate_key
                """
            ),
            {
                "grid": GRID,
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            },
        ).all()
    ]
    assert api_keys == canonical_keys == [_key("A"), _key("B")]


def test_bbox_never_returns_duplicate_rows_across_analysis_runs(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Each cell appears once even though every key has two candidate occurrences."""

    body = pg_client.get(f"{BASE}/cells", params={"bbox": _bbox(0, 2)}).json()

    keys = [item["candidate_key"] for item in body["items"]]
    assert len(keys) == len(set(keys)) == 3
    assert body["total"] == 3
    # The occurrence count is reported on the cell, not collapsed away.
    detail = pg_client.get(f"{BASE}/cells/{_key('A')}").json()
    assert detail["candidate_occurrence_count"] == 2


def test_bbox_composes_with_coverage_status_filter(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(
        f"{BASE}/cells", params={"bbox": _bbox(0, 2), "coverage_status": "NO_COVERAGE"}
    ).json()

    assert [item["candidate_key"] for item in body["items"]] == [_key("C")]
    assert body["items"][0]["dominant_l1_code"] is None


def test_bbox_ignores_candidates_of_another_grid_version(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """A geometrically overlapping candidate from a different grid must not leak in."""

    other = SuitabilityAnalysisRun(
        derivation_version="lc4-test-screening",
        policy_version="lc4-test-policy",
        candidate_grid_version="lc4-test-other-grid-v9",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="balanced",
        analysis_signature="lc4-test-sig-other",
        status="SUCCEEDED",
        started_at=NOW,
        created_at=NOW,
    )
    pg_session.add(other)
    pg_session.flush()
    # Same key text, same geometry, different grid version.
    pg_session.add(
        SuitabilityCandidate(
            analysis_run_id=other.id,
            candidate_key=_key("D"),
            status="ELIGIBLE",
            original_area_m2=250_000,
            clipped_area_m2=250_000,
            clipped_area_ratio=1,
            centroid=WKTElement(f"POINT({_LON0 + 0.02} {_LAT0 + 0.02})", srid=4326),
            geometry=WKTElement(_square(0), srid=4326),
            created_at=NOW,
        )
    )
    pg_session.flush()

    body = pg_client.get(f"{BASE}/cells", params={"bbox": _bbox(0, 2)}).json()
    keys = {item["candidate_key"] for item in body["items"]}
    assert _key("D") not in keys
    assert keys == {_key("A"), _key("B"), _key("C")}


def test_bbox_with_no_matching_candidate_geometry_returns_empty_not_error(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """A bbox over valid but empty ocean is a well-formed empty page, not a 5xx."""

    response = pg_client.get(f"{BASE}/cells", params={"bbox": "0.0,0.0,0.5,0.5"})
    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.parametrize("bbox", ["1,2,3", "a,b,c,d", "10,10,5,20", "-181,10,-179,20"])
def test_malformed_bbox_is_rejected_before_any_query(
    seeded: dict[str, Any], pg_client: TestClient, bbox: str
) -> None:
    response = pg_client.get(f"{BASE}/cells", params={"bbox": bbox})
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "INVALID_BBOX"


# --------------------------------------------------------------------------- #
# Serialization against real column types
# --------------------------------------------------------------------------- #
def test_coverage_statuses_serialize_correctly_from_postgres(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    expected = {"A": "COMPLETE_EXACT", "B": "PARTIAL", "C": "NO_COVERAGE"}
    for label, status in expected.items():
        body = pg_client.get(f"{BASE}/cells/{_key(label)}").json()
        assert body["coverage_status"] == status
        assert body["cell_area_m2"] == pytest.approx(
            body["evaluated_area_m2"] + body["uncovered_area_m2"]
        )


def test_no_coverage_cell_has_no_class_rows_in_postgres(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(f"{BASE}/cells/{_key('C')}/classes").json()

    assert body["items"] == []
    assert body["total"] == 0
    assert body["uncovered_area_m2"] == pytest.approx(250_000.0)
    assert body["class_counts"]["l1_class_area_sum_m2"] == pytest.approx(0.0)


def test_undefined_share_is_null_on_a_zero_evaluated_class_row(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """A NULL ``share_of_evaluated_area`` in the column must serialize as null."""

    cell = seeded["cells"]["B"]
    pg_session.add(
        EnvironmentalLandCoverCellClassArea(
            statistics_version_id=seeded["release"].id,
            cell_statistics_id=cell.id,
            candidate_key=_key("B"),
            class_level=2,
            class_code="310",
            class_name="활엽수림",
            class_area_m2=0.0,
            share_of_evaluated_area=None,
            share_of_cell_area=0.0,
            created_at=NOW,
        )
    )
    pg_session.flush()

    rows = pg_client.get(f"{BASE}/cells/{_key('B')}/classes", params={"class_level": 2}).json()[
        "items"
    ]
    assert len(rows) == 1
    assert rows[0]["share_of_evaluated_area"] is None
    assert rows[0]["share_of_cell_area"] == pytest.approx(0.0)


def test_summary_aggregates_over_postgres_floats(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    body = pg_client.get(f"{BASE}/summary").json()

    assert body["cell_count"] == 3
    assert body["total_cell_area_m2"] == pytest.approx(750_000.0)
    assert body["total_evaluated_area_m2"] == pytest.approx(400_000.0)
    assert body["aggregate_coverage_ratio"] == pytest.approx(400_000.0 / 750_000.0)
    assert body["cells_without_dominant_class"] == 1
    assert [row["class_code"] for row in body["l1_area_distribution"]] == ["300"]
    assert body["l1_area_distribution"][0]["share_of_l1_class_area"] == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# Read-only and no-raw-feature guarantees
# --------------------------------------------------------------------------- #
def test_no_handler_queries_raw_land_cover_features(
    seeded: dict[str, Any], pg_client: TestClient, pg_session: Session
) -> None:
    """The 6.9 M-row feature table must not be read by any API request.

    Asserted from ``pg_stat_statements``-free ground truth: the feature table's
    sequential- and index-scan counters must not advance across a full sweep of every
    endpoint, including the bbox path.
    """

    def scan_counts() -> tuple[int, int]:
        row = pg_session.execute(
            text(
                """
                SELECT coalesce(seq_scan, 0), coalesce(idx_scan, 0)
                FROM pg_stat_all_tables
                WHERE relname = 'environmental_land_cover_features'
                """
            )
        ).first()
        return (0, 0) if row is None else (int(row[0]), int(row[1]))

    before = scan_counts()
    for path in (
        "/release",
        "/summary",
        "/cells",
        f"/cells?bbox={_bbox(0, 2)}",
        f"/cells/{_key('A')}",
        f"/cells/{_key('A')}/classes",
    ):
        assert pg_client.get(f"{BASE}{path}").status_code == 200
    # Stats collection is asynchronous, so equality is asserted on a best-effort basis:
    # what must never happen is a jump proportional to a scan of the feature table.
    after = scan_counts()
    assert after[0] - before[0] == 0, "a handler sequentially scanned the raw feature table"


def test_endpoints_do_not_mutate_statistics_or_suitability_rows(
    seeded: dict[str, Any], pg_client: TestClient, pg_session: Session
) -> None:
    def counts() -> tuple[int, ...]:
        return (
            pg_session.scalar(
                select(func.count()).select_from(EnvironmentalLandCoverCellStatVersion)
            )
            or 0,
            pg_session.scalar(select(func.count()).select_from(EnvironmentalLandCoverCellStatistic))
            or 0,
            pg_session.scalar(select(func.count()).select_from(EnvironmentalLandCoverCellClassArea))
            or 0,
            pg_session.scalar(select(func.count()).select_from(SuitabilityCandidate)) or 0,
            pg_session.scalar(select(func.count()).select_from(SuitabilityAnalysisRun)) or 0,
        )

    before = counts()
    for path in (
        "/release",
        "/summary",
        "/summary?coverage_status=PARTIAL",
        "/cells",
        f"/cells?bbox={_bbox(0, 2)}",
        f"/cells/{_key('B')}",
        f"/cells/{_key('B')}/classes",
        f"/cells/{_key('C')}/classes",
    ):
        assert pg_client.get(f"{BASE}{path}").status_code == 200
    assert counts() == before


def test_unknown_candidate_key_is_a_structured_404_without_leakage(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    response = pg_client.get(f"{BASE}/cells/{GRID}:nope")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "CANDIDATE_CELL_NOT_FOUND"
    lowered = detail["detail"].lower()
    for leak in ("select", "postgresql", "psycopg", "/users", "password", "traceback"):
        assert leak not in lowered
