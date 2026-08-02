"""Candidate-cell land-cover vector-tile integration tests (Phase 1B-LC5B).

Runs only when ``TEST_DATABASE_URL`` is set. Everything is seeded inside a rolled-back
outer transaction, so no real row is ever created, changed, or deleted — the official
local LC2/LC3 data is never touched.

This tier is the only one that can cover the tile endpoint at all: the tile is produced
entirely by PostGIS (``ST_TileEnvelope`` / ``ST_AsMVTGeom`` / ``ST_AsMVT``) over the
existing ``suitability_candidates`` geometry, which SQLite cannot represent.

The load-bearing assertions here are the ones the map's honesty rests on:

* the tile is pinned to a statistics VERSION, and an unknown/failed/incomplete version
  never falls back to whichever release happens to be active;
* the geometry comes from the CANONICAL analysis run — the lowest run of the release's
  grid version, which is exactly the occurrence LC3 measured on — and a cardinality
  mismatch is refused rather than silently dropping cells;
* every candidate key appears exactly once, even though each key has two candidate
  occurrences across runs;
* a ``NO_COVERAGE`` cell carries NO dominant-class attribute at any level;
* no raw land-cover feature attribute, geometry, or scan ever reaches the tile.

The synthetic grid sits in remote ocean around lon 45°, lat 45°, far from any real
candidate, and its analysis runs are synthetic too.
"""

from __future__ import annotations

import datetime
import math
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
GRID = "lc5b-test-grid-500m-v1"
DERIVATION = "land-cover-cell-stats-v1"
AREA_CRS = "EPSG:5186"
SOURCE_ID = "lc5b_test_land_cover"

MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
TILE_SOURCE_LAYER = "land_cover_cells"

#: Remote-ocean anchor for the synthetic grid. No real capital-region candidate is
#: anywhere near it, so a tile here can only contain our cells.
_LON0, _LAT0 = 45.0, 45.0
_STEP = 0.05

#: Three cells in a west-to-east row, one per coverage status.
CELLS = [("A", "COMPLETE_EXACT"), ("B", "PARTIAL"), ("C", "NO_COVERAGE")]

#: Every tile attribute the map is allowed to receive. Anything outside this set is a
#: contract violation, whether it is heavy, raw, or merely unnecessary.
ALLOWED_TILE_PROPERTIES = {
    "candidate_key",
    "statistics_version_id",
    "coverage_status",
    "coverage_ratio",
    "dominant_l1_code",
    "dominant_l1_name",
    "dominant_l2_code",
    "dominant_l2_name",
    "dominant_l3_code",
    "dominant_l3_name",
    "sido_region_code",
    "sigungu_region_code",
}


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


def _deg2tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


#: A zoom whose tile comfortably contains the whole synthetic cluster.
CLUSTER_Z = 10


