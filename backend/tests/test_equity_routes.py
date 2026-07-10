"""Equity-endpoint behavior that does not require PostGIS (Phase 5.1).

Year availability for the derived indicator is the INTERSECTION of the waste
and population reference years; these tests cover the structured 404s for an
empty database, disjoint years, and a year outside the intersection, plus
parameter validation. Data-bearing responses join the PostGIS regions table
and live in ``test_equity_routes_integration.py`` (TEST_DATABASE_URL).
"""

import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from waste_equity_backend.models import RegionalPopulation, RegionalWasteStatistics

UTC = datetime.UTC
NOW = datetime.datetime(2026, 7, 10, tzinfo=UTC)


def _seed_population_row(session: Session, reference_year: int) -> None:
    session.add(
        RegionalPopulation(
            region_id=1,
            reference_year=reference_year,
            reference_period=str(reference_year),
            population=1000,
            unit="persons",
            population_definition="SGIS_TOTAL_POPULATION",
            source_id="sgis",
            source_administrative_code="99999",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()


def _seed_waste_row(session: Session, reference_year: int) -> None:
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
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()


def test_empty_database_returns_structured_404(client: TestClient) -> None:
    response = client.get("/api/v1/equity/waste-per-capita")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_AVAILABLE"
    assert detail["available_years"] == []


def test_disjoint_years_are_not_available(client: TestClient, session: Session) -> None:
    # Waste in 1998 only, population in 1999 only: no shared year exists, so
    # the derived indicator has no data at all — never a partial answer.
    _seed_waste_row(session, 1998)
    _seed_population_row(session, 1999)
    response = client.get("/api/v1/equity/waste-per-capita")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_DATA_AVAILABLE"


def test_available_years_is_the_intersection(client: TestClient, session: Session) -> None:
    _seed_waste_row(session, 1998)
    _seed_waste_row(session, 1999)
    _seed_population_row(session, 1999)
    response = client.get("/api/v1/equity/waste-per-capita", params={"year": 1998})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["requested_year"] == 1998
    # 1998 has waste but no population, so only 1999 is served as available.
    assert detail["available_years"] == [1999]


def test_parameters_are_validated(client: TestClient) -> None:
    assert client.get("/api/v1/equity/waste-per-capita", params={"year": 1889}).status_code == 422
    assert client.get("/api/v1/equity/waste-per-capita", params={"year": 2101}).status_code == 422
    assert (
        client.get(
            "/api/v1/equity/waste-per-capita", params={"waste_stream": "NUCLEAR"}
        ).status_code
        == 422
    )
