# Waste Equity Platform

Waste Equity Platform is a planned public-data analysis platform for waste-management equity and potential waste-facility location recommendations across the Seoul Metropolitan Area.

The first implementation scope covers the full Seoul Metropolitan Area:

- Seoul
- Incheon
- Gyeonggi-do

This repository currently contains project governance documents, the Phase 0 local API-probe package (with live-verified RCIS, SGIS, and VWorld contracts), the Phase 1 backend infrastructure, production ingestion for SGIS geography/population (2.1), RCIS waste statistics (2.2), RCIS waste-treatment facilities (2.3), and VWorld facility geocoding (2.4), the Phase 2.5A VWorld structural-layer feasibility audit ([docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md](docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md), recommendation CONDITIONAL_GO), the Phase 3 backend product API, the Phase 4 interactive MapLibre GL frontend, and the Phase 5.1/5.2 derived equity indicators (per-capita waste generation; facility burden with geodesic buffers) documented in [docs/ANALYTICAL_METHODS.md](docs/ANALYTICAL_METHODS.md). Phase 2.5B (VWorld structural-layer production ingestion) is in progress: subphase 2.5B-1 adds the versioned structural-layer schema and 용도지역 zoning (UQ111–UQ114) bulk-file ingestion via the `vworld-zoning-ingest` CLI. Prior government-project authorization for use, local storage, transformation, and analytical processing of the relevant VWorld/government spatial datasets has been confirmed by the project owner, so the 2.5A audit-time licensing/storage-consent uncertainty no longer blocks 2.5B. It does not yet contain AirKorea/KMA ingestion (credentials missing), the mandatory protected/restricted and road structural layers, suitability scoring (blocked; see Phase 5.4), or scheduler automation.

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

## Run RCIS waste ingestion

Phase 2.2 ingests regional waste generation and treatment statistics for the
four documented sigungu generation PIDs (`NTN007`, `NTN008`, `NTN018`,
`NTN022`) at reference year 2024. Credentials (`RCIS_API_KEY`, `RCIS_USER_ID`)
are read from `.env`; do not pass them on the command line.

Dry run (live reads, region mapping, no writes):

```bash
PYTHONPATH=backend/src:ingestion/src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli rcis-waste-ingest \
  --year 2024 --scope capital-region --dry-run
```

Write through Docker Compose:

```bash
docker compose --profile ingestion run --rm ingestion \
  rcis-waste-ingest --year 2024 --scope capital-region --write
```

The normalized `regional_waste_statistics` table stores one row per
`(region, reference year, source PID)` — the region grand total in 톤/년 with
generation and treatment-by-method (recycling/incineration/landfill/other). The
accounting basis is `ORIGIN_BASED_TREATMENT_OUTCOME` (how the origin region's
own generated waste was treated), not facility throughput and not waste
movement. See [ingestion/README.md](ingestion/README.md) for PID details,
geographic mapping, and idempotency.

## Run RCIS facility ingestion

Phase 2.3 ingests waste-treatment facilities for the six facility PIDs
(`NTN031`, `NTN032`, `NTN033`, `NTN040`, `NTN043`, `NTN046`) at 2024 into
`waste_treatment_facilities` (one row per facility line; accounting basis
`FACILITY_LOCATION_BASED_THROUGHPUT`). Addresses are stored without coordinates;
geocoding is deferred to a later VWorld phase.

```bash
docker compose --profile ingestion run --rm ingestion \
  rcis-facility-ingest --year 2024 --scope capital-region --write
```

See [ingestion/README.md](ingestion/README.md) for PID details, the facility
identity key, and region-mapping status handling.

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

Phase 0 established governance, planning, and live data-source validation through Phase 0.7 (RCIS PID discovery, recommendation GO). Phase 1 added the Docker Compose infrastructure, PostGIS database, core metadata schema, and backend health/data-operations API. Phase 2 (2.1–2.4) ingested SGIS geography/population, RCIS waste statistics and facilities, and VWorld facility geocoding. Phase 2.5A audited the VWorld structural spatial layers (zoning, protected areas, roads, ownership) with live contract probes — recommendation CONDITIONAL_GO. Phase 2.5B production ingestion is now in progress (2.5B-1: versioned structural-layer schema and 용도지역 zoning ingestion); prior government-project authorization for use, storage, transformation, and analytical processing of the datasets has been confirmed by the project owner, resolving the audit-time licensing/storage-consent uncertainty for this project. Phase 3 added the read-only product API over the normalized tables. Phase 4 added the interactive MapLibre GL map frontend. Phase 5.1–5.3 added the derived equity indicators (per-capita generation; facility burden with geodesic buffers) and the analytical methods/review-workflow documentation; Phase 5.4 (suitability scoring) is blocked pending the minimum structural-layer package in [docs/SUITABILITY_DATA_REQUIREMENTS.md](docs/SUITABILITY_DATA_REQUIREMENTS.md). AirKorea/KMA ingestion remains blocked on credentials. See:

- [AGENTS.md](AGENTS.md)
- [Project Specification](docs/PROJECT_SPEC.md)
- [Development Phases](docs/DEVELOPMENT_PHASES.md)
- [Data Requirements](docs/DATA_REQUIREMENTS.md)
- [Analytical Methods](docs/ANALYTICAL_METHODS.md)
- [Phase 0 Findings](docs/PHASE_0_FINDINGS.md)

# waste-equity-platform
