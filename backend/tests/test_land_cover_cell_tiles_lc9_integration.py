"""LC9 vector-tile serving-optimisation guards (Phase 1B-LC9).

Phase 1B-LC9 made the public land-cover tile cheaper to SERVE without changing
what it contains. Two backend changes carry that claim:

* the ``tile`` CTE is ``MATERIALIZED``, so ``ST_AsMVTGeom(ST_Transform(...))`` is
  evaluated once per candidate instead of twice (PostgreSQL inlines a
  single-reference CTE and pushes ``WHERE tile.geom IS NOT NULL`` down into the
  scan as a filter);
* the tile request issues ``SET LOCAL jit = off``, because at low zoom the plan
  cost crosses ``jit_inline_above_cost`` and PostgreSQL LLVM-compiles a tree of
  PostGIS C calls — in every parallel worker — before running it once.

Neither may alter a single served byte. These tests assert exactly that, plus
the tile contract the map and the public documentation depend on. They are the
regression guard for LC9: if someone later "simplifies" the CTE fence, drops a
property, or promotes the JIT setting to a session-level ``SET``, one of these
fails.

Runs only when ``TEST_DATABASE_URL`` is set. Everything is seeded inside a
rolled-back outer transaction, so no real row is created, changed, or deleted;
the official local LC2/LC3 data is never touched. The synthetic grid sits in
remote ocean near lon -30°, lat 20°, far from any real candidate and far from
the LC5B fixture's own anchor, so a tile here can only contain our cells.
"""

from __future__ import annotations

import datetime
import math
import os
import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.api.routes.land_cover_cells import (
    _TILE_DISABLE_JIT,
    _TILE_SQL,
    MVT_CONTENT_TYPE,
    TILE_CACHE_CONTROL,
    TILE_SOURCE_LAYER,
)
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
GRID = "lc9-test-grid-500m-v1"
DERIVATION = "land-cover-cell-stats-v1"
AREA_CRS = "EPSG:5186"
SOURCE_ID = "lc9_test_land_cover"