def _cluster_tile() -> tuple[int, int, int]:
    x, y = _deg2tile(_LON0 + _STEP, _LAT0 + _STEP * 0.25, CLUSTER_Z)
    return CLUSTER_Z, x, y


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
    """A synthetic release plus a TWO-run candidate grid, all rolled back after.

    Both runs carry every cell with byte-identical geometry, exactly like the real grid
    (95,786 candidate rows collapsing to 47,893 cells), so canonical-run resolution is
    genuinely exercised rather than assumed away by a single-run fixture.
    """

    pg_session.add(
        DataSource(
            source_id=SOURCE_ID,
            source_name="LC5B test source",
            dataset_name="LC5B test land cover",
            endpoint="https://example.invalid/lc5b-test",
            publication_frequency="STRUCTURAL",
            enabled=False,
            documentation_url=None,
        )
    )
    pg_session.flush()
    source = EnvironmentalDatasetVersion(
        layer_name="land_cover",
        source_id=SOURCE_ID,
        provider="LC5B 테스트 제공기관",
        official_dataset_name="세분류 [2025] 테스트 토지피복지도",
        provider_dataset_identifier="lc5b-test-land-cover-l3",
        official_source_url="https://example.invalid/lc5b-test",
        reference_period="2025",
        source_crs="EPSG:5186",
        target_crs="EPSG:4326",
        source_encoding="cp949",
        normalized_geometry_type="MultiPolygon",
        declared_feature_count=3,
        source_checksum="8" * 64,
        transformation_version="land-cover-v1",
        license_note="테스트 라이선스 메모 — 서면 재확인 필요",
        is_active=False,
        created_at=NOW,
    )
    pg_session.add(source)
    pg_session.flush()

    runs = []
    for offset, signature in enumerate(("lc5b-test-sig-a", "lc5b-test-sig-b")):
        run = SuitabilityAnalysisRun(
            derivation_version="lc5b-test-screening",
            policy_version="lc5b-test-policy",
            candidate_grid_version=GRID,
            reference_year=1999,
            boundary_vintage="1999",
            weight_profile="balanced",
            analysis_signature=signature,
            status="SUCCEEDED",
            candidate_count_total=len(CELLS),
            started_at=NOW + datetime.timedelta(days=offset),
            created_at=NOW,
        )
        pg_session.add(run)
        runs.append(run)
    pg_session.flush()

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
        candidate_grid_fingerprint="e" * 64,
        derivation_version=DERIVATION,
        area_crs=AREA_CRS,
        input_signature="lc5b-test-" + "0" * 54,
        status="SUCCEEDED",
        expected_cell_count=len(CELLS),
        processed_cell_count=len(CELLS),
        complete_exact_count=1,
        partial_count=1,
        no_coverage_count=1,
        failed_cell_count=0,
        candidate_row_count=len(CELLS) * 2,
        duplicate_candidate_occurrence_count=len(CELLS),
        representation_variant_cell_count=0,
        total_cell_area_m2=750_000.0,
        total_evaluated_area_m2=400_000.0,
        total_uncovered_area_m2=350_000.0,
        aggregate_coverage_ratio=400_000.0 / 750_000.0,
        total_intersection_area_m2=400_000.0,
        class_row_count=2,
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

    for label, status in CELLS:
        if status == "NO_COVERAGE":
            continue
        cell_area, evaluated = measurements[status]
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
    return {"release": release, "source": source, "cells": cells, "runs": runs}


def _tile_url(version_id: int, z: int, x: int, y: int) -> str:
    return f"{BASE}/tiles/{version_id}/{z}/{x}/{y}.mvt"


def _decode(content: bytes) -> dict[str, Any]:
    mvt = pytest.importorskip("mapbox_vector_tile")
    return dict(mvt.decode(content))


# --------------------------------------------------------------------------- #
# A valid, version-pinned tile
# --------------------------------------------------------------------------- #
def test_tile_returns_nonempty_mvt_with_immutable_cache_headers(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))

    assert response.status_code == 200
    assert response.headers["content-type"] == MVT_CONTENT_TYPE
    assert response.headers["cache-control"] == IMMUTABLE_CACHE
    assert response.headers["etag"]
    assert len(response.content) > 0


def test_tile_uses_the_expected_source_layer_name(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)

    assert TILE_SOURCE_LAYER in decoded
    # Never reuses the suitability or wetland source-layer names.
    assert "candidates" not in decoded
    assert "wetlands" not in decoded


