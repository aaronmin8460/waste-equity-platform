"""Regression guard: the official landfill contract is unchanged by Step 2.

The 2024 municipal waste-cost release adds a *separate* accounting basis. This
suite fails if anything in it drifts into the official Sudokwon Landfill
inbound-fee contract — the constants, the model definition, the served indicator
name, or the rows of ``landfill_inbound_monthly``.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from waste_equity_backend.analysis import landfill as landfill_analysis
from waste_equity_backend.api.routes import landfill as landfill_routes
from waste_equity_backend.models import (
    DataSource,
    IngestionRun,
    LandfillInboundMonthly,
    MunicipalCostGeography,
)
from waste_equity_backend.models.landfill_inbound import (
    ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
    ALLOWED_ORIGIN_REGION_CODES,
    DESTINATION_SUDOKWON_LANDFILL,
    EVIDENCE_OFFICIAL_DERIVED,
    EVIDENCE_OFFICIAL_REPORTED,
    FEE_SOURCE_DATASET_ID,
    ORIGIN_LEVEL_METROPOLITAN,
    QUANTITY_SOURCE_DATASET_ID,
)
from waste_equity_backend.models.municipal_cost import (
    ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
)

NOW = datetime.datetime(2026, 8, 5, tzinfo=datetime.UTC)


# ---------------------------------------------------------------------------
# Constants and vocabulary
# ---------------------------------------------------------------------------


def test_official_landfill_constants_are_unchanged() -> None:
    assert ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW == (
        "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"
    )
    assert ALLOWED_ORIGIN_REGION_CODES == ("KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41")
    assert ORIGIN_LEVEL_METROPOLITAN == "SIDO"
    assert DESTINATION_SUDOKWON_LANDFILL == "SUDOKWON_LANDFILL"
    assert QUANTITY_SOURCE_DATASET_ID == "15064381"
    assert FEE_SOURCE_DATASET_ID == "15064394"
    assert EVIDENCE_OFFICIAL_REPORTED == "OFFICIAL_REPORTED_VALUE"
    assert EVIDENCE_OFFICIAL_DERIVED == "OFFICIAL_INPUTS_DERIVED_VALUE"


def test_landfill_fee_per_capita_indicator_contract_is_unchanged() -> None:
    assert landfill_analysis.PER_CAPITA_INDICATOR == "LANDFILL_INBOUND_FEE_PER_CAPITA"
    assert landfill_analysis.PER_CAPITA_DERIVATION_VERSION == "landfill-fee-per-capita-v2"


def test_the_two_indicators_are_distinct_in_every_identifier() -> None:
    assert (
        MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA != landfill_analysis.PER_CAPITA_INDICATOR
    )
    assert ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT != ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW
    # Neither name contains the other, so a substring filter cannot conflate them.
    assert (
        landfill_analysis.PER_CAPITA_INDICATOR
        not in MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA
    )


def test_landfill_model_columns_are_unchanged() -> None:
    columns = {column.name for column in LandfillInboundMonthly.__table__.columns}
    assert columns == {
        "id",
        "reference_month",
        "reference_year",
        "origin_region_code",
        "origin_source_name",
        "origin_region_level",
        "destination_code",
        "waste_name",
        "quantity_kg",
        "inbound_fee_krw",
        "quantity_unit",
        "fee_currency",
        "accounting_basis",
        "quantity_source_dataset_id",
        "quantity_source_snapshot_uuid",
        "quantity_source_snapshot_date",
        "fee_source_dataset_id",
        "fee_source_snapshot_uuid",
        "fee_source_snapshot_date",
        "quantity_evidence_status",
        "fee_evidence_status",
        "retrieved_at",
        "transformation_version",
        "quantity_raw_response_id",
        "fee_raw_response_id",
        "ingestion_run_id",
        "created_at",
        "updated_at",
    }
    # No foreign key was added from the official table to the municipal tables.
    referred = {
        key.column.table.name
        for column in LandfillInboundMonthly.__table__.columns
        for key in column.foreign_keys
    }
    assert referred.isdisjoint(
        {
            "municipal_cost_geographies",
            "municipal_cost_source_files",
            "municipal_waste_contracts",
            "municipal_waste_quantities",
            "municipal_cost_indicator_values",
        }
    )


def test_landfill_route_prefix_and_paths_are_unchanged() -> None:
    paths = {route.path for route in landfill_routes.router.routes}  # type: ignore[attr-defined]
    assert {
        "/api/v1/landfill/summary",
        "/api/v1/landfill/trends",
        "/api/v1/landfill/composition",
        "/api/v1/landfill/flows",
    }.issubset(paths)
    # The municipal endpoint lives in its own router, so the landfill router is
    # exactly what it was.
    assert "/api/v1/landfill/municipal-costs" not in paths


# ---------------------------------------------------------------------------
# Row-level separation
# ---------------------------------------------------------------------------


def _seed_official_row(session: Session) -> None:
    """One SYNTHETIC official row, exactly at the metropolitan grain the table allows."""

    session.execute(
        insert(DataSource).values(
            source_id=QUANTITY_SOURCE_DATASET_ID,
            source_name="TEST",
            dataset_name="TEST",
            endpoint="test",
            publication_frequency="MONTHLY",
            enabled=True,
        )
    )
    run_id = session.scalar(
        insert(IngestionRun)
        .values(
            source_id=QUANTITY_SOURCE_DATASET_ID,
            started_at=NOW,
            status="SUCCEEDED",
            transformation_version="test",
        )
        .returning(IngestionRun.run_id)
    )
    session.execute(
        insert(LandfillInboundMonthly).values(
            reference_month="2024-01",
            reference_year=2024,
            origin_region_code="KR-SGIS-11",
            origin_source_name="서울시",
            origin_region_level=ORIGIN_LEVEL_METROPOLITAN,
            destination_code=DESTINATION_SUDOKWON_LANDFILL,
            waste_name="생활폐기물",
            quantity_kg=Decimal("1000.000"),
            inbound_fee_krw=Decimal("50000.00"),
            quantity_unit="kg",
            fee_currency="KRW",
            accounting_basis=ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
            quantity_source_dataset_id=QUANTITY_SOURCE_DATASET_ID,
            quantity_source_snapshot_uuid="test",
            quantity_source_snapshot_date=None,
            fee_source_dataset_id=FEE_SOURCE_DATASET_ID,
            fee_source_snapshot_uuid="test",
            fee_source_snapshot_date=None,
            quantity_evidence_status=EVIDENCE_OFFICIAL_REPORTED,
            fee_evidence_status=EVIDENCE_OFFICIAL_REPORTED,
            retrieved_at=NOW,
            transformation_version="test",
            quantity_raw_response_id=None,
            fee_raw_response_id=None,
            ingestion_run_id=run_id,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()


def test_landfill_rows_stay_metropolitan_only(session: Session) -> None:
    """Every stored origin is one of the three 광역 units, never a municipality."""

    _seed_official_row(session)
    rows = session.scalars(select(LandfillInboundMonthly)).all()
    assert rows
    for row in rows:
        assert row.origin_region_level == ORIGIN_LEVEL_METROPOLITAN
        assert row.origin_region_code in ALLOWED_ORIGIN_REGION_CODES
        assert row.accounting_basis == ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW


def test_no_municipality_key_appears_in_the_landfill_table(session: Session) -> None:
    _seed_official_row(session)
    origins = set(session.scalars(select(LandfillInboundMonthly.origin_region_code)).all())
    municipal = set(session.scalars(select(MunicipalCostGeography.direct_region_code)).all())
    assert origins.isdisjoint(municipal)
    assert (
        session.scalar(
            select(func.count())
            .select_from(LandfillInboundMonthly)
            .where(LandfillInboundMonthly.origin_region_level != ORIGIN_LEVEL_METROPOLITAN)
        )
        == 0
    )


def test_landfill_summary_still_serves_its_own_indicator(
    client: TestClient, session: Session
) -> None:
    """The official endpoint's payload is unaffected by the municipal release."""

    _seed_official_row(session)
    response = client.get("/api/v1/landfill/summary")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["accounting_basis"] == ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW
    assert payload["destination_code"] == DESTINATION_SUDOKWON_LANDFILL
    assert payload["fee_per_capita"]["indicator"] == "LANDFILL_INBOUND_FEE_PER_CAPITA"
    assert payload["fee_per_capita"]["derivation_version"] == "landfill-fee-per-capita-v2"
    # The municipal indicator never appears in an official landfill response.
    assert MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA not in response.text
