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
from waste_equity_backend.models.metadata import GRANULARITY_MONTHLY

UTC = datetime.UTC

MOIS_SOURCE_ID = "mois_resident_population"


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


def _seed_mois_monthly_row(session: Session, month: str, region_id: int = 2) -> None:
    """One MOIS monthly SIDO row: the series /population must never serve."""
    now = datetime.datetime(2026, 7, 9, tzinfo=UTC)
    session.add(
        RegionalPopulation(
            region_id=region_id,
            reference_year=int(month[:4]),
            reference_month=month,
            reference_period=month,
            population=9_000_000,
            unit="persons",
            population_definition="RESIDENT_REGISTERED_TOTAL",
            population_temporal_granularity=GRANULARITY_MONTHLY,
            source_id=MOIS_SOURCE_ID,
            source_administrative_code="11",
            source_geographic_level="SIDO",
            retrieved_at=now,
            transformation_version="mois-resident-population-v1",
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


def test_population_year_resolution_ignores_newer_mois_monthly_rows(
    client: TestClient, session: Session
) -> None:
    """The map's default year must come from the SGIS annual series alone.

    `regional_population` also holds the MOIS monthly SIDO series, which runs years
    ahead of SGIS. Resolving the latest year across the whole table picked a MOIS
    year and answered with SIDO rows that match no SIGUNGU boundary on the map.
    Several months are seeded so a monthly row cannot pass as an annual one.
    """
    _seed_population_row(session, 2024)
    for month in ("2026-01", "2026-02", "2026-03"):
        _seed_mois_monthly_row(session, month)

    # 2026 exists only in the MOIS monthly series, so it is not an available year here.
    response = client.get("/api/v1/population", params={"year": 2026})
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["requested_year"] == 2026
    assert detail["available_years"] == [2024]


def test_population_available_years_exclude_non_sgis_and_non_sigungu_rows(
    client: TestClient, session: Session
) -> None:
    """Every scope filter is load-bearing, not just the granularity one."""
    now = datetime.datetime(2026, 7, 9, tzinfo=UTC)
    _seed_population_row(session, 2024)
    # Annual rows that are still outside this endpoint's series: a SIDO row, and a
    # SIGUNGU row from another source. Both are newer than the SGIS series.
    for region_id, level, source_id in ((3, "SIDO", MOIS_SOURCE_ID), (4, "SIGUNGU", "other")):
        session.add(
            RegionalPopulation(
                region_id=region_id,
                reference_year=2025,
                reference_period="2025",
                population=1000,
                unit="persons",
                population_definition="RESIDENT_REGISTERED",
                source_id=source_id,
                source_administrative_code=str(region_id),
                source_geographic_level=level,
                retrieved_at=now,
                transformation_version="test-v1",
                ingestion_run_id=1,
                created_at=now,
                updated_at=now,
            )
        )
    session.commit()

    detail = client.get("/api/v1/population", params={"year": 2025}).json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert detail["available_years"] == [2024]


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
