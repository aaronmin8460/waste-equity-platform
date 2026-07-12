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

Status: subphases 2.0–2.4 complete. Remaining subphases (VWorld structural
spatial layers, AirKorea, KMA) are blocked on explicit scoping and, for
AirKorea/KMA, on credentials (CREDENTIAL_MISSING); Phase 3 proceeds first.

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

### Phase 2.3: RCIS Waste-Treatment Facility Ingestion

Status: complete (implemented 2026-07-08; live verification gates passed
2026-07-09 — dry-run VALIDATED on all six PIDs, 651 in-scope facilities,
write + identical second write idempotent with zero identity-key duplicates).

Deliverables:

- Reuse the RCIS client, provider-code handling, sanitization, ingestion-run
  framework, and the Phase 2.2 region crosswalk.
- Live-validate and ingest the six facility PIDs (`NTN031`, `NTN032`, `NTN033`
  public; `NTN040`, `NTN043`, `NTN046` private) for `YEAR=2024`.
- Add and populate normalized `waste_treatment_facilities` (Alembic revision
  `0004`): one row per reported facility line, typed core (identity, address,
  category, capacity, throughput, residue, landfill volume/area, permit dates) +
  `source_fields` JSONB; accounting basis `FACILITY_LOCATION_BASED_THROUGHPUT`.
- Retain in-scope facilities that do not map to a single SGIS region with a
  `region_mapping_status` (multi-district-city facilities → `REQUIRES_GEOCODE`).
- Add a nullable POINT `geometry` column; geocoding is deferred to a later
  VWorld phase and is not performed here.
- Verify idempotent second run (identity `(source_pid, reference_year,
  source_row_index)`).

### Phase 2.4: VWorld Facility Geocoding

Status: complete (2026-07-09). Live results: 547 of 651 facilities geocoded;
97 of 99 REQUIRES_GEOCODE facilities resolved to GEOCODED_MATCH via
point-in-polygon with all cross-checks; 104 non-geocodable addresses kept as
the explicit GEOCODE_FAILED review queue with NULL geometry; zero
point-in-polygon disagreements with Phase 2.3 EXACT_MATCH assignments;
identical second run made zero API calls and zero row changes.

Goal: resolve facility point locations and multi-district region assignment
using the official VWorld geocoder, without fabricating coordinates.

Deliverables:

- Live-validate the VWorld geocoder contract (`/req/address`, `getcoord`)
  including request type (road/parcel), response status values, refined
  address, match level, and CRS, and record it in
  `docs/API_CONTRACTS/vworld.md`.
- Geocode `waste_treatment_facilities` addresses (RCIS `ADDR` prefixed with the
  RCIS sido/sigungu names) to EPSG:4326 POINT `geometry`, preserving the
  geocoder match level, refined address, request timestamp, and sanitized raw
  responses with ingestion-run lifecycle records under the `vworld` source.
- Resolve `REQUIRES_GEOCODE` facilities to a single canonical region via
  point-in-polygon against SGIS region geometry; set a distinct
  `region_mapping_status` (for example `GEOCODED_MATCH`).
- Never invent coordinates: geocoder misses keep `geometry` NULL with an
  explicit failure status (for example `GEOCODE_FAILED`) and are listed in the
  run report for review.
- Idempotent re-run: unchanged addresses are not re-geocoded and re-runs
  produce zero row changes.
- Respect VWorld request quotas with an inter-request delay.

Required checks before completion:

- Live geocoder contract validation succeeds and is documented.
- Dry-run and write CLI modes work.
- Second identical run produces zero row changes.
- Point-in-polygon assignments agree with the RCIS sido for every facility
  (mismatches are flagged, not silently accepted).
- Formatting, linting, type checking, compile checks, and tests pass.
- No secret, fixture fallback, or fabricated coordinate is written.

### Phase 2.5A: VWorld Structural Spatial Layer Feasibility Audit

Status: complete (2026-07-11). Documentation, official-source research, and
live-contract-validation subphase; no production ingestion, migrations, or
scoring.

Delivered:

- `docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`: official-source evidence, live
  contract findings, provider limits/licensing, CRS documentation, coverage
  strategy, and the **CONDITIONAL_GO** recommendation for Phase 2.5B.
