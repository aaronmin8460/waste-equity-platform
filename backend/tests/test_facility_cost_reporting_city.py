"""Facility-cost over the seven RCIS CITY-level reporting regions (Page 3).

WHY THIS EXISTS. RCIS reports 고양·부천·성남·수원·안산·안양·용인 at CITY level. SGIS
2024 has no SIGUNGU ``regions`` row for the city itself — only its 일반구 children —
so the official city total lives in ``reporting_region_waste_statistics`` under a
minted ``KR-RCISRG-*`` code, and the children carry no waste row of their own.
Before this change ``/facility-cost/calculate`` knew only native SGIS codes, so a
citizen saw the city on the selection map and could not calculate it:

    region_codes=KR-RCISRG-3101  -> 404 REGION_NOT_FOUND
    region_codes=KR-SGIS-31011   -> 404 OFFICIAL_WASTE_UNAVAILABLE (child has no row)

WHAT IS ASSERTED HERE
  * the city calculates, from the SOURCE'S OWN city total copied verbatim — the
    quantity that reaches the engine is the stored value, never a sum of children;
  * mixing a city with native regions sums exactly once;
  * the population denominator is the exact sum of the city's SGIS children;
  * an incomplete or inconsistent child lineage yields a NULL per-capita with a
    reason, never a partial sum and never a zero;
  * a city named together with its own child district is REFUSED (double count);
  * the children remain uncalculable on their own, because they genuinely have no
    official waste value;
  * the cost arithmetic is unchanged — a city with the same quantity as a native
    region produces byte-identical cost figures.

The engine, the standard-cost table, and every formula are untouched by the
change these tests cover.
"""

import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.facility_cost_seed import seed_standard_costs
from waste_equity_backend.models import (
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    ReportingRegionWasteStatistics,
    WasteReportingRegion,
    WasteReportingRegionMember,
)

UTC = datetime.UTC
NOW = datetime.datetime(2026, 8, 14, tzinfo=UTC)
YEAR = 2022

JONGNO = "KR-SGIS-11110"
SEOUL_SIDO = "KR-SGIS-11"

# 수원시: the RCIS city reporting region and its four SGIS 일반구 children.
SUWON = "KR-RCISRG-3101"
SUWON_CHILDREN = [
    ("KR-SGIS-31011", "수원시 장안구"),
    ("KR-SGIS-31012", "수원시 권선구"),
    ("KR-SGIS-31013", "수원시 팔달구"),
    ("KR-SGIS-31014", "수원시 영통구"),
]

DATASET = "RCIS 생활계 폐기물 발생 및 처리현황"


def _seed_region(session: Session, region_id: int, code: str, name: str, level: str) -> None:
    # Core insert (an ORM Region(...) would emit the PostGIS geometry column, which
    # the non-spatial SQLite table does not have) — see tests/conftest.py.
    session.execute(
        insert(Region).values(
            id=region_id,
            region_code=code,
            region_name=name,
            region_level=level,
            valid_from=datetime.date(2024, 1, 1),
        )
    )


