"""Dataset-endpoint behavior that does not require PostGIS.

Parameter validation (422) and the no-data / wrong-year structured 404s for
the non-spatial datasets run against the SQLite test client; everything that
touches regions or facilities geometry lives in
``test_dataset_routes_integration.py`` (TEST_DATABASE_URL).
"""

import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from waste_equity_backend.models import RegionalPopulation, RegionalWasteStatistics

UTC = datetime.UTC


def _seed_population_row(session: Session, reference_year: int) -> None:
    now = datetime.datetime(2026, 7, 9, tzinfo=UTC)
    session.add(
        RegionalPopulation(
            region_id=1,
            reference_year=reference_year,
            reference_period=str(reference_year),
            population=1000,
            unit="persons",
            population_definition="RESIDENT_REGISTERED",
            source_id="sgis",
            source_administrative_code="99999",
            source_geographic_level="SIGUNGU",
            retrieved_at=now,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=now,
            updated_at=now,
        )
    )
    session.commit()


def _seed_waste_row(session: Session, reference_year: int) -> None:
    now = datetime.datetime(2026, 7, 9, tzinfo=UTC)
    zero = Decimal("0")
    session.add(
        RegionalWasteStatistics(
            region_id=1,
            reference_year=reference_year,
            reference_period=str(reference_year),
            source_id="waste_statistics",
            source_pid="NTN007",
            official_dataset_name="Test Dataset",
            waste_stream="HOUSEHOLD",
            waste_category_name="총계",
            generation_quantity=Decimal("10"),
            recycling_quantity=zero,
            incineration_quantity=zero,
            landfill_quantity=zero,
            other_treatment_quantity=Decimal("10"),
            total_treatment_quantity=Decimal("10"),
            total_treatment_is_derived=True,
            treatment_reconciliation_difference=zero,
            quantity_unit="톤/년",
            accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
            rcis_sido_name="테스트시",
            rcis_sigungu_name="테스트구",
            source_geographic_level="SIGUNGU",
            retrieved_at=now,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=now,
            updated_at=now,
        )
    )
    session.commit()


def test_population_empty_database_returns_structured_404(client: TestClient) -> None:
    response = client.get("/api/v1/population")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_AVAILABLE"
    assert detail["available_years"] == []


def test_population_unavailable_year_lists_available_years(
    client: TestClient, session: Session
) -> None:
    _seed_population_row(session, 1999)
    response = client.get("/api/v1/population", params={"year": 2000})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["requested_year"] == 2000
    assert detail["available_years"] == [1999]


def test_waste_statistics_empty_database_returns_structured_404(client: TestClient) -> None:
    response = client.get("/api/v1/waste-statistics")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_DATA_AVAILABLE"


def test_waste_statistics_unavailable_year_lists_available_years(
    client: TestClient, session: Session
) -> None:
    _seed_waste_row(session, 1999)
    response = client.get("/api/v1/waste-statistics", params={"year": 1990})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["available_years"] == [1999]


def test_year_bounds_are_validated(client: TestClient) -> None:
    assert client.get("/api/v1/population", params={"year": 1889}).status_code == 422
    assert client.get("/api/v1/population", params={"year": 2101}).status_code == 422
    assert client.get("/api/v1/regions", params={"year": 1889}).status_code == 422
    assert client.get("/api/v1/facilities", params={"year": 2101}).status_code == 422


def test_enumerated_filters_are_validated(client: TestClient) -> None:
    assert client.get("/api/v1/regions", params={"level": "DONG"}).status_code == 422
    assert client.get("/api/v1/regions/boundaries", params={"level": "COUNTRY"}).status_code == 422
    assert (
        client.get("/api/v1/waste-statistics", params={"waste_stream": "NUCLEAR"}).status_code
        == 422
    )
    assert (
        client.get("/api/v1/facilities", params={"facility_category": "BOGUS"}).status_code == 422
    )
    assert client.get("/api/v1/facilities", params={"ownership": "MUNICIPAL"}).status_code == 422
    assert client.get("/api/v1/facilities", params={"has_coordinates": "maybe"}).status_code == 422