- `docs/SUITABILITY_DATA_REQUIREMENTS.md`: mandatory/optional/informational/
  unavailable inputs, unresolved policy and legal decisions, and the minimum
  package required to unblock Phase 5.4.
- Reusable probe command `vworld-structural-audit`
  (`ingestion/src/waste_equity_ingestion/probes/vworld_structural.py`) with
  fixture contract tests; sanitized Git-ignored samples for every live probe.
- Live results: 14 officially documented WFS/2D structural layers and the 2
  NED layers (토지소유 `dt_d160`, 토지이용계획 `dt_d154`) LIVE_VERIFIED
  across small Seoul/Incheon/Gyeonggi bounding boxes; WFS 1.1.0 `startindex`
  paging defect and a malformed provider JSON error body recorded.

### Phase 2.5B: VWorld Structural Layer Production Ingestion

Status: in progress.

Authorization: this project is conducted with a government partner. The
project owner has confirmed that prior government-project authorization for
the use, local storage, transformation, database ingestion, and analytical
processing of the relevant VWorld and government spatial datasets has been
obtained. The 2.5A audit-time licensing/storage-consent uncertainty (VWorld
terms 제19조 vs KOGL/CC BY-NC-ND signals) is therefore resolved for this
project by that prior authorization; it is no longer a blocker for Phase 2.5B.
No approval number, date, contact, or confidential document is recorded here —
only that the project owner has confirmed the authorization.

The remaining 2.5A preconditions are still engineering work, not blockers: a
reproducible bulk-download workflow (documented manual placement of official
archives into Git-ignored local directories, with checksums), and
full-coverage completeness validation per 시도.

Subphases:

- **2.5B-1: versioned structural spatial ingestion foundation and zoning —
  zoning now live-ingested.** Reusable official bulk spatial-file (ZIP/shapefile)
  ingestion infrastructure, normalized versioned structural-layer schema
  (`structural_dataset_versions`, `structural_features`), and zoning ingestion
  for 용도지역 UQ111–UQ114 (도시/관리/농림/자연환경보전지역) via the
  `vworld-zoning-ingest` CLI (dry-run/write, `capital-region` scope). CRS is
  read from the source `.prj`/metadata (including the ESRI-WKT EPSG authority
  used by official LSMD files), rejected when missing or unsupported, and
  transformed to EPSG:4326 for PostGIS. Coverage is validated as a
  region-by-layer completeness matrix distinguishing evaluated-with-features,
  evaluated-with-zero-features, not-evaluated, source-missing,
  validation-failure, and `OFFICIAL_SOURCE_UNAVAILABLE` (a Git-ignored
  `source_manifest.json` records layers the official source does not publish).
  **Live result (2026-07-12):** the 9 official LSMD ZIPs (release 202606,
  EPSG:5186 → 4326) ingested **88,252 features** (538 invalid polygons rejected,
  not repaired); Seoul UQ112–114 are `OFFICIAL_SOURCE_UNAVAILABLE`; coverage
  `COMPLETE_FOR_AVAILABLE_SOURCES`; idempotent second write inserted 0. See
  `docs/PHASE_2_5B_INGESTION_STATUS.md`. Protected areas, roads, ownership,
  sensitive facilities, and per-parcel land-use are out of scope for this
  subphase.
- **2.5B framework extension (in progress): protected + road loaders.** The
  versioned structural schema is extended with a `structural_line_features`
  table (MULTILINESTRING/4326, migration 0007) so road/transport line geometry
  is not forced into the polygon table, and a generalized loader
  (`structural_layer_ingestion.py` + `structural_layers.py` registry) ingests
  the mandatory protected/restricted polygon layers (UD801, UM710, UM901,
  UF151, WGISNPGUG, UO101, UO301; optional UM221, UQ162) via
  `vworld-protected-ingest` and the road line layers (STDLINK, N3A0020000,
  MOCTLINK) via `vworld-roads-ingest`. The framework is PostGIS-verified with
  synthetic fixtures; **no official structural data has been ingested yet**
  because the official bulk downloads are browser-mediated (manual download
  required — see `docs/PHASE_2_5B_INGESTION_STATUS.md` for the checklist and
  the current all-`SOURCE_MISSING` completeness state).

Later Phase 2 subphases will also cover AirKorea and KMA (both currently
CREDENTIAL_MISSING). They must not begin until explicitly scoped.

