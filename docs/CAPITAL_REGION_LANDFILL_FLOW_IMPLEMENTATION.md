# Capital-Region Sudokwon Landfill Flow — Implementation (V2 Phase 1)

Implements the **capital-region metropolitan → Sudokwon Landfill inbound-flow and
official-fee** feature verified in V2 Phase 0
(`docs/PUBLIC_DATA_INTEGRATION_PROOF.md`, `docs/SL_LANDFILL_DATA_DICTIONARY.md`,
`docs/PUBLIC_DATA_V2_RECOMMENDATION.md`).

**Scope is fixed and metropolitan-only.** Supported origins are 서울시 /
경기도 / 인천시; the verified destination is the single **수도권매립지** (Sudokwon
Landfill). A 광역 value is **never** disaggregated to a city, county, or district,
and no city/district → landfill (or → any facility) arrow is ever drawn. No
nationwide coverage, no KONEPS, no current-rate scenario.

Local live-verification date: **2026-07-14** (against the real odcloud API and a
local PostGIS database). Production was **not** changed by this work.

---

## 1. Official sources

Both datasets are published by the 수도권매립지관리공사 (Sudokwon Landfill Site
Management Corporation) through the odcloud API and share an exact 1:1 monthly
grain.

| Dataset | Title | Fields (real JSON) | Unit | Rows | Evidence |
| --- | --- | --- | --- | ---: | --- |
| `15064381` | 통합반입관리_수도권폐기물 반입량 | `마감년월`, `소재지`, `폐기물명`, `반입량` | kg | 9,212 | `OFFICIAL_REPORTED_VALUE` |
| `15064394` | 통합반입관리_폐기물반입수수료 | `마감년월`, `광역지자체명`, `폐기물명`, `반입수수료` | KRW | 9,212 | `OFFICIAL_REPORTED_VALUE` |

- Canonical grain `마감년월 × origin × 폐기물명` is unique; the two datasets join
  **1:1** (9,212 / 9,212; 0 inbound-only, 0 fee-only) — live-verified.
- Origin field contains **exactly** 서울시 / 인천시 / 경기도 (2,810 / 3,034 / 3,368
  rows). No sub-metropolitan value exists.
- Coverage 1999-08 → 2026-05. 2025 is the latest complete year; 2026 is partial
  (through 2026-05). These are derived from stored data, never hardcoded.

---

## 2. Data model

`landfill_inbound_monthly` (migration `0013`, model
`backend/src/waste_equity_backend/models/landfill_inbound.py`) — one canonical
row per `(reference_month × origin × destination × waste_name)` holding **both**
official reported values plus dual source provenance.

- **Grain / uniqueness:** `UNIQUE(reference_month, origin_region_code,
  destination_code, waste_name)`.
- **Origin:** `origin_region_code` is the platform canonical SGIS sido code
  (`KR-SGIS-11` / `KR-SGIS-28` / `KR-SGIS-41`, pinned by a check); `origin_source_name`
  is `소재지`/`광역지자체명` verbatim; `origin_region_level` is pinned to `SIDO`
  (enforces metropolitan-only at the DB level).
- **Destination:** `destination_code` pinned to `SUDOKWON_LANDFILL` (a reviewed
  constant — no existing 수도권매립지 facility record exists, and none is silently
  reused; there is no per-row destination field in the source).
- **Values:** `quantity_kg` `Numeric(20,6)`, `inbound_fee_krw` `Numeric(20,2)`,
  both `>= 0`.
- **Accounting basis:** `accounting_basis` pinned to
  `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` — a **distinct third basis**,
  never merged with `ORIGIN_BASED_TREATMENT_OUTCOME` (`regional_waste_statistics`)
  or `FACILITY_LOCATION_BASED_THROUGHPUT` (`waste_treatment_facilities`).