def _seed_native_waste(session: Session, region_id: int, quantity: str) -> None:
    zero = Decimal("0")
    session.add(
        RegionalWasteStatistics(
            region_id=region_id,
            reference_year=YEAR,
            reference_period=str(YEAR),
            source_id="waste_statistics",
            source_pid="NTN007",
            official_dataset_name=DATASET,
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
            rcis_sigungu_name="종로구",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )


def _seed_population(
    session: Session,
    region_id: int,
    population: int,
    definition: str = "SGIS_TOTAL_POPULATION",
    period: str = str(YEAR),
) -> None:
    session.add(
        RegionalPopulation(
            region_id=region_id,
            reference_year=YEAR,
            reference_period=period,
            population=population,
            unit="persons",
            population_definition=definition,
            source_id="sgis",
            source_administrative_code="31011",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )


def _seed_reporting_city(
    session: Session,
    reporting_id: int,
    code: str,
    name: str,
    child_count: int,
) -> None:
    # Core insert: waste_reporting_regions carries a derived display geometry the
    # non-spatial test table does not have (tests/conftest.py).
    session.execute(
        insert(WasteReportingRegion).values(
            id=reporting_id,
            reporting_region_code=code,
            reporting_region_name=name,
            rcis_sido_name="경기도",
            rcis_sigungu_name=name.replace("경기도 ", ""),
            reporting_geography_type="DERIVED_CITY_UNION",
            geometry_kind="DERIVED",
            derived_geometry_method="ST_UNION_OF_SGIS_CHILDREN",
            source_reporting_level="CITY",
            child_region_count=child_count,
            boundary_source_id=None,
            boundary_reference_period="2024",
            boundary_target_crs="EPSG:4326",
            valid_from=datetime.date(2024, 1, 1),
            created_at=NOW,
            updated_at=NOW,
        )
    )


def _seed_city_waste(session: Session, reporting_id: int, quantity: str) -> None:
    zero = Decimal("0")
    session.add(
        ReportingRegionWasteStatistics(
            reporting_region_id=reporting_id,
            reference_year=YEAR,
            reference_period=str(YEAR),
            source_id="waste_statistics",
            source_pid="NTN007",
            official_dataset_name=DATASET,
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
            rcis_sido_name="경기도",
            rcis_sigungu_name="수원시",
            source_geographic_level="CITY",
            reporting_geography_type="DERIVED_CITY_UNION",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )


@pytest.fixture
def seeded(session: Session) -> None:
    """종로구 (native, 5,250 t) + 수원시 (city-level, 5,250 t), both HOUSEHOLD 2022.

    The two carry the SAME quantity deliberately: it makes "the city path produces
    the identical cost figures" a direct comparison rather than an inference.
    """
    seed_standard_costs(session)
    _seed_region(session, 1, JONGNO, "종로구", "SIGUNGU")
    _seed_region(session, 2, SEOUL_SIDO, "서울특별시", "SIDO")
    _seed_native_waste(session, 1, "5250")
    _seed_population(session, 1, 400_000)

    # The city's four children exist as SGIS regions with population, and — as in
    # the real data — NO waste row of their own.
    for index, (code, name) in enumerate(SUWON_CHILDREN, start=10):
        _seed_region(session, index, code, name, "SIGUNGU")
        _seed_population(session, index, 100_000)

    _seed_reporting_city(session, 1, SUWON, "경기도 수원시", len(SUWON_CHILDREN))
    _seed_city_waste(session, 1, "5250")
    for index, (code, name) in enumerate(SUWON_CHILDREN, start=10):
        session.add(
            WasteReportingRegionMember(
                reporting_region_id=1,
                child_region_id=index,
                child_region_code=code,
                child_region_name=name,
            )
        )
    session.commit()


def _calc(client: TestClient, region_codes: str, **params: object) -> dict:
    base: dict[str, object] = {
        "facility_type": "sorting_auto",
        "waste_stream": "HOUSEHOLD",
        "subsidy_scheme": "city_or_county",
        "region_codes": region_codes,
    }
    base.update(params)
    response = client.get("/api/v1/facility-cost/calculate", params=base)
    return {"status": response.status_code, "body": response.json()}


# --------------------------------------------------------------------------- #
# The city becomes calculable
# --------------------------------------------------------------------------- #


def test_city_reporting_code_calculates(client: TestClient, seeded: None) -> None:
    result = _calc(client, SUWON)
    assert result["status"] == 200
    official = result["body"]["official_input"]
    # The SOURCE'S OWN city total, verbatim — not a sum of the four children.
    assert Decimal(official["official_annual_quantity_ton"]) == Decimal("5250")
    assert official["service_region_codes"] == [SUWON]
    assert [r["region_code"] for r in official["regions"]] == [SUWON]
    assert official["regions"][0]["region_name"] == "경기도 수원시"
    assert Decimal(official["regions"][0]["generation_quantity_ton"]) == Decimal("5250")


def test_city_population_is_the_exact_child_sum(client: TestClient, seeded: None) -> None:
    body = _calc(client, SUWON)["body"]
    official = body["official_input"]
    # 4 children × 100,000 — the exact sum, and it is reported for the city row.
    assert official["official_service_population"] == 400_000
    assert official["regions"][0]["population"] == 400_000
    assert official["population_definition"] == "SGIS_TOTAL_POPULATION"
    assert official["population_source_id"] == "sgis"
    assert body["per_capita"]["per_capita_local_share_won"] is not None
    assert body["per_capita"]["unavailable_reason"] is None


def test_city_cost_figures_match_an_identical_native_region(
    client: TestClient, seeded: None
) -> None:
    """The cost arithmetic did not change: same inputs in, same numbers out."""
    city = _calc(client, SUWON)["body"]
    native = _calc(client, JONGNO)["body"]
    assert city["capacity"] == native["capacity"]
    assert city["standard_cost"] == native["standard_cost"]
    assert city["annualization"] == native["annualization"]
    assert city["subsidy"] == native["subsidy"]
    # Same quantity AND same population (400,000 both ways), so even the per-capita
    # conversion lands on the same figure.
    assert city["per_capita"]["per_capita_local_share_won"] == (
        native["per_capita"]["per_capita_local_share_won"]
    )


def test_city_and_native_regions_sum_exactly_once(client: TestClient, seeded: None) -> None:
    body = _calc(client, f"{JONGNO},{SUWON}")["body"]
    official = body["official_input"]
    # 5,250 + 5,250 — each reporting unit contributes exactly one value.
    assert Decimal(official["official_annual_quantity_ton"]) == Decimal("10500")
    assert official["official_service_population"] == 800_000
    assert {r["region_code"] for r in official["regions"]} == {JONGNO, SUWON}
    assert len(official["regions"]) == 2


# --------------------------------------------------------------------------- #
# Double counting is refused, not silently resolved
# --------------------------------------------------------------------------- #


def test_city_with_its_own_child_is_refused(client: TestClient, seeded: None) -> None:
    child = SUWON_CHILDREN[0][0]
    result = _calc(client, f"{SUWON},{child}")
    assert result["status"] == 422
    detail = result["body"]["detail"]
    assert detail["error"] == "OVERLAPPING_REGIONS"
    assert child in detail["detail"]


def test_child_district_alone_is_still_uncalculable(client: TestClient, seeded: None) -> None:
    """The 일반구 genuinely have no official waste value; that stays honest."""
    result = _calc(client, SUWON_CHILDREN[0][0])
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "OFFICIAL_WASTE_UNAVAILABLE"


def test_unknown_reporting_code_is_region_not_found(client: TestClient, seeded: None) -> None:
    result = _calc(client, "KR-RCISRG-9999")
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "REGION_NOT_FOUND"


def test_city_without_a_row_for_the_stream_is_not_zero_filled(
    client: TestClient, session: Session, seeded: None
) -> None:
    """A stream the city has no official row for refuses, never returns 0.

    A native CONSTRUCTION row is seeded so the reference year resolves; the city
    has no CONSTRUCTION row, which must read as an explicit absence rather than a
    zero quietly folded into the sum.
    """
    row = session.query(RegionalWasteStatistics).one()
    session.add(
        RegionalWasteStatistics(
            region_id=1,
            reference_year=YEAR,
            reference_period=str(YEAR),
            source_id=row.source_id,
            source_pid="NTN010",
            official_dataset_name="RCIS 건설 폐기물 발생 및 처리현황",
            waste_stream="CONSTRUCTION",
            waste_category_name="총계",
            generation_quantity=Decimal("100"),
            recycling_quantity=Decimal("0"),
            incineration_quantity=Decimal("0"),
            landfill_quantity=Decimal("0"),
            other_treatment_quantity=Decimal("100"),
            total_treatment_quantity=Decimal("100"),
            total_treatment_is_derived=True,
            treatment_reconciliation_difference=Decimal("0"),
            quantity_unit="톤/년",
            accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
            rcis_sido_name="서울특별시",
            rcis_sigungu_name="종로구",
            source_geographic_level="SIGUNGU",
            retrieved_at=NOW,
            transformation_version="test-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    result = _calc(client, SUWON, waste_stream="CONSTRUCTION")
    assert result["status"] == 404
    assert result["body"]["detail"]["error"] == "OFFICIAL_WASTE_UNAVAILABLE"


# --------------------------------------------------------------------------- #
# An incomplete child lineage never becomes a partial denominator
# --------------------------------------------------------------------------- #


def test_missing_child_population_nulls_per_capita_rather_than_partially_summing(
    client: TestClient, session: Session, seeded: None
) -> None:
    # Drop one child's population row: the city's denominator is now incomplete.
    session.query(RegionalPopulation).filter(RegionalPopulation.region_id == 13).delete()
    session.commit()

    body = _calc(client, SUWON)["body"]
    official = body["official_input"]
    # Not 300,000 (a partial sum) and not 0 — no denominator at all.
    assert official["official_service_population"] is None
    assert official["regions"][0]["population"] is None
    assert body["per_capita"]["per_capita_local_share_won"] is None
    assert body["per_capita"]["unavailable_reason"] == "NO_MATCHING_SAME_YEAR_POPULATION"
    # The cost half is unaffected — it never depended on population.
    assert Decimal(body["standard_cost"]["standard_construction_cost_bn"]) > 0


def test_incompatible_child_population_definition_nulls_per_capita(
    client: TestClient, session: Session, seeded: None
) -> None:
    row = (
        session.query(RegionalPopulation).filter(RegionalPopulation.region_id == 13).one()
    )
    row.population_definition = "REGISTERED_RESIDENT_POPULATION"
    session.commit()

    body = _calc(client, SUWON)["body"]
    assert body["official_input"]["official_service_population"] is None
    assert body["per_capita"]["per_capita_local_share_won"] is None
    assert body["per_capita"]["unavailable_reason"] is not None


def test_incomplete_child_lineage_nulls_per_capita(
    client: TestClient, session: Session, seeded: None
) -> None:
    """child_region_count says 4; if only 3 members are stored, do not sum 3."""
    session.query(WasteReportingRegionMember).filter(
        WasteReportingRegionMember.child_region_code == SUWON_CHILDREN[3][0]
    ).delete()
    session.commit()

    body = _calc(client, SUWON)["body"]
    assert body["official_input"]["official_service_population"] is None
    assert body["per_capita"]["per_capita_local_share_won"] is None
    # The waste numerator is the city's own row and is unaffected by lineage.
    assert Decimal(body["official_input"]["official_annual_quantity_ton"]) == Decimal("5250")


# --------------------------------------------------------------------------- #
# Provenance is checked across the merged set, not only the native half
# --------------------------------------------------------------------------- #


def test_mixed_waste_unit_across_native_and_city_is_refused(
    client: TestClient, session: Session, seeded: None
) -> None:
    row = session.query(ReportingRegionWasteStatistics).one()
    row.quantity_unit = "kg/년"
    session.commit()

    result = _calc(client, f"{JONGNO},{SUWON}")
    assert result["status"] == 422
    assert result["body"]["detail"]["error"] == "MIXED_OR_UNEXPECTED_WASTE_UNIT"


def test_mixed_waste_provenance_across_native_and_city_is_refused(
    client: TestClient, session: Session, seeded: None
) -> None:
    row = session.query(ReportingRegionWasteStatistics).one()
    row.reference_period = "2021"
    session.commit()

    result = _calc(client, f"{JONGNO},{SUWON}")
    assert result["status"] == 500
    assert result["body"]["detail"]["error"] == "MIXED_WASTE_PROVENANCE"


def test_two_vintages_of_one_city_code_are_refused_rather_than_double_counted(
    client: TestClient, session: Session, seeded: None
) -> None:
    """A code with two boundary vintages, both holding a row for the year.

    ``waste_reporting_regions`` is UNIQUE on (code, valid_from), so one code CAN
    have several vintage rows. If two of them carry a statistic for the same year
    and stream the value is ambiguous, and the endpoint must refuse exactly as it
    does for a duplicated native row — never pick one, never add them.
    """
    _seed_reporting_city(session, 2, SUWON, "경기도 수원시", len(SUWON_CHILDREN))
    _seed_city_waste(session, 2, "999")
    session.commit()

    result = _calc(client, SUWON)
    assert result["status"] == 500
    assert result["body"]["detail"]["error"] == "AMBIGUOUS_WASTE_ROWS"
