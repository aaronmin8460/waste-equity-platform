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
