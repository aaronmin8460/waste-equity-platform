"""Dataset-endpoint integration tests against a real PostGIS database.

Runs only when TEST_DATABASE_URL is set (the docker compose database with
migrations applied). Synthetic rows are seeded at an isolated reference year
(1999, never used by production ingestion) inside an outer transaction that is
rolled back, so real ingested data is never touched. Geometry is a remote
ocean square so the rows cannot collide with real boundaries.
"""

import datetime
import os
from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import (
    DataSource,
    IngestionRun,
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    WasteTreatmentFacility,
)
from waste_equity_backend.models.metadata import GRANULARITY_ANNUAL, GRANULARITY_MONTHLY

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

ISOLATED_YEAR = 1999
SIDO_CODE = "TESTP3SD"
SIGUNGU_CODE = "TESTP3SG"
NOW = datetime.datetime(2026, 7, 9, tzinfo=datetime.UTC)

POPULATION_SOURCE_ID = "sgis"
MOIS_SOURCE_ID = "mois_resident_population"

# The mixed-granularity fixture seeds above every real reference year, so the
# default (latest) year is decided by these rows whether or not the database
# also holds real ingested population.
MIXED_SGIS_YEARS = (2097, 2098)
MIXED_MOIS_MONTHS = ("2099-01", "2099-02")
MIXED_SIGUNGU_CODE = "TESTMIXSG"
MIXED_SIDO_CODE = "TESTMIXSD"

SIDO_WKT = "MULTIPOLYGON(((10 10, 10.4 10, 10.4 10.4, 10 10.4, 10 10)))"
SIGUNGU_WKT = "MULTIPOLYGON(((10 10, 10.2 10, 10.2 10.2, 10 10.2, 10 10)))"


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


def _region(code: str, name: str, level: str, parent: str | None, wkt: str) -> Region:
    return Region(
        region_code=code,
        region_name=name,
        region_level=level,
        parent_region_code=parent,
        geometry=WKTElement(wkt, srid=4326),
        source_id="sgis",
        source_administrative_code=code,
        source_geographic_level=level,
        boundary_reference_period=str(ISOLATED_YEAR),
        boundary_source_crs="EPSG:5179",
        boundary_target_crs="EPSG:4326",
        valid_from=datetime.date(ISOLATED_YEAR, 1, 1),
        valid_to=datetime.date(ISOLATED_YEAR, 12, 31),
    )


