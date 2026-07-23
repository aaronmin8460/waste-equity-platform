# Waste Equity Platform

Waste Equity Platform is a planned public-data analysis platform for waste-management equity and potential waste-facility location recommendations across the Seoul Metropolitan Area.

The first implementation scope covers the full Seoul Metropolitan Area:

- Seoul
- Incheon
- Gyeonggi-do

This repository currently contains project governance documents, the Phase 0 local API-probe package (with live-verified RCIS, SGIS, and VWorld contracts), the Phase 1 backend infrastructure, production ingestion for SGIS geography/population (2.1), RCIS waste statistics (2.2), RCIS waste-treatment facilities (2.3), and VWorld facility geocoding (2.4), the Phase 2.5A VWorld structural-layer feasibility audit ([docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md](docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md), recommendation CONDITIONAL_GO), the Phase 3 backend product API, the Phase 4 interactive MapLibre GL frontend, and the Phase 5.1/5.2 derived equity indicators (per-capita waste generation; facility burden with geodesic buffers) documented in [docs/ANALYTICAL_METHODS.md](docs/ANALYTICAL_METHODS.md). Phase 2.5B (VWorld structural-layer production ingestion) is complete: the versioned structural-layer schema and the mandatory structural package are production-ingested for Seoul/Incheon/Gyeonggi — 용도지역 zoning (88,252), protected/restricted areas (20,892), and road/road-network lines (2,971,494) — via the `vworld-zoning-ingest`, `vworld-protected-ingest`, and `vworld-roads-ingest` CLIs (see [docs/PHASE_2_5B_INGESTION_STATUS.md](docs/PHASE_2_5B_INGESTION_STATUS.md)). Prior government-project authorization for use, local storage, transformation, and analytical processing of the relevant VWorld/government spatial datasets has been confirmed by the project owner. Phase 5.4 completes the **suitability screening**: a reproducible 500 m candidate grid scored under the project-approved analytical screening policy v1 (`suitability-build` CLI, `/api/v1/suitability` API, and an Equity/Suitability dashboard) — analytical decision-support only, never a legal/permit determination (see [docs/SUITABILITY_POLICY_V1.md](docs/SUITABILITY_POLICY_V1.md)). The suitability map serves the **complete** candidate grid as PostGIS Mapbox Vector Tiles (MVT) — the viewport transfers only the tiles it needs, with no partial-map row limit — documented in [docs/SUITABILITY_VECTOR_TILES.md](docs/SUITABILITY_VECTOR_TILES.md). Policy **v2** (`suitability-policy-v2` / `suitability-screening-v3`) adds, purely additively, a run-specific **CRITIC data-derived weight profile** (weights computed from the variation and non-redundancy of the four component scores among complete ELIGIBLE candidates — not expert/AHP weighting, not a policy-importance judgment) and per-candidate **weight-sensitivity stability** (top-10% membership across baseline/equal/critic), documented in [docs/SUITABILITY_CRITIC_STABILITY.md](docs/SUITABILITY_CRITIC_STABILITY.md); the four static profiles and all screening rules are unchanged, and "stable" is a sensitivity indicator, never legal eligibility. A read-only **user-weight scenario lab** (가중치 실험실) additionally lets citizens temporarily recombine the four component scores of one fixed succeeded run under their own Z/R/E/D weights, entirely on read — no database write, no migration, no new official run, and no change to stored profiles, CRITIC, or stability; it carries its own separate method version `user-weight-scenario-v1` and is never persisted (see [docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md](docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md)). It does not yet contain AirKorea/KMA ingestion (credentials missing) or scheduler automation.

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

