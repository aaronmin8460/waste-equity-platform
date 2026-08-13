"""Read-only API tests for ``GET /api/v1/landfill/municipal-costs``.

All seeded rows are SYNTHETIC. The suite asserts the contract that matters for a
consumer: full scope returns one row per expected 2024 municipality (66),
unavailable values are ``null`` rather than 0, and the response says in the
payload itself that this is not the official landfill inbound fee.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from tests.conftest import REGIONS_NONSPATIAL
from waste_equity_backend.analysis.municipal_cost import (
    EXPECTED_MUNICIPALITIES,
    METROPOLITAN_GYEONGGI,
    METROPOLITAN_INCHEON,
    METROPOLITAN_SEOUL,
    describe_reasons,
)
from waste_equity_backend.models import (
    MunicipalCostGeography,
    MunicipalCostGeographyComponent,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteQuantity,
)
from waste_equity_backend.models.municipal_cost import (
    ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT,
    ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
    BOUNDARY_VINTAGE,
    CLASS_DATA_A_PAYMENT_AND_QUANTITY,
    CLASS_DATA_B_QUANTITY_VALIDATION,
    EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
    EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
    EVIDENCE_OFFICIAL_DERIVED,
    EVIDENCE_OFFICIAL_REPORTED,
    INDICATOR_DISPLAY_NAME_KO,
    INDICATOR_UNIT,
    INGESTION_DECISION_ACCEPTED,
    INGESTION_DECISION_REJECTED,
    LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS,
    LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID,
    METHODOLOGY_VERSION,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
    MUNICIPALITY_LEVEL_SIGUNGU,
    POPULATION_DEFINITION_SGIS,
    POPULATION_DERIVED_WARD_SUM,
    POPULATION_DIRECT,
    QUANTITY_UNIT_TONNE,
    REASON_MISSING_PAYMENT,
    REASON_NO_SOURCE_FILE,
    REASON_PARTIAL_WASTE_SCOPE,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    TRANSFORMATION_VERSION,
    VALUE_MEASURED,
    VALUE_SOURCE_DASH_NO_DATA,
)

ENDPOINT = "/api/v1/landfill/municipal-costs"
NOW = datetime.datetime(2026, 8, 5, tzinfo=datetime.UTC)

# Synthetic values assigned to a handful of municipalities so the filters and
# sorts have something to order. Everything else is seeded UNAVAILABLE.
AVAILABLE_VALUES: dict[str, tuple[str, str, int]] = {
    # municipality display name -> (payment KRW, per-capita KRW, population)
    "동구": ("3835178000", "66187.6640", 57944),
    "서구": ("21001664200", "33122.2053", 634066),
    "광명시": ("23099780450", "84809.9851", 272371),
}
PARTIAL_VALUES: dict[str, tuple[str, str, int]] = {
    "부평구": ("10028548010", "19863.0342", 504885),
}


def _seed_regions(session: Session) -> dict[str, int]:
    """Seed the 2024 SIGUNGU rows a direct-population geography must reference."""

    rows: list[dict[str, Any]] = []
    for definition in EXPECTED_MUNICIPALITIES:
        codes = (
            [definition.canonical_region_code]
            if definition.canonical_region_code
            else list(definition.ward_region_codes)
        )
        for code in codes:
            rows.append(
                {
                    "region_code": code,
                    "region_name": f"{definition.metropolitan_name} {definition.display_name}",
                    "region_level": MUNICIPALITY_LEVEL_SIGUNGU,
                    "boundary_reference_period": "2024",
                    "valid_from": datetime.date(2024, 1, 1),
                    "valid_to": datetime.date(2024, 12, 31),
                }
            )
    session.execute(insert(REGIONS_NONSPATIAL), rows)
    session.commit()
    return dict(
        session.execute(select(REGIONS_NONSPATIAL.c.region_code, REGIONS_NONSPATIAL.c.id)).all()
    )


def _seed(session: Session) -> dict[str, int]:
    """Seed all 66 registry rows plus one indicator row each."""

    region_ids = _seed_regions(session)
    keys: dict[str, int] = {}
    for definition in EXPECTED_MUNICIPALITIES:
        name = definition.display_name
        available = name in AVAILABLE_VALUES
        partial = name in PARTIAL_VALUES
        payment, value, population = (AVAILABLE_VALUES | PARTIAL_VALUES).get(
            name, (None, None, None)
        )
        derived = definition.population_method == POPULATION_DERIVED_WARD_SUM
        # Every geography needs a positive population when AVAILABLE; the ones
        # with no indicator value still carry their denominator.
        geography_population = population if population is not None else 100_000
        geography = MunicipalCostGeography(
            municipality_key=definition.municipality_key,
            display_name=name,
            metropolitan_code=definition.metropolitan_code,
            metropolitan_name=definition.metropolitan_name,
            municipality_level=MUNICIPALITY_LEVEL_SIGUNGU,
            boundary_vintage=BOUNDARY_VINTAGE,
            direct_region_id=None,
            direct_region_code=definition.canonical_region_code,
            population_method=definition.population_method,
            population_definition=POPULATION_DEFINITION_SGIS,
            reference_year=2024,
            population=geography_population,
            evidence_status=(EVIDENCE_OFFICIAL_DERIVED if derived else EVIDENCE_OFFICIAL_REPORTED),
            status=STATUS_AVAILABLE,
            reason_codes=[],
            created_at=NOW,
            updated_at=NOW,
        )
        # A direct-population geography must name the region it read; a derived
        # one must not fabricate one (the CHECK constraint enforces both).
        geography.direct_region_id = (
            None if derived else region_ids[definition.canonical_region_code]
        )
        session.add(geography)
        session.flush()
        keys[name] = int(geography.id)

        if derived:
            for index, ward in enumerate(definition.ward_region_codes, start=1):
                session.add(
                    MunicipalCostGeographyComponent(
                        geography_id=geography.id,
                        component_region_id=region_ids[ward],
                        component_region_code=ward,
                        component_region_name=f"{definition.metropolitan_name} {name} 구{index}",
                        component_population=geography_population
                        // len(definition.ward_region_codes),
                        reference_year=2024,
                        population_definition=POPULATION_DEFINITION_SGIS,
                    )
                )

        if available or partial:
            status = STATUS_AVAILABLE if available else STATUS_PARTIAL
            session.add(
                MunicipalCostIndicatorValue(
                    geography_id=geography.id,
                    reference_year=2024,
                    indicator_code=MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
                    value=Decimal(value),
                    unit=INDICATOR_UNIT,
                    numerator_amount_krw=Decimal(payment),
                    denominator_population=population,
                    numerator_contract_count=3,
                    population_method=geography.population_method,
                    population_definition=POPULATION_DEFINITION_SGIS,
                    evidence_status=EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
                    status=status,
                    reason_codes=[REASON_PARTIAL_WASTE_SCOPE] if partial else [],
                    # The loader stores describe_reasons(reason_codes) verbatim
                    # (municipal_cost_ingestion.py). Seeding the same derivation
                    # keeps the fixture faithful to the shipped payload — an
                    # invented sentence would hide the one-sentence-per-code
                    # alignment the frontend pairs positionally.
                    limitations=(describe_reasons([REASON_PARTIAL_WASTE_SCOPE]) if partial else []),
                    methodology_version=METHODOLOGY_VERSION,
                    ingestion_run_id=None,
                    computed_at=NOW,
                )
            )
        else:
            reasons = (
                [REASON_MISSING_PAYMENT]
                if definition.metropolitan_code == METROPOLITAN_SEOUL
                else [REASON_NO_SOURCE_FILE]
            )
            session.add(
                MunicipalCostIndicatorValue(
                    geography_id=geography.id,
                    reference_year=2024,
                    indicator_code=MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
                    value=None,
                    unit=INDICATOR_UNIT,
                    numerator_amount_krw=None,
                    denominator_population=None,
                    numerator_contract_count=0,
                    population_method=geography.population_method,
                    population_definition=None,
                    evidence_status=EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
                    status=STATUS_UNAVAILABLE,
                    reason_codes=reasons,
                    limitations=describe_reasons(reasons),
                    methodology_version=METHODOLOGY_VERSION,
                    ingestion_run_id=None,
                    computed_at=NOW,
                )
            )
    session.commit()
    return keys


def _seed_sources(session: Session, keys: dict[str, int]) -> None:
    """One accepted DATA_A file, one accepted DATA_B file, and one rejected file."""

    session.add_all(
        [
            MunicipalCostSourceFile(
                relative_path="DATA_A/경기도(…)/광명시.xlsx",
                filename="광명시.xlsx",
                sha256="a" * 64,
                file_size_bytes=1234,
                dataset_role="DATA_A",
                region_folder="경기도(…)",
                workbook_sheet="Sheet1",
                used_range="A1:I98",
                layout_family=LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS,
                source_municipality_name="광명시청",
                resolved_geography_id=keys["광명시"],
                resolution_basis="WORKBOOK_ORGANISATION_NAME",
                resolution_evidence="워크북 기관명 셀: 광명시청",
                reference_year=2024,
                boundary_vintage=BOUNDARY_VINTAGE,
                primary_classification=CLASS_DATA_A_PAYMENT_AND_QUANTITY,
                ingestion_decision=INGESTION_DECISION_ACCEPTED,
                rejection_reasons=[],
                source_notes=[],
                ingestion_run_id=None,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=NOW,
            ),
            MunicipalCostSourceFile(
                relative_path="DATA_B/서울/종로구.xlsx",
                filename="종로구.xlsx",
                sha256="b" * 64,
                file_size_bytes=999,
                dataset_role="DATA_B",
                region_folder="서울",
                workbook_sheet="2024년",
                used_range="A1:N5",
                layout_family=LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID,
                source_municipality_name=None,
                resolved_geography_id=keys["종로구"],
                resolution_basis="FILENAME",
                resolution_evidence="파일명: 종로구.xlsx",
                reference_year=2024,
                boundary_vintage=BOUNDARY_VINTAGE,
                primary_classification=CLASS_DATA_B_QUANTITY_VALIDATION,
                ingestion_decision=INGESTION_DECISION_ACCEPTED,
                rejection_reasons=[],
                source_notes=[],
                ingestion_run_id=None,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=NOW,
            ),
            MunicipalCostSourceFile(
                relative_path="DATA_B/인천/서해구xlsx.xlsx",
                filename="서해구xlsx.xlsx",
                sha256="c" * 64,
                file_size_bytes=888,
                dataset_role="DATA_B",
                region_folder="인천",
                workbook_sheet="2024년",
                used_range="A1:N9",
                layout_family=LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID,
                source_municipality_name=None,
                resolved_geography_id=None,
                resolution_basis="UNRESOLVED",
                resolution_evidence="2024년 행정구역이 아닙니다.",
                reference_year=2024,
                boundary_vintage=BOUNDARY_VINTAGE,
                primary_classification="BOUNDARY_MISMATCH",
                ingestion_decision=INGESTION_DECISION_REJECTED,
                rejection_reasons=["BOUNDARY_MISMATCH", "AMBIGUOUS_REGION_MAPPING"],
                source_notes=[],
                ingestion_run_id=None,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=NOW,
            ),
        ]
    )
    session.commit()


def _seed_quantities(session: Session, keys: dict[str, int]) -> None:
    file_row = session.scalars(
        select(MunicipalCostSourceFile).where(MunicipalCostSourceFile.sha256 == "a" * 64)
    ).one()
    session.add_all(
        [
            MunicipalWasteQuantity(
                source_file_id=file_row.id,
                contract_id=None,
                geography_id=keys["광명시"],
                source_row=2,
                source_column=6,
                source_label="시 전체 수거량: 1월",
                source_repetition_rows=[2, 14, 26],
                reference_year=2024,
                reference_month="2024-01",
                quantity_period="MONTHLY",
                waste_category="COMBINED",
                destination_name="시 전체 수거량",
                treatment_method=None,
                quantity_value=Decimal("5882.0300"),
                quantity_unit=QUANTITY_UNIT_TONNE,
                value_state=VALUE_MEASURED,
                attribution=ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
                evidence_status=EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
                limitation_reasons=[],
                ingestion_run_id=None,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=NOW,
            ),
            MunicipalWasteQuantity(
                source_file_id=file_row.id,
                contract_id=None,
                geography_id=keys["광명시"],
                source_row=3,
                source_column=6,
                source_label="시 전체 수거량: 2월",
                source_repetition_rows=[3, 15, 27],
                reference_year=2024,
                reference_month="2024-02",
                quantity_period="MONTHLY",
                waste_category="COMBINED",
                destination_name="시 전체 수거량",
                treatment_method=None,
                quantity_value=None,
                quantity_unit=QUANTITY_UNIT_TONNE,
                value_state=VALUE_SOURCE_DASH_NO_DATA,
                attribution=ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
                evidence_status=EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
                limitation_reasons=[],
                ingestion_run_id=None,
                transformation_version=TRANSFORMATION_VERSION,
                imported_at=NOW,
            ),
        ]
    )
    session.commit()


@pytest.fixture
def seeded(session: Session) -> dict[str, int]:
    keys = _seed(session)
    _seed_sources(session, keys)
    _seed_quantities(session, keys)
    return keys


def get(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get(ENDPOINT, params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Scope and counts
# ---------------------------------------------------------------------------


def test_full_scope_returns_all_66_municipalities(
    client: TestClient, seeded: dict[str, int]
) -> None:
    payload = get(client)
    assert len(payload["municipalities"]) == 66
    assert payload["meta"]["expected_count"] == 66
    assert payload["meta"]["returned_count"] == 66
    counts = payload["meta"]
    assert counts["available_count"] + counts["partial_count"] + counts["unavailable_count"] == 66


def test_counts_are_derived_from_stored_rows(client: TestClient, seeded: dict[str, int]) -> None:
    meta = get(client)["meta"]
    assert meta["available_count"] == len(AVAILABLE_VALUES)
    assert meta["partial_count"] == len(PARTIAL_VALUES)
    assert meta["unavailable_count"] == 66 - len(AVAILABLE_VALUES) - len(PARTIAL_VALUES)


@pytest.mark.parametrize(
    ("sido", "expected"),
    [(METROPOLITAN_SEOUL, 25), (METROPOLITAN_INCHEON, 10), (METROPOLITAN_GYEONGGI, 31)],
)
def test_sido_filter_returns_the_full_metropolitan_scope(
    client: TestClient, seeded: dict[str, int], sido: str, expected: int
) -> None:
    payload = get(client, sido=sido)
    assert len(payload["municipalities"]) == expected
    assert payload["meta"]["expected_count"] == expected
    assert {row["metropolitan_code"] for row in payload["municipalities"]} == {sido}


def test_status_filter_narrows_rows_but_not_the_scope_counts(
    client: TestClient, seeded: dict[str, int]
) -> None:
    payload = get(client, status=STATUS_AVAILABLE)
    assert {row["status"] for row in payload["municipalities"]} == {STATUS_AVAILABLE}
    assert payload["meta"]["returned_count"] == len(AVAILABLE_VALUES)
    # The honest denominators are unchanged by a status filter.
    assert payload["meta"]["expected_count"] == 66
    assert payload["meta"]["unavailable_count"] == 66 - len(AVAILABLE_VALUES) - len(PARTIAL_VALUES)


def test_combined_filters(client: TestClient, seeded: dict[str, int]) -> None:
    payload = get(client, sido=METROPOLITAN_INCHEON, status=STATUS_PARTIAL)
    names = [row["display_name"] for row in payload["municipalities"]]
    assert names == ["부평구"]


def test_unknown_sido_is_rejected(client: TestClient, seeded: dict[str, int]) -> None:
    assert client.get(ENDPOINT, params={"sido": "99"}).status_code == 422


def test_unsupported_year_is_rejected(client: TestClient, seeded: dict[str, int]) -> None:
    assert client.get(ENDPOINT, params={"year": 2023}).status_code == 422


def test_supported_year_is_accepted_as_a_query_string(
    client: TestClient, seeded: dict[str, int]
) -> None:
    """``?year=2024`` must be accepted.

    A query value always arrives as the string ``"2024"``. Declaring the
    parameter as ``Literal[2024]`` made this exact request a 422 while
    ``test_unsupported_year_is_rejected`` still passed, so the rejection case
    alone does not pin the contract — the acceptance case has to be asserted too.
    """

    response = client.get(ENDPOINT, params={"year": "2024"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["reference_year"] == 2024
    assert len(payload["municipalities"]) == len(get(client)["municipalities"])


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------


def test_payment_per_capita_desc_puts_nulls_last(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = get(client, sort="payment_per_capita_desc")["municipalities"]
    values = [row["payment_per_capita_krw"] for row in rows]
    valued = [Decimal(value) for value in values if value is not None]
    assert valued == sorted(valued, reverse=True)
    assert values[len(valued) :] == [None] * (len(values) - len(valued))
    assert rows[0]["display_name"] == "광명시"


def test_total_payment_desc(client: TestClient, seeded: dict[str, int]) -> None:
    rows = get(client, sort="total_payment_desc")["municipalities"]
    assert rows[0]["display_name"] == "광명시"
    assert rows[1]["display_name"] == "서구"
    # The same nulls-last promise the per-capita sort makes. Asserted here too
    # because the two orderings are separate lambdas and only one of them was
    # pinned; a null total must never be ordered as if it were the cheapest.
    values = [row["total_eligible_payment_krw"] for row in rows]
    valued = [Decimal(value) for value in values if value is not None]
    assert valued == sorted(valued, reverse=True)
    assert values[len(valued) :] == [None] * (len(values) - len(valued))


def test_region_name_asc_is_grouped_by_metropolitan(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = get(client, sort="region_name_asc")["municipalities"]
    ordered = [(row["metropolitan_code"], row["display_name"]) for row in rows]
    assert ordered == sorted(ordered)


def test_unknown_sort_is_rejected(client: TestClient, seeded: dict[str, int]) -> None:
    assert client.get(ENDPOINT, params={"sort": "cheapest"}).status_code == 422


# ---------------------------------------------------------------------------
# Null, never zero
# ---------------------------------------------------------------------------


def test_unavailable_rows_serve_null_not_zero(client: TestClient, seeded: dict[str, int]) -> None:
    rows = get(client)["municipalities"]
    unavailable = [row for row in rows if row["status"] == STATUS_UNAVAILABLE]
    assert unavailable
    for row in unavailable:
        assert row["payment_per_capita_krw"] is None
        assert row["total_eligible_payment_krw"] is None
        assert row["eligible_contract_count"] == 0
        assert row["reason_codes"]


def test_available_rows_expose_both_inputs(client: TestClient, seeded: dict[str, int]) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    kwangmyeong = rows["광명시"]
    assert kwangmyeong["payment_per_capita_krw"] == "84809.9851"
    assert kwangmyeong["total_eligible_payment_krw"] == "23099780450.00"
    assert kwangmyeong["population"] == 272371
    assert kwangmyeong["evidence_status"] == EVIDENCE_LOCAL_GOVERNMENT_DERIVED


def test_partial_rows_carry_their_reason(client: TestClient, seeded: dict[str, int]) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    bupyeong = rows["부평구"]
    assert bupyeong["status"] == STATUS_PARTIAL
    assert bupyeong["payment_per_capita_krw"] is not None
    assert REASON_PARTIAL_WASTE_SCOPE in bupyeong["reason_codes"]
    assert bupyeong["limitations"]


# ---------------------------------------------------------------------------
# Geography and provenance detail
# ---------------------------------------------------------------------------


def test_derived_cities_expose_their_ward_components(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    for name in ("수원시", "성남시", "안양시", "부천시", "안산시", "고양시", "용인시"):
        row = rows[name]
        assert row["population_method"] == POPULATION_DERIVED_WARD_SUM
        assert row["direct_region_code"] is None
        assert len(row["population_components"]) >= 2


def test_direct_municipalities_expose_their_canonical_region_code(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    assert rows["종로구"]["population_method"] == POPULATION_DIRECT
    assert rows["종로구"]["direct_region_code"] == "KR-SGIS-11010"
    assert rows["종로구"]["population_components"] == []


def test_no_2026_incheon_district_is_served(client: TestClient, seeded: dict[str, int]) -> None:
    names = {
        row["display_name"] for row in get(client, sido=METROPOLITAN_INCHEON)["municipalities"]
    }
    assert names.isdisjoint({"제물포구", "영종구", "서해구", "검단구"})
    assert names == {
        "중구",
        "동구",
        "미추홀구",
        "연수구",
        "남동구",
        "부평구",
        "계양구",
        "서구",
        "강화군",
        "옹진군",
    }


def test_boundary_vintage_is_2024_everywhere(client: TestClient, seeded: dict[str, int]) -> None:
    rows = get(client)["municipalities"]
    assert {row["boundary_vintage"] for row in rows} == {"2024"}


def test_source_provenance_and_dataset_role_flags(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    kwangmyeong = rows["광명시"]
    assert kwangmyeong["has_data_a"] is True
    assert kwangmyeong["has_data_b"] is False
    assert kwangmyeong["source_files"][0]["filename"] == "광명시.xlsx"
    jongno = rows["종로구"]
    assert jongno["has_data_a"] is False
    assert jongno["has_data_b"] is True


def test_quantity_coverage_counts_missing_separately_from_zero(
    client: TestClient, seeded: dict[str, int]
) -> None:
    rows = {row["display_name"]: row for row in get(client)["municipalities"]}
    coverage = rows["광명시"]["quantity_coverage"]
    assert coverage["observation_count"] == 2
    assert coverage["measured_count"] == 1
    assert coverage["measured_zero_count"] == 0
    assert coverage["missing_count"] == 1
    assert coverage["repeated_municipal_block_count"] == 2
    assert coverage["months_covered"] == 2


# ---------------------------------------------------------------------------
# Metadata — the response must disclaim the official landfill dataset
# ---------------------------------------------------------------------------


def test_metadata_names_the_indicator_and_its_basis(
    client: TestClient, seeded: dict[str, int]
) -> None:
    meta = get(client)["meta"]
    assert meta["indicator_code"] == "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA"
    assert meta["display_name"] == INDICATOR_DISPLAY_NAME_KO
    assert meta["unit"] == "KRW/인"
    assert meta["reference_year"] == 2024
    assert meta["accounting_basis"] == ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT
    assert meta["methodology_version"] == METHODOLOGY_VERSION
    assert meta["geography_policy"]
    assert meta["population_policy"]
    assert meta["numerator_definition"]


def test_metadata_states_it_is_not_the_official_landfill_fee(
    client: TestClient, seeded: dict[str, int]
) -> None:
    meta = get(client)["meta"]
    assert meta["is_official_landfill_fee"] is False
    assert "LANDFILL_INBOUND_FEE_PER_CAPITA" in meta["difference_from_official_landfill_fee"]
    assert any("수도권매립지" in caveat for caveat in meta["caveats"])
    # The accounting basis is not the landfill one.
    assert meta["accounting_basis"] != "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"


def test_metadata_lists_rejected_source_files(client: TestClient, seeded: dict[str, int]) -> None:
    meta = get(client)["meta"]
    assert meta["rejected_source_file_count"] == 1
    rejected = meta["rejected_source_files"][0]
    assert rejected["filename"] == "서해구xlsx.xlsx"
    assert "BOUNDARY_MISMATCH" in rejected["reason_codes"]
    assert rejected["explanation"]


def test_metadata_source_coverage(client: TestClient, seeded: dict[str, int]) -> None:
    coverage = get(client)["meta"]["source_coverage"]
    assert coverage["discovered_file_count"] == 3
    assert coverage["accepted_file_count"] == 2
    assert coverage["rejected_file_count"] == 1
    assert coverage["data_a_file_count"] == 1
    assert coverage["data_b_file_count"] == 2
    assert coverage["municipalities_with_data_a"] == 1
    assert coverage["municipalities_with_data_b"] == 1
    assert coverage["municipalities_with_no_source_file"] == 64


def test_deferred_landfill_estimate_is_not_exposed(
    client: TestClient, seeded: dict[str, int]
) -> None:
    body = client.get(ENDPOINT).text
    assert "MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE" not in body


def test_empty_database_serves_no_rows_rather_than_zeros(client: TestClient) -> None:
    payload = get(client)
    assert payload["municipalities"] == []
    assert payload["meta"]["available_count"] == 0
    assert payload["meta"]["expected_count"] == 66
