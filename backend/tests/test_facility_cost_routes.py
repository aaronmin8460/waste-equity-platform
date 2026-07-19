"""Facility cost API tests (Phase 4 V1) on the non-spatial SQLite tier.

Seeds the standard-cost reference table, two SIGUNGU regions (+ one SIDO), and
official waste + population, then exercises /standards, /options, and /calculate
including the exact computed values, Decimal serialization, completeness/provenance
metadata, the null per-capita path, and the structured error paths. Candidate
context (spatial table) is covered by the PostGIS integration tier.
"""

import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.facility_cost_seed import seed_standard_costs
from waste_equity_backend.models import Region, RegionalPopulation, RegionalWasteStatistics

UTC = datetime.UTC
NOW = datetime.datetime(2026, 7, 19, tzinfo=UTC)
YEAR = 2022

JONGNO = "KR-SGIS-11110"
JUNG = "KR-SGIS-11140"
SEOUL_SIDO = "KR-SGIS-11"


def _seed_region(session: Session, region_id: int, code: str, name: str, level: str) -> None:
    # Core insert naming only real columns (an ORM Region(...) would emit the
    # PostGIS geometry column, which the non-spatial SQLite table does not have).
    session.execute(
        insert(Region).values(
            id=region_id,
            region_code=code,
            region_name=name,
            region_level=level,
            valid_from=datetime.date(2024, 1, 1),
        )
    )