Phase 0 established governance, planning, and live data-source validation through Phase 0.7 (RCIS PID discovery, recommendation GO). Phase 1 added the Docker Compose infrastructure, PostGIS database, core metadata schema, and backend health/data-operations API. Phase 2 (2.1–2.4) ingested SGIS geography/population, RCIS waste statistics and facilities, and VWorld facility geocoding. Phase 2.5A audited the VWorld structural spatial layers (zoning, protected areas, roads, ownership) with live contract probes — recommendation CONDITIONAL_GO. Phase 2.5B production ingestion is complete (versioned structural-layer schema and the mandatory zoning + protected/restricted + road package for Seoul/Incheon/Gyeonggi); prior government-project authorization for use, storage, transformation, and analytical processing of the datasets has been confirmed by the project owner, resolving the audit-time licensing/storage-consent uncertainty for this project. Phase 3 added the read-only product API over the normalized tables. Phase 4 added the interactive MapLibre GL map frontend. Phase 5.1–5.3 added the derived equity indicators (per-capita generation; facility burden with geodesic buffers) and the analytical methods/review-workflow documentation; Phase 5.4 completes the suitability screening — a reproducible 500 m candidate grid scored under analytical screening policy v1 ([docs/SUITABILITY_POLICY_V1.md](docs/SUITABILITY_POLICY_V1.md)), live-verified against the real database. AirKorea/KMA ingestion remains blocked on credentials; scheduler automation (Phase 6) has not been started.

V2 Phase 1 added the capital-region **수도권매립지 반입** feature — the two official Sudokwon Landfill Corporation odcloud datasets (inbound quantity `15064381` + inbound fee `15064394`), joined 1:1 at a metropolitan (서울시/인천시/경기도) monthly grain, behind read-only `/api/v1/landfill` endpoints. V2 Phase 2 replaced that mode's schematic straight-line map with a **full-width data dashboard**: the source reports metropolitan totals only and declares no municipal origin, no route, and no destination coordinate, so the map implied a movement path the data cannot support and was removed rather than re-labelled. The 형평성 (Equity) and 적합성 (Suitability) maps are unchanged. Phase 2 derived **주민 1인당 환산 반입수수료** (`LANDFILL_INBOUND_FEE_PER_CAPITA`) against the annual SGIS population; **V2 Phase 3 supersedes it with `landfill-fee-per-capita-v2`**, denominated by the official **행정안전부 주민등록 인구통계** monthly series (행정동별 주민등록 인구 및 세대현황, 2008-01 → 2026-06, 서울/인천/경기; `전체 = 거주자 + 거주불명자 + 재외국민`, 외국인 제외). The denominator is the **exact month the period requires** — the selected month, December of a complete year, or the final month actually included in a partial year's fee — and is never borrowed from a neighbouring month, another year, or a month later than the fee itself. A missing period is served as `null` with an explicit reason (`NO_MATCHING_POPULATION_PERIOD`), never zero-filled; SGIS is never a landfill fallback and remains the unchanged Equity denominator. The MOIS total-population definition changed at 2010-10 (거주불명자) and 2015-01 (재외국민), so long-run comparisons are **not** like-for-like — the caveat is served with the data. Method and source contract: [docs/MOIS_POPULATION_2008_2026.md](docs/MOIS_POPULATION_2008_2026.md).

Phase 7 completes a **citizen-language, plain-Korean redesign** and the final
product features. The top navigation is now **지역 부담 / 후보지 분석 / 매립지 현황 /
데이터·출처**, statuses read **스크리닝 통과 / 추가 검토 필요 / 프로젝트 스크리닝 제외**, and
technical terms/versions/codes are demoted to "자세히 보기" detail layers — analytical
honesty unchanged (missing ≠ zero, no legal/final/cost-complete claims).