def _population(
    *,
    region_id: int,
    run_id: int,
    reference_year: int,
    population: int,
    source_id: str,
    geographic_level: str,
    granularity: str,
    reference_month: str | None = None,
) -> RegionalPopulation:
    return RegionalPopulation(
        region_id=region_id,
        reference_year=reference_year,
        reference_month=reference_month,
        reference_period=reference_month or str(reference_year),
        population=population,
        unit="persons",
        population_definition="RESIDENT_REGISTERED",
        population_temporal_granularity=granularity,
        source_id=source_id,
        source_administrative_code=str(region_id),
        source_geographic_level=geographic_level,
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


def _facility(
    *,
    run_id: int,
    row_index: int,
    name: str,
    region_id: int | None,
    mapping_status: str,
    geocode_status: str | None,
    point_wkt: str | None,
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
        facility_name=name,
        operator_name=None,
        address="테스트 주소",
        source_seq=None,
        source_row_index=row_index,
        region_id=region_id,
        rcis_sido_name="테스트시",
        rcis_sigungu_name="테스트구",
        source_geographic_level="SIGUNGU",
        region_mapping_status=mapping_status,
        geometry=(WKTElement(point_wkt, srid=4326) if point_wkt is not None else None),
        geocode_status=geocode_status,
        capacity_quantity=Decimal("120.5"),
        capacity_unit="톤/일",
        throughput_quantity=Decimal("1000"),
        throughput_unit="톤/년",
        accounting_basis="FACILITY_LOCATION_BASED_THROUGHPUT",
        source_fields={},
        retrieved_at=NOW,
        transformation_version="test-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, int]:
    run = IngestionRun(
        source_id="waste_statistics",
        started_at=NOW,
        completed_at=NOW,
        status="SUCCEEDED",
    )
    pg_session.add(run)
    pg_session.flush()

    sido = _region(SIDO_CODE, "테스트시", "SIDO", None, SIDO_WKT)
    sigungu = _region(SIGUNGU_CODE, "테스트구", "SIGUNGU", SIDO_CODE, SIGUNGU_WKT)
    pg_session.add_all([sido, sigungu])
    pg_session.flush()

    pg_session.add(
        RegionalPopulation(
            region_id=sigungu.id,
            reference_year=ISOLATED_YEAR,
            reference_period=str(ISOLATED_YEAR),
            population=250000,
            unit="persons",
            population_definition="RESIDENT_REGISTERED",
            source_id="sgis",
            source_administrative_code=SIGUNGU_CODE,
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=run.run_id,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    pg_session.add(
        RegionalWasteStatistics(
            region_id=sigungu.id,
            reference_year=ISOLATED_YEAR,
            reference_period=str(ISOLATED_YEAR),
            source_id="waste_statistics",
            source_pid="NTN007",
            official_dataset_name="Test Waste Dataset",
            waste_stream="HOUSEHOLD",
            waste_category_name="총계",
            generation_quantity=Decimal("123.456"),
            recycling_quantity=Decimal("100.456"),
            incineration_quantity=Decimal("20"),
            landfill_quantity=Decimal("3"),
            other_treatment_quantity=Decimal("0"),
            total_treatment_quantity=Decimal("123.456"),
            total_treatment_is_derived=True,
            treatment_reconciliation_difference=Decimal("0"),
            quantity_unit="톤/년",
            accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
            rcis_sido_name="테스트시",
            rcis_sigungu_name="테스트구",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=run.run_id,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    pg_session.add_all(
        [
            _facility(
                run_id=run.run_id,
                row_index=0,
                name="테스트 지오코딩 시설",
                region_id=sigungu.id,
                mapping_status="GEOCODED_MATCH",
                geocode_status="SUCCEEDED",
                point_wkt="POINT(10.1 10.1)",
            ),
            _facility(
                run_id=run.run_id,
                row_index=1,
                name="테스트 실패 시설",
                region_id=None,
                mapping_status="REQUIRES_GEOCODE",
                geocode_status="FAILED",
                point_wkt=None,
            ),
        ]
    )
    pg_session.flush()
    return {"run_id": run.run_id, "sigungu_id": sigungu.id}


def test_regions_list_serves_provenance(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get("/api/v1/regions", params={"year": ISOLATED_YEAR}).json()
    assert body["reference_year"] == ISOLATED_YEAR
    assert body["count"] == 2
    codes = [item["region_code"] for item in body["items"]]
    assert codes == sorted(codes)
    sigungu = next(item for item in body["items"] if item["region_code"] == SIGUNGU_CODE)
    assert sigungu["source_id"] == "sgis"
    assert sigungu["boundary_reference_period"] == str(ISOLATED_YEAR)
    assert sigungu["parent_region_code"] == SIDO_CODE

    filtered = pg_client.get(
        "/api/v1/regions", params={"year": ISOLATED_YEAR, "level": "SIDO"}
    ).json()
    assert [item["region_code"] for item in filtered["items"]] == [SIDO_CODE]


def test_region_boundaries_geojson(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get("/api/v1/regions/boundaries", params={"year": ISOLATED_YEAR}).json()
    assert body["type"] == "FeatureCollection"
    assert body["count"] == 1  # level defaults to SIGUNGU
    feature = body["features"][0]
    assert feature["type"] == "Feature"
    assert feature["geometry"]["type"] == "MultiPolygon"
    ring = feature["geometry"]["coordinates"][0][0]
    assert [10, 10] in [[round(x, 6), round(y, 6)] for x, y in ring]
    assert feature["properties"]["region_code"] == SIGUNGU_CODE
    assert feature["properties"]["source_id"] == "sgis"
    assert feature["properties"]["boundary_reference_period"] == str(ISOLATED_YEAR)


def test_population_with_metadata_and_region_filter(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get("/api/v1/population", params={"year": ISOLATED_YEAR}).json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["region_code"] == SIGUNGU_CODE
    assert item["population"] == 250000
    assert item["source_id"] == "sgis"
    assert item["reference_period"] == str(ISOLATED_YEAR)

    filtered = pg_client.get(
        "/api/v1/population", params={"year": ISOLATED_YEAR, "region_code": SIGUNGU_CODE}
    ).json()
    assert filtered["count"] == 1

    unknown = pg_client.get(
        "/api/v1/population", params={"year": ISOLATED_YEAR, "region_code": "NOPE"}
    )
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["error"] == "REGION_NOT_FOUND"


def test_population_defaults_to_latest_available_year(
    pg_client: TestClient, pg_session: Session, seeded: dict[str, int]
) -> None:
    # Scoped to this endpoint's series: an unscoped max() over the whole table
    # would read the MOIS monthly SIDO rows, which /population never serves.
    latest = pg_session.scalar(
        select(func.max(RegionalPopulation.reference_year)).where(
            RegionalPopulation.population_temporal_granularity == GRANULARITY_ANNUAL,
            RegionalPopulation.source_id == POPULATION_SOURCE_ID,
            RegionalPopulation.source_geographic_level == "SIGUNGU",
        )
    )
    body = pg_client.get("/api/v1/population").json()
    assert body["reference_year"] == latest


@pytest.fixture
def mixed_granularity(pg_session: Session, seeded: dict[str, int]) -> None:
    """The real post-MOIS table shape: annual SGIS SIGUNGU + newer monthly MOIS SIDO.

    Population is seeded above every real reference year so the assertions below hold
    whether or not the database also holds real ingested population. The regions keep
    the default vintage: /population joins regions without a vintage filter, so only
    the population rows' reference years matter here.
    """
    # The migrations seed the SGIS source but not MOIS (ingestion registers that at
    # run time), and regional_population.source_id is a real FK under PostGIS.
    if pg_session.get(DataSource, MOIS_SOURCE_ID) is None:
        pg_session.add(
            DataSource(
                source_id=MOIS_SOURCE_ID,
                source_name="행정안전부",
                dataset_name="주민등록 인구 및 세대현황",
                endpoint="https://jumin.mois.go.kr",
                publication_frequency=GRANULARITY_MONTHLY,
                enabled=True,
                documentation_url=None,
            )
        )
        pg_session.flush()

    sigungu = _region(MIXED_SIGUNGU_CODE, "테스트혼합구", "SIGUNGU", None, SIGUNGU_WKT)
    sido = _region(MIXED_SIDO_CODE, "테스트혼합시", "SIDO", None, SIDO_WKT)
    pg_session.add_all([sigungu, sido])
    pg_session.flush()

    for year in MIXED_SGIS_YEARS:
        pg_session.add(
            _population(
                region_id=sigungu.id,
                run_id=seeded["run_id"],
                reference_year=year,
                population=250_000 + year,
                source_id=POPULATION_SOURCE_ID,
                geographic_level="SIGUNGU",
                granularity=GRANULARITY_ANNUAL,
            )
        )
    for month in MIXED_MOIS_MONTHS:
        pg_session.add(
            _population(
                region_id=sido.id,
                run_id=seeded["run_id"],
                reference_year=int(month[:4]),
                population=9_000_000,
                source_id=MOIS_SOURCE_ID,
                geographic_level="SIDO",
                granularity=GRANULARITY_MONTHLY,
                reference_month=month,
            )
        )
    pg_session.flush()


def test_population_default_year_ignores_newer_mois_monthly_sido_rows(
    pg_client: TestClient, mixed_granularity: None
) -> None:
    response = pg_client.get("/api/v1/population")
    assert response.status_code == 200
    body = response.json()
    # The latest SGIS annual year (2098), never the latest MOIS monthly year (2099).
    assert body["reference_year"] == MIXED_SGIS_YEARS[-1]
    codes = [item["region_code"] for item in body["items"]]
    assert MIXED_SIGUNGU_CODE in codes
    assert MIXED_SIDO_CODE not in codes


def test_population_serves_only_annual_sgis_sigungu_rows(
    pg_client: TestClient, mixed_granularity: None
) -> None:
    for params in ({}, {"year": MIXED_SGIS_YEARS[0]}, {"year": MIXED_SGIS_YEARS[-1]}):
        body = pg_client.get("/api/v1/population", params=params).json()
        assert body["items"], f"expected annual SGIS rows for {params}"
        assert all(item["source_id"] == POPULATION_SOURCE_ID for item in body["items"])
        assert all(item["region_level"] == "SIGUNGU" for item in body["items"])
        # A monthly row would surface as a YYYY-MM reference period.
        assert all(item["reference_period"].isdigit() for item in body["items"])


def test_population_explicit_year_still_works_within_the_sgis_series(
    pg_client: TestClient, mixed_granularity: None
) -> None:
    year = MIXED_SGIS_YEARS[0]
    body = pg_client.get(
        "/api/v1/population", params={"year": year, "region_code": MIXED_SIGUNGU_CODE}
    ).json()
    assert body["reference_year"] == year
    assert body["count"] == 1
    assert body["items"][0]["population"] == 250_000 + year


def test_population_year_only_in_the_mois_series_is_not_available(
    pg_client: TestClient, mixed_granularity: None
) -> None:
    response = pg_client.get("/api/v1/population", params={"year": 2099})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["requested_year"] == 2099
    assert 2099 not in detail["available_years"]
    assert set(MIXED_SGIS_YEARS).issubset(detail["available_years"])


def test_waste_statistics_exact_decimals_and_basis(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get("/api/v1/waste-statistics", params={"year": ISOLATED_YEAR}).json()
    assert body["count"] == 1
    item = body["items"][0]
    # Decimal fields serialize as exact strings (scale-padded by the database,
    # e.g. "123.456000"); the numeric value must survive unchanged.
    assert Decimal(item["generation_quantity"]) == Decimal("123.456")
    assert Decimal(item["recycling_quantity"]) == Decimal("100.456")
    assert item["accounting_basis"] == "ORIGIN_BASED_TREATMENT_OUTCOME"
    assert item["source_pid"] == "NTN007"
    assert item["quantity_unit"] == "톤/년"
    assert item["reference_period"] == str(ISOLATED_YEAR)

    empty = pg_client.get(
        "/api/v1/waste-statistics",
        params={"year": ISOLATED_YEAR, "waste_stream": "CONSTRUCTION"},
    ).json()
    assert empty["count"] == 0
    assert empty["items"] == []


def test_facilities_coordinates_never_fabricated(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get("/api/v1/facilities", params={"year": ISOLATED_YEAR}).json()
    assert body["count"] == 2
    geocoded, failed = body["items"]

    assert geocoded["region_mapping_status"] == "GEOCODED_MATCH"
    assert geocoded["geocode_status"] == "SUCCEEDED"
    assert geocoded["region_code"] == SIGUNGU_CODE
    assert round(geocoded["longitude"], 6) == 10.1
    assert round(geocoded["latitude"], 6) == 10.1
    assert Decimal(geocoded["capacity_quantity"]) == Decimal("120.5")
    assert geocoded["accounting_basis"] == "FACILITY_LOCATION_BASED_THROUGHPUT"
    assert geocoded["source_id"] == "waste_statistics"
    assert geocoded["reference_period"] == str(ISOLATED_YEAR)

    assert failed["geocode_status"] == "FAILED"
    assert failed["longitude"] is None
    assert failed["latitude"] is None
    assert failed["region_code"] is None
    assert failed["region_mapping_status"] == "REQUIRES_GEOCODE"


def test_facilities_filters(pg_client: TestClient, seeded: dict[str, int]) -> None:
    with_coords = pg_client.get(
        "/api/v1/facilities", params={"year": ISOLATED_YEAR, "has_coordinates": True}
    ).json()
    assert with_coords["count"] == 1
    assert with_coords["items"][0]["geocode_status"] == "SUCCEEDED"

    without_coords = pg_client.get(
        "/api/v1/facilities", params={"year": ISOLATED_YEAR, "has_coordinates": False}
    ).json()
    assert without_coords["count"] == 1
    assert without_coords["items"][0]["longitude"] is None

    by_region = pg_client.get(
        "/api/v1/facilities", params={"year": ISOLATED_YEAR, "region_code": SIGUNGU_CODE}
    ).json()
    assert by_region["count"] == 1

    by_ownership = pg_client.get(
        "/api/v1/facilities", params={"year": ISOLATED_YEAR, "ownership": "PRIVATE"}
    ).json()
    assert by_ownership["count"] == 0
