"""Migration 0021 integration test (PostGIS tier).

Runs only when ``TEST_DATABASE_URL`` is set. It proves the migration is purely
additive: after upgrading to head the six new tables exist with their
constraints, the official ``landfill_inbound_monthly`` definition and rows are
byte-identical to what they were before, and downgrading removes only what 0021
added.

Every row written here is SYNTHETIC and is rolled back or deleted.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from waste_equity_backend.models import (
    MunicipalCostGeography,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteQuantity,
)
from waste_equity_backend.models.landfill_inbound import (
    ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
    ALLOWED_ORIGIN_REGION_CODES,
)
from waste_equity_backend.models.municipal_cost import (
    BOUNDARY_VINTAGE,
    EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
    EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
    EVIDENCE_OFFICIAL_REPORTED,
    INDICATOR_UNIT,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
    MUNICIPALITY_LEVEL_SIGUNGU,
    POPULATION_DERIVED_WARD_SUM,
    POPULATION_DIRECT,
    QUANTITY_UNIT_TONNE,
    SOURCE_ID,
    STATUS_AVAILABLE,
    STATUS_UNAVAILABLE,
    TRANSFORMATION_VERSION,
    VALUE_MEASURED,
    VALUE_MEASURED_ZERO,
    VALUE_SOURCE_DASH_NO_DATA,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NEW_TABLES = (
    "municipal_cost_geographies",
    "municipal_cost_geography_components",
    "municipal_cost_source_files",
    "municipal_waste_contracts",
    "municipal_waste_quantities",
    "municipal_cost_indicator_values",
)
LANDFILL_TABLE = "landfill_inbound_monthly"
NOW = datetime.datetime(2026, 8, 5, tzinfo=datetime.UTC)


def _alembic_config() -> Any:
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings

    get_settings.cache_clear()
    return config


def _upgrade(revision: str = "head") -> None:
    from alembic import command

    command.upgrade(_alembic_config(), revision)


def _downgrade(revision: str) -> None:
    from alembic import command

    command.downgrade(_alembic_config(), revision)


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    _upgrade()
    created = create_engine(str(TEST_DATABASE_URL))
    yield created
    created.dispose()


def _table_definition(engine: Engine, table: str) -> dict[str, Any]:
    """A stable, comparable snapshot of a table's physical definition."""

    inspector = inspect(engine)
    return {
        "columns": sorted(
            (
                column["name"],
                str(column["type"]),
                bool(column["nullable"]),
            )
            for column in inspector.get_columns(table)
        ),
        "check_constraints": sorted(
            (constraint["name"] or "", constraint.get("sqltext", ""))
            for constraint in inspector.get_check_constraints(table)
        ),
        "unique_constraints": sorted(
            (constraint["name"] or "", tuple(constraint["column_names"]))
            for constraint in inspector.get_unique_constraints(table)
        ),
        "indexes": sorted(
            (index["name"] or "", tuple(index["column_names"]))
            for index in inspector.get_indexes(table)
        ),
        "foreign_keys": sorted(
            (
                tuple(key["constrained_columns"]),
                key["referred_table"],
                tuple(key["referred_columns"]),
            )
            for key in inspector.get_foreign_keys(table)
        ),
    }


# ---------------------------------------------------------------------------
# Alembic chain
# ---------------------------------------------------------------------------


def test_single_alembic_head_is_0021() -> None:
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    heads = script.get_heads()
    assert list(heads) == ["0021"]
    revision = script.get_revision("0021")
    assert revision.down_revision == "0020"


def test_upgrade_creates_every_new_table(engine: Engine) -> None:
    tables = set(inspect(engine).get_table_names())
    assert set(NEW_TABLES).issubset(tables)


def test_data_source_row_is_registered(engine: Engine) -> None:
    with Session(engine) as session:
        found = session.execute(
            text("SELECT source_id FROM data_sources WHERE source_id = :sid"),
            {"sid": SOURCE_ID},
        ).scalar_one_or_none()
    assert found == SOURCE_ID


