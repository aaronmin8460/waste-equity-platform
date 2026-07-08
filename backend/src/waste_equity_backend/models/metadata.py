"""Data-operations and provenance tables (System D)."""

import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
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

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    endpoint_identifier: Mapped[str] = mapped_column(String(200))
    request_timestamp: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    response_hash: Mapped[str] = mapped_column(String(64), index=True)
    # Sanitized only: credentials are removed before persistence.
    sanitized_response: Mapped[Any] = mapped_column(JsonVariant)
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id"), index=True
    )
