"""Data-operations and provenance tables (System D)."""

import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# JSONB on PostgreSQL, generic JSON elsewhere (unit tests use SQLite).
JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")


class DataSource(Base):
    __tablename__ = "data_sources"

    source_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    source_name: Mapped[str] = mapped_column(String(200))
    dataset_name: Mapped[str] = mapped_column(String(200))
    endpoint: Mapped[str] = mapped_column(String(500))
    # ANNUAL, MONTHLY, REAL_TIME, or STRUCTURAL per the data frequency model.
    publication_frequency: Mapped[str] = mapped_column(String(20))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    documentation_url: Mapped[str | None] = mapped_column(String(500))


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    run_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # RUNNING, SUCCEEDED, FAILED, or PARTIAL.
    status: Mapped[str] = mapped_column(String(20))
    rows_received: Mapped[int] = mapped_column(Integer, default=0)
    rows_inserted: Mapped[int] = mapped_column(Integer, default=0)
    rows_updated: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    reference_period: Mapped[str | None] = mapped_column(String(50))
    transformation_version: Mapped[str | None] = mapped_column(String(100))
    error_category: Mapped[str | None] = mapped_column(String(50))
    error_message: Mapped[str | None] = mapped_column(Text)


class DatasetFreshness(Base):
    __tablename__ = "dataset_freshness"

    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), primary_key=True)
    latest_reference_period: Mapped[str | None] = mapped_column(String(50))
    last_checked_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    last_changed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    next_scheduled_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # UNKNOWN, FRESH, STALE, or FAILED.
    freshness_status: Mapped[str] = mapped_column(String(20), default="UNKNOWN")


class RawApiResponse(Base):
    __tablename__ = "raw_api_responses"
    __table_args__ = (
        UniqueConstraint(
            "source_id",
            "endpoint_identifier",
            "reference_period",
            "response_hash",
            "transformation_version",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    endpoint_identifier: Mapped[str] = mapped_column(String(200))
    reference_period: Mapped[str | None] = mapped_column(String(50))
    request_timestamp: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    response_hash: Mapped[str] = mapped_column(String(64), index=True)
    transformation_version: Mapped[str | None] = mapped_column(String(100))
    # Sanitized only: credentials are removed before persistence.
    sanitized_response: Mapped[Any] = mapped_column(JsonVariant)
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id"), index=True
    )


# Temporal grain of one population observation. The SGIS series is ANNUAL; the
# MOIS resident-registration series is MONTHLY (month-end). The two grains coexist
# in this table but are never interchangeable as a denominator.
GRANULARITY_ANNUAL = "ANNUAL"
GRANULARITY_MONTHLY = "MONTHLY"


class RegionalPopulation(Base):
    """One official population observation for a region at a reference period.

    Holds both the annual SGIS series (``reference_month`` NULL) and the monthly
    MOIS series (``reference_month`` = ``YYYY-MM``, month-end). Uniqueness is
    scoped by granularity so twelve monthly observations can share a
    ``reference_year`` while the legacy annual guarantee stays exactly as strong.
    """

    __tablename__ = "regional_population"
    __table_args__ = (
        # Granularity-scoped partial unique indexes (migration 0014). The former
        # table-wide annual UniqueConstraint could not admit a monthly series.
        Index(
            "uq_regional_population_annual",
            "region_id",
            "reference_year",
            "source_id",
            "population_definition",
            unique=True,
            postgresql_where=text(f"population_temporal_granularity = '{GRANULARITY_ANNUAL}'"),
            sqlite_where=text(f"population_temporal_granularity = '{GRANULARITY_ANNUAL}'"),
        ),
        Index(
            "uq_regional_population_monthly",
            "region_id",
            "reference_month",
            "source_id",
            "population_definition",
            unique=True,
            postgresql_where=text(f"population_temporal_granularity = '{GRANULARITY_MONTHLY}'"),
            sqlite_where=text(f"population_temporal_granularity = '{GRANULARITY_MONTHLY}'"),
        ),
        Index("ix_regional_population_reference_month", "reference_month"),
        Index(
            "ix_regional_population_month_lookup",
            "region_id",
            "reference_month",
            "source_id",
            "population_definition",
        ),
        Index(
            "ix_regional_population_year_lookup",
            "region_id",
            "reference_year",
            "source_id",
            "population_definition",
        ),
        CheckConstraint("population >= 0", name="regional_population_population_nonnegative"),
        # A monthly row must name its month and an annual row must not, so a
        # monthly value can never be read as an annual denominator.
        CheckConstraint(
            f"(population_temporal_granularity = '{GRANULARITY_MONTHLY}'"
            " AND reference_month IS NOT NULL)"
            f" OR (population_temporal_granularity = '{GRANULARITY_ANNUAL}'"
            " AND reference_month IS NULL)",
            name="regional_population_granularity_month_consistent",
        ),
        CheckConstraint(
            "reference_month IS NULL OR reference_month LIKE '____-__'",
            name="regional_population_reference_month_format",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"), index=True)
    reference_year: Mapped[int] = mapped_column(Integer)
    # YYYY-MM for a monthly observation; NULL for the annual SGIS series.
    reference_month: Mapped[str | None] = mapped_column(String(7))
    reference_period: Mapped[str] = mapped_column(String(50))
    population: Mapped[int] = mapped_column(BigInteger().with_variant(Integer(), "sqlite"))
    unit: Mapped[str] = mapped_column(String(20))
    population_definition: Mapped[str] = mapped_column(String(100))
    # Defaults to ANNUAL so every pre-existing annual writer (the SGIS ingestion,
    # and the annual rows already stored) keeps working untouched; a monthly
    # series must set it explicitly. A monthly row that forgot to would be caught
    # by the granularity/month check constraint rather than silently mislabelled.
    population_temporal_granularity: Mapped[str] = mapped_column(
        String(20), default=GRANULARITY_ANNUAL
    )
    # Set when a series' definition changed over time (the MOIS total gained
    # 거주불명자 in 2010-10 and 재외국민 in 2015-01), so the comparability limit
    # travels with the row instead of living only in prose.
    population_definition_version: Mapped[str | None] = mapped_column(String(100))
    population_comparability_note: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    source_administrative_code: Mapped[str] = mapped_column(String(20), index=True)
    source_geographic_level: Mapped[str] = mapped_column(String(20))
    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
