"""PostGIS-backed zoning persistence/idempotency tests (no live source needed).

``structural_features`` carries a PostGIS geometry column, so these run only
against a real PostgreSQL/PostGIS database (``TEST_DATABASE_URL``). Every test
builds a synthetic in-memory ``ZoningLoadResult`` (a fixture, never official
data) at an isolated reference date and rolls back, leaving nothing behind.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    StructuralDatasetVersion,
    StructuralFeature,
)

from waste_equity_ingestion.errors import IngestionError
from waste_equity_ingestion.vworld_zoning_contract import (
    SOURCE_ID,
    ZoningFeature,
    ZoningLoadResult,
    feature_fingerprint,
)
from waste_equity_ingestion.vworld_zoning_ingestion import (
    _mark_run_failed,
    _write_bundle,
    feature_count_for_version,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")

ISOLATED_REFERENCE_DATE = "1999-01-01"  # keep fixtures away from real data
UTC = datetime.UTC
# Ocean-remote square (Gulf of Guinea) so fixtures can never overlap real data.
_REMOTE_WKT = "MULTIPOLYGON(((10 10, 10.2 10, 10.2 10.2, 10 10.2, 10 10)))"


def _upgrade() -> None:
    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[2] / "backend"
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
    command.upgrade(config, "head")


@pytest.fixture(scope="module", autouse=True)
def _migrated() -> None:
    _upgrade()


@pytest.fixture
def session() -> Iterator[Session]:
    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db_session = factory()
    try:
        yield db_session
    finally:
        db_session.rollback()
        db_session.close()
        engine.dispose()


def _feature(uname: str, ucode: str, *, region: str = "11") -> ZoningFeature:
    from shapely import wkt

    geometry = wkt.loads(_REMOTE_WKT)
    fingerprint = feature_fingerprint(
        geometry,
        layer_code="UQ111",
        target_region_code=region,
        source_attributes={"uname": uname, "ucode": ucode},
    )
    return ZoningFeature(
        layer_identifier="LT_C_UQ111",
        zoning_category="URBAN",
        official_zoning_code="UQ111",
        official_zoning_name="도시지역",
        provider_feature_id=None,
        target_region_code=region,
        target_region_name="서울특별시",
        source_attributes={"uname": uname, "ucode": ucode},
        geometry_wkt=_REMOTE_WKT,
        feature_fingerprint=fingerprint,
        source_provenance={"origin_filename": "FIXTURE.shp", "region": "seoul"},
    )


def _load(features: list[ZoningFeature], checksum: str) -> ZoningLoadResult:
    result = ZoningLoadResult(reference_date=ISOLATED_REFERENCE_DATE)
    result.features = features
    result.total_feature_count = len(features)
    result.accepted_feature_count = len(features)
    result.rejected_feature_count = 0
    result.combined_checksum = checksum
    result.source_files = [{"origin_filename": "FIXTURE.shp", "checksum": checksum}]
    result.source_crs_by_region = {"seoul": "EPSG:5179"}
    result.regions_evaluated = ["seoul"]
    result.coverage_matrix = {"seoul": {"region_evaluated": True}}
    result.coverage_status = "PARTIAL"
    return result


def _run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=datetime.datetime.now(UTC),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=ISOLATED_REFERENCE_DATE,
        transformation_version="vworld-zoning-v1",
    )
    session.add(run)
    session.flush()
    return run


def test_write_persists_version_and_features(session: Session) -> None:
    load = _load([_feature("도시지역", "UQA100")], checksum="chk-a")
    run = _run(session)
    report = _write_bundle(session, load, run=run, reference_date=ISOLATED_REFERENCE_DATE)
    session.flush()
    assert report.dataset_version_created is True
    assert report.features_inserted == 1
    assert feature_count_for_version(session, report.dataset_version_id or -1) == 1


def test_identical_second_write_is_idempotent(session: Session) -> None:
    features = [_feature("도시지역", "UQA100"), _feature("중심상업지역", "UQA210")]
    first = _write_bundle(
        session, _load(features, "chk-b"), run=_run(session), reference_date=ISOLATED_REFERENCE_DATE
    )
    session.flush()
    second = _write_bundle(
        session, _load(features, "chk-b"), run=_run(session), reference_date=ISOLATED_REFERENCE_DATE
    )
    session.flush()
    assert first.dataset_version_created is True
    assert first.features_inserted == 2
    # Second identical write: version reused, zero material feature inserts.
    assert second.dataset_version_created is False
    assert second.features_inserted == 0
    assert second.features_skipped_existing == 2
    assert first.dataset_version_id == second.dataset_version_id


def test_duplicate_dataset_version_is_prevented(session: Session) -> None:
    load = _load([_feature("도시지역", "UQA100")], checksum="chk-c")
    _write_bundle(session, load, run=_run(session), reference_date=ISOLATED_REFERENCE_DATE)
    session.flush()
    _write_bundle(session, load, run=_run(session), reference_date=ISOLATED_REFERENCE_DATE)
    session.flush()
    count = session.scalar(
        select(func.count())
        .select_from(StructuralDatasetVersion)
        .where(
            StructuralDatasetVersion.source_id == SOURCE_ID,
            StructuralDatasetVersion.source_checksum == "chk-c",
        )
    )
    assert count == 1


def test_duplicate_feature_is_prevented(session: Session) -> None:
    # Same fingerprint appearing twice in one load must persist once.
    duplicate = _feature("도시지역", "UQA100")
    load = _load([duplicate, _feature("도시지역", "UQA100")], checksum="chk-d")
    report = _write_bundle(session, load, run=_run(session), reference_date=ISOLATED_REFERENCE_DATE)
    session.flush()
    assert report.features_inserted == 1
    assert report.features_skipped_existing == 1
    assert feature_count_for_version(session, report.dataset_version_id or -1) == 1


def test_freshness_updates_only_after_success(session: Session) -> None:
    session.query(DatasetFreshness).filter(DatasetFreshness.source_id == SOURCE_ID).delete()
    session.flush()
    load = _load([_feature("도시지역", "UQA100")], checksum="chk-e")
    _write_bundle(session, load, run=_run(session), reference_date=ISOLATED_REFERENCE_DATE)
    session.flush()
    freshness = session.get(DatasetFreshness, SOURCE_ID)
    assert freshness is not None
    assert freshness.latest_reference_period == ISOLATED_REFERENCE_DATE
    assert freshness.freshness_status == "FRESH"


def test_failed_run_is_marked_and_rolls_back(session: Session) -> None:
    run = _run(session)
    session.commit()
    _mark_run_failed(session, run.run_id, ISOLATED_REFERENCE_DATE, IngestionError("boom"))
    failed = session.get(IngestionRun, run.run_id)
    assert failed is not None
    assert failed.status == "FAILED"
    assert failed.error_category == "IngestionError"


def _cleanup(session: Session, checksums: list[str]) -> None:
    # Defensive: not relied upon (tests roll back), but keeps a shared DB clean.
    versions: Any = session.scalars(
        select(StructuralDatasetVersion.id).where(
            StructuralDatasetVersion.source_checksum.in_(checksums)
        )
    ).all()
    for version_id in versions:
        session.query(StructuralFeature).filter(
            StructuralFeature.dataset_version_id == version_id
        ).delete()
    session.query(StructuralDatasetVersion).filter(
        StructuralDatasetVersion.source_checksum.in_(checksums)
    ).delete()
