"""Postgres-backed geocoding apply/PIP tests (no live geocoder).

Point-in-polygon needs real PostGIS, so these run only with TEST_DATABASE_URL.
Synthetic regions/facilities live at an isolated reference year (1999) with an
ocean-remote polygon so they can never interact with real ingested data, and
every test rolls back.
"""

from __future__ import annotations

import datetime
import os
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from waste_equity_backend.models import IngestionRun, Region, WasteTreatmentFacility

from waste_equity_ingestion.vworld_geocoding_contract import TRANSFORMATION_VERSION
from waste_equity_ingestion.vworld_geocoding_ingestion import (
    GeocodeReport,
    _apply_failure,
    _apply_success,
    _get_or_create_raw_response,
    _sido_names_by_code,
    geocode_address,
    resolve_point_region,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")

ISOLATED_YEAR = 1999
UTC = datetime.UTC
# Ocean-remote square (Gulf of Guinea) so PIP can never touch real regions.
SYNTH_POLYGON = "MULTIPOLYGON(((10 10, 10.2 10, 10.2 10.2, 10 10.2, 10 10)))"
INSIDE_X, INSIDE_Y = "10.1", "10.1"


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


@pytest.fixture
def session() -> Any:
    _upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db_session = factory()
    try:
        yield db_session
    finally:
        db_session.rollback()
        db_session.close()
        engine.dispose()


def _synthetic_regions(session: Session) -> Region:
    valid_from = datetime.date(ISOLATED_YEAR, 1, 1)
    sido = Region(
        region_code="ZS99",
        region_name="경기도",
        region_level="SIDO",
        parent_region_code=None,
        valid_from=valid_from,
    )
    sigungu = Region(
        region_code="ZG9901",
        region_name="경기도 시험시 시험구",
        region_level="SIGUNGU",
        parent_region_code="ZS99",
        geometry=SYNTH_POLYGON,
        valid_from=valid_from,
    )
    session.add_all([sido, sigungu])
    session.flush()
    return sigungu


def _synthetic_facility(session: Session, run: IngestionRun) -> WasteTreatmentFacility:
    now = datetime.datetime(ISOLATED_YEAR, 1, 1, tzinfo=UTC)
    facility = WasteTreatmentFacility(
        source_id="waste_statistics",
        source_pid="NTN031",
        official_dataset_name="SYNTHETIC",
        reference_year=ISOLATED_YEAR,
        reference_period=str(ISOLATED_YEAR),
        facility_category="PUBLIC_INCINERATION",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        facility_name="시험소각시설",
        address="시험로 1",
        source_row_index=990001,
        region_id=None,
        rcis_sido_name="경기",
        rcis_sigungu_name="시험시",
        source_geographic_level="SIGUNGU",
        region_mapping_status="REQUIRES_GEOCODE",
        accounting_basis="FACILITY_LOCATION_BASED_THROUGHPUT",
        source_fields={"SYNTHETIC": True},
        retrieved_at=now,
        transformation_version="synthetic-test",
        ingestion_run_id=run.run_id,
        created_at=now,
        updated_at=now,
    )
    session.add(facility)
    session.flush()
    return facility


def _synthetic_run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id="vworld",
        started_at=datetime.datetime(ISOLATED_YEAR, 1, 1, tzinfo=UTC),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=str(ISOLATED_YEAR),
        transformation_version=TRANSFORMATION_VERSION,
    )
    session.add(run)
    session.flush()
    return run


def _ok_payload(level4ac: str = "4199099000") -> dict[str, Any]:
    return {
        "response": {
            "status": "OK",
            "refined": {
                "text": "경기도 시험시 시험구 시험로 1",
                "structure": {"level4AC": level4ac},
            },
            "result": {"crs": "EPSG:4326", "point": {"x": INSIDE_X, "y": INSIDE_Y}},
        }
    }


def test_pip_resolves_multi_district_facility(session: Session) -> None:
    sigungu = _synthetic_regions(session)
    resolution = resolve_point_region(
        session,
        x=INSIDE_X,
        y=INSIDE_Y,
        rcis_sido_name="경기",
        rcis_sigungu_name="시험시",
        level4ac="4199099000",
        sido_names=_sido_names_by_code(session),
    )
    assert resolution.region_id == sigungu.id
    assert "ZG9901" in resolution.detail


