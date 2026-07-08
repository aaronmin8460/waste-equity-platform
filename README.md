# Waste Equity Platform

Waste Equity Platform is a planned public-data analysis platform for waste-management equity and potential waste-facility location recommendations across the Seoul Metropolitan Area.

The first implementation scope covers the full Seoul Metropolitan Area:

- Seoul
- Incheon
- Gyeonggi-do

This repository currently contains project governance documents, the Phase 0 local API-probe package (with live-verified RCIS, SGIS, and VWorld contracts), the Phase 1 backend infrastructure, and Phase 2.1 SGIS production ingestion for canonical geography and total population. It does not yet contain the frontend, RCIS/VWorld/AirKorea/KMA production ingestion, waste metrics, equity analysis, scheduler automation, or facility recommendation logic.

## Run the local stack

```bash
docker compose up --build
```

Shutdown:

```bash
docker compose down
```

The Phase 1 API runs at:

- Health: `http://localhost:8000/health`
- Data sources: `http://localhost:8000/api/v1/data-sources`
- Data freshness: `http://localhost:8000/api/v1/data-freshness`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
- Swagger UI: `http://localhost:8000/docs`

See [backend/README.md](backend/README.md) for local development without Docker.

## Run SGIS ingestion

Phase 2.1 implements only SGIS canonical geography and total population
ingestion. Credentials are read from `.env`; do not pass them on the command
line.

Dry run:

```bash
PYTHONPATH=backend/src:ingestion/src \
  python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 --scope capital-region --dry-run
```

Write through Docker Compose:

```bash
docker compose --profile ingestion run --rm ingestion \
  sgis-ingest --year 2024 --scope capital-region --write
```

The selected Phase 2.1 SGIS reference year is 2024 because live validation
found 2024 is the latest year with successful population and boundary responses
for Seoul, Incheon, and Gyeonggi-do. SGIS boundary source geometries are
handled as EPSG:5179 and stored in PostGIS as EPSG:4326 MultiPolygons.

## Planned Technical Direction

- Frontend: Next.js, TypeScript, Tailwind CSS, MapLibre GL
- Backend: FastAPI, Python, Pydantic, SQLAlchemy
- Database: PostgreSQL and PostGIS
- Data ingestion: httpx, pandas, GeoPandas
- Automation: separate scheduler process
- Local infrastructure: Docker Compose
- Testing: pytest, Vitest, Playwright

## Planned Data Categories

- Waste generation and treatment statistics
- Waste-treatment facilities
- Population and administrative boundaries
- Land-use and zoning information
- Real-time air quality
- Weather, wind direction, and wind speed

## Core Data Principles

The platform must use real Korean public data and must not present mock, generated, estimated, fallback, or sample data as official public data. Every displayed analytical metric must include its source and reference period. Annual, monthly, periodically updated, and real-time data must be clearly distinguished.

The frontend must not call Korean government APIs directly. Future ingestion and API access must go through backend or scheduler-controlled services using credentials loaded only from environment variables.

## Current Status

Phase 0 established governance, planning, and live data-source validation through Phase 0.7 (RCIS PID discovery, recommendation GO). Phase 1 added the Docker Compose infrastructure, PostGIS database, core metadata schema, and backend health/data-operations API. Phase 2.1 adds SGIS canonical geography and population ingestion only; later Phase 2 subphases will cover RCIS, VWorld, AirKorea, and KMA. See:

- [AGENTS.md](AGENTS.md)
- [Project Specification](docs/PROJECT_SPEC.md)
- [Development Phases](docs/DEVELOPMENT_PHASES.md)
- [Data Requirements](docs/DATA_REQUIREMENTS.md)
- [Phase 0 Findings](docs/PHASE_0_FINDINGS.md)

# waste-equity-platform