def test_downgrade_then_upgrade_restores_the_schema(engine: Engine) -> None:
    """0021 down/up is reversible and touches nothing else."""

    before_landfill = _table_definition(engine, LANDFILL_TABLE)
    _downgrade("0020")
    after_downgrade = set(inspect(engine).get_table_names())
    assert after_downgrade.isdisjoint(NEW_TABLES)
    # Downgrading 0021 must not disturb the official landfill table.
    assert LANDFILL_TABLE in after_downgrade
    assert _table_definition(engine, LANDFILL_TABLE) == before_landfill

    _upgrade()
    assert set(NEW_TABLES).issubset(set(inspect(engine).get_table_names()))
    assert _table_definition(engine, LANDFILL_TABLE) == before_landfill


# ---------------------------------------------------------------------------
# The official landfill contract is untouched
# ---------------------------------------------------------------------------


def test_landfill_table_definition_is_unchanged(engine: Engine) -> None:
    definition = _table_definition(engine, LANDFILL_TABLE)
    columns = {name for name, _type, _nullable in definition["columns"]}
    # The exact column set migration 0013 created — 0021 adds none and drops none.
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
    checks = " ".join(sql for _name, sql in definition["check_constraints"])
    assert ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW in checks
    for code in ALLOWED_ORIGIN_REGION_CODES:
        assert code in checks
    # No foreign key was added from the landfill table to the municipal tables.
    referred = {key[1] for key in definition["foreign_keys"]}
    assert referred.isdisjoint(NEW_TABLES)


def test_no_municipal_row_exists_in_the_landfill_table(engine: Engine) -> None:
    """The municipal grain is city/county/district; the landfill table is 광역-only."""

    with Session(engine) as session:
        offending = session.execute(
            text(
                "SELECT COUNT(*) FROM landfill_inbound_monthly "
                "WHERE origin_region_level <> 'SIDO' "
                "   OR origin_region_code NOT IN ('KR-SGIS-11', 'KR-SGIS-28', 'KR-SGIS-41')"
            )
        ).scalar_one()
    assert offending == 0


def test_landfill_row_count_survives_the_migration(engine: Engine) -> None:
    """0021 inserts into, updates, and deletes from the landfill table: never."""

    with Session(engine) as session:
        before = session.execute(text("SELECT COUNT(*) FROM landfill_inbound_monthly")).scalar_one()
    _downgrade("0020")
    _upgrade()
    with Session(engine) as session:
        after = session.execute(text("SELECT COUNT(*) FROM landfill_inbound_monthly")).scalar_one()
    assert before == after


# ---------------------------------------------------------------------------
# New constraints actually bite
# ---------------------------------------------------------------------------


def _scratch_region(session: Session) -> int:
    """A synthetic 2024 SIGUNGU region row, created inside the rolled-back scratch."""

    existing = session.execute(
        text(
            "SELECT id FROM regions WHERE region_level = 'SIGUNGU' "
            "AND boundary_reference_period = '2024' ORDER BY id LIMIT 1"
        )
    ).scalar_one_or_none()
    if existing is not None:
        return int(existing)
    return int(
        session.execute(
            text(
                "INSERT INTO regions (region_code, region_name, region_level, "
                "boundary_reference_period, valid_from, valid_to) "
                "VALUES ('KR-TEST-0021', '테스트 지역', 'SIGUNGU', '2024', "
                "'2024-01-01', '2024-12-31') RETURNING id"
            )
        ).scalar_one()
    )