def test_pip_rejects_wrong_sido_and_wrong_city(session: Session) -> None:
    _synthetic_regions(session)
    sido_names = _sido_names_by_code(session)
    wrong_sido = resolve_point_region(
        session,
        x=INSIDE_X,
        y=INSIDE_Y,
        rcis_sido_name="서울",
        rcis_sigungu_name="시험시",
        level4ac=None,
        sido_names=sido_names,
    )
    assert wrong_sido.region_id is None and "sido" in wrong_sido.detail
    wrong_city = resolve_point_region(
        session,
        x=INSIDE_X,
        y=INSIDE_Y,
        rcis_sido_name="경기",
        rcis_sigungu_name="다른시",
        level4ac=None,
        sido_names=sido_names,
    )
    assert wrong_city.region_id is None and "district" in wrong_city.detail
    outside = resolve_point_region(
        session,
        x="0.5",
        y="0.5",
        rcis_sido_name="경기",
        rcis_sigungu_name="시험시",
        level4ac=None,
        sido_names=sido_names,
    )
    assert outside.region_id is None and outside.containing_count == 0


def test_pip_rejects_level4ac_sido_mismatch(session: Session) -> None:
    _synthetic_regions(session)
    resolution = resolve_point_region(
        session,
        x=INSIDE_X,
        y=INSIDE_Y,
        rcis_sido_name="경기",
        rcis_sigungu_name="시험시",
        level4ac="1123010100",  # Seoul-prefixed legal-dong code
        sido_names=_sido_names_by_code(session),
    )
    assert resolution.region_id is None
    assert "prefix" in resolution.detail


def test_apply_success_writes_geometry_and_geocoded_match(session: Session) -> None:
    sigungu = _synthetic_regions(session)
    run = _synthetic_run(session)
    facility = _synthetic_facility(session, run)
    report = GeocodeReport(mode="write", status="RUNNING")
    now = datetime.datetime(ISOLATED_YEAR, 1, 2, tzinfo=UTC)

    result = geocode_address(
        "test-key",
        "경기 시험시 시험로 1",
        fetch=lambda params: _ok_payload(),
        request_delay=0,
        counter=report,
    )
    assert result.status == "SUCCEEDED" and result.parsed is not None
    resolution = resolve_point_region(
        session,
        x=result.parsed.x or "",
        y=result.parsed.y or "",
        rcis_sido_name=facility.rcis_sido_name,
        rcis_sigungu_name=facility.rcis_sigungu_name,
        level4ac=result.parsed.level4ac,
        sido_names=_sido_names_by_code(session),
    )
    raw = _get_or_create_raw_response(
        session,
        payload=result.final_payload,
        request_address=result.request_address,
        address_type=result.address_type,
        reference_period=str(ISOLATED_YEAR),
        run_id=run.run_id,
        now=now,
        report=report,
    )
    _apply_success(facility, result, result.parsed, resolution, raw, now)
    session.flush()

    assert facility.geometry is not None
    assert facility.geocode_status == "SUCCEEDED"
    assert facility.region_mapping_status == "GEOCODED_MATCH"
    assert facility.region_id == sigungu.id
    assert facility.geocode_raw_response_id == raw.id
    assert report.raw_responses_inserted == 1

    # Identical payload reuses the stored raw response (append-only by hash).
    again = _get_or_create_raw_response(
        session,
        payload=result.final_payload,
        request_address=result.request_address,
        address_type=result.address_type,
        reference_period=str(ISOLATED_YEAR),
        run_id=run.run_id,
        now=now,
        report=report,
    )
    assert again.id == raw.id
    assert report.raw_responses_reused == 1


def test_apply_failure_keeps_geometry_null(session: Session) -> None:
    _synthetic_regions(session)
    run = _synthetic_run(session)
    facility = _synthetic_facility(session, run)
    report = GeocodeReport(mode="write", status="RUNNING")
    now = datetime.datetime(ISOLATED_YEAR, 1, 2, tzinfo=UTC)

    result = geocode_address(
        "test-key",
        "경기 시험시 시험로 1",
        fetch=lambda params: {"response": {"status": "NOT_FOUND"}},
        request_delay=0,
        counter=report,
    )
    assert result.status == "FAILED"
    raw = _get_or_create_raw_response(
        session,
        payload=result.final_payload,
        request_address=result.request_address,
        address_type=result.address_type,
        reference_period=str(ISOLATED_YEAR),
        run_id=run.run_id,
        now=now,
        report=report,
    )
    _apply_failure(facility, result, raw, now)
    session.flush()

    assert facility.geometry is None
    assert facility.geocode_status == "FAILED"
    assert facility.region_mapping_status == "REQUIRES_GEOCODE"
    assert facility.region_id is None
    assert facility.geocode_note is not None