- **Dual provenance:** `quantity_source_dataset_id` / `fee_source_dataset_id`
  (FK `data_sources`), snapshot UUID + snapshot date per dataset,
  `quantity_evidence_status` / `fee_evidence_status`, `quantity_raw_response_id` /
  `fee_raw_response_id` (FK `raw_api_responses`), `ingestion_run_id`, and
  `retrieved_at` / `transformation_version` / `created_at` / `updated_at`.

The migration also seeds the two `data_sources` registry rows (documented
endpoints only, never credentials). Migration `downgrade()` drops the table and
those two seed rows.

---

## 3. Source discovery (never permanently hardcoded)

`ingestion/src/waste_equity_ingestion/odcloud_contract.py::select_latest_snapshot`
parses the **public** odcloud OpenAPI document and selects the latest dated
snapshot:

- OAS URL: `https://infuser.odcloud.kr/oas/docs?namespace=<DATASET_ID>/v1` (no key).
- Each `paths` entry is `/<DATASET_ID>/v1/uddi:<uuid>` with a summary ending in
  `_YYYYMMDD` (publication date). The maximum dated summary wins; the `uddi:` UUID
  is extracted from the path.
- Data URL: `https://api.odcloud.kr/api/<DATASET_ID>/v1/uddi:<uuid>` with
  `page`, `perPage`, `returnType`, and `serviceKey` query params.

Recorded per run and per row: dataset ID, selected snapshot UUID, snapshot
publication date, `retrieved_at`, and the official documentation URL. **Fails
safely** if no snapshot can be discovered, required fields change, an unsupported
origin appears, or the 1:1 join breaks.

At the 2026-07-14 snapshot: quantity `uddi:73a914ef-…` (2026-05-31), fee
`uddi:d49e4c48-…` (2026-05-31).

---

## 4. Ingestion command

Module `ingestion/src/waste_equity_ingestion/landfill_inbound.py`, CLI subcommand
`landfill-inbound` (`--dry-run` validates only; `--apply` / `--write` writes).
`DATA_GO_KR_SERVICE_KEY` is loaded from the environment only, passed as the
`serviceKey` query parameter, and is redacted (`[REDACTED]`) before any raw
response is persisted; it is never printed, returned, committed, or sent to the
frontend.

```bash
# from the repository root, with DATA_GO_KR_SERVICE_KEY in .env
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli landfill-inbound --dry-run
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli landfill-inbound --apply
```

Behavior: discover snapshots → fetch all pages (perPage=1000, bounded network
retries, refuses a short read vs `totalCount`) → normalize origins → validate
required fields / nulls / negatives / duplicates / unsupported origins → join
quantity↔fee **1:1** (a breach aborts) → preserve sanitized raw responses in
`raw_api_responses` → **idempotent upsert** (change-detected; provenance refreshed
only when material data changes; no physical DELETE) → update `dataset_freshness`
→ emit a JSON summary.

**Live verification (2026-07-14):**

- dry-run: 9,212 inbound × 9,212 fee → **9,212 joined**, 0 inbound-only, 0
  fee-only; origins exactly `KR-SGIS-11/28/41` (2,810 / 3,034 / 3,368); coverage
  1999-08 → 2026-05.
- apply: 9,212 inserted, 0 updated, 0 rejected (run id 707).
- second apply (idempotency): 0 inserted, 0 updated, **9,212 unchanged** (run id
  708); DB holds exactly 9,212 rows, 2 raw responses, freshness = 2026-05 FRESH.

---

## 5. API endpoints (read-only, `/api/v1/landfill`)

`backend/src/waste_equity_backend/api/routes/landfill.py`; aggregation helpers in
`backend/src/waste_equity_backend/analysis/landfill.py`. Every response carries
source provenance, evidence labels, the accounting basis, and the two caveats.

