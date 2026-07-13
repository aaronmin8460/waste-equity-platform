"""Synthetic persistence tests for RCIS waste ingestion write helpers.

These use SQLite for the non-spatial provenance and normalized tables. SQLite
does not enforce the regions foreign key, so a synthetic region_id is used
without creating the PostGIS-backed regions table. Full spatial behavior is
covered by the opt-in Docker/PostGIS integration test.

All values are synthetic; nothing here represents official RCIS data.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    IngestionRun,
    RawApiResponse,
    RegionalWasteStatistics,
    RegionCodeMap,
)

from waste_equity_ingestion.errors import IngestionError
from waste_equity_ingestion.rcis_region_crosswalk import SgisRegion
from waste_equity_ingestion.rcis_waste_contract import PidParseResult, WasteRecord
from waste_equity_ingestion.rcis_waste_ingestion import (
    MappedRecord,
    RawRcisResponse,
    RcisFetchBundle,
    _MappingOutcome,
    _mark_run_failed,
    _write_bundle,
)

VALID_FROM = datetime.date(2024, 1, 1)
REGION_ID = 4242
REGION_CODE = "KR-SGIS-11010"


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            DataSource.__table__,
            IngestionRun.__table__,
            DatasetFreshness.__table__,
            RawApiResponse.__table__,
            RegionCodeMap.__table__,
            RegionalWasteStatistics.__table__,
        ],
    )
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db_session:
        db_session.add(
            DataSource(
                source_id="waste_statistics",
                source_name="RCIS fixture",
                dataset_name="Fixture",
                endpoint="https://example.test",
                publication_frequency="ANNUAL",
                enabled=True,
                documentation_url=None,
            )
        )
        db_session.commit()
        yield db_session
    engine.dispose()


def _record() -> WasteRecord:
    return WasteRecord(
        source_pid="NTN007",
        waste_stream="HOUSEHOLD",
        official_dataset_name="SYNTHETIC household form",
        reference_year=2024,
        rcis_sido_name="서울특별시",
        rcis_sigungu_name="종로구",
        waste_category_name="총계",
        quantity_unit="톤/년",
        generation_quantity=Decimal("100"),
        recycling_quantity=Decimal("40"),
        incineration_quantity=Decimal("30"),
        landfill_quantity=Decimal("20"),
        other_treatment_quantity=Decimal("10"),
        total_treatment_quantity=Decimal("100"),
        treatment_reconciliation_difference=Decimal("0"),
    )


def _bundle() -> RcisFetchBundle:
    record = _record()
    parsed = PidParseResult(
        pid="NTN007",
        reference_year=2024,
        provider_code="E000",
        provider_message="ok",
        official_dataset_name="SYNTHETIC household form",
        quantity_unit="톤/년",
        records=[record],
        source_record_count=1,
        excluded_pseudo_rows=2,
        excluded_detail_rows=1,
        rejected_rows=[],
        reconciliation_mismatches=[],
    )
    raw = RawRcisResponse(
        pid="NTN007",
        endpoint_identifier="wss/JsonApi/NTN007:year=2024",
        reference_period="2024",
        request_metadata={"pid": "NTN007", "year": "2024", "provider_code": "E000"},
        payload={"result": [{"ERR_CODE": "E000"}], "data": [{"x": 1}]},
        retrieved_at=datetime.datetime(2026, 7, 8, tzinfo=datetime.UTC),
        record_count=1,
    )
    return RcisFetchBundle(raw_responses=[raw], parse_results={"NTN007": parsed})


def _mapping() -> _MappingOutcome:
    record = _record()
    mapped = MappedRecord(
        record=record, region_id=REGION_ID, region_code=REGION_CODE, valid_from=VALID_FROM
    )
    sgis_region = SgisRegion(
        region_id=REGION_ID,
        region_code=REGION_CODE,
        region_name="서울특별시 종로구",
        region_level="SIGUNGU",
        valid_from=VALID_FROM,
        parent_region_code="KR-SGIS-11",
    )
    return _MappingOutcome(
        mapped_by_pid={"NTN007": [mapped]},
        in_scope_by_pid={"NTN007": 1},
        exact_regions={REGION_CODE: "서울특별시 종로구"},
        unmatched_labels=set(),
        ambiguous_labels=set(),
        city_reporting_labels=set(),
        city_records_by_pid={"NTN007": []},
        rejected_by_pid={"NTN007": 0},
        parse_rejected_by_pid={"NTN007": 0},
        reconciliation_by_pid={"NTN007": 0},
        sgis_regions=[sgis_region],
    )


def _new_run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id="waste_statistics",
        started_at=datetime.datetime(2026, 7, 8, tzinfo=datetime.UTC),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period="2024",
        transformation_version="rcis-waste-capital-region-v1",
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def test_successful_write_inserts_normalized_row(session: Session) -> None:
    run = _new_run(session)
    report = _write_bundle(session, 2024, _bundle(), _mapping(), run)
    session.commit()

    assert report.rows_inserted == 1
    assert report.rows_updated == 0
    assert report.normalized_row_total == 1
    row = session.scalar(select(RegionalWasteStatistics))
    assert row is not None
    assert row.waste_stream == "HOUSEHOLD"
    assert row.accounting_basis == "ORIGIN_BASED_TREATMENT_OUTCOME"
    assert row.total_treatment_is_derived is True
    assert row.total_treatment_quantity == Decimal("100")
    assert row.quantity_unit == "톤/년"
    assert row.raw_response_id is not None
    assert row.ingestion_run_id == run.run_id
    assert run.status == "SUCCEEDED"
    assert run.rows_received == 1


def test_second_identical_run_is_idempotent(session: Session) -> None:
    first_run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), first_run)
    session.commit()

    second_run = _new_run(session)
    report = _write_bundle(session, 2024, _bundle(), _mapping(), second_run)
    session.commit()

    assert report.rows_inserted == 0
    assert report.rows_updated == 0
    assert report.normalized_row_total == 1
    # Identical synthetic payload hash -> raw response reused, not duplicated.
    assert report.raw_responses_reused == 1
    total = session.scalar(select(func.count()).select_from(RegionalWasteStatistics))
    assert total == 1


def test_raw_response_is_linked_and_sanitized(session: Session) -> None:
    run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), run)
    session.commit()

    raw = session.scalar(select(RawApiResponse))
    assert raw is not None
    assert raw.source_id == "waste_statistics"
    assert raw.reference_period == "2024"
    # No credential parameters are present in the stored request metadata.
    metadata = raw.sanitized_response["request_metadata"]
    assert "KEY" not in metadata
    assert "USRID" not in metadata


def test_crosswalk_row_records_rcis_name_pair(session: Session) -> None:
    run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), run)
    session.commit()

    crosswalk = session.scalar(
        select(RegionCodeMap).where(RegionCodeMap.canonical_region_code == REGION_CODE)
    )
    assert crosswalk is not None
    assert crosswalk.rcis_sido_name == "서울특별시"
    assert crosswalk.rcis_sigungu_name == "종로구"
    assert crosswalk.cross_source_review_status == "RCIS_NAME_MATCHED"


def test_crosswalk_update_preserves_existing_sgis_provenance(session: Session) -> None:
    # A pre-existing SGIS crosswalk row must keep its SGIS provenance.
    session.add(
        RegionCodeMap(
            canonical_region_code=REGION_CODE,
            valid_from=VALID_FROM,
            valid_to=datetime.date(2024, 12, 31),
            sgis_code="11010",
            mapping_status="SGIS_CONFIRMED",
            cross_source_review_status="NEEDS_REVIEW",
            mapping_source="SGIS_BOUNDARY_POPULATION_INGESTION",
            source_reference_period="2024",
        )
    )
    session.commit()

    run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), run)
    session.commit()

    crosswalk = session.scalar(
        select(RegionCodeMap).where(RegionCodeMap.canonical_region_code == REGION_CODE)
    )
    assert crosswalk is not None
    assert crosswalk.sgis_code == "11010"
    assert crosswalk.mapping_status == "SGIS_CONFIRMED"
    assert crosswalk.mapping_source == "SGIS_BOUNDARY_POPULATION_INGESTION"
    assert crosswalk.rcis_sido_name == "서울특별시"
    assert crosswalk.cross_source_review_status == "RCIS_NAME_MATCHED"
    # Exactly one crosswalk row for the region (no duplicate).
    count = session.scalar(
        select(func.count())
        .select_from(RegionCodeMap)
        .where(RegionCodeMap.canonical_region_code == REGION_CODE)
    )
    assert count == 1


def test_freshness_updates_on_success(session: Session) -> None:
    run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), run)
    session.commit()

    freshness = session.get(DatasetFreshness, "waste_statistics")
    assert freshness is not None
    assert freshness.latest_reference_period == "2024"
    assert freshness.freshness_status == "FRESH"


def test_failed_run_does_not_update_freshness(session: Session) -> None:
    run = _new_run(session)
    _mark_run_failed(session, run.run_id, 2024, IngestionError("synthetic failure"))

    failed = session.get(IngestionRun, run.run_id)
    assert failed is not None
    assert failed.status == "FAILED"
    assert failed.error_category == "IngestionError"
    assert session.get(DatasetFreshness, "waste_statistics") is None


def test_rollback_discards_partial_normalized_writes(session: Session) -> None:
    run = _new_run(session)
    _write_bundle(session, 2024, _bundle(), _mapping(), run)
    # Simulate a mid-transaction failure before commit.
    session.rollback()

    total = session.scalar(select(func.count()).select_from(RegionalWasteStatistics))
    assert total == 0
