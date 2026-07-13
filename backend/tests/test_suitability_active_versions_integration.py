"""PostGIS integration tests for active-version screening (Phase 2.5B remediation).

Runs only when TEST_DATABASE_URL is set. Every test seeds synthetic dataset
versions and protected features inside a rolled-back outer transaction, so the
real analysis data is never touched. These cover the parts of the effective-
coverage remediation that cannot be exercised without PostGIS + JSONB:

* only ACTIVE protected dataset versions contribute to spatial intersections
  (``_enrich``);
* ``_coverage_gaps`` applies effective coverage over the active protected
  versions and leaves historical coverage matrices unmodified;
* ``_resolve_inputs`` refuses to screen when a required structural family has no
  active dataset version.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator

import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.suitability.engine import (
    SuitabilityBuildError,
    _coverage_gaps,
    _enrich,
    _resolve_inputs,
)
from waste_equity_backend.models import (
    StructuralDatasetVersion,
    StructuralProtectedFeature,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
REF_DATE = datetime.date(2026, 6, 1)
SOURCE_ID = "vworld_structural"  # seeded by migration 0006

# A 500 m-ish candidate cell and two protected polygons that both cover it.
_CELL_WKT = "MULTIPOLYGON(((126.50 37.70,126.50 37.71,126.51 37.71,126.51 37.70,126.50 37.70)))"
_CENTROID_WKT = "POINT(126.505 37.705)"
_COVER_WKT = "MULTIPOLYGON(((126.49 37.69,126.49 37.72,126.52 37.72,126.52 37.69,126.49 37.69)))"


@pytest.fixture
def pg_session() -> Iterator[Session]:
    engine = create_engine(str(TEST_DATABASE_URL))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=True,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


_checksum_counter = iter(range(1_000_000))


def _add_version(
    session: Session,
    *,
    family: str,
    is_active: bool = True,
    coverage_matrix: dict | None = None,
) -> StructuralDatasetVersion:
    unique = next(_checksum_counter)
    version = StructuralDatasetVersion(
        source_id=SOURCE_ID,
        provider="국토교통부",
        provider_dataset_identifier=f"test-{family}-{unique}",
        layer_family=family,
        reference_date=REF_DATE,
        source_checksum=f"{unique:064x}",
        source_crs="EPSG:5186",
        target_crs="EPSG:4326",
        normalized_geometry_type="MultiPolygon",
        transformation_version="test-active-versions",
        coverage_status="COMPLETE_WITH_FEATURES",
        coverage_matrix=coverage_matrix or {},
        is_active=is_active,
        created_at=NOW,
    )
    session.add(version)
    session.flush()
    return version


def _add_protected(session: Session, *, version_id: int, code: str, wkt: str = _COVER_WKT) -> None:
    session.add(
        StructuralProtectedFeature(
            dataset_version_id=version_id,
            layer_identifier=f"LT_C_{code}",
            provider_feature_id=None,
            layer_category="TEST",
            official_layer_code=code,
            official_layer_name=code,
            target_region_code="41",
            target_region_name="경기도",
            source_attributes={},
            geometry=WKTElement(wkt, srid=4326),
            feature_fingerprint=f"{version_id}-{code}",
            source_provenance={},
            created_at=NOW,
            ingested_at=NOW,
        )
    )
    session.flush()


def _active_protected_ids(session: Session) -> list[int]:
    return list(
        session.execute(
            text(
                "SELECT id FROM structural_dataset_versions "
                "WHERE layer_family = 'protected' AND is_active"
            )
        ).scalars()
    )


def _make_one_cell_grid(session: Session) -> None:
    session.execute(text("DROP TABLE IF EXISTS _sc_grid"))
    session.execute(
        text(
            """
            CREATE TEMP TABLE _sc_grid (
                gid bigint, candidate_key varchar,
                sido_code varchar, sido_name varchar,
                sigungu_code varchar, sigungu_name varchar, sigungu_count int,
                original_area_m2 numeric, clipped_area_m2 numeric,
                geom geometry(MultiPolygon, 4326), centroid geometry(Point, 4326)
            )
            """
        )
    )
    session.execute(
        text(
            """
            INSERT INTO _sc_grid VALUES (
                1, 'capital-grid-500m-v1:1_1', '41', '경기도', '41280', '고양시', 1,
                250000, 250000, ST_GeomFromText(:cell, 4326), ST_GeomFromText(:cen, 4326)
            )
            """
        ),
        {"cell": _CELL_WKT, "cen": _CENTROID_WKT},
    )


def test_enrich_only_active_protected_versions_intersect(pg_session: Session) -> None:
    active = _add_version(pg_session, family="protected", is_active=True)
    inactive = _add_version(pg_session, family="protected", is_active=False)
    _add_protected(pg_session, version_id=active.id, code="UM901")
    _add_protected(pg_session, version_id=inactive.id, code="UD801")
    _make_one_cell_grid(pg_session)

    facts = _enrich(pg_session, _active_protected_ids(pg_session))
    hits = set(facts[0]["hard_protected_hits"] or [])
    # The active version's wetland polygon excludes the cell; the inactive
    # version's greenbelt polygon (same footprint) does not participate.
    assert "UM901" in hits
    assert "UD801" not in hits


def test_coverage_gaps_effective_over_active_versions_and_immutable(
    pg_session: Session,
) -> None:
    va = _add_version(
        pg_session,
        family="protected",
        is_active=True,
        coverage_matrix={
            "gyeonggi": {"UM901": {"status": "COMPLETE_WITH_FEATURES"}},
            "seoul": {"UM901": {"status": "OFFICIAL_SOURCE_UNAVAILABLE"}},
        },
    )
    vb = _add_version(
        pg_session,
        family="protected",
        is_active=True,
        coverage_matrix={
            "seoul": {
                "UM901": {"status": "OFFICIAL_SOURCE_UNAVAILABLE"},
                "UF151": {"status": "OFFICIAL_SOURCE_UNAVAILABLE"},
            },
            "gyeonggi": {"UF151": {"status": "COMPLETE_WITH_FEATURES"}},
        },
    )
    va_before = dict(va.coverage_matrix)
    vb_before = dict(vb.coverage_matrix)
    # An inactive version still recording Gyeonggi UM901 unavailable must be ignored.
    _add_version(
        pg_session,
        family="protected",
        is_active=False,
        coverage_matrix={"gyeonggi": {"UM901": {"status": "OFFICIAL_SOURCE_UNAVAILABLE"}}},
    )

    gaps = _coverage_gaps(pg_session, _active_protected_ids(pg_session))
    assert gaps.get("서울특별시") == {"UM901", "UF151"}
    assert "경기도" not in gaps  # both Gyeonggi cells covered by active versions

    # Historical coverage matrices are never rewritten by gap computation.
    pg_session.expire_all()
    assert pg_session.get(StructuralDatasetVersion, va.id).coverage_matrix == va_before
    assert pg_session.get(StructuralDatasetVersion, vb.id).coverage_matrix == vb_before


def test_resolve_inputs_requires_active_version_per_family(pg_session: Session) -> None:
    # zoning + protected active, but roads only present as an inactive version.
    _add_version(pg_session, family="zoning", is_active=True)
    _add_version(pg_session, family="protected", is_active=True)
    _add_version(pg_session, family="roads", is_active=False)

    with pytest.raises(SuitabilityBuildError, match="roads"):
        _resolve_inputs(pg_session, 2024)