| Endpoint | Query params | Returns |
| --- | --- | --- |
| `GET /summary` | `year?`, `month?`, `origin?` (11/28/41), `waste_name?` | period + completeness, totals (kg/tons/fee), effective fee/tonne, origin shares, top waste types, largest origin/waste share, evidence, sources, caveats |
| `GET /trends` | `start_month?`, `end_month?`, `origin?`, `waste_name?` | monthly points (quantity kg/tons, fee, effective fee/tonne); defaults to the latest complete year |
| `GET /composition` | `year?`, `origin?` | per-waste quantities, fees, shares |
| `GET /flows` | `year?`, `month?`, `waste_name?` | **only** three possible origin nodes (Seoul/Gyeonggi/Incheon) and one destination (Sudokwon Landfill), each with schematic coordinates, quantity, fee, share, evidence; never a municipal/district row |

Period completeness is dynamic: the default reporting period is the latest
complete year (12 present months); an incomplete year returns
`is_complete_year=false` and `available_through_month`. `origin=99` → 422; a year
with no data → structured 404 with `available_years`.

Live-verified 2025 annual: total 1,058,910.57 t; effective fee 99,653.57 KRW/t;
shares 경기 45.6% / 서울 39.7% / 인천 14.7% — matching the Phase-0 proof. 2024
composition 생활 51.7% / 하수오니(자원화) 18.3% / 음폐수 13.2% / 음식물탈리액 11.4%
/ 중간처리잔재폐기물 2.0% — matching the proof.

---

## 6. Evidence meanings

- `OFFICIAL_REPORTED_VALUE` — inbound **quantity** (15064381) and inbound **fee**
  (15064394), reported directly by the source.
- `OFFICIAL_INPUTS_DERIVED_VALUE` — monthly/annual aggregates, shares, and the
  **effective fee per tonne** = `inbound_fee_krw ÷ (quantity_kg ÷ 1000)`
  (`derivation_version: landfill-effective-fee-v1`), null when quantity is zero.

Displayed caveats (every surface):

> 수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다.
> 시·군·구별 반입량을 의미하지 않습니다.

> 반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가
> 아닙니다.

---

## 7. Frontend

New top-level map mode **수도권매립지 이동** (`data-testid="mode-flow"`) in
`frontend/src/app/page.tsx`, added alongside Equity and Suitability without
overloading the equity metric dropdown.

- **Flow map** (`frontend/src/components/MapView.tsx`): straight-line
  `LineString` features from each metropolitan origin node to the single
  destination node; line width scales with official inbound quantity; a
  MapLibre `line-gradient` (light origin → saturated destination) shows direction
  toward the landfill without any external font/glyph request. Pure line/node
  helpers live in `frontend/src/lib/flow.ts`. Lines are explicitly schematic, not
  road routes.
- **Filters:** year (default latest complete year), month/annual, origin, waste
  type — defaults are latest complete year, all origins, all waste types.
- **KPI cards:** total inbound quantity, official inbound fee, effective fee per
  tonne, largest origin share, largest waste-type share.
- **Charts** (hand-rolled inline SVG / bars — no new dependency): monthly inbound
  trend, monthly official fee trend, origin comparison, waste-type composition.
- **Evidence & caveats:** the 공식 보고값 / 공식자료 기반 계산 split, source dataset
  IDs and snapshot dates, the accounting basis, and both mandated caveats.

The frontend never calls government APIs; all requests go to the platform backend
(and the public OSM basemap). Screenshots: see §10.

---

## 8. Geographic limitations

1. Origin is **metropolitan-only** (서울시/인천시/경기도). Sub-metropolitan
   origin→destination flow is `UNAVAILABLE` and is never inferred.
2. Destination is a single facility implied by the dataset scope; the destination
   coordinate is a reviewed representative point of the Sudokwon Landfill site
   (인천 서구) used only for the schematic straight-line flow — not a precise
   boundary or a geocoded facility coordinate.
3. `반입수수료` is the corporation's reported inbound fee (tariff × quantity), not
   a procurement/contract paid amount, not transport-only cost, and not total
   waste-management cost.
4. Landfill inbound values must **never** be combined with RCIS municipal
   generation to claim a municipal dependency ratio; the accounting bases stay
   visibly separated.

---

## 9. Update procedure

The source refreshes quarterly (monthly grain). To ingest a new snapshot:

1. Ensure `DATA_GO_KR_SERVICE_KEY` is set in `.env` (never committed).
2. `... python -m waste_equity_ingestion.cli landfill-inbound --dry-run` and
   confirm `joined_rows == inbound_rows_received == fee_rows_received`,
   `inbound_only == 0`, `fee_only == 0`, and `supported_origins` is exactly
   `KR-SGIS-11/28/41`.
3. `... python -m waste_equity_ingestion.cli landfill-inbound --apply`.
4. Re-run `--apply` to confirm idempotency (0 inserted, 0 updated).

Snapshot discovery is automatic — no code change is needed for a new quarterly
snapshot. The ingestion refuses to proceed if required fields change, the join is
not 1:1, or an unsupported origin appears.

---

## 10. Operational runbook

- **Migrate:** `cd backend && alembic upgrade head` (applies `0013`; requires a
  PostGIS database).
- **Serve:** `uvicorn waste_equity_backend.api.app:app` — the four `/api/v1/landfill`
  endpoints are registered in `app.py`.
- **Health probe after ingest:**
  `GET /api/v1/landfill/summary` (default) → 200 with the latest complete year;
  `GET /api/v1/landfill/flows?year=<Y>` → exactly three origin nodes.
- **Freshness:** `dataset_freshness` rows for `15064381` and `15064394` report the
  latest reference period and `FRESH` after a successful apply; failed runs mark
  the `IngestionRun` `FAILED` with a sanitized error.
- **Screenshots (git-ignored):**
  `backups/capital_region_landfill_flow_screenshots/` —
  `flow_desktop_default_2025.png`, `flow_desktop_evidence.png`,
  `flow_desktop_seoul_only.png`, `flow_mobile.png`.

---

## 11. Rollback

- **Data / schema:** `cd backend && alembic downgrade 0012` drops
  `landfill_inbound_monthly` and the two seeded `data_sources` rows. (Raw
  responses and ingestion-run rows for these sources can be pruned separately if
  desired; they are harmless if left.)
- **API:** remove the `landfill` router include in `api/app.py` (or downgrade the
  branch); the endpoints simply stop being served.
- **Frontend:** the flow mode is additive; reverting the branch removes the third
  mode button and leaves Equity/Suitability untouched.

The feature is fully additive: no existing table, endpoint, metric, or map mode
is modified.

---

## 12. Known limitations

1. Metropolitan-only origin (see §8.1); no municipal/district flow.
2. The rate table `15064397` (current-rate) is **deferred**; period-correct cost
   comes from `반입수수료` (15064394). No current 단가 is applied to historical
   months.
3. KONEPS public-contract data is **deferred** (not in this MVP).
4. Destination coordinate is a schematic representative point (§8.2).
5. 2 waste names carry a 0 fee in some periods; effective fee/tonne is `null`
   (never 0) when quantity is zero.

---

## 13. Tests

- **Ingestion** (`ingestion/tests/test_landfill_odcloud_contract.py`,
  `test_landfill_inbound_persistence.py`): snapshot discovery picks the latest
  dated snapshot; field validation; origin normalization (rejects
  sub-metropolitan); exact quantity↔fee 1:1 join; unsupported-origin, duplicate,
  null, and negative rejection; idempotent upsert; dry-run writes nothing;
  repeated apply produces no duplicates.
- **Backend** (`backend/tests/test_landfill_routes.py`,
  `test_landfill_analysis.py`): summary annual aggregation, monthly/origin/waste
  filtering, effective-fee math, zero-quantity handling, partial-year metadata,
  exactly three allowed origins in `/flows`, evidence labels, no city/district
  flow output, and 422/404 paths.
- **Frontend** (`frontend/src/lib/flow.test.ts`, `frontend/e2e/flow.spec.ts`):
  line building + width scaling + formatting; the new tab renders; default latest
  complete year; year/month/origin/waste filters; KPI formatting; evidence labels;
  the metropolitan caveat; mobile layout; and no municipal-arrow generation. The
  e2e spec also asserts no request ever leaves for a government API host.
