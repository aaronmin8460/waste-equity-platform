"""Equity-endpoint integration tests against a real PostGIS database (Phase 5.1).

Runs only when TEST_DATABASE_URL is set. Synthetic rows are seeded at an
isolated reference year (1999) inside a rolled-back outer transaction with
remote-ocean geometry, mirroring ``test_dataset_routes_integration.py``.
"""

import datetime
import os
from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import (
    IngestionRun,
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    WasteTreatmentFacility,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

ISOLATED_YEAR = 1999
SIDO_CODE = "TESTP5SD"
SERVED_CODE = "TESTP5A"
NO_POPULATION_CODE = "TESTP5B"
ZERO_POPULATION_CODE = "TESTP5C"
NOW = datetime.datetime(2026, 7, 10, tzinfo=datetime.UTC)

SIDO_WKT = "MULTIPOLYGON(((20 20, 20.6 20, 20.6 20.6, 20 20.6, 20 20)))"
SIGUNGU_WKT = "MULTIPOLYGON(((20 20, 20.2 20, 20.2 20.2, 20 20.2, 20 20)))"


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

    def override_get_session() -> Iterator[Session]:
        yield pg_session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client


def _region(code: str, name: str, level: str, parent: str | None) -> Region:
    return Region(
        region_code=code,
        region_name=name,
        region_level=level,
        parent_region_code=parent,
        geometry=WKTElement(SIGUNGU_WKT if level == "SIGUNGU" else SIDO_WKT, srid=4326),
        source_id="sgis",
        source_administrative_code=code,
        source_geographic_level=level,
        boundary_reference_period=str(ISOLATED_YEAR),
        boundary_source_crs="EPSG:5179",
        boundary_target_crs="EPSG:4326",
        valid_from=datetime.date(ISOLATED_YEAR, 1, 1),
        valid_to=datetime.date(ISOLATED_YEAR, 12, 31),
    )


def _population(region_id: int, run_id: int, population: int) -> RegionalPopulation:
    return RegionalPopulation(
        region_id=region_id,
        reference_year=ISOLATED_YEAR,
        reference_period=str(ISOLATED_YEAR),
        population=population,
        unit="persons",
        population_definition="SGIS_TOTAL_POPULATION",
        source_id="sgis",
        source_administrative_code=str(region_id),
        source_geographic_level="SIGUNGU",
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


# Streams come from distinct RCIS PIDs; the table grain is unique on
# (region, year, PID, category), so the fixture mirrors the real mapping.
STREAM_PIDS = {"HOUSEHOLD": "NTN007", "CONSTRUCTION": "NTN022"}


def _waste(region_id: int, run_id: int, waste_stream: str) -> RegionalWasteStatistics:
    zero = Decimal("0")
    return RegionalWasteStatistics(
        region_id=region_id,
        reference_year=ISOLATED_YEAR,
        reference_period=str(ISOLATED_YEAR),
        source_id="waste_statistics",
        source_pid=STREAM_PIDS[waste_stream],
        official_dataset_name="Test Waste Dataset",
        waste_stream=waste_stream,
        waste_category_name="총계",
        generation_quantity=Decimal("123.456"),
        recycling_quantity=Decimal("123.456"),
        incineration_quantity=zero,
        landfill_quantity=zero,
        other_treatment_quantity=zero,
        total_treatment_quantity=Decimal("123.456"),
        total_treatment_is_derived=True,
        treatment_reconciliation_difference=zero,
        quantity_unit="톤/년",
        accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
        rcis_sido_name="테스트시",
        rcis_sigungu_name="테스트구",
        source_geographic_level="SIGUNGU",
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def seeded(pg_session: Session) -> None:
    run = IngestionRun(
        source_id="waste_statistics",
        started_at=NOW,
        completed_at=NOW,
        status="SUCCEEDED",
    )
    pg_session.add(run)
    pg_session.flush()

    sido = _region(SIDO_CODE, "테스트시", "SIDO", None)
    served = _region(SERVED_CODE, "테스트 서빙구", "SIGUNGU", SIDO_CODE)
    no_population = _region(NO_POPULATION_CODE, "테스트 무인구구", "SIGUNGU", SIDO_CODE)
    zero_population = _region(ZERO_POPULATION_CODE, "테스트 영인구구", "SIGUNGU", SIDO_CODE)
    pg_session.add_all([sido, served, no_population, zero_population])
    pg_session.flush()

    pg_session.add_all(
        [
            _population(served.id, run.run_id, 250000),
            _population(zero_population.id, run.run_id, 0),
            _waste(served.id, run.run_id, "HOUSEHOLD"),
            _waste(served.id, run.run_id, "CONSTRUCTION"),
            _waste(no_population.id, run.run_id, "HOUSEHOLD"),
            _waste(zero_population.id, run.run_id, "HOUSEHOLD"),
        ]
    )
    pg_session.flush()


def test_per_capita_served_with_dual_provenance(pg_client: TestClient, seeded: None) -> None:
    body = pg_client.get("/api/v1/equity/waste-per-capita", params={"year": ISOLATED_YEAR}).json()

    assert body["indicator"] == "PER_CAPITA_WASTE_GENERATION"
    assert body["derivation_version"] == "per-capita-v1"
    assert body["unit"] == "kg/인/년"
    assert body["reference_year"] == ISOLATED_YEAR
    assert len(body["assumptions"]) >= 3

    assert body["count"] == 2  # served region only: HOUSEHOLD + CONSTRUCTION
    item = next(entry for entry in body["items"] if entry["waste_stream"] == "HOUSEHOLD")
    assert item["region_code"] == SERVED_CODE
    # 123.456 t/y × 1000 / 250,000 persons, exact decimal.
    assert Decimal(item["per_capita_kg_per_year"]) == Decimal("0.493824")
    assert item["per_capita_unit"] == "kg/인/년"
    assert Decimal(item["generation_quantity"]) == Decimal("123.456")
    assert item["accounting_basis"] == "ORIGIN_BASED_TREATMENT_OUTCOME"
    # Dual provenance: numerator and denominator each cite source and period.
    assert item["waste_source_id"] == "waste_statistics"
    assert item["waste_source_pid"] == "NTN007"
    assert item["waste_reference_period"] == str(ISOLATED_YEAR)
    assert item["population_source_id"] == "sgis"
    assert item["population"] == 250000
    assert item["population_definition"] == "SGIS_TOTAL_POPULATION"
    assert item["population_reference_period"] == str(ISOLATED_YEAR)


def test_unservable_regions_are_reported_not_zero_filled(
    pg_client: TestClient, seeded: None
) -> None:
    body = pg_client.get("/api/v1/equity/waste-per-capita", params={"year": ISOLATED_YEAR}).json()

    served_codes = {entry["region_code"] for entry in body["items"]}
    assert NO_POPULATION_CODE not in served_codes
    assert ZERO_POPULATION_CODE not in served_codes

    exclusions = {entry["region_code"]: entry["reason"] for entry in body["excluded_regions"]}
    assert exclusions[NO_POPULATION_CODE] == "NO_POPULATION_DENOMINATOR"
    assert exclusions[ZERO_POPULATION_CODE] == "ZERO_POPULATION"


# --- Phase 5.2: facility burden -------------------------------------------
#
# Geometry plan (lat ~30°: 0.01° lon ≈ 0.96 km, 0.01° lat ≈ 1.11 km):
#   Region A square 30.00–30.02; Region B square 30.15–30.17 (~12 km apart,
#   far outside the 5 km buffer of each other).
#   F1 (30.01, 30.01) inside A            → located A; buffer A only.
#   F2 (30.05, 30.01) ≈2.9 km east of A   → located B (crosswalk); buffer A
#     only (≈9.6 km from B).
#   F3 no coordinates                     → located B; no buffer membership.
#   F4 (30.16, 30.16) inside B, NULL
#     throughput                          → located B and buffer B, partial.
#   F5 (31.5, 31.5), no region            → unallocated; outside every buffer.

BURDEN_SIDO_CODE = "TESTP5FS"
BURDEN_A_CODE = "TESTP5FA"
BURDEN_B_CODE = "TESTP5FB"
BURDEN_NO_POP_CODE = "TESTP5FD"
BURDEN_ZERO_POP_CODE = "TESTP5FE"


def _square_wkt(origin: float, size: float) -> str:
    low, high = origin, origin + size
    return f"MULTIPOLYGON((({low} {low}, {high} {low}, {high} {high}, {low} {high}, {low} {low})))"


_BURDEN_REGION_WKT = {
    BURDEN_SIDO_CODE: _square_wkt(30.0, 0.3),
    BURDEN_A_CODE: _square_wkt(30.0, 0.02),
    BURDEN_B_CODE: _square_wkt(30.15, 0.02),
    BURDEN_NO_POP_CODE: _square_wkt(30.25, 0.02),
    BURDEN_ZERO_POP_CODE: _square_wkt(30.2, 0.02),
}


def _burden_region(code: str, name: str, level: str, parent: str | None) -> Region:
    region = _region(code, name, level, parent)
    region.geometry = WKTElement(_BURDEN_REGION_WKT[code], srid=4326)
    return region


def _burden_facility(
    *,
    run_id: int,
    row_index: int,
    region_id: int | None,
    point_wkt: str | None,
    throughput: str | None,
) -> WasteTreatmentFacility:
    return WasteTreatmentFacility(
        source_id="waste_statistics",
        source_pid="NTN032",
        official_dataset_name="Test Facility Dataset",
        reference_year=ISOLATED_YEAR,
        reference_period=str(ISOLATED_YEAR),
        facility_category="PUBLIC_OTHER",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        facility_name=f"테스트 시설 {row_index}",
        operator_name=None,
        address="테스트 주소",
        source_seq=None,
        source_row_index=row_index,
        region_id=region_id,
        rcis_sido_name="테스트시",
        rcis_sigungu_name="테스트구",
        source_geographic_level="SIGUNGU",
        region_mapping_status="EXACT_MATCH" if region_id is not None else "REQUIRES_GEOCODE",
        geometry=(WKTElement(point_wkt, srid=4326) if point_wkt is not None else None),
        geocode_status="SUCCEEDED" if point_wkt is not None else "FAILED",
        capacity_quantity=None,
        capacity_unit=None,
        throughput_quantity=None if throughput is None else Decimal(throughput),
        throughput_unit=None if throughput is None else "톤/년",
        remaining_fill_capacity_m3=None,
        accounting_basis="FACILITY_LOCATION_BASED_THROUGHPUT",
        source_fields={},
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def burden_seeded(pg_session: Session) -> None:
    run = IngestionRun(
        source_id="waste_statistics",
        started_at=NOW,
        completed_at=NOW,
        status="SUCCEEDED",
    )
    pg_session.add(run)
    pg_session.flush()

    sido = _burden_region(BURDEN_SIDO_CODE, "테스트시", "SIDO", None)
    region_a = _burden_region(BURDEN_A_CODE, "테스트 A구", "SIGUNGU", BURDEN_SIDO_CODE)
    region_b = _burden_region(BURDEN_B_CODE, "테스트 B구", "SIGUNGU", BURDEN_SIDO_CODE)
    no_pop = _burden_region(BURDEN_NO_POP_CODE, "테스트 무인구구", "SIGUNGU", BURDEN_SIDO_CODE)
    zero_pop = _burden_region(BURDEN_ZERO_POP_CODE, "테스트 영인구구", "SIGUNGU", BURDEN_SIDO_CODE)
    pg_session.add_all([sido, region_a, region_b, no_pop, zero_pop])
    pg_session.flush()

    pg_session.add_all(
        [
            _population(region_a.id, run.run_id, 100000),
            _population(region_b.id, run.run_id, 50000),
            _population(zero_pop.id, run.run_id, 0),
            _burden_facility(
                run_id=run.run_id,
                row_index=0,
                region_id=region_a.id,
                point_wkt="POINT(30.01 30.01)",
                throughput="1000",
            ),
            _burden_facility(
                run_id=run.run_id,
                row_index=1,
                region_id=region_b.id,
                point_wkt="POINT(30.05 30.01)",
                throughput="2000",
            ),
            _burden_facility(
                run_id=run.run_id,
                row_index=2,
                region_id=region_b.id,
                point_wkt=None,
                throughput="500",
            ),
            _burden_facility(
                run_id=run.run_id,
                row_index=3,
                region_id=region_b.id,
                point_wkt="POINT(30.16 30.16)",
                throughput=None,
            ),
            _burden_facility(
                run_id=run.run_id,
                row_index=4,
                region_id=None,
                point_wkt="POINT(31.5 31.5)",
                throughput="42",
            ),
        ]
    )
    pg_session.flush()


def test_facility_burden_located_and_buffer_aggregates(
    pg_client: TestClient, burden_seeded: None
) -> None:
    body = pg_client.get("/api/v1/equity/facility-burden", params={"year": ISOLATED_YEAR}).json()

    assert body["indicator"] == "FACILITY_BURDEN"
    assert body["derivation_version"] == "facility-burden-v1"
    assert body["buffer_meters"] == 5000
    assert body["unit"] == "kg/인/년"
    assert body["facilities_without_coordinates"] == 1
    assert body["facilities_without_region"] == 1
    assert body["count"] == 2  # A and B; no-pop and zero-pop are excluded

    by_code = {item["region_code"]: item for item in body["items"]}

    region_a = by_code[BURDEN_A_CODE]
    assert region_a["facility_count_located"] == 1
    assert Decimal(region_a["throughput_located_tons_per_year"]) == Decimal("1000")
    # 1000 t × 1000 / 100,000 persons = 10 kg/인/년.
    assert Decimal(region_a["throughput_located_kg_per_capita"]) == Decimal("10")
    assert region_a["located_throughput_is_partial"] is False
    # Buffer: F1 (inside) + F2 (≈2.9 km east) = 3000 t → 30 kg/인/년.
    assert region_a["facility_count_within_buffer"] == 2
    assert Decimal(region_a["throughput_within_buffer_tons_per_year"]) == Decimal("3000")
    assert Decimal(region_a["throughput_within_buffer_kg_per_capita"]) == Decimal("30")
    assert region_a["buffer_throughput_is_partial"] is False
    assert region_a["accounting_basis"] == "FACILITY_LOCATION_BASED_THROUGHPUT"
    assert region_a["facility_source_id"] == "waste_statistics"
    assert region_a["facility_reference_period"] == str(ISOLATED_YEAR)
    assert region_a["population_source_id"] == "sgis"
    assert region_a["population_reference_period"] == str(ISOLATED_YEAR)

    region_b = by_code[BURDEN_B_CODE]
    # Located: F2 (2000) + F3 (500, no coordinates) + F4 (NULL throughput).
    assert region_b["facility_count_located"] == 3
    assert Decimal(region_b["throughput_located_tons_per_year"]) == Decimal("2500")
    # 2500 t × 1000 / 50,000 persons = 50 kg/인/년, flagged as undercount.
    assert Decimal(region_b["throughput_located_kg_per_capita"]) == Decimal("50")
    assert region_b["located_missing_throughput_count"] == 1
    assert region_b["located_throughput_is_partial"] is True
    # Buffer: only F4 (inside B); F2 is ≈9.6 km away, F3 has no coordinates.
    assert region_b["facility_count_within_buffer"] == 1
    assert Decimal(region_b["throughput_within_buffer_tons_per_year"]) == Decimal("0")
    assert region_b["buffer_missing_throughput_count"] == 1
    assert region_b["buffer_throughput_is_partial"] is True


def test_facility_burden_exclusions_and_filters(pg_client: TestClient, burden_seeded: None) -> None:
    body = pg_client.get("/api/v1/equity/facility-burden", params={"year": ISOLATED_YEAR}).json()
    exclusions = {entry["region_code"]: entry["reason"] for entry in body["excluded_regions"]}
    assert exclusions[BURDEN_NO_POP_CODE] == "NO_POPULATION_DENOMINATOR"
    assert exclusions[BURDEN_ZERO_POP_CODE] == "ZERO_POPULATION"

    filtered = pg_client.get(
        "/api/v1/equity/facility-burden",
        params={"year": ISOLATED_YEAR, "region_code": BURDEN_A_CODE},
    ).json()
    assert filtered["count"] == 1
    assert filtered["items"][0]["region_code"] == BURDEN_A_CODE

    wrong_year = pg_client.get("/api/v1/equity/facility-burden", params={"year": 1998})
    assert wrong_year.status_code == 404
    detail = wrong_year.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert ISOLATED_YEAR in detail["available_years"]


def test_stream_and_region_filters(pg_client: TestClient, seeded: None) -> None:
    filtered = pg_client.get(
        "/api/v1/equity/waste-per-capita",
        params={"year": ISOLATED_YEAR, "waste_stream": "CONSTRUCTION"},
    ).json()
    assert filtered["count"] == 1
    assert filtered["items"][0]["waste_stream"] == "CONSTRUCTION"

    by_region = pg_client.get(
        "/api/v1/equity/waste-per-capita",
        params={"year": ISOLATED_YEAR, "region_code": SERVED_CODE},
    ).json()
    assert by_region["count"] == 2

    unknown = pg_client.get(
        "/api/v1/equity/waste-per-capita",
        params={"year": ISOLATED_YEAR, "region_code": "NOPE"},
    )
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["error"] == "REGION_NOT_FOUND"
