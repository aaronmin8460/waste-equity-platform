"""Data-operations endpoints: source registry, freshness, ingestion runs."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db import get_session
from ...models import DatasetFreshness, DataSource, IngestionRun
from ...schemas import DataFreshnessOut, DataSourceOut, IngestionRunOut

router = APIRouter(prefix="/api/v1")

SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/data-sources", response_model=list[DataSourceOut])
def list_data_sources(session: SessionDep) -> list[DataSource]:
    return list(session.scalars(select(DataSource).order_by(DataSource.source_id)).all())


@router.get("/data-freshness", response_model=list[DataFreshnessOut])
def list_data_freshness(session: SessionDep) -> list[DataFreshnessOut]:
    rows = session.execute(
        select(DataSource, DatasetFreshness)
        .outerjoin(DatasetFreshness, DataSource.source_id == DatasetFreshness.source_id)
        .order_by(DataSource.source_id)
    ).all()
    results: list[DataFreshnessOut] = []
    for source, freshness in rows:
        results.append(
            DataFreshnessOut(
                source_id=source.source_id,
                source_name=source.source_name,
                publication_frequency=source.publication_frequency,
                latest_reference_period=(freshness.latest_reference_period if freshness else None),
                last_checked_at=freshness.last_checked_at if freshness else None,
                last_changed_at=freshness.last_changed_at if freshness else None,
                last_success_at=freshness.last_success_at if freshness else None,
                next_scheduled_at=freshness.next_scheduled_at if freshness else None,
                freshness_status=freshness.freshness_status if freshness else "UNKNOWN",
            )
        )
    return results


@router.get("/ingestion-runs", response_model=list[IngestionRunOut])
def list_ingestion_runs(
    session: SessionDep,
    source_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[IngestionRun]:
    query = select(IngestionRun).order_by(IngestionRun.started_at.desc()).limit(limit)
    if source_id is not None:
        query = query.where(IngestionRun.source_id == source_id)
    return list(session.scalars(query).all())
