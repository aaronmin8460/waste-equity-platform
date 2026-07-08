# Development Phases

Development must proceed in small, reviewable phases. A phase is complete only when its deliverables are implemented, documented, reviewed for data-integrity risks, and verified with the appropriate formatting, linting, type checking, and tests once tooling exists.

## Phase 0: Governance And Planning

Status: complete, including Phase 0.5 (probe package, SGIS/VWorld live validation), Phase 0.6 (RCIS authentication and connectivity), and Phase 0.7 (RCIS PID discovery; recommendation GO — see `PHASE_0_FINDINGS.md`).

Deliverables:

- `AGENTS.md`
- `README.md`
- `docs/PROJECT_SPEC.md`
- `docs/DEVELOPMENT_PHASES.md`
- `docs/DATA_REQUIREMENTS.md`
- `.gitignore`
- `.env.example`

Constraints:

- Do not create application source code.
- Do not install packages.
- Do not create fake datasets.
- Do not start API integration.

Completion checks:

- Planning files do not contradict the mandatory data-integrity rules.
- Planned scope covers Seoul, Incheon, and Gyeonggi-do.
- Technical direction is documented without implying implementation has started.

## Phase 1: Repository And Tooling Scaffold

Status: complete for the backend and infrastructure (2026-07-08). The master project context consolidates this phase with the metadata model and database foundation below as "Phase 1: Infrastructure"; the delivered scope is the `backend/` package (FastAPI, SQLAlchemy 2.0, Alembic, ruff/mypy/pytest all passing), `docker-compose.yml` (PostGIS database + backend), the core metadata tables (`regions`, `region_code_map`, `data_sources`, `ingestion_runs`, `dataset_freshness`, `raw_api_responses`) with a seeded source registry, and the health/data-operations endpoints. Frontend scaffold and CI remain open.

Goal: create the minimal project structure and developer tooling without implementing product features or data integrations.

Planned deliverables:

- Frontend and backend directory structure
- Package and Python project metadata
- Formatting, linting, type-checking, and test commands
- Docker Compose skeleton for local services
- Environment variable loading pattern
- Continuous integration plan or initial workflow

Required checks before completion:

- Formatting command passes
- Linting command passes
- Type-checking command passes
- Empty or scaffold tests pass
- No fake public datasets are introduced

## Phase 2: Data Source Registry And Metadata Model

Goal: define how official data sources, reference periods, update cadences, licenses, and retrieval metadata are represented.

Planned deliverables:

- Source registry schema
- Data cadence taxonomy: annual, monthly, periodically updated, real-time
- Ingestion run metadata model
- Raw response storage convention
- Source and reference-period requirements for backend responses

Required checks before completion:

- Unit tests for metadata validation
- Documentation for source registration
- Review confirming unavailable sources cannot silently fall back to sample data

## Phase 3: Database And Spatial Foundation

Goal: implement the initial PostgreSQL and PostGIS foundation for administrative boundaries, facilities, source metadata, and ingestion runs.

Planned deliverables:

- Database migrations
- Spatial reference system conventions
- Raw, normalized, and derived schema separation
- Administrative boundary versioning approach
- Test fixtures that are clearly marked as synthetic test fixtures, not official data

Required checks before completion:

- Migration tests pass
- Spatial indexes are defined where needed
- Test fixtures cannot be confused with public data

## Phase 4: First Official Data Ingestion

Goal: ingest the first approved official dataset for the full Seoul Metropolitan Area.

Planned deliverables:

- Idempotent ingestion job
- Sanitized raw response preservation
- Normalized table writes
- Source, retrieval time, reference period, and transformation metadata
- Visible failure behavior when official data is unavailable

Required checks before completion:

- Ingestion job can be rerun without duplicating records
- Tests cover idempotency and metadata requirements
- No fallback sample data path exists

## Phase 5: Backend API Foundation

Goal: serve normalized data and metadata to the frontend through backend APIs.

Planned deliverables:

- FastAPI endpoints for initial datasets
- Pydantic response models requiring source and reference period
- Error responses for unavailable data
- No frontend exposure of government API credentials

Required checks before completion:

- Backend unit and integration tests pass
- API responses include required metadata
- Type checking passes

## Phase 6: Interactive Map Prototype

Goal: build the first MapLibre GL interface using backend-provided data.

Planned deliverables:

- Map view covering Seoul, Incheon, and Gyeonggi-do
- Layer controls and legends
- Metric display with source and reference period
- Clear labels for annual, monthly, periodically updated, and real-time data

Required checks before completion:

- Frontend tests pass
- Playwright smoke test confirms map loads
- Frontend does not call Korean government APIs directly

## Phase 7: Equity And Suitability Analysis

Goal: implement documented spatial analysis and facility-siting decision support.

Planned deliverables:

- Equity indicators
- Suitability constraints and scoring
- Spatial joins, buffers, and aggregation
- Assumption and weighting documentation
- Review workflow for analytical outputs

Required checks before completion:

- Analytical tests cover scoring and edge cases
- Every metric includes source and reference period
- Real-time readings are not treated as permanent siting evidence
- Waste origin-to-destination movement is used only when explicitly sourced

## Phase 8: Automated Refresh And Operations

Goal: run periodic data refresh through a separate scheduler process.

Planned deliverables:

- Scheduler process
- Source-specific refresh schedules
- Job status and logging
- Retry and alerting conventions
- Reproducibility documentation

Required checks before completion:

- Scheduler tests pass
- Failed ingestion is visible
- Idempotency is verified for each job

