"""Capital-region Sudokwon Landfill inbound flow (metropolitan → destination).

Adds the ``landfill_inbound_monthly`` canonical monthly fact table joining the two
official Sudokwon Landfill Corporation (수도권매립지관리공사) odcloud datasets that
share an exact 1:1 monthly grain — inbound quantity (``15064381`` ``반입량``, kg)
and inbound fee (``15064394`` ``반입수수료``, KRW). Both are seeded into the
``data_sources`` registry (documented endpoints only, never credentials).

Origin is metropolitan-only (서울시/인천시/경기도 → KR-SGIS-11/28/41); the
destination is the single Sudokwon Landfill (``SUDOKWON_LANDFILL``). The accounting
basis ``VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`` is distinct from the
origin-treatment and facility-throughput bases and is pinned by a check.

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-14

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Exact-decimal storage matching the model's Quantity (kg) and FeeAmount (KRW).
_QUANTITY = sa.Numeric(precision=20, scale=6)
_FEE = sa.Numeric(precision=20, scale=2)

# Reviewed constants (mirrored from models/landfill_inbound.py) — duplicated here
# per the migration convention of not importing model types.
_ACCOUNTING_BASIS = "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"
_DESTINATION = "SUDOKWON_LANDFILL"
_ORIGIN_LEVEL = "SIDO"
_ORIGIN_CODES = ("KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41")
_EVIDENCE = ("OFFICIAL_REPORTED_VALUE", "OFFICIAL_INPUTS_DERIVED_VALUE")

_ORIGIN_CODES_SQL = ", ".join(f"'{code}'" for code in _ORIGIN_CODES)
_EVIDENCE_SQL = ", ".join(f"'{value}'" for value in _EVIDENCE)

_TABLE = "landfill_inbound_monthly"
_INDEXED_COLUMNS = (
    "reference_month",
    "reference_year",
    "origin_region_code",
    "waste_name",
    "quantity_source_dataset_id",
    "fee_source_dataset_id",
    "ingestion_run_id",
)


def upgrade() -> None:
    # Register the two official odcloud sources so the fact rows, ingestion runs,
    # and raw responses can reference them (documented endpoints only).
    data_sources = sa.table(
        "data_sources",
        sa.column("source_id", sa.String),
        sa.column("source_name", sa.String),
        sa.column("dataset_name", sa.String),
        sa.column("endpoint", sa.String),
        sa.column("publication_frequency", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("documentation_url", sa.String),
    )
    op.bulk_insert(
        data_sources,
        [
            {
                "source_id": "15064381",
                "source_name": "수도권매립지관리공사 (Sudokwon Landfill Site Management Corp.)",
                "dataset_name": "통합반입관리_수도권폐기물 반입량 (landfill inbound quantity)",
                "endpoint": "https://api.odcloud.kr/api/15064381/v1",
                "publication_frequency": "MONTHLY",
                "enabled": True,
                "documentation_url": "https://www.data.go.kr/data/15064381/fileData.do",
            },
            {
                "source_id": "15064394",
                "source_name": "수도권매립지관리공사 (Sudokwon Landfill Site Management Corp.)",
                "dataset_name": "통합반입관리_폐기물반입수수료 (landfill inbound fee)",
                "endpoint": "https://api.odcloud.kr/api/15064394/v1",
                "publication_frequency": "MONTHLY",
                "enabled": True,
                "documentation_url": "https://www.data.go.kr/data/15064394/fileData.do",
            },
        ],
    )

    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reference_month", sa.String(length=7), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("origin_region_code", sa.String(length=20), nullable=False),
        sa.Column("origin_source_name", sa.String(length=50), nullable=False),
        sa.Column("origin_region_level", sa.String(length=20), nullable=False),
        sa.Column("destination_code", sa.String(length=40), nullable=False),
        sa.Column("waste_name", sa.String(length=100), nullable=False),
        sa.Column("quantity_kg", _QUANTITY, nullable=False),
        sa.Column("inbound_fee_krw", _FEE, nullable=False),
        sa.Column("quantity_unit", sa.String(length=20), nullable=False),
        sa.Column("fee_currency", sa.String(length=10), nullable=False),
        sa.Column("accounting_basis", sa.String(length=60), nullable=False),
        sa.Column("quantity_source_dataset_id", sa.String(length=50), nullable=False),
        sa.Column("quantity_source_snapshot_uuid", sa.String(length=60), nullable=False),
        sa.Column("quantity_source_snapshot_date", sa.Date(), nullable=True),
        sa.Column("fee_source_dataset_id", sa.String(length=50), nullable=False),
        sa.Column("fee_source_snapshot_uuid", sa.String(length=60), nullable=False),
        sa.Column("fee_source_snapshot_date", sa.Date(), nullable=True),
        sa.Column("quantity_evidence_status", sa.String(length=40), nullable=False),
        sa.Column("fee_evidence_status", sa.String(length=40), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("quantity_raw_response_id", sa.BigInteger(), nullable=True),
        sa.Column("fee_raw_response_id", sa.BigInteger(), nullable=True),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "quantity_kg >= 0",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_quantity_nonnegative"),
        ),
        sa.CheckConstraint(
            "inbound_fee_krw >= 0",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_fee_nonnegative"),
        ),
        sa.CheckConstraint(
            f"origin_region_code IN ({_ORIGIN_CODES_SQL})",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_origin_allowed"),
        ),
        sa.CheckConstraint(
            f"origin_region_level = '{_ORIGIN_LEVEL}'",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_origin_level_allowed"),
        ),
        sa.CheckConstraint(
            f"destination_code = '{_DESTINATION}'",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_destination_allowed"),
        ),
        sa.CheckConstraint(
            f"accounting_basis = '{_ACCOUNTING_BASIS}'",
            name=op.f(
                "ck_landfill_inbound_monthly_landfill_inbound_monthly_accounting_basis_allowed"
            ),
        ),
        sa.CheckConstraint(
            f"quantity_evidence_status IN ({_EVIDENCE_SQL})",
            name=op.f(
                "ck_landfill_inbound_monthly_landfill_inbound_monthly_quantity_evidence_allowed"
            ),
        ),
        sa.CheckConstraint(
            f"fee_evidence_status IN ({_EVIDENCE_SQL})",
            name=op.f("ck_landfill_inbound_monthly_landfill_inbound_monthly_fee_evidence_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["quantity_source_dataset_id"],
            ["data_sources.source_id"],
            name=op.f("fk_landfill_inbound_monthly_quantity_source_dataset_id_data_sources"),
        ),
        sa.ForeignKeyConstraint(
            ["fee_source_dataset_id"],
            ["data_sources.source_id"],
            name=op.f("fk_landfill_inbound_monthly_fee_source_dataset_id_data_sources"),
        ),
        sa.ForeignKeyConstraint(
            ["quantity_raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_landfill_inbound_monthly_quantity_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["fee_raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_landfill_inbound_monthly_fee_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_runs.run_id"],
            name=op.f("fk_landfill_inbound_monthly_ingestion_run_id_ingestion_runs"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_landfill_inbound_monthly")),
        sa.UniqueConstraint(
            "reference_month",
            "origin_region_code",
            "destination_code",
            "waste_name",
            name="uq_landfill_inbound_monthly_grain",
        ),
    )
    for column in _INDEXED_COLUMNS:
        op.create_index(
            op.f(f"ix_landfill_inbound_monthly_{column}"), _TABLE, [column], unique=False
        )


def downgrade() -> None:
    for column in reversed(_INDEXED_COLUMNS):
        op.drop_index(op.f(f"ix_landfill_inbound_monthly_{column}"), table_name=_TABLE)
    op.drop_table(_TABLE)
    op.execute("DELETE FROM data_sources WHERE source_id IN ('15064381', '15064394')")