A follow-on **suitability transparency pass (Phase 0)** clarifies that 후보지 분석 is a
**regional analytical screening**, not a siting decision: every 후보지 분석 sub-view heads
with a standing analytical-screening disclaimer (`본 화면은 … 광역 후보지 스크리닝입니다 …`),
the misleading component terms are renamed to what is actually measured
(`용도지역 호환성`, `도로 근접성 대리지표`), each screening status carries a plain-Korean
meaning, and a "현재 분석에 포함되지 않은 항목" disclosure lists the physical/environmental
conditions the screen does **not** yet evaluate (경사·지질·지하수·토지피복·건축물·홍수·부지
규모·소유권·차량 진입·현장조사/EIA). It is **presentation- and disclosure-only** — no score,
weight, rank, status, exclusion rule, or stored record changed. See
[docs/SUITABILITY_PHASE_0_TRANSPARENCY.md](docs/SUITABILITY_PHASE_0_TRANSPARENCY.md). The 지역 부담
view adds **regional ranking** (값이 높은/낮은 지역, scope + top-N, map-synced), a
searchable **2–3 region comparison**, a versioned validated **shareable URL**,
injection-safe **CSV export**, and a **print/PNG report** (the PNG excludes the
interactive map). A new **데이터·출처** center shows sources, reference periods, served
counts, suitability versions, cost-model inputs/omissions, and a **facility mapping
transparency** panel (paginated un-mapped facilities; the recorded reason or
"실패 사유 기록 없음" — never fabricated), backed by the read-only
`GET /api/v1/facilities/mapping-transparency` endpoint (no migration; Alembic head
unchanged). See [docs/CITIZEN_LANGUAGE_AND_UX.md](docs/CITIZEN_LANGUAGE_AND_UX.md).

**Suitability Phase 1A** prepared an environmental-data foundation for a future
suitability expansion: an audit of 15 candidate datasets, a layer architecture, a
backend layer registry with inert pipeline interfaces, an empty ingestion
framework, and one additive catalogue table (`environmental_layer_registry`).
Foundation only — no score, weight, rank, candidate status, API contract, or
frontend calculation changed.

**Suitability Phase 1B-0** verified the first of those datasets against a real
file: the **국립생태원 내륙습지 공간데이터 및 속성정보** inland wetland inventory
(공공데이터포털 `15086410`, 2,704 features, EPSG:5186 confirmed from the `.prj`,
UTF-8 confirmed from the `.cpg`, 0 invalid/null/empty geometries, unique `CODE`).
The dataset has completed **local contract verification only** — recommendation
**GO for Phase 1B ingestion**. It is **not ingested into PostGIS** and **not used
in scoring**; no score, rank, candidate status, policy version, or production
behaviour changed. It must stay separate from the statutory 습지보호지역 layer
(`UM901`) already ingested: `UM901` is a designated protection area with legal
effect and includes coastal 연안습지, while the inventory is a survey of inland
wetlands that confers no status (only 1 of 232 capital-region inventory features
carries any designation note). The raw dataset is local-only and Git-ignored.
Contract: [docs/WETLAND_INVENTORY_DATA_CONTRACT.md](docs/WETLAND_INVENTORY_DATA_CONTRACT.md);
observed values: [docs/WETLAND_INVENTORY_VALIDATION_REPORT.md](docs/WETLAND_INVENTORY_VALIDATION_REPORT.md).

See:

- [AGENTS.md](AGENTS.md)
- [Citizen Language & UX](docs/CITIZEN_LANGUAGE_AND_UX.md)
- [Project Specification](docs/PROJECT_SPEC.md)
- [Development Phases](docs/DEVELOPMENT_PHASES.md)
- [Data Requirements](docs/DATA_REQUIREMENTS.md)
- [Analytical Methods](docs/ANALYTICAL_METHODS.md)
- [Capital-Region Landfill Inbound](docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md)
- [MOIS Monthly Population 2008–2026](docs/MOIS_POPULATION_2008_2026.md)
- [Phase 0 Findings](docs/PHASE_0_FINDINGS.md)
- [Suitability Environmental Data Audit](docs/SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md)
- [Wetland Inventory Data Contract](docs/WETLAND_INVENTORY_DATA_CONTRACT.md)
- [Wetland Inventory Validation Report](docs/WETLAND_INVENTORY_VALIDATION_REPORT.md)

# waste-equity-platform
