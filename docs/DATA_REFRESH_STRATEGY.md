# Data Refresh Strategy

Refresh jobs must be idempotent, preserve sanitized raw responses, and fail visibly when official data is unavailable. They must never silently replace unavailable real data with fixture or sample data.

## Refresh Matrix

| Source/data | Check frequency | Expected publication frequency | Incremental-load key | Deduplication strategy | Freshness warning threshold | Retry policy | Failure behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Annual official waste statistics | Monthly check for new annual release | Annual | `source_id`, `reference_year`, `waste_category`, `region_code_or_label`, `metric_code` | Upsert by full natural key plus transformation version | Warn if latest reference year is more than 18 months behind current date or later than official expected registration date | 3 attempts with exponential backoff, then manual review | Mark source stale; do not substitute sample data. |
| Monthly or periodic waste records, if available | Weekly after source discovery | UNVERIFIED | `source_id`, `reference_period`, `region_code_or_label`, `record_type` | Upsert by source primary fields and retrieval metadata | Source-specific after endpoint validation | 3 attempts; stop on provider-level schema change | Mark UNVERIFIED/stale until real source recovers. |
| Population data | Quarterly check | Census or official statistical release cadence | `source_id`, `reference_year`, `sgis_adm_cd`, `population_type` | Replace partition by reference year and geography after validation | Warn if selected population year is not aligned with metric documentation | 3 attempts; no retry storm | Keep last verified version with stale warning. |
| MOIS monthly resident-registration population (행정동별 주민등록 인구 및 세대현황) | Monthly check for the new month | Monthly (month-end values) | `source_id`, `region_id`, `reference_month`, `population_definition` | Idempotent upsert on the monthly natural key (partial unique index scoped to `population_temporal_granularity='MONTHLY'`); a revised month updates in place and reports `rows_updated > 0` | Warn if the latest reference month is more than 60 days behind the current month, or behind the month the official page reports as published | Bounded retries on the official download; never retried into a storm | Mark stale; serve `null` + `NO_MATCHING_POPULATION_PERIOD` for uncovered periods. Never interpolate, project, or borrow an adjacent month, and never fall back to the SGIS annual series. |
| Administrative boundaries | Quarterly check and before major analysis releases | Periodic/versioned | `source_id`, `boundary_year`, `adm_cd`, `geometry_hash` | Versioned insert; never overwrite prior boundary version | Warn if metric uses boundary older than selected population/waste period without note | 3 attempts; schema validation required | Block new spatial outputs if boundary version is unresolved. |
| Waste-facility information | Monthly check after source validation | UNVERIFIED | `source_id`, `facility_id_or_name`, `address`, `reference_date` | Match on official ID if available; otherwise reviewed composite key | Warn after 90 days without refreshed facility status unless annual source dictates otherwise | 3 attempts, then manual source review | Preserve previous verified data with stale warning; do not infer closures or capacities. |
| AirKorea real-time observations | Every 10-15 minutes for selected stations, respecting traffic limits | Real-time/hourly operational updates | `station_name_or_id`, `data_time`, `pollutant` | Ignore exact duplicate station/time/pollutant records | Warn when observations are older than 2 hours | Retry twice with short backoff; skip cycle on repeated provider failure | Display unavailable/stale status; do not use stale real-time values as current. |
| KMA weather observations and forecasts | Every 30-60 minutes by unique grid and base time | Real-time forecast cycle | `nx`, `ny`, `base_date`, `base_time`, `category`, `forecast_time` | Upsert by grid/base/forecast/category | Warn when current context is older than 2 hours or forecast base is superseded | Retry twice with provider-aware base-time fallback only if documented | Display unavailable/stale status; do not invent weather. |
| VWorld structural spatial datasets | Monthly metadata check; refresh on new dataset date | Documented per dataset (Phase 2.5A): LSMD zone bulk 변경발생시, NA_24 용도지역지구 전체 매월/변동 매일, NGII 도로중심선 연간, 표준노드링크 수시, ownership bulk 매년/매월 | `dataset_id`, `dataset_reference_date`, `feature_id_or_geometry_hash` (API feature-id stability across provider refreshes is unverified — prefer geometry hash + attributes) | Versioned spatial loads; keep prior geometries | Warn if zoning/cadastral data are more than 90 days behind VWorld metadata or source-specific threshold | Retry download/API 3 times; checksum and schema validation; `OVER_REQUEST_LIMIT` is not retried within the same window | Block affected siting screens until layer status is clear. |

## Idempotency Rules

