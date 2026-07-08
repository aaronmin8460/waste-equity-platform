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
    Integer,
    String,
    Text,
    UniqueConstraint,
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


class RegionalPopulation(Base):
    __tablename__ = "regional_population"
    __table_args__ = (
        UniqueConstraint("region_id", "reference_year", "source_id", "population_definition"),
        CheckConstraint("population >= 0", name="regional_population_population_nonnegative"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"), index=True)
    reference_year: Mapped[int] = mapped_column(Integer)
    reference_period: Mapped[str] = mapped_column(String(50))
    population: Mapped[int] = mapped_column(BigInteger().with_variant(Integer(), "sqlite"))
    unit: Mapped[str] = mapped_column(String(20))
    population_definition: Mapped[str] = mapped_column(String(100))
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    source_administrative_code: Mapped[str] = mapped_column(String(20), index=True)
    source_geographic_level: Mapped[str] = mapped_column(String(20))
    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
