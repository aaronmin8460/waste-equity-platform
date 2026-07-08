# Project Specification

## Purpose

Waste Equity Platform will analyze waste-management equity and recommend potential waste-facility locations across the Seoul Metropolitan Area using real Korean public data, reproducible ingestion, spatial analysis, and interactive maps.

The platform is intended for decision support. It must not present algorithmic outputs as final siting decisions or as a substitute for legal, environmental, engineering, or community review.

## Geographic Scope

The initial and first implementation scope is the entire Seoul Metropolitan Area:

- Seoul
- Incheon
- Gyeonggi-do

The project must not start with Seoul alone unless a later approved phase explicitly narrows a prototype while preserving the metropolitan data model.

## Primary Users

- Public-policy analysts studying waste-management burden and service equity
- Urban and regional planners evaluating facility access and constraints
- Researchers comparing administrative areas and environmental indicators
- Civic stakeholders reviewing documented public-data analysis

## Planned Capabilities

- Periodic ingestion of Korean public data through backend-controlled jobs
- Preservation of sanitized raw API responses for reproducibility
- Normalization of statistical, facility, boundary, land-use, air-quality, and weather data
- Spatial analysis using administrative boundaries, buffers, joins, and suitability constraints
- Interactive MapLibre GL maps for exploring facilities, indicators, and candidate areas
- Transparent metric cards and map layers that cite source and reference period
- Audit-friendly metadata for ingestion runs, transformations, and derived outputs

## Non-Goals For The Initial Documentation Phase

- No application source code
- No dependency installation
- No package manager setup
- No fake datasets
- No generated sample public data
- No API integration
- No scheduler implementation
- No database schema implementation

## Planned Architecture

### Frontend

The planned frontend stack is Next.js, TypeScript, Tailwind CSS, and MapLibre GL.

Frontend responsibilities will include:

- Rendering maps, filters, legends, metric panels, and source metadata
- Requesting normalized platform data from the backend
- Showing source and reference period for every displayed analytical metric
- Clearly labeling annual, monthly, periodically updated, and real-time indicators

The frontend must never call Korean government APIs directly.

### Backend

The planned backend stack is FastAPI, Python, Pydantic, and SQLAlchemy.

Backend responsibilities will include:

- Serving normalized data and analytical results to the frontend
- Enforcing source metadata requirements in API responses
- Loading credentials only from environment variables
- Keeping public API access out of browser-executed code
- Validating request and response contracts with Pydantic

### Database

The planned database is PostgreSQL with PostGIS.

Database responsibilities will include:

- Storing normalized public data
- Storing spatial geometries and indexes
- Separating raw, normalized, and derived analytical records
- Preserving source, retrieval, reference-period, and transformation metadata

### Data Ingestion

The planned ingestion tools are httpx, pandas, and GeoPandas.

Ingestion responsibilities will include:

- Fetching official public data from approved sources
- Preserving sanitized raw API responses
- Recording source metadata and reference periods
- Running idempotently
- Failing visibly when real data is unavailable

### Automation

Automated refresh will be handled by a separate scheduler process rather than by frontend code. The scheduler will trigger ingestion jobs according to each source's update cadence.

### Local Infrastructure

Docker Compose is planned for local development infrastructure, including application services, database, and scheduler where applicable.

### Testing

The planned test stack is:

- pytest for Python backend and ingestion tests
- Vitest for frontend unit tests
- Playwright for end-to-end browser tests

Future implementation phases must run formatting, linting, type checking, and tests before being considered complete.

## Data Integrity Requirements

- Never present mock, generated, estimated, sample, fallback, or placeholder data as official public data.
- Never silently replace unavailable real data with sample data.
- Every displayed analytical metric must include its source and reference period.
- Annual, monthly, periodically updated, and real-time data must be distinguished.
- Waste origin-to-destination movement must not be inferred unless the source explicitly provides it.
- Real-time weather and air-quality readings must not be directly treated as permanent facility-siting evidence.
- Unverified assumptions must be clearly identified.

## Open Assumptions

The following assumptions are unverified until source discovery is completed:

- Required Korean public datasets are available with licenses or terms compatible with this platform.
- Administrative boundary data can be versioned consistently across Seoul, Incheon, and Gyeonggi-do.
- Waste generation, treatment, and facility datasets provide enough reference-period metadata for comparable analysis.
- Real-time air-quality and weather APIs provide stable identifiers and documented update intervals.