Phase 5.4 remains blocked until zoning, the mandatory protected/restricted
layers, and road features are all production-ingested with complete Seoul,
Incheon, and Gyeonggi-do coverage and the required analytical policy decisions
are recorded.

## Phase 3: Backend Product API Foundation

Status: complete (2026-07-09). Live smoke against the docker database served
the real 2024 datasets with counts matching the Phase 2 ingestion totals
exactly: 82 regions (3 SIDO + 79 SIGUNGU GeoJSON boundaries), 82 population
rows, 234 waste-statistics rows, 651 facilities (547 with coordinates, 104
explicit failed geocodes with null coordinates, zero rows where coordinate
presence disagrees with geocode status); structured 404s verified for an
unavailable year and an unknown region code.

Goal: serve normalized official data and metadata to the frontend through backend APIs beyond the Phase 1 data-operations endpoints.

Deliverables:

- Read-only `GET /api/v1` dataset endpoints backed solely by the normalized
  tables (no live government API calls from request handlers):
  - `regions` — canonical region list for a boundary vintage year (no
    geometry payload).
  - `regions/boundaries` — GeoJSON FeatureCollection of region boundaries
    (EPSG:4326, served exactly as stored, no simplification or rounding).
  - `population` — SGIS regional population.
  - `waste-statistics` — RCIS origin-based regional waste statistics
    (accounting basis `ORIGIN_BASED_TREATMENT_OUTCOME` exposed per item).
  - `facilities` — RCIS waste-treatment facilities (accounting basis
    `FACILITY_LOCATION_BASED_THROUGHPUT` exposed per item), with EPSG:4326
    longitude/latitude only where VWorld geocoding succeeded; failed
    geocodes stay NULL (no fabricated coordinates), with
    `region_mapping_status`/`geocode_status` visible for review.
- Every dataset item carries required (non-optional) `source_id` and
  reference-period fields; a row missing provenance fails response
  validation visibly rather than being served unsourced.
- The two accounting bases stay on separate endpoints and are never merged
  or conflated.
- Dataset responses use an envelope echoing the resolved `reference_year`
  (default: latest year available in the database) and row `count`.
- Unavailable data returns a structured `404` error body (error code,
  requested year, available years) instead of an empty `200`; unknown
  `region_code` filters return a structured `404`; legitimately empty
  filtered results within an available year return `200` with `count: 0`.
- No new migrations; no credentials are read, logged, or exposed by any
  endpoint.

Required checks before completion:

- Formatting, linting, strict type checking, and tests pass in both packages.
- Unit tests cover parameter-validation and error paths; integration tests
  (TEST_DATABASE_URL, synthetic rows at an isolated reference year, rolled
  back) cover data-bearing responses against real PostGIS.
- Live smoke check: the API served from the docker compose database returns
  the real 2024 datasets with counts matching the ingested totals and
  correct source/reference-period metadata.
- No mock data, fixture fallback, or fabricated coordinate/metric is served.

## Phase 4: Interactive Map Prototype

Status: complete (2026-07-10). Live-verified with the backend serving the
real 2024 datasets: map rendered the 79-SIGUNGU choropleth and 547 of 651
facilities (the 104 without official coordinates reported in the sidebar,
never drawn); metric panel showed source, reference period, publication
frequency, and accounting basis; Playwright smoke passed, including the
guard that no browser request left for any host other than the platform
backend and the basemap tile service; eslint, tsc, and 13 Vitest unit tests
green.

Goal: build the first MapLibre GL interface using backend-provided data.

Deliverables:

- `frontend/` package: Next.js (App Router), TypeScript, Tailwind CSS, and
  MapLibre GL, per the project spec; Vitest for unit tests and Playwright for
  the browser smoke test.
- Map view fitted to Seoul, Incheon, and Gyeonggi-do, rendering the Phase 3
  backend data only:
  - SIGUNGU choropleth layers for regional metrics served as-is (regional
    population; per-stream RCIS waste generation) — no client-side derived
    aggregates in this phase.
  - Waste-treatment facility point layer showing only facilities with
    backend-served VWorld coordinates; facilities without coordinates are
    reported as an explicit count, never placed on the map.
- Layer controls (metric selector, facility toggle) and a legend computed
  from the served values.