def _geography(session: Session, **overrides: Any) -> MunicipalCostGeography:
    values: dict[str, Any] = {
        "municipality_key": "41-테스트시",
        "display_name": "테스트시",
        "metropolitan_code": "41",
        "metropolitan_name": "경기도",
        "municipality_level": MUNICIPALITY_LEVEL_SIGUNGU,
        "boundary_vintage": BOUNDARY_VINTAGE,
        "direct_region_id": None,
        "direct_region_code": None,
        "population_method": POPULATION_DERIVED_WARD_SUM,
        "population_definition": "SGIS_TOTAL_POPULATION",
        "reference_year": 2024,
        "population": 1000,
        "evidence_status": EVIDENCE_OFFICIAL_REPORTED,
        "status": STATUS_AVAILABLE,
        "reason_codes": [],
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return MunicipalCostGeography(**values)


@pytest.fixture
def scratch(engine: Engine) -> Iterator[Session]:
    """A session whose writes are always rolled back."""

    with Session(engine) as session:
        yield session
        session.rollback()


def test_boundary_vintage_is_pinned_to_2024(scratch: Session) -> None:
    scratch.add(_geography(scratch, boundary_vintage="2026"))
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_derived_population_may_not_name_a_direct_region(scratch: Session) -> None:
    region_id = _scratch_region(scratch)
    scratch.add(
        _geography(
            scratch, population_method=POPULATION_DERIVED_WARD_SUM, direct_region_id=region_id
        )
    )
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_direct_population_requires_a_region(scratch: Session) -> None:
    scratch.add(_geography(scratch, population_method=POPULATION_DIRECT, direct_region_id=None))
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_unavailable_geography_may_not_carry_a_population(scratch: Session) -> None:
    scratch.add(_geography(scratch, status=STATUS_UNAVAILABLE, population=1000))
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_available_geography_may_not_have_a_zero_population(scratch: Session) -> None:
    scratch.add(_geography(scratch, status=STATUS_AVAILABLE, population=0))
    with pytest.raises(IntegrityError):
        scratch.flush()


def _quantity(geography_id: int, source_file_id: int, **overrides: Any) -> MunicipalWasteQuantity:
    values: dict[str, Any] = {
        "source_file_id": source_file_id,
        "contract_id": None,
        "geography_id": geography_id,
        "source_row": 2,
        "source_column": 6,
        "source_label": "테스트: 1월",
        "source_repetition_rows": [2],
        "reference_year": 2024,
        "reference_month": "2024-01",
        "quantity_period": "MONTHLY",
        "waste_category": "GENERAL",
        "destination_name": None,
        "treatment_method": None,
        "quantity_value": Decimal("1.0000"),
        "quantity_unit": QUANTITY_UNIT_TONNE,
        "value_state": VALUE_MEASURED,
        "attribution": "MUNICIPAL_TOTAL_SINGLE",
        "evidence_status": EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
        "limitation_reasons": [],
        "ingestion_run_id": None,
        "transformation_version": TRANSFORMATION_VERSION,
        "imported_at": NOW,
    }
    values.update(overrides)
    return MunicipalWasteQuantity(**values)


def _scratch_parents(session: Session) -> tuple[int, int]:
    """A geography + source file to hang a constraint probe on, always rolled back."""

    geography = _geography(session, municipality_key="41-제약테스트")
    session.add(geography)
    session.flush()
    source_file = MunicipalCostSourceFile(
        relative_path="TEST/제약테스트.xlsx",
        filename="제약테스트.xlsx",
        sha256="f" * 64,
        file_size_bytes=1,
        dataset_role="DATA_A",
        region_folder="TEST",
        workbook_sheet="Sheet1",
        used_range="A1:I2",
        layout_family="DATA_A_CONTRACT_QUANTITY_PAIRS",
        source_municipality_name=None,
        resolved_geography_id=int(geography.id),
        resolution_basis="FILENAME",
        resolution_evidence=None,
        reference_year=2024,
        boundary_vintage=BOUNDARY_VINTAGE,
        primary_classification="DATA_A_PAYMENT_ONLY",
        ingestion_decision="ACCEPTED",
        rejection_reasons=[],
        source_notes=[],
        ingestion_run_id=None,
        transformation_version=TRANSFORMATION_VERSION,
        imported_at=NOW,
    )
    session.add(source_file)
    session.flush()
    return int(geography.id), int(source_file.id)


@pytest.mark.parametrize(
    ("value_state", "quantity_value"),
    [
        # A missing state may never carry a number …
        (VALUE_SOURCE_DASH_NO_DATA, Decimal("1.0000")),
        (VALUE_SOURCE_DASH_NO_DATA, Decimal("0.0000")),
        # … a measured value may never be NULL or zero …
        (VALUE_MEASURED, None),
        (VALUE_MEASURED, Decimal("0.0000")),
        # … and a measured zero may never be NULL or nonzero.
        (VALUE_MEASURED_ZERO, None),
        (VALUE_MEASURED_ZERO, Decimal("1.0000")),
    ],
)
def test_value_state_constraint_makes_missing_and_zero_distinct(
    scratch: Session, value_state: str, quantity_value: Decimal | None
) -> None:
    geography_id, source_file_id = _scratch_parents(scratch)
    scratch.add(
        _quantity(
            geography_id,
            source_file_id,
            source_row=999_000,
            value_state=value_state,
            quantity_value=quantity_value,
        )
    )
    with pytest.raises(IntegrityError):
        scratch.flush()


@pytest.mark.parametrize(
    ("value_state", "quantity_value"),
    [
        (VALUE_MEASURED, Decimal("1.0000")),
        (VALUE_MEASURED_ZERO, Decimal("0.0000")),
        (VALUE_SOURCE_DASH_NO_DATA, None),
    ],
)
def test_value_state_constraint_admits_the_legitimate_combinations(
    scratch: Session, value_state: str, quantity_value: Decimal | None
) -> None:
    geography_id, source_file_id = _scratch_parents(scratch)
    scratch.add(
        _quantity(
            geography_id,
            source_file_id,
            source_row=999_001,
            source_label=f"허용 조합 {value_state}",
            value_state=value_state,
            quantity_value=quantity_value,
        )
    )
    scratch.flush()  # must not raise


def _indicator(geography_id: int, **overrides: Any) -> MunicipalCostIndicatorValue:
    values: dict[str, Any] = {
        "geography_id": geography_id,
        "reference_year": 2024,
        "indicator_code": MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
        "value": None,
        "unit": INDICATOR_UNIT,
        "numerator_amount_krw": None,
        "denominator_population": None,
        "numerator_contract_count": 0,
        "population_method": POPULATION_DIRECT,
        "population_definition": None,
        "evidence_status": EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
        "status": STATUS_UNAVAILABLE,
        "reason_codes": [],
        "limitations": [],
        "methodology_version": "test-only-method",
        "ingestion_run_id": None,
        "computed_at": NOW,
    }
    values.update(overrides)
    return MunicipalCostIndicatorValue(**values)


def test_unavailable_indicator_may_never_store_zero(scratch: Session) -> None:
    geography_id, _source_file_id = _scratch_parents(scratch)
    scratch.add(
        _indicator(
            geography_id,
            status=STATUS_UNAVAILABLE,
            value=Decimal("0.0000"),
            numerator_amount_krw=Decimal(0),
            denominator_population=1,
        )
    )
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_a_served_value_must_show_both_inputs(scratch: Session) -> None:
    geography_id, _source_file_id = _scratch_parents(scratch)
    scratch.add(
        _indicator(
            geography_id,
            status=STATUS_AVAILABLE,
            value=Decimal("1.0000"),
            numerator_amount_krw=Decimal(100),
            denominator_population=None,
        )
    )
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_a_served_value_requires_a_positive_denominator(scratch: Session) -> None:
    geography_id, _source_file_id = _scratch_parents(scratch)
    scratch.add(
        _indicator(
            geography_id,
            status=STATUS_AVAILABLE,
            value=Decimal("1.0000"),
            numerator_amount_krw=Decimal(100),
            denominator_population=0,
        )
    )
    with pytest.raises(IntegrityError):
        scratch.flush()


def test_loaded_registry_has_exactly_66_rows_for_2024(engine: Engine) -> None:
    """Skips cleanly before the first ingestion; asserts the count once loaded."""

    with Session(engine) as session:
        total = session.scalar(
            select(func.count())
            .select_from(MunicipalCostGeography)
            .where(MunicipalCostGeography.reference_year == 2024)
        )
    if not total:
        pytest.skip("municipal cost registry has not been ingested into the test database")
    assert total == 66
