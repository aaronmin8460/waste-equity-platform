"""Reporting-geography endpoint integration tests against a real PostGIS database.

Runs only when TEST_DATABASE_URL is set. Synthetic rows are seeded at an isolated
reference year (1998, never used by production ingestion) inside an outer
transaction that is rolled back, so real ingested data is never touched. Geometry
is a remote ocean square. Covers the native + derived reporting geography, the
per-capita city denominator, and the precise availability reasons.
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
    ReportingRegionWasteStatistics,
    WasteReportingRegion,
    WasteReportingRegionMember,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

YEAR = 1998
NOW = datetime.datetime(2026, 7, 13, tzinfo=datetime.UTC)
ACCT = "ORIGIN_BASED_TREATMENT_OUTCOME"

# Remote ocean squares so seeded rows cannot collide with real boundaries.
WKT_A = "MULTIPOLYGON(((12 12, 12.2 12, 12.2 12.2, 12 12.2, 12 12)))"
WKT_B = "MULTIPOLYGON(((12.3 12, 12.5 12, 12.5 12.2, 12.3 12.2, 12.3 12)))"
WKT_C1 = "MULTIPOLYGON(((13 13, 13.1 13, 13.1 13.1, 13 13.1, 13 13)))"
WKT_C2 = "MULTIPOLYGON(((13.1 13, 13.2 13, 13.2 13.1, 13.1 13.1, 13.1 13)))"
WKT_CITY = "MULTIPOLYGON(((13 13, 13.2 13, 13.2 13.1, 13 13.1, 13 13)))"


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


def _region(code: str, name: str, wkt: str) -> Region:
    return Region(
        region_code=code,
        region_name=name,
        region_level="SIGUNGU",
        parent_region_code="TESTRGSD",
        geometry=WKTElement(wkt, srid=4326),
        source_id="sgis",
        source_administrative_code=code,
        source_geographic_level="SIGUNGU",
        boundary_reference_period=str(YEAR),
        boundary_source_crs="EPSG:5179",
        boundary_target_crs="EPSG:4326",
        valid_from=datetime.date(YEAR, 1, 1),
        valid_to=datetime.date(YEAR, 12, 31),
    )


def _population(region_id: int, code: str, pop: int) -> RegionalPopulation:
    return RegionalPopulation(
        region_id=region_id,
        reference_year=YEAR,
        reference_period=str(YEAR),
        population=pop,
        unit="persons",
        population_definition="RESIDENT_REGISTERED",
        source_id="sgis",
        source_administrative_code=code,
        source_geographic_level="SIGUNGU",
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=1,
        created_at=NOW,
        updated_at=NOW,
    )


def _native_waste(
    region_id: int, run_id: int, stream: str, pid: str, gen: str
) -> RegionalWasteStatistics:
    return RegionalWasteStatistics(
        region_id=region_id,
        reference_year=YEAR,
        reference_period=str(YEAR),
        source_id="waste_statistics",
        source_pid=pid,
        official_dataset_name=f"Native {stream}",
        waste_stream=stream,
        waste_category_name="총계",
        generation_quantity=Decimal(gen),
        recycling_quantity=Decimal("1"),
        incineration_quantity=Decimal("1"),
        landfill_quantity=Decimal("1"),
        other_treatment_quantity=Decimal("1"),
        total_treatment_quantity=Decimal("4"),
        total_treatment_is_derived=True,
        treatment_reconciliation_difference=Decimal("0"),
        quantity_unit="톤/년",
        accounting_basis=ACCT,
        rcis_sido_name="테스트시",
        rcis_sigungu_name="테스트구",
        source_geographic_level="SIGUNGU",
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


def _reporting_waste(
    reporting_region_id: int, run_id: int, stream: str, pid: str, gen: str
) -> ReportingRegionWasteStatistics:
    return ReportingRegionWasteStatistics(
        reporting_region_id=reporting_region_id,
        reference_year=YEAR,
        reference_period=str(YEAR),
        source_id="waste_statistics",
        source_pid=pid,
        official_dataset_name=f"City {stream}",
        waste_stream=stream,
        waste_category_name="총계",
        generation_quantity=Decimal(gen),
        recycling_quantity=Decimal("1"),
        incineration_quantity=Decimal("1"),
        landfill_quantity=Decimal("1"),
        other_treatment_quantity=Decimal("1"),
        total_treatment_quantity=Decimal("4"),
        total_treatment_is_derived=True,
        treatment_reconciliation_difference=Decimal("0"),
        quantity_unit="톤/년",
        accounting_basis=ACCT,
        rcis_sido_name="경기",
        rcis_sigungu_name="테스트시티",
        source_geographic_level="CITY",
        reporting_geography_type="DERIVED_CITY_UNION",
        retrieved_at=NOW,
        transformation_version="test-v1",
        raw_response_id=None,
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, int]:
    run = IngestionRun(
        source_id="waste_statistics", started_at=NOW, completed_at=NOW, status="SUCCEEDED"
    )
    pg_session.add(run)
    pg_session.flush()

    sido = Region(
        region_code="TESTRGSD",
        region_name="테스트시",
        region_level="SIDO",
        parent_region_code=None,
        geometry=WKTElement(WKT_A, srid=4326),
        source_id="sgis",
        source_administrative_code="TESTRGSD",
        source_geographic_level="SIDO",
        boundary_reference_period=str(YEAR),
        boundary_source_crs="EPSG:5179",
        boundary_target_crs="EPSG:4326",
        valid_from=datetime.date(YEAR, 1, 1),
        valid_to=datetime.date(YEAR, 12, 31),
    )
    a = _region("TESTRGA", "테스트시 에이구", WKT_A)
    b = _region("TESTRGB", "테스트시 비구", WKT_B)
    c1 = _region("TESTRGC1", "테스트시티 씨일구", WKT_C1)
    c2 = _region("TESTRGC2", "테스트시티 씨이구", WKT_C2)
    pg_session.add_all([sido, a, b, c1, c2])
    pg_session.flush()

    pg_session.add_all(
        [
            _population(a.id, "TESTRGA", 100000),
            _population(b.id, "TESTRGB", 200000),
            _population(c1.id, "TESTRGC1", 300000),
            _population(c2.id, "TESTRGC2", 500000),
        ]
    )
    # Native waste: A has both streams, B has HOUSEHOLD only (missing NTN018).
    pg_session.add_all(
        [
            _native_waste(a.id, run.run_id, "HOUSEHOLD", "NTN007", "10000"),
            _native_waste(a.id, run.run_id, "INDUSTRIAL_FACILITY", "NTN018", "20000"),
            _native_waste(b.id, run.run_id, "HOUSEHOLD", "NTN007", "30000"),
        ]
    )

    city = WasteReportingRegion(
        reporting_region_code="KR-RCISRG-TEST",
        reporting_region_name="경기도 테스트시티",
        rcis_sido_name="경기",
        rcis_sigungu_name="테스트시티",
        reporting_geography_type="DERIVED_CITY_UNION",
        geometry_kind="DERIVED",
        derived_geometry_method="ST_UNION_OF_SGIS_CHILDREN",
        source_reporting_level="CITY",
        child_region_count=2,
        geometry=WKTElement(WKT_CITY, srid=4326),
        boundary_source_id="sgis",
        boundary_reference_period=str(YEAR),
        boundary_source_crs="EPSG:5179",
        boundary_target_crs="EPSG:4326",
        boundary_geometry_hash="0" * 64,
        boundary_retrieved_at=NOW,
        valid_from=datetime.date(YEAR, 1, 1),
        valid_to=datetime.date(YEAR, 12, 31),
        created_at=NOW,
        updated_at=NOW,
    )
    pg_session.add(city)
    pg_session.flush()
    pg_session.add_all(
        [
            WasteReportingRegionMember(
                reporting_region_id=city.id,
                child_region_id=c1.id,
                child_region_code="TESTRGC1",
                child_region_name="테스트시티 씨일구",
            ),
            WasteReportingRegionMember(
                reporting_region_id=city.id,
                child_region_id=c2.id,
                child_region_code="TESTRGC2",
                child_region_name="테스트시티 씨이구",
            ),
        ]
    )
    pg_session.add_all(
        [
            _reporting_waste(city.id, run.run_id, "HOUSEHOLD", "NTN007", "80000"),
            _reporting_waste(city.id, run.run_id, "INDUSTRIAL_FACILITY", "NTN018", "40000"),
        ]
    )
    pg_session.flush()
    return {"city_id": city.id}


def test_boundaries_native_plus_derived_city_once(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"/api/v1/waste-reporting/boundaries?year={YEAR}").json()
    codes = [f["properties"]["reporting_region_code"] for f in body["features"]]
    # Native A, B + derived city; child districts are NOT separate features.
    assert set(codes) == {"TESTRGA", "TESTRGB", "KR-RCISRG-TEST"}
    assert "TESTRGC1" not in codes and "TESTRGC2" not in codes
    city = next(
        f for f in body["features"] if f["properties"]["reporting_region_code"] == "KR-RCISRG-TEST"
    )
    assert city["properties"]["geometry_kind"] == "DERIVED"
    assert city["properties"]["source_reporting_level"] == "CITY"
    assert city["properties"]["child_region_codes"] == ["TESTRGC1", "TESTRGC2"]
    assert city["geometry"]["type"] == "MultiPolygon"
    native = next(
        f for f in body["features"] if f["properties"]["reporting_region_code"] == "TESTRGA"
    )
    assert native["properties"]["geometry_kind"] == "NATIVE"
    assert native["properties"]["native_region_code"] == "TESTRGA"


def test_statistics_city_once_and_unavailable_reason(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    hh = pg_client.get(
        f"/api/v1/waste-reporting/statistics?year={YEAR}&waste_stream=HOUSEHOLD"
    ).json()
    hh_codes = sorted(i["reporting_region_code"] for i in hh["items"])
    assert hh_codes == ["KR-RCISRG-TEST", "TESTRGA", "TESTRGB"]
    assert hh["unavailable_regions"] == []
    city_item = next(i for i in hh["items"] if i["reporting_region_code"] == "KR-RCISRG-TEST")
    assert city_item["source_reporting_level"] == "CITY"
    assert city_item["reporting_geography_type"] == "DERIVED_CITY_UNION"
    assert city_item["child_region_codes"] == ["TESTRGC1", "TESTRGC2"]
    # A city value is never labelled with a child district name/code.
    assert "씨일구" not in city_item["reporting_region_name"]

    ind = pg_client.get(
        f"/api/v1/waste-reporting/statistics?year={YEAR}&waste_stream=INDUSTRIAL_FACILITY"
    ).json()
    ind_codes = sorted(i["reporting_region_code"] for i in ind["items"])
    assert ind_codes == ["KR-RCISRG-TEST", "TESTRGA"]
    # B has no INDUSTRIAL_FACILITY row -> precise SOURCE_NOT_REPORTED, not NO_DATA.
    unavailable = {u["reporting_region_code"]: u["reason"] for u in ind["unavailable_regions"]}
    assert unavailable == {"TESTRGB": "SOURCE_NOT_REPORTED"}


def test_per_capita_city_denominator_is_sum_of_children(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(
        f"/api/v1/waste-reporting/per-capita?year={YEAR}&waste_stream=HOUSEHOLD"
    ).json()
    city = next(i for i in body["items"] if i["reporting_region_code"] == "KR-RCISRG-TEST")
    # Denominator = C1 (300000) + C2 (500000) = 800000; derived and lineage-kept.
    assert city["population"] == 800000
    assert city["population_is_derived"] is True
    assert city["population_derivation"] == "SUM_OF_SGIS_CHILD_DISTRICTS"
    assert city["child_region_codes"] == ["TESTRGC1", "TESTRGC2"]
    assert city["numerator_reporting_level"] == "CITY"
    # 80000 톤 * 1000 / 800000 = 100 kg/인/년.
    assert Decimal(city["per_capita_kg_per_year"]) == Decimal("100.000000")

    native = next(i for i in body["items"] if i["reporting_region_code"] == "TESTRGA")
    assert native["population_is_derived"] is False
    # 10000 톤 * 1000 / 100000 = 100 kg/인/년.
    assert Decimal(native["per_capita_kg_per_year"]) == Decimal("100.000000")