- Metric panel showing, for every displayed layer: official source,
  reference period, quantity unit, accounting basis where applicable, and
  the publication-frequency label (annual, monthly, periodic, real-time)
  from the backend source registry.
- The frontend requests data exclusively from the platform backend
  (`NEXT_PUBLIC_API_BASE_URL`); it never calls Korean government APIs and
  holds no credentials. Basemap tiles, if any, come from a non-government
  public tile service with attribution.
- Backend-unavailable and no-data states render explicit errors; the UI
  never falls back to bundled or fabricated data.

Required checks before completion:

- Frontend lint, type check, and Vitest unit tests pass.
- Playwright smoke test (gated on a live backend URL, mirroring the
  TEST_DATABASE_URL convention) confirms the map loads, layers render, and
  source/reference-period metadata is visible against the real database.
- Frontend does not call Korean government APIs directly and contains no
  government credentials or mock official data.

## Phase 5: Equity And Suitability Analysis

Goal: implement documented spatial analysis and facility-siting decision support.

Planned deliverables:

- Equity indicators.
- Suitability constraints and scoring.
- Spatial joins, buffers, and aggregation.
- Assumption and weighting documentation.
- Review workflow for analytical outputs.

### Phase 5.1: Per-Capita Waste Generation Equity Indicator

