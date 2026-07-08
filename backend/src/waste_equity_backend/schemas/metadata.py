"""Response schemas for health and data-operations endpoints."""

import datetime

from pydantic import BaseModel, ConfigDict


class HealthOut(BaseModel):
    status: str
    database: str
    app_env: str
    checked_at: datetime.datetime


class DataSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: str
    source_name: str
    dataset_name: str
    endpoint: str
    publication_frequency: str
    enabled: bool
    documentation_url: str | None


class DataFreshnessOut(BaseModel):
    source_id: str
    source_name: str
    publication_frequency: str
    latest_reference_period: str | None
    last_checked_at: datetime.datetime | None
    last_changed_at: datetime.datetime | None
    last_success_at: datetime.datetime | None
    next_scheduled_at: datetime.datetime | None
    freshness_status: str


class IngestionRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    run_id: int
    source_id: str
    started_at: datetime.datetime
    completed_at: datetime.datetime | None
    status: str
    rows_received: int
    rows_inserted: int
    rows_updated: int
    rows_rejected: int
    error_category: str | None
    error_message: str | None
