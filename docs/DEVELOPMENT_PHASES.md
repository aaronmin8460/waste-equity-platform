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

Status: complete for the backend and infrastructure (2026-07-08). This phase absorbed the source-registry, metadata-model, and database-foundation work that earlier roadmap drafts listed as separate later phases.

Goal: create the minimal project structure and developer tooling without implementing product features or data integrations.

Delivered:

- `backend/` package with FastAPI, SQLAlchemy 2.0, Alembic, ruff, mypy, and pytest.
- `docker-compose.yml` with PostgreSQL/PostGIS and backend services.
- Core source registry and metadata model.
- PostgreSQL/PostGIS foundation and Alembic revision `0001`.
- Core metadata tables: `regions`, `region_code_map`, `data_sources`, `ingestion_runs`, `dataset_freshness`, `raw_api_responses`.
- Seeded source registry for SGIS, RCIS, VWorld, AirKorea, and KMA.
- Backend health and data-operations endpoints.

Required checks before completion:

- Formatting command passes
- Linting command passes
- Type-checking command passes
- Backend tests pass
- No fake public datasets are introduced

## Phase 2: Production Ingestion

Status: current phase.

Goal: implement explicit, reproducible, one-shot production ingestion jobs for official public data. Phase 2 jobs must preserve sanitized raw responses, write normalized tables idempotently, and fail visibly without fixture fallback.

### Phase 2.0: Reusable Production Ingestion Framework

Deliverables:

- CLI entrypoint for explicit ingestion jobs.
- Shared credential loading from environment variables.
- Provider-result validation and sanitized error handling.
- Sanitized raw-response preservation through `raw_api_responses`.
- Visible ingestion lifecycle through `ingestion_runs`.
- Dataset freshness updates only after successful writes.
- Idempotent upsert conventions.
- Docker Compose one-shot ingestion command.

### Phase 2.1: SGIS Canonical Geography And Population Ingestion

Deliverables:

- Reuse the live-verified SGIS authentication/client logic.
- Validate SGIS population and boundary contracts for Seoul, Incheon, and Gyeonggi-do.
- Select a mutually compatible SGIS population/boundary reference year.
- Transform SGIS boundary geometries from source CRS EPSG:5179 to target CRS EPSG:4326.
- Populate canonical `regions` rows and SGIS `region_code_map` entries.
- Add and populate normalized `regional_population`.
- Preserve source/reference-period/raw-response/ingestion-run provenance.
- Verify idempotent second run behavior.

Required checks before completion:

- Live SGIS authentication succeeds.
- Population and boundary contracts are validated for the full Seoul Metropolitan Area.
- Migration and Docker/PostGIS integration tests pass.
- Dry-run and write CLI modes work.
- Identical second write creates no duplicate regions or population rows.
- Formatting, linting, type checking, compile checks, and tests pass.
- No secret, access token, fixture fallback, or sample data is used for production writes.

### Phase 2.2: RCIS Regional Waste Generation And Treatment Ingestion

Status: complete (2026-07-08).

Deliverables:

- Reuse the Phase 0.6/0.7 RCIS client, request builder, provider-code handling,
  and sanitization, plus the Phase 2.0/2.1 ingestion-run/raw-response/freshness
  framework and CLI/Docker one-shot pattern.
- Live-validate the four documented sigungu generation PIDs (`NTN007`, `NTN008`,
  `NTN018`, `NTN022`) for `YEAR=2024`, 2020-onward schema era only.
- Add and populate normalized `regional_waste_statistics` (Alembic revision
  `0003`): region grand-total generation and treatment-by-method in 톤/년,
  accounting basis `ORIGIN_BASED_TREATMENT_OUTCOME`.
- Map RCIS Korean region-name pairs to SGIS 2024 canonical regions with a
  deterministic, reviewed crosswalk (no silent fuzzy matching); report unmatched,
  ambiguous, and city-vs-city-district-mismatch records and exclude them.
- Preserve sanitized raw responses and source/transformation provenance; update
  RCIS freshness only after a successful run; verify idempotent second run.

Required checks before completion (met):

- All four PIDs live-validated for 2024 (`E000`).
- Data mapped to canonical SGIS regions without silent fuzzy matching.
- Migration `0003` and Docker/PostGIS integration tests pass.
- Dry-run and write CLI modes work through the Compose ingestion service.
- Identical second write creates no duplicate rows.
- Formatting, linting, type checking, compile checks, and tests pass.
- No secret, access token, fixture fallback, or sample data used for writes.

Later Phase 2 subphases will cover RCIS facilities (Phase 2.3), VWorld structural spatial data, AirKorea, and KMA. They must not begin until explicitly scoped. RCIS facility ingestion is not implemented.

## Phase 3: Backend Product API Foundation

Goal: serve normalized official data and metadata to the frontend through backend APIs beyond the Phase 1 data-operations endpoints.

Planned deliverables:

- FastAPI endpoints for initial normalized datasets.
- Pydantic response models requiring source and reference period.
- Error responses for unavailable data.
- No frontend exposure of government API credentials.

Required checks before completion:

- Backend unit and integration tests pass.
- API responses include required metadata.
- Type checking passes.

## Phase 4: Interactive Map Prototype

Goal: build the first MapLibre GL interface using backend-provided data.

Planned deliverables:

- Map view covering Seoul, Incheon, and Gyeonggi-do.
- Layer controls and legends.
- Metric display with source and reference period.
- Clear labels for annual, monthly, periodically updated, and real-time data.

Required checks before completion:

- Frontend tests pass.
- Playwright smoke test confirms map loads.
- Frontend does not call Korean government APIs directly.

## Phase 5: Equity And Suitability Analysis

Goal: implement documented spatial analysis and facility-siting decision support.

Planned deliverables:

- Equity indicators.
- Suitability constraints and scoring.
- Spatial joins, buffers, and aggregation.
- Assumption and weighting documentation.
- Review workflow for analytical outputs.

Required checks before completion:

- Analytical tests cover scoring and edge cases.
- Every metric includes source and reference period.
- Real-time readings are not treated as permanent siting evidence.
- Waste origin-to-destination movement is used only when explicitly sourced.

## Phase 6: Automated Refresh And Operations

Goal: run periodic data refresh through a separate scheduler process.

Planned deliverables:

- Scheduler process.
- Source-specific refresh schedules.
- Job status and logging.
- Retry and alerting conventions.
- Reproducibility documentation.

Required checks before completion:

- Scheduler tests pass.
- Failed ingestion is visible.
- Idempotency is verified for each job.
