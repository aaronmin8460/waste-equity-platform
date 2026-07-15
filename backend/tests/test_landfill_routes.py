"""SQLite-tier tests for the capital-region landfill inbound-flow API.

Seeds synthetic ``landfill_inbound_monthly`` rows and asserts aggregation,
filtering, derived effective-fee math, the derived per-capita inbound fee and its
same-reference-year rule, period completeness, the three-origin flow output
(never municipal), and evidence labels. All values are synthetic.

Population denominators are seeded through the canonical SGIS regions, which use
SGIS's own sido codes (11 서울 / 23 인천 / 31 경기) — deliberately *not* the
landfill origin codes (11/28/41). The route crosswalks between the two systems;
seeding the real canonical codes is what makes these tests exercise it.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from waste_equity_backend.models import (
    DataSource,
    LandfillInboundMonthly,
    Region,
    RegionalPopulation,
)

NOW = datetime.datetime(2026, 7, 14, tzinfo=datetime.UTC)
SNAP = datetime.date(2026, 5, 31)
ORIGIN_NAME = {"KR-SGIS-11": "서울시", "KR-SGIS-28": "인천시", "KR-SGIS-41": "경기도"}

# landfill origin code -> (canonical SGIS region code, official region name)
CANONICAL = {
    "KR-SGIS-11": ("KR-SGIS-11", "서울특별시"),
    "KR-SGIS-28": ("KR-SGIS-23", "인천광역시"),
    "KR-SGIS-41": ("KR-SGIS-31", "경기도"),
}


def _row(month: str, origin: str, waste: str, qty: str, fee: str) -> LandfillInboundMonthly:
    return LandfillInboundMonthly(
        reference_month=month,
        reference_year=int(month[:4]),
        origin_region_code=origin,
        origin_source_name=ORIGIN_NAME[origin],
        origin_region_level="SIDO",
        destination_code="SUDOKWON_LANDFILL",
        waste_name=waste,
        quantity_kg=Decimal(qty),
        inbound_fee_krw=Decimal(fee),
        quantity_unit="kg",
        fee_currency="KRW",
        accounting_basis="VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
        quantity_source_dataset_id="15064381",
        quantity_source_snapshot_uuid="uddi-quantity",
        quantity_source_snapshot_date=SNAP,
        fee_source_dataset_id="15064394",
        fee_source_snapshot_uuid="uddi-fee",
        fee_source_snapshot_date=SNAP,
        quantity_evidence_status="OFFICIAL_REPORTED_VALUE",
        fee_evidence_status="OFFICIAL_REPORTED_VALUE",
        retrieved_at=NOW,
        transformation_version="landfill-inbound-v1",
        ingestion_run_id=1,
        created_at=NOW,
        updated_at=NOW,
    )


def _seed_population(
    session: Session,
    origin: str,
    *,
    year: int,
    population: int,
    definition: str = "SGIS_TOTAL_POPULATION",
    region_level: str = "SIDO",
    region_name: str | None = None,
) -> None:
    """Seed a canonical SIDO region and its population row for a landfill origin.

    The region is inserted with a core insert (not the ORM) because the SQLite
    tier's ``regions`` table intentionally has no PostGIS geometry column.
    """
    canonical_code, canonical_name = CANONICAL[origin]
    region_id = session.execute(
        insert(Region).values(
            region_code=canonical_code,
            region_name=region_name if region_name is not None else canonical_name,
            region_level=region_level,
            source_id="sgis",
            source_administrative_code=canonical_code.removeprefix("KR-SGIS-"),
            source_geographic_level=region_level,
            boundary_reference_period=str(year),
            valid_from=datetime.date(year, 1, 1),
        )
    ).inserted_primary_key[0]
    session.add(
        RegionalPopulation(
            region_id=region_id,
            reference_year=year,
            reference_period=str(year),
            population=population,
            unit="persons",
            population_definition=definition,
            source_id="sgis",
            source_administrative_code=canonical_code.removeprefix("KR-SGIS-"),
            source_geographic_level=region_level,
            retrieved_at=NOW,
            transformation_version="sgis-v1",
            ingestion_run_id=1,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()


def _seed_all_populations(session: Session, year: int = 2024) -> None:
    # Round synthetic denominators so the expected per-capita values are exact.
    _seed_population(session, "KR-SGIS-11", year=year, population=10_000_000)
    _seed_population(session, "KR-SGIS-28", year=year, population=3_000_000)
    _seed_population(session, "KR-SGIS-41", year=year, population=14_000_000)


def _seed(session: Session) -> None:
    for source_id, name in (("15064381", "반입량"), ("15064394", "반입수수료")):
        session.add(
            DataSource(
                source_id=source_id,
                source_name="수도권매립지관리공사",
                dataset_name=name,
                endpoint="https://api.odcloud.kr/api",
                publication_frequency="MONTHLY",
                enabled=True,
                documentation_url=None,
            )
        )
    rows: list[LandfillInboundMonthly] = []
    # 2024 complete year: Seoul 생활 every month (1,000,000 kg / 50,000,000 KRW).
    for m in range(1, 13):
        rows.append(_row(f"2024-{m:02d}", "KR-SGIS-11", "생활", "1000000", "50000000"))
    # 2024-01 extra origins / wastes.
    rows.append(_row("2024-01", "KR-SGIS-41", "생활", "2000000", "180000000"))
    rows.append(_row("2024-01", "KR-SGIS-28", "생활", "500000", "45000000"))
    rows.append(_row("2024-01", "KR-SGIS-11", "건설", "3000000", "90000000"))
    rows.append(_row("2024-01", "KR-SGIS-11", "낙엽", "0", "0"))  # zero-quantity row
    # 2025 partial year (Jan–May), Seoul 생활 only.
    for m in range(1, 6):
        rows.append(_row(f"2025-{m:02d}", "KR-SGIS-11", "생활", "800000", "40000000"))
    session.add_all(rows)
    session.commit()


def test_summary_empty_database_returns_404(client: TestClient) -> None:
    response = client.get("/api/v1/landfill/summary")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_DATA_AVAILABLE"


def test_summary_defaults_to_latest_complete_year(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary").json()
    # 2024 is the latest complete year (2025 is partial), so it is the default.
    assert body["period"]["year"] == 2024
    assert body["period"]["is_complete_year"] is True
    assert body["period"]["latest_available_month"] == "2025-05"
    # Totals: Seoul 15,000,000 + Gyeonggi 2,000,000 + Incheon 500,000 = 17,500,000 kg.
    assert Decimal(body["total_quantity_kg"]) == Decimal("17500000")
    assert Decimal(body["total_quantity_tons"]) == Decimal("17500.000000")
    assert Decimal(body["total_inbound_fee_krw"]) == Decimal("915000000")
    # 915,000,000 / 17,500 t = 52,285.71 KRW/t (2 dp).
    assert Decimal(body["effective_fee_per_ton"]) == Decimal("52285.71")
    # Largest origin is Seoul; three origins present.
    assert body["largest_origin_share"]["origin_sgis_code"] == "11"
    assert Decimal(body["largest_origin_share"]["quantity_share"]) == Decimal("0.857143")
    assert {o["origin_sgis_code"] for o in body["origin_shares"]} == {"11", "28", "41"}
    assert body["largest_waste_share"]["waste_name"] == "생활"
    assert body["accounting_basis"] == "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"


def test_summary_evidence_and_sources(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    assert body["evidence"]["quantity_status"] == "OFFICIAL_REPORTED_VALUE"
    assert body["evidence"]["fee_status"] == "OFFICIAL_REPORTED_VALUE"
    assert body["evidence"]["derived_status"] == "OFFICIAL_INPUTS_DERIVED_VALUE"
    ids = {s["dataset_id"] for s in body["sources"]}
    assert ids == {"15064381", "15064394"}
    for source in body["sources"]:
        assert source["snapshot_date"] == "2026-05-31"
    # Both mandated caveats are present.
    joined = " ".join(body["caveats"])
    assert "시·군·구별 반입량을 의미하지 않습니다" in joined
    assert "순수 운송비 또는 전체 폐기물 관리비가 아닙니다" in joined


def test_summary_origin_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    incheon = client.get("/api/v1/landfill/summary?year=2024&origin=28").json()
    assert incheon["origin_filter"] == "28"
    assert Decimal(incheon["total_quantity_kg"]) == Decimal("500000")
    assert {o["origin_sgis_code"] for o in incheon["origin_shares"]} == {"28"}


def test_summary_waste_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024&waste_name=건설").json()
    assert Decimal(body["total_quantity_kg"]) == Decimal("3000000")
    assert {w["waste_name"] for w in body["top_waste_types"]} == {"건설"}


def test_summary_month_filter(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2024&month=2").json()
    assert body["period"]["month"] == "2024-02"
    # Only Seoul 생활 exists in 2024-02.
    assert Decimal(body["total_quantity_kg"]) == Decimal("1000000")


def test_summary_partial_year_metadata(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/summary?year=2025").json()
    assert body["period"]["is_complete_year"] is False
    assert body["period"]["available_through_month"] == "2025-05"


def test_summary_invalid_origin_returns_422(client: TestClient, session: Session) -> None:
    _seed(session)
    assert client.get("/api/v1/landfill/summary?origin=99").status_code == 422


def test_composition_zero_quantity_effective_fee_null(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/composition?year=2024").json()
    names = {w["waste_name"]: w for w in body["waste_types"]}
    assert names["낙엽"]["effective_fee_per_ton"] is None
    assert Decimal(names["낙엽"]["quantity_share"]) == Decimal("0.000000")
    assert names["생활"]["effective_fee_per_ton"] is not None


def test_trends_default_latest_complete_year(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/trends").json()
    assert body["start_month"] == "2024-01"
    assert body["end_month"] == "2024-12"
    assert len(body["points"]) == 12
    first = next(p for p in body["points"] if p["reference_month"] == "2024-01")
    # 2024-01 sums all seeded origins/wastes: 1,000,000 + 2,000,000 + 500,000 + 3,000,000 + 0.
    assert Decimal(first["quantity_kg"]) == Decimal("6500000")


def test_flows_three_origins_one_destination_no_municipal(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/flows?year=2024").json()
    assert body["origin_level"] == "SIDO"
    assert len(body["flows"]) == 3
    assert {f["origin_sgis_code"] for f in body["flows"]} == {"11", "28", "41"}
    for flow in body["flows"]:
        assert flow["destination_code"] == "SUDOKWON_LANDFILL"
        assert flow["evidence_status"] == "OFFICIAL_REPORTED_VALUE"
        assert "lon" in flow["origin_point"] and "lat" in flow["destination_point"]
    assert body["destination"]["code"] == "SUDOKWON_LANDFILL"
    assert body["destination"]["coordinate_provenance"]
    # Sorted by quantity desc → Seoul (15M) first.
    assert body["flows"][0]["origin_sgis_code"] == "11"


def test_flows_waste_filter_still_only_metropolitan(client: TestClient, session: Session) -> None:
    _seed(session)
    body = client.get("/api/v1/landfill/flows?year=2024&waste_name=생활").json()
    # 건설/낙엽 excluded; still only metropolitan origins, no municipal rows.
    assert {f["origin_sgis_code"] for f in body["flows"]} <= {"11", "28", "41"}
    seoul = next(f for f in body["flows"] if f["origin_sgis_code"] == "11")
    assert Decimal(seoul["quantity_kg"]) == Decimal("12000000")


# --------------------------------------------------------------------------- #
# Derived inbound fee per resident (landfill-fee-per-capita-v1)
#
# Seeded 2024 fees: Seoul 690,000,000 / Gyeonggi 180,000,000 / Incheon 45,000,000
# (total 915,000,000). Seeded 2024 population: 10,000,000 / 14,000,000 / 3,000,000
# (total 27,000,000).
# --------------------------------------------------------------------------- #


def test_per_capita_2024_fee_uses_2024_population(client: TestClient, session: Session) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024").json()

    aggregate = body["fee_per_capita"]
    assert aggregate["indicator"] == "LANDFILL_INBOUND_FEE_PER_CAPITA"
    assert aggregate["derivation_version"] == "landfill-fee-per-capita-v1"
    assert aggregate["evidence_status"] == "OFFICIAL_INPUTS_DERIVED_VALUE"
    assert aggregate["unit"] == "KRW/인"
    assert aggregate["unavailable_reason"] is None
    # 915,000,000 / 27,000,000 = 33.888... -> 33.89
    assert Decimal(aggregate["fee_per_capita_krw"]) == Decimal("33.89")
    assert aggregate["population"] == 27_000_000
    assert aggregate["population_reference_year"] == 2024
    assert aggregate["fee_reference_year"] == 2024
    assert aggregate["fee_reference_period"] == "2024"
    assert aggregate["population_definition"] == "SGIS_TOTAL_POPULATION"
    assert aggregate["population_source_id"] == "sgis"
    assert aggregate["population_region_level"] == "SIDO"
    assert aggregate["population_unit"] == "persons"
    assert "실제 납부액이 아닙니다" in aggregate["caveat"]


def test_per_capita_row_level_values_for_each_metropolitan_origin(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    by_origin = {o["origin_sgis_code"]: o for o in body["origin_shares"]}
    assert set(by_origin) == {"11", "28", "41"}
    # Seoul 690,000,000 / 10,000,000 = 69.00
    assert Decimal(by_origin["11"]["fee_per_capita"]["fee_per_capita_krw"]) == Decimal("69.00")
    # Incheon 45,000,000 / 3,000,000 = 15.00
    assert Decimal(by_origin["28"]["fee_per_capita"]["fee_per_capita_krw"]) == Decimal("15.00")
    # Gyeonggi 180,000,000 / 14,000,000 = 12.857... -> 12.86
    assert Decimal(by_origin["41"]["fee_per_capita"]["fee_per_capita_krw"]) == Decimal("12.86")
    for origin in by_origin.values():
        assert origin["fee_per_capita"]["population_reference_year"] == 2024
        assert origin["fee_per_capita"]["unavailable_reason"] is None


def test_per_capita_aggregate_is_total_fee_over_total_population_not_a_mean(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    aggregate = Decimal(body["fee_per_capita"]["fee_per_capita_krw"])
    per_origin = [Decimal(o["fee_per_capita"]["fee_per_capita_krw"]) for o in body["origin_shares"]]
    mean = (sum(per_origin, Decimal("0")) / Decimal(len(per_origin))).quantize(Decimal("0.01"))
    assert mean == Decimal("32.29")
    assert aggregate == Decimal("33.89")  # population-weighted, never the mean
    assert aggregate != mean


def test_per_capita_2025_never_uses_2024_population(client: TestClient, session: Session) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)  # only 2024 population exists
    body = client.get("/api/v1/landfill/summary?year=2025").json()
    aggregate = body["fee_per_capita"]
    assert aggregate["fee_per_capita_krw"] is None
    assert aggregate["population"] is None
    assert aggregate["population_reference_year"] is None
    assert aggregate["unavailable_reason"] == "NO_MATCHING_POPULATION_YEAR"
    for origin in body["origin_shares"]:
        assert origin["fee_per_capita"]["fee_per_capita_krw"] is None
        assert origin["fee_per_capita"]["unavailable_reason"] == "NO_MATCHING_POPULATION_YEAR"


def test_per_capita_unavailable_when_no_population_at_all(
    client: TestClient, session: Session
) -> None:
    _seed(session)  # no population seeded
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    assert body["fee_per_capita"]["fee_per_capita_krw"] is None
    assert body["fee_per_capita"]["unavailable_reason"] == "NO_METROPOLITAN_POPULATION"
    for origin in body["origin_shares"]:
        assert origin["fee_per_capita"]["unavailable_reason"] == "NO_METROPOLITAN_POPULATION"


def test_per_capita_zero_population_returns_null_not_zero(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_population(session, "KR-SGIS-11", year=2024, population=0)
    body = client.get("/api/v1/landfill/summary?year=2024&origin=11").json()
    seoul = body["origin_shares"][0]
    assert seoul["fee_per_capita"]["fee_per_capita_krw"] is None
    assert seoul["fee_per_capita"]["unavailable_reason"] == "ZERO_POPULATION"
    # The official fee itself is still served — only the derived value is absent.
    assert Decimal(seoul["inbound_fee_krw"]) == Decimal("690000000")


def test_per_capita_ambiguous_population_definition_is_unavailable(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    # Two competing accepted denominators for the same region/year.
    _seed_population(session, "KR-SGIS-11", year=2024, population=10_000_000)
    _seed_population(session, "KR-SGIS-11", year=2024, population=9_000_000)
    body = client.get("/api/v1/landfill/summary?year=2024&origin=11").json()
    seoul = body["origin_shares"][0]
    assert seoul["fee_per_capita"]["fee_per_capita_krw"] is None
    assert seoul["fee_per_capita"]["unavailable_reason"] == "AMBIGUOUS_POPULATION_DEFINITION"


def test_per_capita_aggregate_incomplete_when_one_origin_lacks_population(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    # Gyeonggi deliberately missing.
    _seed_population(session, "KR-SGIS-11", year=2024, population=10_000_000)
    _seed_population(session, "KR-SGIS-28", year=2024, population=3_000_000)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    aggregate = body["fee_per_capita"]
    assert aggregate["fee_per_capita_krw"] is None
    assert aggregate["unavailable_reason"] == "INCOMPLETE_POPULATION_COVERAGE"
    # The two covered origins still serve their own values.
    by_origin = {o["origin_sgis_code"]: o for o in body["origin_shares"]}
    assert Decimal(by_origin["11"]["fee_per_capita"]["fee_per_capita_krw"]) == Decimal("69.00")
    assert by_origin["41"]["fee_per_capita"]["unavailable_reason"] == "NO_METROPOLITAN_POPULATION"


def test_per_capita_monthly_fee_over_same_year_annual_population(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024&month=2").json()
    aggregate = body["fee_per_capita"]
    assert aggregate["fee_reference_period"] == "2024-02"
    assert aggregate["fee_reference_year"] == 2024
    # 2024-02 holds only Seoul 생활: 50,000,000 KRW over the 2024 annual
    # population of the single origin in scope (10,000,000) = 5.00.
    assert Decimal(aggregate["inbound_fee_krw"]) == Decimal("50000000")
    assert aggregate["population"] == 10_000_000
    assert aggregate["population_reference_year"] == 2024  # annual denominator
    assert Decimal(aggregate["fee_per_capita_krw"]) == Decimal("5.00")


def test_per_capita_waste_filter_uses_only_that_waste_fee(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024&waste_name=건설").json()
    aggregate = body["fee_per_capita"]
    # 건설 exists only for Seoul: 90,000,000 / 10,000,000 = 9.00
    assert Decimal(aggregate["inbound_fee_krw"]) == Decimal("90000000")
    assert Decimal(aggregate["fee_per_capita_krw"]) == Decimal("9.00")
    assert aggregate["included_origin_region_codes"] == ["KR-SGIS-11"]


def test_per_capita_origin_filter_aggregate_matches_that_origin(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024&origin=28").json()
    assert len(body["origin_shares"]) == 1
    assert Decimal(body["fee_per_capita"]["fee_per_capita_krw"]) == Decimal("15.00")
    assert body["fee_per_capita"]["included_origin_region_codes"] == ["KR-SGIS-28"]


def test_per_capita_ignores_non_sido_population(client: TestClient, session: Session) -> None:
    _seed(session)
    _seed_population(
        session, "KR-SGIS-11", year=2024, population=10_000_000, region_level="SIGUNGU"
    )
    body = client.get("/api/v1/landfill/summary?year=2024&origin=11").json()
    reason = body["origin_shares"][0]["fee_per_capita"]["unavailable_reason"]
    assert reason == "NO_METROPOLITAN_POPULATION"


def test_per_capita_refuses_denominator_when_canonical_region_name_unexpected(
    client: TestClient, session: Session
) -> None:
    # Guards the origin -> canonical SGIS region crosswalk: if the canonical
    # region is renamed/recoded upstream, the denominator is refused rather than
    # silently attached to a different region.
    _seed(session)
    _seed_population(
        session, "KR-SGIS-11", year=2024, population=10_000_000, region_name="다른광역시"
    )
    body = client.get("/api/v1/landfill/summary?year=2024&origin=11").json()
    reason = body["origin_shares"][0]["fee_per_capita"]["unavailable_reason"]
    assert reason == "NO_METROPOLITAN_POPULATION"


def test_existing_official_fields_and_caveats_survive_per_capita_addition(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    _seed_all_populations(session, year=2024)
    body = client.get("/api/v1/landfill/summary?year=2024").json()
    # Official quantity/fee/effective-fee, provenance, and period are untouched.
    assert Decimal(body["total_quantity_kg"]) == Decimal("17500000")
    assert Decimal(body["total_inbound_fee_krw"]) == Decimal("915000000")
    assert Decimal(body["effective_fee_per_ton"]) == Decimal("52285.71")
    assert body["derivation_version"] == "landfill-effective-fee-v1"
    assert body["accounting_basis"] == "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"
    assert {s["dataset_id"] for s in body["sources"]} == {"15064381", "15064394"}
    joined = " ".join(body["caveats"])
    assert "시·군·구별 반입량을 의미하지 않습니다" in joined
    assert "순수 운송비 또는 전체 폐기물 관리비가 아닙니다" in joined
    # The route/granularity limitation is served on every landfill response...
    assert "실제 운송 경로를 의미하지 않습니다" in joined
    # ...while the per-capita interpretation caveat rides on the indicator it
    # describes, not on the shared list (endpoints without the metric must not
    # advertise it).
    assert "개인의 실제 납부액이 아닙니다" not in joined
    assert "개인의 실제 납부액이 아닙니다" in body["fee_per_capita"]["caveat"]
    notes = " ".join(body["evidence"]["notes"])
    assert "주민 1인당 환산 반입수수료" in notes


def test_per_capita_caveat_not_served_on_endpoints_without_the_metric(
    client: TestClient, session: Session
) -> None:
    _seed(session)
    for path in ("trends", "composition?year=2024", "flows?year=2024"):
        body = client.get(f"/api/v1/landfill/{path}").json()
        assert "fee_per_capita" not in body
        joined = " ".join(body["caveats"])
        assert "개인의 실제 납부액이 아닙니다" not in joined
        # The always-true landfill caveats are still present.
        assert "실제 운송 경로를 의미하지 않습니다" in joined