def _seed_waste(session: Session, region_id: int, quantity: str) -> None:
    zero = Decimal("0")
    session.add(
        RegionalWasteStatistics(
            region_id=region_id,
            reference_year=YEAR,
            reference_period=str(YEAR),
            source_id="waste_statistics",
            source_pid="NTN007",
            official_dataset_name="RCIS 생활계 폐기물 발생 및 처리현황",
            waste_stream="HOUSEHOLD",
            waste_category_name="총계",
            generation_quantity=Decimal(quantity),
            recycling_quantity=zero,
            incineration_quantity=zero,
            landfill_quantity=zero,
            other_treatment_quantity=Decimal(quantity),
            total_treatment_quantity=Decimal(quantity),
            total_treatment_is_derived=True,
            treatment_reconciliation_difference=zero,
            quantity_unit="톤/년",
            accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
            rcis_sido_name="서울특별시",
            rcis_sigungu_name="구",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )


def _seed_population(session: Session, region_id: int, population: int) -> None:
    session.add(
        RegionalPopulation(
            region_id=region_id,
            reference_year=YEAR,
            reference_period=str(YEAR),
            population=population,
            unit="persons",
            population_definition="SGIS_TOTAL_POPULATION",
            source_id="sgis",
            source_administrative_code="11110",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )


@pytest.fixture
def seeded(session: Session) -> None:
    seed_standard_costs(session)
    _seed_region(session, 1, JONGNO, "종로구", "SIGUNGU")
    _seed_region(session, 2, JUNG, "중구", "SIGUNGU")
    _seed_region(session, 3, SEOUL_SIDO, "서울특별시", "SIDO")
    # 5,250 + 5,250 = 10,500 톤/년 → 10,500 ÷ 300일 = 35 톤/일.
    _seed_waste(session, 1, "5250")
    _seed_waste(session, 2, "5250")
    _seed_population(session, 1, 100_000)
    _seed_population(session, 2, 100_000)
    session.commit()


def _calc(client: TestClient, **params: object) -> dict:
    base = {
        "facility_type": "sorting_auto",
        "waste_stream": "HOUSEHOLD",
        "subsidy_scheme": "city_or_county",
        "region_codes": f"{JONGNO},{JUNG}",
    }
    base.update(params)
    response = client.get("/api/v1/facility-cost/calculate", params=base)
    return {"status": response.status_code, "body": response.json()}


def test_standards_lists_the_seeded_version_and_bands(client: TestClient, seeded: None) -> None:
    response = client.get("/api/v1/facility-cost/standards")
    assert response.status_code == 200
    body = response.json()
    assert body["active_cost_version"] == "capex-standard-v2022dec"
    assert body["count"] == 15
    version = body["versions"][0]
    assert version["cost_version"] == "capex-standard-v2022dec"
    assert version["price_base_date"] == "2022-12-01"
    assert version["source_page"] == "p.211"
    assert set(version["facility_types"]) == {"incineration_new", "sorting_auto"}
    # Exact-decimal unit cost, served as a string.
    incin_first = next(
        b
        for b in version["bands"]
        if b["facility_type"] == "incineration_new" and b["capacity_min_ton_per_day"] is None
    )
    assert Decimal(incin_first["cost_per_capacity_bn"]) == Decimal("6.24")


def test_options_exposes_scenario_choices(client: TestClient, seeded: None) -> None:
    response = client.get("/api/v1/facility-cost/options")
    assert response.status_code == 200
    body = response.json()
    assert {o["value"] for o in body["facility_types"]} == {"incineration_new", "sorting_auto"}
    schemes = {o["value"]: o["rate"] for o in body["subsidy_schemes"]}
    assert Decimal(schemes["metropolitan_city"]) == Decimal("0.40")
    assert Decimal(schemes["joint_regional_facility"]) == Decimal("0.50")
    assert body["default_operating_days"] == 300
    assert Decimal(body["underground_multiplier"]["max"]) == Decimal("1.40")
    assert "capex-standard-v2022dec" in body["cost_versions"]


def test_calculate_full_scenario_exact_values(client: TestClient, seeded: None) -> None:
    result = _calc(client)
    assert result["status"] == 200
    body = result["body"]

    assert Decimal(body["official_input"]["official_annual_quantity_ton"]) == Decimal("10500")
    assert body["official_input"]["reference_year"] == YEAR
    assert Decimal(body["capacity"]["facility_capacity_ton_per_day"]) == Decimal("35")

    sc = body["standard_cost"]
    assert sc["term_ko"] == "표준공사비 기반 설치비 산정액"
    assert Decimal(sc["standard_unit_cost_bn_per_tpd"]) == Decimal("3.45")
    assert Decimal(sc["standard_construction_cost_bn"]) == Decimal("120.75")
    assert sc["unit"] == "억원"

    assert body["annualization"]["facility_lifetime_years"] == 15
    assert Decimal(body["annualization"]["annualized_construction_cost_bn"]) == Decimal("8.05")

    sub = body["subsidy"]
    assert Decimal(sub["subsidy_rate"]) == Decimal("0.30")
    assert Decimal(sub["estimated_national_subsidy_bn"]) == Decimal("36.225")
    assert Decimal(sub["simplified_local_government_share_bn"]) == Decimal("84.525")

    pc = body["per_capita"]
    assert pc["term_ko"] == "주민 1인당 환산 지방비"
    assert Decimal(pc["per_capita_local_share_won"]) == Decimal("42262.50")
    assert pc["official_service_population"] == 200_000
    assert pc["unavailable_reason"] is None


def test_calculate_completeness_and_provenance(client: TestClient, seeded: None) -> None:
    body = _calc(client)["body"]
    comp = body["completeness"]
    assert comp["is_partial"] is True
    missing = {m["component"] for m in comp["missing_components"]}
    assert "OPERATING_COST" in missing
    assert "ACTUAL_TRANSPORT_COST" in missing
    assert body["provenance"]["price_base_date"] == "2022-12-01"
    assert body["provenance"]["cost_version"] == "capex-standard-v2022dec"
    # Never labelled a total cost.
    assert "총비용" not in str(body)


def test_underground_multiplier_scales_the_standard_cost(client: TestClient, seeded: None) -> None:
    body = _calc(client, underground_multiplier="1.4")["body"]
    # 3.45 × 35 × 1.4 = 169.05 억원.
    assert Decimal(body["standard_cost"]["standard_construction_cost_bn"]) == Decimal("169.05")


def test_processing_share_scales_the_quantity(client: TestClient, seeded: None) -> None:
    # 50% of 10,500 = 5,250 톤/년 → 17.5 톤/일 (still the sorting ≤20 band? 10<17.5≤20 → 4.63).
    body = _calc(client, processing_share_percent="50")["body"]
    assert Decimal(body["capacity"]["facility_capacity_ton_per_day"]) == Decimal("17.5")
    assert Decimal(body["standard_cost"]["standard_unit_cost_bn_per_tpd"]) == Decimal("4.63")


def test_calculate_unknown_cost_version(client: TestClient, seeded: None) -> None:
    result = _calc(client, cost_version="capex-standard-v9999")
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "UNKNOWN_COST_VERSION"


def test_calculate_unknown_region(client: TestClient, seeded: None) -> None:
    result = _calc(client, region_codes="KR-SGIS-99999")
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "REGION_NOT_FOUND"


def test_calculate_rejects_non_leaf_region(client: TestClient, seeded: None) -> None:
    result = _calc(client, region_codes=SEOUL_SIDO)
    assert result["status"] == 422
    assert result["body"]["detail"]["error"] == "NON_LEAF_REGION"


def test_calculate_refuses_when_a_region_has_no_official_waste(
    client: TestClient, session: Session
) -> None:
    # Region 2 has no waste row → aggregation would undercount → refuse (never 0-fill).
    seed_standard_costs(session)
    _seed_region(session, 1, JONGNO, "종로구", "SIGUNGU")
    _seed_region(session, 2, JUNG, "중구", "SIGUNGU")
    _seed_waste(session, 1, "5250")
    session.commit()
    result = _calc(client)
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "OFFICIAL_WASTE_UNAVAILABLE"


def test_calculate_null_per_capita_without_population(client: TestClient, session: Session) -> None:
    # Waste present, population absent → per-capita null + reason; cost still computed.
    seed_standard_costs(session)
    _seed_region(session, 1, JONGNO, "종로구", "SIGUNGU")
    _seed_region(session, 2, JUNG, "중구", "SIGUNGU")
    _seed_waste(session, 1, "5250")
    _seed_waste(session, 2, "5250")
    session.commit()
    body = _calc(client)["body"]
    assert body["per_capita"]["per_capita_local_share_won"] is None
    assert body["per_capita"]["unavailable_reason"] is not None
    assert body["per_capita"]["official_service_population"] is None
    # The standard cost is still present (the cost part does not depend on population).
    assert Decimal(body["standard_cost"]["standard_construction_cost_bn"]) == Decimal("120.75")


@pytest.mark.parametrize(
    ("param", "value"),
    [
        ("processing_share_percent", "150"),
        ("operating_days", "0"),
        ("underground_multiplier", "1.5"),
    ],
)
def test_calculate_rejects_out_of_range_params(
    client: TestClient, seeded: None, param: str, value: str
) -> None:
    result = _calc(client, **{param: value})
    assert result["status"] == 422