- Every run records a run ID, source, reference period, retrieval timestamp, request fingerprint, response fingerprint, and transformation version.
- Re-running a job with the same source payload and transformation version must not duplicate records.
- New transformations of the same raw payload must produce a new derived version, not overwrite old derived results.

Phase 2.1 SGIS behavior:

- SGIS normalized regions are upserted by canonical region code derived from
  exact SGIS `adm_cd`.
- SGIS population rows are upserted by region, reference year, source, and
  population definition.
- Re-running the same `sgis-ingest --year 2024 --scope capital-region --write`
  command must not create duplicate regions or population rows.
- Exact sanitized SGIS data responses are retained by endpoint, reference
  period, response hash, and transformation version. Repeated live requests may
  add raw-response rows when SGIS provider transaction metadata changes, while
  normalized rows remain idempotent.

## Raw Response Rules

- Store only sanitized raw responses or source files.
- Redact service keys, API IDs, access tokens, signatures, authorization headers, and credential-like query parameters.
- Store samples and probes under `data/samples/` only when marked `LIVE_VERIFIED` or `FIXTURE_ONLY`.
- Do not commit live response samples unless a later governance phase explicitly approves that storage pattern.
- SGIS Phase 2.1 stores sanitized production API data responses in the database,
  not in committed sample files. Authentication tokens are not stored.

## Phase 2.1 SGIS Production Refresh

Current implementation status:

- Implemented as an explicit one-shot CLI job, not a scheduler.
- Production command:

```bash
python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 \
  --scope capital-region \
  --write
```

- Dry-run/validation command:

```bash
python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 \
  --scope capital-region \
  --dry-run
```

- Docker one-shot command:

```bash
docker compose --profile ingestion run --rm ingestion \
  sgis-ingest --year 2024 --scope capital-region --write
```

The selected SGIS reference year is `2024`, the latest year live-verified as
mutually compatible across Seoul, Incheon, and Gyeonggi-do population and
boundary endpoints during Phase 2.1. Source CRS is recorded as `EPSG:5179` and
PostGIS storage CRS is `EPSG:4326`.

Dataset freshness is updated only after the SGIS job completes successfully.
Failed SGIS runs remain visible in `ingestion_runs`, retain sanitized error
categories, and must not update `last_success_at`.

## Phase 2.2 RCIS Waste Production Refresh

Implemented as an explicit one-shot CLI job (`rcis-waste-ingest`), not a
scheduler. Source id `waste_statistics`; reference year 2024; PIDs `NTN007`,
`NTN008`, `NTN018`, `NTN022`; 2020-onward schema era only.

```bash
python -m waste_equity_ingestion.cli rcis-waste-ingest \
  --year 2024 --scope capital-region --dry-run
python -m waste_equity_ingestion.cli rcis-waste-ingest \
  --year 2024 --scope capital-region --write
docker compose --profile ingestion run --rm ingestion \
  rcis-waste-ingest --year 2024 --scope capital-region --write
```

Idempotency and deduplication:

- Normalized `regional_waste_statistics` rows are upserted by
  `(region_id, reference_year, source_pid, waste_category_name)`. Re-running the
  same year/scope creates no duplicate waste rows and no duplicate crosswalk
  rows; the normalized count stays stable.
- Provenance fields (retrieved-at, ingestion-run id, raw-response id) are
  refreshed only when the material official values change, so an identical
  re-run reports zero inserts and zero updates.
- Each RCIS response carries fresh transaction metadata (`result[0].callId`), so
  identical re-runs append new sanitized raw-response rows (deduplication is by
  exact response hash), while normalized rows remain idempotent — the same
  behavior documented for SGIS.
- Counters are capital-region-scoped: `rows_received` counts in-scope source
  grand-total records; `rows_inserted`/`rows_updated`/`rows_rejected` count
  database row operations / in-scope records excluded from writes. One source
  grand-total record maps to at most one normalized row.

Dataset freshness (`waste_statistics`) is updated only after a successful run.
Failed RCIS runs remain visible in `ingestion_runs`, retain a sanitized error
category, roll back partial normalized writes, and do not update
`last_success_at`. Provider quota errors (`E005`/`E006`) are not retried; only
transient network failures get bounded retries. The dry-run makes real RCIS
requests and never falls back to local samples.

## Phase 2.3 RCIS Facility Production Refresh

Explicit one-shot CLI job (`rcis-facility-ingest`), not a scheduler. Source id
`waste_statistics`; year 2024; PIDs `NTN031`, `NTN032`, `NTN033`, `NTN040`,
`NTN043`, `NTN046`.

```bash
python -m waste_equity_ingestion.cli rcis-facility-ingest \
  --year 2024 --scope capital-region --write
docker compose --profile ingestion run --rm ingestion \
  rcis-facility-ingest --year 2024 --scope capital-region --write
```

