"""Postgres-backed facility persistence/idempotency tests (no live API).

The facility table carries a PostGIS geometry column, so these run only against
a real PostgreSQL/PostGIS database (TEST_DATABASE_URL). They build synthetic
bundles at an isolated reference year and roll back, leaving no data behind.
"""

from __future__ import annotations

import datetime
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from waste_equity_backend.models import IngestionRun, WasteTreatmentFacility

from waste_equity_ingestion.rcis_facility_contract import FacilityParseResult, FacilityRecord
from waste_equity_ingestion.rcis_facility_ingestion import (
    FacilityFetchBundle,
    MappedFacility,
    _FacilityMapping,
    _write_bundle,
)
from waste_equity_ingestion.rcis_waste_ingestion import RawRcisResponse

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")

ISOLATED_YEAR = 1999  # keep synthetic rows away from real ingested data


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


def _record(name: str) -> FacilityRecord:
    return FacilityRecord(
        source_pid="NTN031",
        official_dataset_name="SYNTHETIC",
        reference_year=ISOLATED_YEAR,
        facility_category="PUBLIC_INCINERATION",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        facility_name=name,
        operator_name=None,
        address="합성 주소 1",
        source_seq="1",
        source_row_index=0,
        rcis_sido_name="서울",
        rcis_sigungu_name="종로구",
        capacity_quantity=None,
        capacity_unit=None,
        throughput_quantity=None,
        throughput_unit=None,
        residue_total=None,
        residue_recycling=None,
        residue_incineration=None,
        residue_landfill=None,
        residue_other=None,
        fill_area_m2=None,
        total_fill_capacity_m3=None,
        remaining_fill_capacity_m3=None,
        fill_quantity_m3=None,
        fill_use_period=None,
        permit_date=None,
        return_date=None,
        source_fields={"SEQ": "1"},
    )


def _bundle_and_mapping(region_id: int | None, status: str) -> tuple:
    rec = _record("합성시설")
    parsed = FacilityParseResult(
        pid="NTN031",
        reference_year=ISOLATED_YEAR,
        provider_code="E000",
        provider_message="ok",
        official_dataset_name="SYNTHETIC",
        records=[rec],
        source_record_count=1,
        excluded_aggregate_rows=0,
        rejected_rows=[],
    )
    raw = RawRcisResponse(
        pid="NTN031",
        endpoint_identifier=f"wss/JsonApi/NTN031:year={ISOLATED_YEAR}",
        reference_period=str(ISOLATED_YEAR),
        request_metadata={"pid": "NTN031"},
        payload={"result": [{"ERR_CODE": "E000"}], "data": []},
        retrieved_at=datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC),
        record_count=1,
    )
    bundle = FacilityFetchBundle(raw_responses=[raw], parse_results={"NTN031": parsed})
    mapping = _FacilityMapping(
        mapped_by_pid={"NTN031": [MappedFacility(rec, region_id, status)]},
        in_scope_by_pid={"NTN031": 1},
        parse_rejected_by_pid={"NTN031": 0},
        status_by_pid={"NTN031": {status: 1}},
        unmatched_labels=set(),
    )
    return bundle, mapping


def _new_run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id="waste_statistics",
        started_at=datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=str(ISOLATED_YEAR),
        transformation_version="rcis-facility-capital-region-v1",
    )
    session.add(run)
    session.flush()
    return run


@pytest.fixture
def session():
    _upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db = factory()
    try:
        yield db
    finally:
        db.rollback()  # discard all synthetic rows
        db.close()
        engine.dispose()


def test_facility_write_then_idempotent_second_write(session: Session) -> None:
    def count() -> int:
        return (
            session.scalar(
                select(func.count())
                .select_from(WasteTreatmentFacility)
                .where(WasteTreatmentFacility.reference_year == ISOLATED_YEAR)
            )
            or 0
        )

    assert count() == 0
    bundle, mapping = _bundle_and_mapping(region_id=None, status="EXACT_MATCH")

    run1 = _new_run(session)
    r1 = _write_bundle(session, ISOLATED_YEAR, bundle, mapping, run1)
    assert r1.rows_inserted == 1
    assert count() == 1

    run2 = _new_run(session)
    r2 = _write_bundle(session, ISOLATED_YEAR, bundle, mapping, run2)
    assert r2.rows_inserted == 0
    assert r2.rows_updated == 0
    assert count() == 1


def test_unmapped_facility_stored_with_null_region_and_status(session: Session) -> None:
    bundle, mapping = _bundle_and_mapping(region_id=None, status="REQUIRES_GEOCODE")
    run = _new_run(session)
    _write_bundle(session, ISOLATED_YEAR, bundle, mapping, run)

    row = session.scalar(
        select(WasteTreatmentFacility).where(WasteTreatmentFacility.reference_year == ISOLATED_YEAR)
    )
    assert row is not None
    assert row.region_id is None
    assert row.region_mapping_status == "REQUIRES_GEOCODE"
    assert row.accounting_basis == "FACILITY_LOCATION_BASED_THROUGHPUT"
    assert row.geometry is None
    assert row.raw_response_id is not None