Status: complete (2026-07-10, PR #8). Live-verified against the real 2024
datasets: 234 SIGUNGU–stream items served with dual provenance and zero
exclusions; backend ruff/mypy/pytest (35, including PostGIS integration),
frontend eslint/tsc/Vitest (18), and the Playwright live smoke — including
the government-API egress guard — all passed.

Goal: serve the first derived equity indicator — per-capita waste generation
per SIGUNGU and waste stream — computed server-side from the normalized Phase 2
tables, with full dual-source provenance and explicit exclusion reporting.

Deliverables:

- Read-only `GET /api/v1/equity/waste-per-capita`: RCIS generation
  (`ORIGIN_BASED_TREATMENT_OUTCOME`, 톤/년) divided by SGIS total population
  for the same reference year, converted to kg/인/년 with exact `Decimal`
  arithmetic at a documented precision. No new migration; the indicator is
  computed on read and versioned with a `derivation_version`.
- A reference year is available only when both the waste statistics and the
  population dataset have rows for it; requests outside that intersection
  return the structured 404 with the intersected `available_years`.
- Every item carries both provenances (waste `source_id`/PID/reference period
  and accounting basis; population `source_id`/definition/reference period).
  The envelope names the indicator, formula, unit, derivation version, and
  documented assumptions.
- Regions that cannot be served honestly are excluded and reported in the
  envelope with a reason, never zero-filled or estimated: missing population
  denominator, zero population, or an unexpected source quantity unit
  (anything other than 톤/년 refuses to convert).
- The two accounting bases remain unmerged; facility throughput is not used.
- Frontend: per-capita metric options (one per waste stream, household as the
  headline equity indicator) in the metric selector; the metric panel labels
  the indicator as derived, shows the formula, both sources with reference
  periods, and the served assumptions; industrial per-capita carries an
  interpretation caveat. Legend formatting handles small decimal ranges
  without collapsing classes to equal rounded labels.

Required checks before completion:

- Analytical unit tests cover the derivation math (exact decimals, zero
  population, unexpected unit) and the structured 404/422 paths.
- Integration tests (TEST_DATABASE_URL, isolated year, rolled back) cover the
  served indicator, dual provenance, and exclusion reporting against PostGIS.
- Frontend lint, type check, and Vitest tests pass; backend formatting,
  linting, strict type checking, and tests pass.
- Every displayed value cites both sources and reference periods; no mock,
  estimated, or zero-filled value is served or displayed.

Required checks before completion:

- Analytical tests cover scoring and edge cases.
- Every metric includes source and reference period.
- Real-time readings are not treated as permanent siting evidence.
- Waste origin-to-destination movement is used only when explicitly sourced.

### Phase 5.2: Facility-Burden Spatial Equity Indicator

Status: complete (2026-07-10, PR #10). Live-verified against the real 2024
datasets: 79 SIGUNGU items with zero exclusions; coverage gaps served (104
facilities without coordinates, 2 without a canonical region); geodesic
buffer membership verified in PostGIS integration tests; the GiST bbox
prefilter cut the live response from 72 s to 1.7 s with byte-identical
results; backend ruff/mypy/pytest (43), frontend eslint/tsc/Vitest (20),
and the Playwright live smoke all passed.

Goal: the first spatial equity indicator — waste-treatment facility burden
per SIGUNGU — using PostGIS spatial joins and distance buffers over the
Phase 2.3/2.4 facility data, computed server-side with full provenance.

Deliverables:

- Read-only `GET /api/v1/equity/facility-burden`: per SIGUNGU of the region
  vintage, (a) facilities located in the region (canonical `region_id`
  assignment, which includes name-crosswalk matches without coordinates) with
  their summed throughput (톤/년, accounting basis
  `FACILITY_LOCATION_BASED_THROUGHPUT`) and per-capita conversion to
  kg/인/년, and (b) facilities within a documented 5,000 m geodesic buffer of
  the region boundary (`ST_DWithin` on geography; EPSG:4326 validated before
  measuring), same aggregates.
- The facility-location accounting basis is exposed on every item and never
  merged with the origin-based statistics; the endpoint serves burden, not
  waste origin.
- Reference-year availability is the intersection of the facility and
  population years; the population denominator reuses the Phase 5.1
  derivation (exact Decimal, documented precision, zero-population refused).
- Facilities without coordinates cannot participate in the buffer measure and
  facilities with no canonical region cannot be located: both counts are
  served in the envelope, and per-region items flag partial throughput sums
  (`throughput_is_partial`) whenever a summed facility had no usable
  throughput value. Nothing is fabricated to fill the gaps.
- Regions with population and zero facilities serve real zeros (an actual
  observed absence, not fill).
- Frontend: two derived burden metrics (located per capita; within-5km per
  capita) with the derived-indicator panel showing both provenances, the
  buffer definition, coverage caveats, and served assumptions.

Required checks before completion:

- Analytical tests cover aggregation, buffer membership, partial-throughput
  flagging, exclusion reporting, and the structured 404/422 paths; PostGIS
  integration tests verify the geodesic buffer against seeded geometries.
- Formatting, linting, strict type checking, and tests pass in both packages;
  Playwright live smoke passes.
- Every displayed value cites sources and reference periods; the two
  accounting bases stay separate.

### Phase 5.3: Analytical Methods, Weighting Policy, And Review Workflow

Status: complete (2026-07-10). Documentation subphase; no code changes.

Deliverables:

- `docs/ANALYTICAL_METHODS.md`: the registry of served derived indicators
  (formulas, inputs, precision, exclusion rules, caveats, derivation
  versions), the never-merge rule for the two accounting bases, the spatial
  method documentation (CRS validation, geodesic distance, conservative
  prefilters, boundary vintages), the weighting policy (no composite is
  served; adoption requirements are documented), the real-time data rule,
  the review workflow checklist for analytical outputs, and current known
  limitations.
- README status refresh to reflect the implemented platform.

### Phase 5.4: Suitability Constraints And Scoring

Status: blocked — must not begin until explicitly scoped.

Blocking prerequisites:

- The minimum structural-layer package defined in
  `docs/SUITABILITY_DATA_REQUIREMENTS.md` (zoning, protected/restricted
  areas, roads) must be production-ingested through Phase 2.5B with complete
  Seoul/Incheon/Gyeonggi-do coverage; the Phase 2.5A audit (2026-07-11) found
  the official feature sources (CONDITIONAL_GO) and Phase 2.5B is now in
  progress (2.5B-1 delivers the versioned schema and zoning ingestion), but
  the full mandatory package is not yet ingested. A suitability score without
  constraint layers would present burden/demand alone as siting suitability,
  which the data-integrity rules forbid.
- The exclusion-classification and buffer/weighting policy decisions listed in
  `docs/SUITABILITY_DATA_REQUIREMENTS.md` must be recorded. (Dataset
  storage/licensing is resolved for this project by the confirmed prior
  government-project authorization recorded under Phase 2.5B.)
- Any weighting must satisfy the adoption requirements in
  `docs/ANALYTICAL_METHODS.md` (documented rationale and sensitivity,
  review sign-off, distinct derivation version, honest UI labeling).

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
