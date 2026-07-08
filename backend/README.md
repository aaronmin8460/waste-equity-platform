# Waste Equity Backend

FastAPI backend and core metadata schema.

## What Phase 1 provides

- PostgreSQL + PostGIS via Docker Compose.
- SQLAlchemy 2.0 models and an Alembic migration for the core metadata tables:
  `regions`, `region_code_map`, `data_sources`, `ingestion_runs`,
  `dataset_freshness`, `raw_api_responses`.
- Seeded `data_sources` registry for the five Phase 0 validated sources.
- Phase 2.1 SGIS ingestion schema additions:
  - provenance columns on `ingestion_runs`, `raw_api_responses`, and `regions`
  - mapping-review columns on `region_code_map`
  - normalized `regional_population`
- Phase 2.2 RCIS waste ingestion schema addition (Alembic revision `0003`):
  - normalized `regional_waste_statistics` (region grand-total generation and
    treatment-by-method per PID; accounting basis
    `ORIGIN_BASED_TREATMENT_OUTCOME`). The `region_code_map` RCIS name-pair
    columns already existed from revision `0001`, so revision `0003` only adds
    the new table.
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

Run the SGIS migration and integration test against Docker PostgreSQL/PostGIS:

```bash
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/pytest tests/test_migration_integration.py
```

Phase 2.2 adds RCIS regional waste generation/treatment production ingestion
(see [ingestion/README.md](../ingestion/README.md)). RCIS facility ingestion
(Phase 2.3), VWorld, AirKorea, KMA, frontend, scheduler, equity metrics, and
facility recommendation logic are not implemented here. RCIS freshness and
ingestion runs surface through the existing `GET /api/v1/data-freshness` and
`GET /api/v1/ingestion-runs` endpoints (source id `waste_statistics`); no new
backend route was added.

## Data-integrity rules enforced here

- No credentials in code, config files, images, or seed data.
- `raw_api_responses.sanitized_response` stores sanitized payloads only.
- Every data source row records its documented endpoint and documentation URL.
- Sources without freshness records report `freshness_status = UNKNOWN` rather
  than pretending to be fresh.