def test_tile_carries_every_required_attribute_for_a_covered_cell(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    features = decoded[TILE_SOURCE_LAYER]["features"]
    covered = next(f for f in features if f["properties"]["candidate_key"] == _key("A"))[
        "properties"
    ]

    assert covered["candidate_key"] == _key("A")
    assert covered["statistics_version_id"] == seeded["release"].id
    assert covered["coverage_status"] == "COMPLETE_EXACT"
    assert covered["coverage_ratio"] == pytest.approx(1.0)
    assert covered["dominant_l1_code"] == "300"
    assert covered["dominant_l1_name"] == "산림지역"
    assert covered["dominant_l2_code"] == "310"
    assert covered["dominant_l3_code"] == "311"
    # Official Korean names travel verbatim.
    assert covered["dominant_l3_name"] == "활엽수림"
    assert covered["sido_region_code"] == "KR-SGIS-11"
    assert covered["sigungu_region_code"] == "KR-SGIS-11110"


def test_no_coverage_cell_carries_no_dominant_class_at_any_level(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """The uncovered cell is present and explicitly classless — never given a class."""

    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    features = decoded[TILE_SOURCE_LAYER]["features"]
    uncovered = next(f for f in features if f["properties"]["candidate_key"] == _key("C"))[
        "properties"
    ]

    assert uncovered["coverage_status"] == "NO_COVERAGE"
    # ST_AsMVT omits NULL properties, so the dominant-class keys are simply absent —
    # which MapLibre reads as null. No fabricated "unknown"/"기타" class value.
    for level in (1, 2, 3):
        assert f"dominant_l{level}_code" not in uncovered
        assert f"dominant_l{level}_name" not in uncovered
    assert uncovered["coverage_ratio"] == pytest.approx(0.0)


def test_tile_holds_only_the_allowed_light_attributes(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)

    for feature in decoded[TILE_SOURCE_LAYER]["features"]:
        assert set(feature["properties"]) <= ALLOWED_TILE_PROPERTIES
        for banned in (
            # Raw land-cover source fields.
            "raw_attributes",
            "source_attributes",
            "source_feature_id",
            "source_fid",
            "map_sheet_code",
            "class_code",
            "class_name",
            "class_area_m2",
            # Heavy / provenance / audit fields that belong on the JSON endpoints.
            "candidate_geometry_fingerprint",
            "input_signature",
            "license_note",
            "derivation_metadata",
            "geometry",
            # Suitability values the land-cover layer has no business carrying.
            "score",
            "rank",
            "status",
        ):
            assert banned not in feature["properties"], banned


def test_tile_returns_each_candidate_key_exactly_once(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Each key has TWO candidate occurrences across runs; the tile must carry one."""

    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    keys = [f["properties"]["candidate_key"] for f in decoded[TILE_SOURCE_LAYER]["features"]]

    assert len(keys) == len(set(keys)) == len(CELLS)
    assert set(keys) == {_key(label) for label, _ in CELLS}


# --------------------------------------------------------------------------- #
# Canonical-run resolution
# --------------------------------------------------------------------------- #
def test_tile_geometry_comes_from_the_lowest_analysis_run(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """The canonical run is the LOWEST run of the grid version — LC3's own rule.

    Asserted by giving the SECOND run a visibly different geometry: if the tile were
    built from it, the drawn cell would move. The tile must be unaffected.
    """

    z, x, y = _cluster_tile()
    before = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    before_geoms = {
        f["properties"]["candidate_key"]: str(f["geometry"])
        for f in before[TILE_SOURCE_LAYER]["features"]
    }

    higher_run = seeded["runs"][1]
    pg_session.execute(
        text(
            "UPDATE suitability_candidates SET geometry = ST_GeomFromText(:wkt, 4326) "
            "WHERE analysis_run_id = :run AND candidate_key = :key"
        ),
        {"wkt": _square(9), "run": higher_run.id, "key": _key("A")},
    )
    pg_session.flush()

    after = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    after_geoms = {
        f["properties"]["candidate_key"]: str(f["geometry"])
        for f in after[TILE_SOURCE_LAYER]["features"]
    }
    assert after_geoms == before_geoms


def test_missing_canonical_run_is_refused_rather_than_substituted(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """No SUCCEEDED run for the grid version -> honest 409, never an empty tile."""

    for run in seeded["runs"]:
        run.status = "FAILED"
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "CANONICAL_RUN_NOT_FOUND"


def test_a_non_succeeded_lower_run_is_refused_not_skipped(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """A failed LOWEST run must not be silently replaced by the next succeeded one.

    LC3 canonicalized on the lowest occurrence, so serving run 2 would draw geometry
    the statistics were never measured on. That is refused, not worked around.
    """

    seeded["runs"][0].status = "FAILED"
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "CANONICAL_RUN_NOT_FOUND"


def test_statistics_geometry_cardinality_mismatch_is_refused(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """Fewer candidate geometries than expected cells -> 409, never a short tile."""

    seeded["runs"][0].candidate_count_total = len(CELLS) - 1
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "CANDIDATE_GEOMETRY_CARDINALITY_MISMATCH"


def test_a_run_that_never_recorded_a_candidate_count_is_refused(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """``candidate_count_total`` is NOT NULL DEFAULT 0, so an unrecorded count is 0.

    That is exactly the unverifiable case: it cannot equal a non-zero expected cell
    count, so the tile is refused rather than served short.
    """

    seeded["runs"][0].candidate_count_total = 0
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "CANDIDATE_GEOMETRY_CARDINALITY_MISMATCH"


def test_candidates_of_another_grid_version_never_leak_into_the_tile(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """A geometrically overlapping candidate from a different grid must not appear."""

    other = SuitabilityAnalysisRun(
        derivation_version="lc5b-test-screening",
        policy_version="lc5b-test-policy",
        candidate_grid_version="lc5b-test-other-grid-v9",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="balanced",
        analysis_signature="lc5b-test-sig-other",
        status="SUCCEEDED",
        candidate_count_total=1,
        started_at=NOW,
        created_at=NOW,
    )
    pg_session.add(other)
    pg_session.flush()
    pg_session.add(
        SuitabilityCandidate(
            analysis_run_id=other.id,
            candidate_key=_key("D"),
            status="ELIGIBLE",
            original_area_m2=250_000,
            clipped_area_m2=250_000,
            clipped_area_ratio=1,
            centroid=WKTElement(f"POINT({_LON0 + 0.01} {_LAT0 + 0.01})", srid=4326),
            geometry=WKTElement(_square(0), srid=4326),
            created_at=NOW,
        )
    )
    pg_session.flush()

    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    keys = {f["properties"]["candidate_key"] for f in decoded[TILE_SOURCE_LAYER]["features"]}
    assert _key("D") not in keys
    assert keys == {_key(label) for label, _ in CELLS}


# --------------------------------------------------------------------------- #
# Version pinning and error behavior
# --------------------------------------------------------------------------- #
def test_unknown_statistics_version_is_a_structured_404_without_fallback(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(999_999_999, z, x, y))

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "STATISTICS_VERSION_NOT_FOUND"
    # It did NOT quietly serve the active release instead.
    assert response.headers.get("content-type") != MVT_CONTENT_TYPE


def test_failed_statistics_version_is_refused(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    seeded["release"].status = "FAILED"
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "INCOMPLETE_ACTIVE_STATISTICS_RELEASE"


def test_incomplete_statistics_version_is_refused(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    seeded["release"].processed_cell_count = len(CELLS) - 1
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "INCOMPLETE_ACTIVE_STATISTICS_RELEASE"


def test_a_superseded_but_complete_version_is_still_served(
    seeded: dict[str, Any], pg_session: Session, pg_client: TestClient
) -> None:
    """The URL is version-pinned, so deactivation must not change what it means.

    Otherwise an immutably-cached tile URL would start failing the moment a newer
    release was activated, which is exactly what pinning exists to prevent.
    """

    seeded["release"].is_active = False
    pg_session.flush()

    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 200
    assert len(response.content) > 0


def test_empty_tile_outside_the_cluster_is_a_valid_200(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    x, y = _deg2tile(-120.0, 10.0, CLUSTER_Z)  # nowhere near the seeded cluster
    response = pg_client.get(_tile_url(seeded["release"].id, CLUSTER_Z, x, y))

    assert response.status_code == 200
    assert response.content == b""
    # An empty viewport and a broken layer must stay distinguishable.
    assert response.headers["content-type"] == MVT_CONTENT_TYPE


@pytest.mark.parametrize(("z", "x", "y"), [(2, 99, 0), (2, 0, 99), (0, 1, 1)])
def test_out_of_range_tile_coordinates_are_a_structured_422(
    seeded: dict[str, Any], pg_client: TestClient, z: int, x: int, y: int
) -> None:
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "INVALID_TILE_COORDINATE"


@pytest.mark.parametrize("path", ["99/0/0", "-1/0/0", "abc/0/0", "8/-1/0", "8/0/xyz"])
def test_malformed_tile_coordinates_are_rejected(
    seeded: dict[str, Any], pg_client: TestClient, path: str
) -> None:
    response = pg_client.get(f"{BASE}/tiles/{seeded['release'].id}/{path}.mvt")
    assert response.status_code == 422


def test_malformed_statistics_version_is_rejected(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    assert pg_client.get(f"{BASE}/tiles/not-a-number/{z}/{x}/{y}.mvt").status_code == 422


def test_errors_never_leak_sql_or_connection_information(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    bodies = [
        pg_client.get(_tile_url(999_999_999, z, x, y)).text,
        pg_client.get(_tile_url(seeded["release"].id, 2, 99, 0)).text,
    ]
    for body in bodies:
        lowered = body.lower()
        for leak in ("select", "postgresql", "psycopg", "/users", "password", "traceback"):
            assert leak not in lowered


# --------------------------------------------------------------------------- #
# Cache contract
# --------------------------------------------------------------------------- #
def test_etag_is_deterministic_for_the_same_tile(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    first = pg_client.get(url)
    second = pg_client.get(url)

    assert first.headers["etag"] == second.headers["etag"]
    assert first.content == second.content
    # The version AND the canonical run are both in the key, so a tile can never be
    # revalidated against geometry it was not generated from.
    assert str(seeded["release"].id) in first.headers["etag"]
    assert str(seeded["runs"][0].id) in first.headers["etag"]


def test_different_tiles_get_different_etags(seeded: dict[str, Any], pg_client: TestClient) -> None:
    z, x, y = _cluster_tile()
    one = pg_client.get(_tile_url(seeded["release"].id, z, x, y)).headers["etag"]
    other = pg_client.get(_tile_url(seeded["release"].id, z, x + 1, y)).headers["etag"]
    assert one != other


def test_conditional_request_returns_304_with_the_cache_headers(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    etag = pg_client.get(url).headers["etag"]
    second = pg_client.get(url, headers={"If-None-Match": etag})

    assert second.status_code == 304
    assert second.headers["cache-control"] == IMMUTABLE_CACHE
    assert second.headers["etag"] == etag


def test_a_stale_etag_is_not_honored(seeded: dict[str, Any], pg_client: TestClient) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    response = pg_client.get(url, headers={"If-None-Match": '"lc-cells-0-0-0-0-0"'})
    assert response.status_code == 200
    assert len(response.content) > 0


def test_tile_features_are_ordered_by_candidate_key(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """The aggregate is explicitly ordered, which is what makes the bytes stable.

    Without an ORDER BY the planner may feed ``ST_AsMVT`` in a parallel-join order that
    varies between executions; because MVT delta-encodes geometry, the tile bytes would
    then differ between regenerations of identical content while the content-independent
    ETag stayed the same. Asserting the order here pins the property the cache contract
    depends on, at the level a regression would actually break.
    """

    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    keys = [f["properties"]["candidate_key"] for f in decoded[TILE_SOURCE_LAYER]["features"]]

    assert keys == sorted(keys)
    assert len(keys) == len(CELLS)


# --------------------------------------------------------------------------- #
# Read-only and no-raw-feature guarantees
# --------------------------------------------------------------------------- #
def test_tile_requests_never_read_the_raw_land_cover_feature_table(
    seeded: dict[str, Any], pg_client: TestClient, pg_session: Session
) -> None:
    """The 6.9 M-row feature table must not be touched by a normal tile request."""

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

    z, x, y = _cluster_tile()
    before = scan_counts()
    for _ in range(3):
        assert pg_client.get(_tile_url(seeded["release"].id, z, x, y)).status_code == 200
    after = scan_counts()
    assert after[0] - before[0] == 0, "a tile request sequentially scanned the raw feature table"


def test_tile_sql_contains_no_reference_to_the_raw_feature_table() -> None:
    """Structural proof, independent of runtime statistics."""

    from waste_equity_backend.api.routes.land_cover_cells import _TILE_SQL

    assert "environmental_land_cover_features" not in _TILE_SQL
    assert "environmental_land_cover_map_sheets" not in _TILE_SQL
    # It reads exactly the two statistics-side tables plus the existing candidate table.
    assert "environmental_land_cover_cell_statistics" in _TILE_SQL
    assert "suitability_candidates" in _TILE_SQL


def test_tile_requests_mutate_nothing(
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

    z, x, y = _cluster_tile()
    before = counts()
    pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    pg_client.get(_tile_url(seeded["release"].id, z, x + 1, y))
    pg_client.get(_tile_url(999_999_999, z, x, y))
    assert counts() == before


def test_the_tile_never_changes_suitability_scores_ranks_or_statuses(
    seeded: dict[str, Any], pg_client: TestClient, pg_session: Session
) -> None:
    def checksum() -> str | None:
        return pg_session.execute(
            text(
                "SELECT md5(string_agg(sig, '|' ORDER BY sig)) FROM ("
                "  SELECT analysis_run_id || ':' || candidate_key || ':' || status"
                "         || ':' || coalesce(total_score::text, '-')"
                "         || ':' || coalesce(rank::text, '-') AS sig"
                "  FROM suitability_candidates"
                ") s"
            )
        ).scalar()

    z, x, y = _cluster_tile()
    before = checksum()
    for offset in range(3):
        pg_client.get(_tile_url(seeded["release"].id, z, x + offset, y))
    assert checksum() == before