#: The exact property contract the public documentation states and the map
#: consumes. LC9 is a SERVING optimisation: it may not add or remove a key.
#: (``coverage_status`` drives fill/opacity/filters; the six dominant-class keys
#: drive the class modes and the legend; ``candidate_key`` is the feature's
#: logical identity; the remaining three are the release/region context the LC5B
#: contract published.)
EXPECTED_TILE_PROPERTIES = {
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

#: Fields that must never reach a tile: raw source attributes, heavy provenance,
#: and every suitability value the land-cover layer has no business carrying.
FORBIDDEN_TILE_PROPERTIES = (
    "raw_attributes",
    "source_attributes",
    "source_feature_id",
    "source_fid",
    "map_sheet_code",
    "class_code",
    "class_name",
    "class_area_m2",
    "candidate_geometry_fingerprint",
    "input_signature",
    "license_note",
    "derivation_metadata",
    "geometry",
    "score",
    "total_score",
    "rank",
    "status",
    "exclusion_reasons",
    "review_reasons",
    "stability_class",
)

#: Remote-ocean anchor, deliberately different from the LC5B fixture's.
_LON0, _LAT0 = -30.0, 20.0
_STEP = 0.02

#: A 4x3 block of cells, one row per coverage status, so a single low tile holds
#: twelve cells and an adjacent-tile pair can be compared.
_COLS, _ROWS = 4, 3
_STATUSES = ["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]
CELLS: list[tuple[str, str]] = [
    (f"r{row}c{col}", _STATUSES[row]) for row in range(_ROWS) for col in range(_COLS)
]


def _key(label: str) -> str:
    return f"{GRID}:{label}"


def _square(row: int, col: int) -> str:
    """A small axis-aligned square at grid position (row, col)."""

    lon0 = _LON0 + col * _STEP
    lat0 = _LAT0 + row * _STEP
    lon1, lat1 = lon0 + _STEP * 0.6, lat0 + _STEP * 0.6
    return (
        f"MULTIPOLYGON((({lon0} {lat0},{lon1} {lat0},{lon1} {lat1},{lon0} {lat1},{lon0} {lat0})))"
    )


def _deg2tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


#: A zoom whose single tile comfortably contains the whole synthetic block.
CLUSTER_Z = 11


def _cluster_tile() -> tuple[int, int, int]:
    x, y = _deg2tile(_LON0 + _STEP, _LAT0 + _STEP, CLUSTER_Z)
    return CLUSTER_Z, x, y


def _straddling_tile_pair() -> tuple[int, int, int]:
    """The lowest zoom at which the block genuinely spans two adjacent x-tiles.

    Computed rather than hard-coded so the adjacency test cannot degenerate into
    comparing a populated tile against an empty neighbour — which would make it
    pass for the wrong reason.
    """

    lat = _LAT0 + _STEP
    west = _LON0
    east = _LON0 + (_COLS - 1) * _STEP + _STEP * 0.6
    for zoom in range(CLUSTER_Z, 22):
        x_west, y = _deg2tile(west, lat, zoom)
        x_east, _ = _deg2tile(east, lat, zoom)
        if x_east > x_west:
            return zoom, x_west, y
    raise AssertionError("the synthetic block never spans two tiles")


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
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
    """A synthetic release over a twelve-cell, two-run candidate grid."""

    pg_session.add(
        DataSource(
            source_id=SOURCE_ID,
            source_name="LC9 test source",
            dataset_name="LC9 test land cover",
            endpoint="https://example.invalid/lc9-test",
            publication_frequency="STRUCTURAL",
            enabled=False,
            documentation_url=None,
        )
    )
    pg_session.flush()
    source = EnvironmentalDatasetVersion(
        layer_name="land_cover",
        source_id=SOURCE_ID,
        provider="LC9 테스트 제공기관",
        official_dataset_name="세분류 [2025] 테스트 토지피복지도",
        provider_dataset_identifier="lc9-test-land-cover-l3",
        official_source_url="https://example.invalid/lc9-test",
        reference_period="2025",
        source_crs="EPSG:5186",
        target_crs="EPSG:4326",
        source_encoding="cp949",
        normalized_geometry_type="MultiPolygon",
        declared_feature_count=len(CELLS),
        source_checksum="9" * 64,
        transformation_version="land-cover-v1",
        license_note="테스트 라이선스 메모",
        is_active=False,
        created_at=NOW,
    )
    pg_session.add(source)
    pg_session.flush()

    runs = []
    for offset, signature in enumerate(("lc9-test-sig-a", "lc9-test-sig-b")):
        run = SuitabilityAnalysisRun(
            derivation_version="lc9-test-screening",
            policy_version="lc9-test-policy",
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

    for row in range(_ROWS):
        for col in range(_COLS):
            wkt = _square(row, col)
            for run in runs:
                pg_session.add(
                    SuitabilityCandidate(
                        analysis_run_id=run.id,
                        candidate_key=_key(f"r{row}c{col}"),
                        status="ELIGIBLE",
                        original_area_m2=250_000,
                        clipped_area_m2=250_000,
                        clipped_area_ratio=1,
                        centroid=WKTElement(
                            f"POINT({_LON0 + col * _STEP + _STEP * 0.3} "
                            f"{_LAT0 + row * _STEP + _STEP * 0.3})",
                            srid=4326,
                        ),
                        geometry=WKTElement(wkt, srid=4326),
                        created_at=NOW,
                    )
                )
    pg_session.flush()

    complete = sum(1 for _, s in CELLS if s == "COMPLETE_EXACT")
    partial = sum(1 for _, s in CELLS if s == "PARTIAL")
    no_cov = sum(1 for _, s in CELLS if s == "NO_COVERAGE")
    release = EnvironmentalLandCoverCellStatVersion(
        land_cover_dataset_version_id=source.id,
        candidate_grid_version=GRID,
        candidate_grid_fingerprint="c" * 64,
        derivation_version=DERIVATION,
        area_crs=AREA_CRS,
        input_signature="lc9-test-" + "0" * 55,
        status="SUCCEEDED",
        expected_cell_count=len(CELLS),
        processed_cell_count=len(CELLS),
        complete_exact_count=complete,
        partial_count=partial,
        no_coverage_count=no_cov,
        failed_cell_count=0,
        candidate_row_count=len(CELLS) * 2,
        duplicate_candidate_occurrence_count=len(CELLS),
        representation_variant_cell_count=0,
        total_cell_area_m2=250_000.0 * len(CELLS),
        total_evaluated_area_m2=250_000.0 * complete + 150_000.0 * partial,
        total_uncovered_area_m2=100_000.0 * partial + 250_000.0 * no_cov,
        aggregate_coverage_ratio=0.5,
        total_intersection_area_m2=250_000.0 * complete + 150_000.0 * partial,
        class_row_count=complete + partial,
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
            candidate_geometry_fingerprint=f"{label}".ljust(64, "0"),
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
            topological_cover_predicate=status == "COMPLETE_EXACT",
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


def _features(content: bytes) -> list[dict[str, Any]]:
    decoded = _decode(content)
    return list(decoded[TILE_SOURCE_LAYER]["features"])


# --------------------------------------------------------------------------- #
# 1. The optimisation is byte-neutral
# --------------------------------------------------------------------------- #
def test_materialized_cte_is_byte_identical_to_the_inlined_reference(
    seeded: dict[str, Any], pg_session: Session
) -> None:
    """LC9's CTE fence must change evaluation count, never the encoded tile.

    The reference is derived from the SHIPPING SQL by removing exactly the
    ``MATERIALIZED`` keyword, so this cannot drift into comparing the route
    against a hand-copied query that no longer resembles it.
    """

    reference_sql = _TILE_SQL.replace("tile AS MATERIALIZED (", "tile AS (", 1)
    assert reference_sql != _TILE_SQL, "the shipping SQL no longer materializes the tile CTE"
    assert "MATERIALIZED" not in reference_sql

    release = seeded["release"]
    params = {
        "version_id": release.id,
        "grid_version": GRID,
        "run_id": seeded["runs"][0].id,
        "z": CLUSTER_Z,
        "x": _cluster_tile()[1],
        "y": _cluster_tile()[2],
    }
    shipped = pg_session.execute(text(_TILE_SQL), params).scalar()
    reference = pg_session.execute(text(reference_sql), params).scalar()

    assert shipped is not None and len(bytes(shipped)) > 0
    assert bytes(shipped) == bytes(reference)


def test_repeated_requests_return_byte_identical_tiles(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Determinism is what makes the content-independent ETag honest."""

    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    bodies = [pg_client.get(url).content for _ in range(3)]

    assert len(bodies[0]) > 0
    assert bodies[0] == bodies[1] == bodies[2]


def test_the_tile_request_uses_a_transaction_local_jit_setting(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """``SET LOCAL``, never a session-level ``SET``.

    A session-level ``SET`` would ride a POOLED connection into unrelated
    requests and silently change how every other query in the application is
    planned. The statement text is asserted structurally because that is the
    property that makes the setting safe.
    """

    statement = str(_TILE_DISABLE_JIT).strip()
    assert re.fullmatch(r"(?i)SET\s+LOCAL\s+jit\s*=\s*off", statement), statement

    # And the endpoint still serves normally with it in place.
    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))
    assert response.status_code == 200
    assert len(response.content) > 0


def test_set_local_jit_does_not_survive_its_transaction() -> None:
    """The scoping property LC9 relies on, verified against the real server."""

    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            default = connection.execute(text("SHOW jit")).scalar()
            connection.execute(text("SET LOCAL jit = off"))
            assert connection.execute(text("SHOW jit")).scalar() == "off"
            connection.rollback()  # ends the transaction
            assert connection.execute(text("SHOW jit")).scalar() == default
    finally:
        engine.dispose()


# --------------------------------------------------------------------------- #
# 2. The published property contract
# --------------------------------------------------------------------------- #
def test_tile_property_contract_is_exactly_the_published_set(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """An evaluated cell carries all twelve keys — no more, no fewer.

    The existing LC5B test asserts a SUBSET (properties are allowed to be
    absent, e.g. a NO_COVERAGE cell has no dominant class). This asserts the
    exact set on a fully-evaluated cell, so LC9 cannot have quietly dropped a
    property to save bytes.
    """

    z, x, y = _cluster_tile()
    features = _features(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    covered = next(f for f in features if f["properties"]["coverage_status"] == "COMPLETE_EXACT")[
        "properties"
    ]

    assert set(covered) == EXPECTED_TILE_PROPERTIES


def test_no_coverage_cell_still_carries_no_dominant_class(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Uncovered area is never given a class, and the cell is never dropped."""

    z, x, y = _cluster_tile()
    features = _features(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    uncovered = [f for f in features if f["properties"]["coverage_status"] == "NO_COVERAGE"]

    assert len(uncovered) == _COLS
    for feature in uncovered:
        props = feature["properties"]
        for level in (1, 2, 3):
            assert f"dominant_l{level}_code" not in props
            assert f"dominant_l{level}_name" not in props
        assert props["coverage_ratio"] == pytest.approx(0.0)


def test_tile_carries_no_raw_source_or_suitability_field(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    features = _features(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)

    assert features
    for feature in features:
        props = feature["properties"]
        assert set(props) <= EXPECTED_TILE_PROPERTIES
        for banned in FORBIDDEN_TILE_PROPERTIES:
            assert banned not in props, banned


def test_source_layer_and_extent_are_unchanged(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    decoded = _decode(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)

    assert list(decoded) == [TILE_SOURCE_LAYER]
    assert decoded[TILE_SOURCE_LAYER]["extent"] == 4096
    assert "candidates" not in decoded
    assert "wetlands" not in decoded


def test_media_type_and_cache_headers_are_unchanged(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    response = pg_client.get(_tile_url(seeded["release"].id, z, x, y))

    assert response.status_code == 200
    assert response.headers["content-type"] == MVT_CONTENT_TYPE
    assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert response.headers["cache-control"] == TILE_CACHE_CONTROL


# --------------------------------------------------------------------------- #
# 3. Identity, boundedness and geometry
# --------------------------------------------------------------------------- #
def test_no_duplicate_candidate_key_within_a_tile(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    features = _features(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)
    keys = [f["properties"]["candidate_key"] for f in features]

    assert len(keys) == len(set(keys))
    assert set(keys) == {_key(label) for label, _ in CELLS}


def test_low_zoom_tile_stays_bounded_to_the_release_cells(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """A whole-world low-zoom tile must hold one feature per cell, not a product.

    Each key has TWO candidate occurrences across runs and the statistics join
    is not on a unique index by itself, so a lost pin would show up here as
    duplication rather than as a subtle slowdown.
    """

    x, y = _deg2tile(_LON0 + _STEP, _LAT0 + _STEP, 3)
    features = _features(pg_client.get(_tile_url(seeded["release"].id, 3, x, y)).content)
    keys = [f["properties"]["candidate_key"] for f in features]

    assert len(keys) == len(CELLS)
    assert len(set(keys)) == len(CELLS)


def test_tile_geometry_is_structurally_valid(seeded: dict[str, Any], pg_client: TestClient) -> None:
    """Every decoded ring is closed and has at least four positions."""

    z, x, y = _cluster_tile()
    features = _features(pg_client.get(_tile_url(seeded["release"].id, z, x, y)).content)

    assert features
    for feature in features:
        geometry = feature["geometry"]
        assert geometry["type"] in {"Polygon", "MultiPolygon"}
        polygons = (
            [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        )
        for polygon in polygons:
            for ring in polygon:
                assert len(ring) >= 4
                assert tuple(ring[0]) == tuple(ring[-1]), "ring is not closed"


def test_adjacent_tiles_agree_on_every_shared_cell(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Boundary duplication is normal MVT clipping; disagreement is not.

    A cell inside the encoding buffer legitimately appears in both neighbouring
    tiles. What must never happen is the SAME candidate key carrying different
    attributes in two tiles — that would mean the two tiles disagree about one
    cell's coverage or class.
    """

    z, x, y = _straddling_tile_pair()
    release_id = seeded["release"].id
    left = _features(pg_client.get(_tile_url(release_id, z, x, y)).content)
    right = _features(pg_client.get(_tile_url(release_id, z, x + 1, y)).content)

    # Both neighbours must actually hold cells, or the comparison is vacuous.
    assert left, f"west tile z{z}/{x}/{y} is empty"
    assert right, f"east tile z{z}/{x + 1}/{y} is empty"

    def by_key(features: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        keys = [f["properties"]["candidate_key"] for f in features]
        assert len(keys) == len(set(keys)), "a single tile duplicated a candidate key"
        return {f["properties"]["candidate_key"]: f["properties"] for f in features}

    left_by_key, right_by_key = by_key(left), by_key(right)
    shared = set(left_by_key) & set(right_by_key)
    for key in shared:
        assert left_by_key[key] == right_by_key[key], key

    # Together the two tiles must not invent a cell the release does not have.
    assert set(left_by_key) | set(right_by_key) <= {_key(label) for label, _ in CELLS}


# --------------------------------------------------------------------------- #
# 4. Conditional requests
# --------------------------------------------------------------------------- #
def test_etag_is_stable_across_requests(seeded: dict[str, Any], pg_client: TestClient) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    etags = {pg_client.get(url).headers["etag"] for _ in range(3)}

    assert len(etags) == 1
    etag = etags.pop()
    assert etag.startswith('"lc-cells-')
    assert etag.endswith(f'-{z}-{x}-{y}"')


def test_conditional_request_returns_304_with_no_body(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    etag = pg_client.get(url).headers["etag"]

    revalidated = pg_client.get(url, headers={"If-None-Match": etag})
    assert revalidated.status_code == 304
    assert revalidated.content == b""
    assert revalidated.headers["etag"] == etag
    assert revalidated.headers["cache-control"] == TILE_CACHE_CONTROL


def test_stale_validator_still_returns_the_tile(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    z, x, y = _cluster_tile()
    url = _tile_url(seeded["release"].id, z, x, y)
    fresh = pg_client.get(url, headers={"If-None-Match": '"lc-cells-not-this-one"'})

    assert fresh.status_code == 200
    assert len(fresh.content) > 0


def test_a_different_statistics_version_would_mint_a_different_url_and_etag(
    seeded: dict[str, Any], pg_client: TestClient
) -> None:
    """Version-pinning is what makes the one-year immutable cache safe."""

    z, x, y = _cluster_tile()
    etag = pg_client.get(_tile_url(seeded["release"].id, z, x, y)).headers["etag"]

    assert str(seeded["release"].id) in etag
    other = pg_client.get(_tile_url(seeded["release"].id + 10_000, z, x, y))
    assert other.status_code == 404
    assert other.json()["detail"]["error"] == "STATISTICS_VERSION_NOT_FOUND"


# --------------------------------------------------------------------------- #
# 5. LC9 wrote nothing
# --------------------------------------------------------------------------- #
def test_serving_tiles_changes_no_land_cover_or_suitability_row(
    seeded: dict[str, Any], pg_client: TestClient, pg_session: Session
) -> None:
    def fingerprint() -> tuple[Any, ...]:
        return tuple(
            pg_session.execute(text(sql)).scalar()
            for sql in (
                "SELECT md5(string_agg(candidate_key || ':' || coverage_status || ':'"
                "  || coverage_ratio::text, '|' ORDER BY candidate_key))"
                " FROM environmental_land_cover_cell_statistics",
                "SELECT md5(string_agg(candidate_key || ':' || class_code || ':'"
                "  || class_area_m2::text, '|' ORDER BY candidate_key, class_level, class_code))"
                " FROM environmental_land_cover_cell_class_areas",
                "SELECT md5(string_agg(analysis_run_id || ':' || candidate_key || ':' || status"
                "  || ':' || coalesce(total_score::text, '-') || ':' || coalesce(rank::text, '-'),"
                "  '|' ORDER BY analysis_run_id, candidate_key)) FROM suitability_candidates",
                "SELECT count(*) FROM environmental_land_cover_cell_stat_versions",
            )
        )

    z, x, y = _cluster_tile()
    before = fingerprint()
    for offset in range(3):
        pg_client.get(_tile_url(seeded["release"].id, z, x + offset, y))
    pg_client.get(_tile_url(seeded["release"].id, 3, 0, 0))
    pg_client.get(_tile_url(999_999_999, z, x, y))

    assert fingerprint() == before
