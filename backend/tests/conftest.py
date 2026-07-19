"""Test fixtures: FastAPI client backed by in-memory SQLite.

Only non-spatial tables are created here; the facilities table uses PostGIS
geometry and is covered by the migration and dataset-route integration tests
(TEST_DATABASE_URL).

``regions`` is created **without its MULTIPOLYGON boundary column** (SQLite has
no SpatiaLite here), which is enough for the column-scoped lookups that read only
region_code/region_name/region_level — notably the landfill per-capita population
denominator. Seed it with ``insert(Region).values(...)`` (a core insert naming
only real columns); an ORM ``Region(...)`` insert would emit the geometry column
and fail. Anything that needs the boundary geometry itself still belongs in the
PostGIS integration tier.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    FacilityStandardCost,
    IngestionRun,
    LandfillInboundMonthly,
    RawApiResponse,
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    SuitabilityAnalysisRun,
)

METADATA_TABLES = [
    DataSource.__table__,
    IngestionRun.__table__,
    DatasetFreshness.__table__,
    RawApiResponse.__table__,
    RegionalPopulation.__table__,
    RegionalWasteStatistics.__table__,
    # Non-spatial capital-region landfill inbound flow fact table.
    LandfillInboundMonthly.__table__,
    # Non-spatial versioned facility standard-cost reference table.
    FacilityStandardCost.__table__,
    # Non-spatial; the candidates table is spatial and is covered by the
    # suitability route integration tests (TEST_DATABASE_URL).
    SuitabilityAnalysisRun.__table__,
]

# A copy of `regions` minus the geometry column, in its own MetaData so the
# mapped Region class (and its PostGIS column) is left untouched. The physical
# table name matches, so column-scoped ORM queries against Region resolve here.
_REGIONS_METADATA = MetaData()
REGIONS_NONSPATIAL = Table(
    "regions",
    _REGIONS_METADATA,
    *[column._copy() for column in Region.__table__.columns if column.name != "geometry"],
)


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=METADATA_TABLES)
    _REGIONS_METADATA.create_all(engine, tables=[REGIONS_NONSPATIAL])
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def session(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as db_session:
        yield db_session


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    app = create_app()

    def override_get_session() -> Iterator[Session]:
        db_session = session_factory()
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