- `waste_treatment_facilities` rows are upserted by
  `(source_pid, reference_year, source_row_index)`. Facilities have no official
  id and can share every business attribute, so the stable source row position
  is the reviewed identity key. Re-running the same year creates no duplicate
  rows; identical data updates nothing.
- Each RCIS response carries fresh transaction metadata (`callId`), so identical
  re-runs append new sanitized raw-response rows (dedup by exact hash) while
  normalized rows remain idempotent.
- `rows_received` counts in-scope capital-region facility lines. In-scope
  facilities are always stored (including those pending geocoding), so
  `rows_rejected` is 0; nationwide structural parse rejects are reported as a
  per-PID diagnostic.
- Freshness updates only on success; failed runs are visible, roll back, and do
  not update `last_success_at`.

## Phase 2.5A/2.5B VWorld Structural Layer Implications

The Phase 2.5A audit (2026-07-11, `docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`)
scoped the Phase 2.5B refresh design; Phase 2.5B is now in progress (2.5B-1
implements the versioned schema and zoning ingestion):

- Area-complete polygon layers should come from official bulk downloads
  (per-시도 LSMD SHP, EPSG:5186/2097; NGII 도로중심선 EPSG:5179), transformed
  to EPSG:4326 with both CRS recorded, loaded as versioned datasets by
  reference date. Phase 2.5B-1 implements this for 용도지역 (UQ111–UQ114):
  official ZIP/shapefile bulk files are placed in Git-ignored local
  directories (`data/raw/vworld/zoning/<region>/`), the CRS is read from the
  `.prj`/metadata and rejected when missing/unsupported, and each load is
  recorded as a `structural_dataset_versions` row with source/target CRS,
  checksum, feature counts, and coverage status.
- API-side refresh must use 2D Data API paging (`size` ≤ 1000, verified
  `page`/`record` metadata); WFS `startindex` paging did not work under
  version 1.1.0 and must not be relied on.
- Production storage of these datasets is authorized for this project: the
  project owner has confirmed prior government-project authorization for use,
  storage, transformation, and analytical processing, resolving the audit-time
  VWorld 제19조 storage-consent and CC BY-NC-ND uncertainty for this project.
  Bulk source files themselves are never committed (Git-ignored); only
  sanitized normalized features, provenance, and checksums are persisted.

## V2 Phase 3 MOIS Population Refresh

Source: 행정안전부 주민등록 인구통계, dataset **행정동별 주민등록 인구 및 세대현황**
(https://jumin.mois.go.kr/statMonth.do). Monthly, month-end. Scope: 서울특별시 /
인천광역시 / 경기도 only, 2008-01 onward. Full contract:
`docs/MOIS_POPULATION_2008_2026.md`.

```bash
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  mois-population-ingest --scope capital-region --start-month 2008-01 --dry-run
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  mois-population-ingest --scope capital-region --start-month 2008-01 --write
```

- The latest published month is **discovered from the official page**, so a new
  month needs no code change. `--end-month` pins it explicitly if required.
- The dry run must report `missing_months: []` and
  `found_month_count == expected_month_count` before any write. It writes nothing
  and exits non-zero when coverage cannot be validated.
- A month MOIS has not yet published is returned by the endpoint as a CSV of
  **zeros**, not an error; non-positive values are rejected, so a stale request
  can never store a population of 0.
- Re-running is idempotent (`0 inserted / 0 updated / N unchanged`).
- Raw official CSVs stay in the Git-ignored `data/raw/mois_population/`; only the
  SHA-256 and byte length are persisted, and the files are never committed.
- **Never** run this alongside an unrelated ingestion, and never let it touch the
  annual SGIS rows: the two series coexist, distinguished by
  `population_temporal_granularity`.

## Phase 0.6 Refresh Implications

- SGIS source-registry and code-crosswalk planning from Phase 0.6 has been
  superseded by Phase 2.1 live production validation for canonical geography and
  population. Metrics still require later RCIS and cross-source mapping work.
- VWorld cadastral refresh planning can proceed for small-area probes; large-area Seoul/Incheon/Gyeonggi coverage should use official downloads or tiled requests that respect VWorld limits.
- Waste-statistics refresh can be planned for live-verified `NTN001` management-area records. Generation/treatment refresh remains blocked until the relevant PIDs are live-validated for fields, units, and accounting basis. Use `RCIS_API_KEY` as the only required RCIS secret; use `RCIS_USER_ID` only as non-secret `USRID` request configuration.
- AirKorea and KMA refresh schedules remain documented but not live-verified locally.
