# Waste Equity Backend

FastAPI backend and core metadata schema (Phase 1).

## What Phase 1 provides

- PostgreSQL + PostGIS via Docker Compose.
- SQLAlchemy 2.0 models and an Alembic migration for the core metadata tables:
  `regions`, `region_code_map`, `data_sources`, `ingestion_runs`,
  `dataset_freshness`, `raw_api_responses`.
- Seeded `data_sources` registry for the five Phase 0 validated sources.
- Health and data-operations endpoints:
  - `GET /health`
  - `GET /api/v1/data-sources`
  - `GET /api/v1/data-freshness`
  - `GET /api/v1/ingestion-runs`

## Run locally with Docker Compose

From the repository root:

```bash
docker compose up --build
```

The backend applies Alembic migrations on startup, then serves on
`http://localhost:8000`. The database keeps data in the `pgdata` volume.
Stop the stack with:

```bash
docker compose down
```

API URLs:

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/api/v1/data-sources`
- `GET http://localhost:8000/api/v1/data-freshness`
- `GET http://localhost:8000/api/v1/ingestion-runs`
- `GET http://localhost:8000/openapi.json`
- Swagger UI: `http://localhost:8000/docs`

## Local development without Docker

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/alembic upgrade head
.venv/bin/uvicorn waste_equity_backend.api.app:app --reload
```

Migration commands:

```bash
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/alembic current
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/alembic upgrade head
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/alembic downgrade base
```

## Checks

```bash
.venv/bin/ruff format --check .
.venv/bin/ruff check .
.venv/bin/mypy src
.venv/bin/pytest
.venv/bin/python -m compileall src tests
```

Unit tests run against in-memory SQLite (metadata tables only). Integration
tests that need PostGIS run only when `TEST_DATABASE_URL` is set, for example:

```bash
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/pytest tests/test_migration_integration.py
```

Phase 1 is limited to infrastructure, metadata tables, source registry seed
metadata, and health/data-operations APIs. Phase 2 production ingestion has
not begun.

## Data-integrity rules enforced here

- No credentials in code, config files, images, or seed data.
- `raw_api_responses.sanitized_response` stores sanitized payloads only.
- Every data source row records its documented endpoint and documentation URL.
- Sources without freshness records report `freshness_status = UNKNOWN` rather
  than pretending to be fresh.
