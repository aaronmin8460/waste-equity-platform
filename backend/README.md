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
- Phase 2.3 RCIS facility ingestion schema addition (Alembic revision `0004`):
  - normalized `waste_treatment_facilities` (one row per facility line;
    accounting basis `FACILITY_LOCATION_BASED_THROUGHPUT`; nullable POINT
    `geometry` reserved for a later VWorld geocoding phase).
- Phase 2.4 VWorld facility geocoding schema addition (Alembic revision
  `0005`): geocode provenance columns on `waste_treatment_facilities`
  (status, request/refined address, `level4AC`, note, raw-response link) and
  the `GEOCODED_MATCH` region-mapping status.
- Health and data-operations endpoints:
  - `GET /health`
  - `GET /api/v1/data-sources`
  - `GET /api/v1/data-freshness`
  - `GET /api/v1/ingestion-runs`

## Phase 3: normalized-dataset endpoints

Read-only `GET` endpoints serving the Phase 2 normalized tables. Handlers
never call government APIs and never read credentials; every item carries
required `source_id` and reference-period fields, and quantities serialize as
exact decimal strings (scale-padded by the database, e.g. `"83721.300000"`).

- `GET /api/v1/regions?year=&level=` — canonical region list for a boundary
  vintage year (default: latest available), no geometry payload.
- `GET /api/v1/regions/boundaries?year=&level=` — GeoJSON FeatureCollection
  (EPSG:4326, served exactly as stored). `level` defaults to `SIGUNGU`.
- `GET /api/v1/population?year=&region_code=` — SGIS regional population.
- `GET /api/v1/waste-statistics?year=&waste_stream=&region_code=` — RCIS
  origin-based statistics (accounting basis `ORIGIN_BASED_TREATMENT_OUTCOME`).
- `GET /api/v1/facilities?year=&facility_category=&ownership=&region_code=&has_coordinates=`
  — RCIS facilities (accounting basis `FACILITY_LOCATION_BASED_THROUGHPUT`);
  `longitude`/`latitude` are present only where VWorld geocoding succeeded and
  are `null` otherwise (coordinates are never fabricated), with
  `region_mapping_status`/`geocode_status` exposed for review.

Availability semantics: a reference year that is not in the database returns a
structured `404` (`NO_DATA_FOR_PERIOD` with `available_years`, or
`NO_DATA_AVAILABLE` when nothing has been ingested); an unknown `region_code`
returns `404` `REGION_NOT_FOUND`; a legitimately empty filtered result within
an available year returns `200` with `count: 0`. Region rows missing
provenance or boundary geometry raise a visible `500` instead of being served
incomplete. The two accounting bases stay on separate endpoints and must never
be merged.

Live-verified 2026-07-09 against the docker database: 82 regions (3 SIDO + 79
SIGUNGU boundaries), 82 population rows, 234 waste-statistics rows, 651
facilities (547 with coordinates, 104 explicit `FAILED` geocodes with `null`
coordinates), matching the Phase 2 ingestion totals exactly.

## Phase 5: derived indicators + suitability screening

Read-only derived indicators (computed server-side, dual provenance, exact
`Decimal`; `docs/ANALYTICAL_METHODS.md`):

- `GET /api/v1/equity/waste-per-capita?year=&waste_stream=&region_code=` (5.1).
- `GET /api/v1/equity/facility-burden?year=&region_code=` (5.2).

Phase 5.4 suitability screening over the stored analysis run (analytical
decision-support only — never a legal/permit determination; no legal-eligibility
boolean; `docs/SUITABILITY_POLICY_V1.md`):

- `GET /api/v1/suitability/policies` — versions, weights, profiles,
  classification registry, distance curve, disclaimer.
- `GET /api/v1/suitability/runs`, `/runs/latest`, `/summary?run_id=&profile=`.
- `GET /api/v1/suitability/candidates?run_id=&profile=&bbox=&sido=&sigungu=&status=&min_score=&max_score=&top=&limit=&offset=`
  — GeoJSON FeatureCollection, always bounded by a controlled limit.
- `GET /api/v1/suitability/candidates/{id}?profile=` — full candidate evidence.

Live-verified 2026-07-13: one run over 47,893 candidates (1,099 ELIGIBLE /
34,534 REVIEW_REQUIRED / 12,260 EXCLUDED), all geometry valid EPSG:4326
MultiPolygon; served values reproduce the stored inputs on hand-check.

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
- `GET http://localhost:8000/api/v1/regions`
- `GET http://localhost:8000/api/v1/regions/boundaries`
- `GET http://localhost:8000/api/v1/population`
- `GET http://localhost:8000/api/v1/waste-statistics`
- `GET http://localhost:8000/api/v1/facilities`
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

Unit tests run against in-memory SQLite (non-spatial tables only). Integration
tests that need PostGIS — the migration chain and the Phase 3 dataset routes
(`tests/test_dataset_routes_integration.py`, synthetic rows at isolated
reference year 1999, rolled back) — run only when `TEST_DATABASE_URL` is set,
for example:

```bash
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/pytest tests/test_migration_integration.py
```

Run the SGIS migration and integration test against Docker PostgreSQL/PostGIS:

```bash
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  .venv/bin/pytest tests/test_migration_integration.py
```

Phases 2.2–2.4 add RCIS regional waste statistics, RCIS waste-treatment
facilities, and VWorld facility geocoding through the ingestion package (see
[ingestion/README.md](../ingestion/README.md)); Phase 3 serves those
normalized tables through the dataset endpoints above. AirKorea, KMA, VWorld
structural spatial layers, frontend, scheduler, equity metrics, and facility
recommendation logic are not implemented here. Ingestion freshness and runs
surface through `GET /api/v1/data-freshness` and `GET /api/v1/ingestion-runs`
(source ids `waste_statistics`, `sgis`, `vworld`).

## Data-integrity rules enforced here

- No credentials in code, config files, images, or seed data.
- `raw_api_responses.sanitized_response` stores sanitized payloads only.
- Every data source row records its documented endpoint and documentation URL.
- Sources without freshness records report `freshness_status = UNKNOWN` rather
  than pretending to be fresh.
