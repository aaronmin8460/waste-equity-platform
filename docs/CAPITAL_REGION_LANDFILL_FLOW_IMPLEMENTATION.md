# Capital-Region Sudokwon Landfill Inbound — Implementation (V2 Phase 1–2)

Implements the **capital-region metropolitan → Sudokwon Landfill inbound-flow and
official-fee** feature verified in V2 Phase 0
(`docs/PUBLIC_DATA_INTEGRATION_PROOF.md`, `docs/SL_LANDFILL_DATA_DICTIONARY.md`,
`docs/PUBLIC_DATA_V2_RECOMMENDATION.md`).

**Scope is fixed and metropolitan-only.** Supported origins are 서울시 /
경기도 / 인천시; the verified destination is the single **수도권매립지** (Sudokwon
Landfill). A 광역 value is **never** disaggregated to a city, county, or district,
and no city/district → landfill (or → any facility) arrow is ever drawn. No
nationwide coverage, no KONEPS, no current-rate scenario.

Local live-verification date: **2026-07-14** (V2 Phase 1, against the real
odcloud API and a local PostGIS database).

## V2 Phase 2 (2026-07-15) — dashboard replaces the flow map

The **수도권매립지 이동** mode no longer renders a map. The Phase 1 view drew
schematic straight lines from representative metropolitan coordinates to a
representative landfill point; those lines were not road routes, not municipal
origin-to-destination movement, and not geocoded facility positions. Because the
source declares metropolitan totals only, there is nothing map-shaped it can
honestly support, so the map was **removed** rather than re-labelled, and the
mode is now a full-width, filter-driven **data dashboard**
(`frontend/src/components/LandfillDashboard.tsx`).

Phase 2 also adds one derived indicator, **LANDFILL_INBOUND_FEE_PER_CAPITA**
(`landfill-fee-per-capita-v1`) — §5.1 below and the registry entry in
`docs/ANALYTICAL_METHODS.md`.

The 형평성 (Equity) and 적합성 (Suitability) maps are unchanged. No migration, no
ingestion, and no schema change: the indicator is derived from existing
`landfill_inbound_monthly`, `regions`, and `regional_population` rows.

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
| `GET /summary` | `year?`, `month?`, `origin?` (11/28/41), `waste_name?` | period + completeness, totals (kg/tons/fee), effective fee/tonne, **fee per capita (aggregate + per origin row)**, origin shares, top waste types, largest origin/waste share, evidence, sources, caveats |
| `GET /trends` | `start_month?`, `end_month?`, `origin?`, `waste_name?` | monthly points (quantity kg/tons, fee, effective fee/tonne); defaults to the latest complete year |
| `GET /composition` | `year?`, `origin?` | per-waste quantities, fees, shares |
| `GET /flows` | `year?`, `month?`, `waste_name?` | **only** three possible origin nodes (Seoul/Gyeonggi/Incheon) and one destination (Sudokwon Landfill), each with schematic coordinates, quantity, fee, share, evidence; never a municipal/district row. **Retained as a read-only API but no longer drives any UI** — the frontend stopped consuming it in V2 Phase 2 when the schematic flow map was removed. Its coordinates remain explicitly schematic representative points (§8.2). |

Period completeness is dynamic: the default reporting period is the latest
complete year (12 present months); an incomplete year returns
`is_complete_year=false` and `available_through_month`. `origin=99` → 422; a year
with no data → structured 404 with `available_years`.

Live-verified 2025 annual: total 1,058,910.57 t; effective fee 99,653.57 KRW/t;
shares 경기 45.6% / 서울 39.7% / 인천 14.7% — matching the Phase-0 proof. 2024
composition 생활 51.7% / 하수오니(자원화) 18.3% / 음폐수 13.2% / 음식물탈리액 11.4%
/ 중간처리잔재폐기물 2.0% — matching the proof.

---

### 5.1 Inbound fee per resident (`landfill-fee-per-capita-v1`) — V2 Phase 2

Indicator `LANDFILL_INBOUND_FEE_PER_CAPITA`, Korean name **주민 1인당 환산
반입수수료**, unit `KRW/인` (KRW per person), evidence
`OFFICIAL_INPUTS_DERIVED_VALUE`. Served as a nested `fee_per_capita` object on
the `/summary` envelope (all-origin aggregate) and on each `origin_shares[]` row.
Pure derivation: `analysis/landfill.py`; the route only fetches and maps.

```
주민 1인당 환산 반입수수료 = 선택 조건의 공식 반입수수료 ÷ 동일 연도의 해당 광역지자체 인구
```

Exact `Decimal`, `ROUND_HALF_EVEN`, 2 dp. Full method, vocabulary, and rationale:
`docs/ANALYTICAL_METHODS.md` (indicator registry). Key rules:

- **Same reference year only.** A population year that differs from the fee year
  is never substituted (no nearest/latest/previous fallback). Since SGIS
  population is ingested for **2024 only** and landfill data runs to 2026-05, the
  default period (latest complete year = 2025) legitimately serves `null` with
  `NO_MATCHING_POPULATION_YEAR`; 2024 serves real values.
- **Monthly**: `선택 월 반입수수료 ÷ 해당 연도 인구` — the annual resident
  population of the same calendar year (no monthly population exists; none is
  interpolated). Both periods are served so the difference is explicit.
- **All origins**: `Σ fee ÷ Σ same-year population`, never the mean of the three
  per-origin values. Incomplete coverage ⇒ `null` +
  `INCOMPLETE_POPULATION_COVERAGE`.
- **Unavailable ⇒ `null` + reason, never `0`**: `NO_MATCHING_POPULATION_YEAR`,
  `NO_METROPOLITAN_POPULATION`, `ZERO_POPULATION`,
  `AMBIGUOUS_POPULATION_DEFINITION`, `INCOMPLETE_POPULATION_COVERAGE`.
- **Provenance for both inputs** is served: fee amount/year/period, and
  population value/year/period/definition/source/level/unit.
- **No N+1**: one batched, column-scoped query fetches the three metropolitan
  regions' population rows (the MULTIPOLYGON boundary is never selected).

#### Origin → canonical region crosswalk (reviewed, load-bearing)

`landfill_inbound_monthly.origin_region_code` uses the **standard administrative**
sido codes with a `KR-SGIS-` prefix; the canonical `regions` rows use **SGIS's
own** sido codes. They disagree for two of the three origins:

| Landfill origin | 소재지 | Canonical region row | Official region name |
| --- | --- | --- | --- |
| `KR-SGIS-11` | 서울시 | `KR-SGIS-11` | 서울특별시 |
| `KR-SGIS-28` | 인천시 | **`KR-SGIS-23`** | 인천광역시 |
| `KR-SGIS-41` | 경기도 | **`KR-SGIS-31`** | 경기도 |

Only Seoul coincides. Joining the codes directly would resolve Seoul alone and
silently report Incheon and Gyeonggi as having no population, so the crosswalk is
explicit in `api/routes/landfill.py::_ORIGIN_META` and every entry is verified
against the canonical `region_name` before the denominator is used. A rename or
recode upstream refuses the denominator (`NO_METROPOLITAN_POPULATION`) instead of
attaching another region's population. This is a **read-side** bridge: no stored
code was changed, no migration and no re-ingestion were required.

Live-verified 2024 (local PostGIS, hand-checked against the stored inputs):

| Origin | Official fee (KRW) | SGIS 2024 population | 주민 1인당 환산 반입수수료 |
| --- | ---: | ---: | ---: |
| 서울시 | 41,647,362,920 | 9,335,444 | 4,461.21 |
| 인천시 | 15,228,400,200 | 3,058,033 | 4,979.80 |
| 경기도 | 51,300,279,950 | 13,914,479 | 3,686.83 |
| **전체** | **108,176,043,070** | **26,307,956** | **4,111.91** |

The aggregate (4,111.91) is the population-weighted ratio, deliberately **not**
the mean of the three (4,375.95). 2025 returns `null` +
`NO_MATCHING_POPULATION_YEAR` — 2024 population is never borrowed.

## 6. Evidence meanings

- `OFFICIAL_REPORTED_VALUE` — inbound **quantity** (15064381) and inbound **fee**
  (15064394), reported directly by the source; and **population** (SGIS
  `regional_population`, `SGIS_TOTAL_POPULATION`).
- `OFFICIAL_INPUTS_DERIVED_VALUE` — monthly/annual aggregates, shares, the
  **effective fee per tonne** = `inbound_fee_krw ÷ (quantity_kg ÷ 1000)`
  (`derivation_version: landfill-effective-fee-v1`), null when quantity is zero;
  and the **inbound fee per resident** = `inbound_fee_krw ÷ population`
  (`derivation_version: landfill-fee-per-capita-v1`), null with a served reason
  whenever a valid same-year population is unavailable.

Displayed caveats — served in `caveats` on **every** landfill surface
(`/summary`, `/trends`, `/composition`, `/flows`), because each is true of the
underlying data regardless of which values a response carries:

> 수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다.
> 시·군·구별 반입량을 의미하지 않습니다.

> 광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지
> 않습니다.

> 반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가
> 아닙니다.

The per-capita interpretation caveat is **not** in that shared list — it
describes one indicator, and `/trends`, `/composition`, and `/flows` do not serve
it. It rides on the nested `fee_per_capita.caveat` field instead, so a caveat
never advertises a value its response does not contain:

> 선택 기간의 공식 반입수수료를 동일 연도의 해당 지역 인구로 나눈 분석용
> 환산값입니다. 개인의 실제 납부액이 아닙니다.

---

## 7. Frontend — full-width dashboard, no map (V2 Phase 2)

Top-level mode **수도권매립지 이동** (`data-testid="mode-flow"`) alongside Equity
and Suitability, without overloading the equity metric dropdown. Since Phase 2 it
renders `frontend/src/components/LandfillDashboard.tsx` — a responsive,
full-width dashboard — and **does not mount `MapView` at all**.

- **No map in this mode.** `MapMode` is now `"equity" | "suitability"` only;
  `DashboardMode` adds `"flow"`. `page.tsx` returns the dashboard before MapView
  is constructed, so a non-map mode cannot reach it (enforced by the type, not by
  a runtime flag). The `flows` prop, the flow line/node layers and their popups,
  and the schematic GeoJSON builders (`buildFlowFeatures` / `buildNodeFeatures`
  in the former `lib/flow.ts`) are **deleted**. `lib/flow.ts` → `lib/landfill.ts`
  keeps the reusable formatters and adds `formatKrwPerPerson` plus the per-capita
  reason labels. The mode selector stays reachable from the dashboard.
- **Heading:** 수도권매립지 반입 현황 / 서울 · 인천 · 경기 공식 반입자료.
- **Limitation notice (prominent):** 광역지자체 단위 자료이며 시·군·구별 이동
  경로나 실제 운송 경로를 의미하지 않습니다. The Phase 1 sentence explaining
  schematic straight lines is removed — there is no longer a line to explain.
- **Filters** (`1 / 2 / 4` columns at mobile / tablet / desktop): 연도 (default
  latest complete year), 월/연간, 출발 광역지자체, 폐기물 종류.
- **Four KPI cards** (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`): 총 반입량,
  공식 반입수수료, 톤당 실효 수수료, **주민 1인당 환산 반입수수료**. The fourth
  shows the served reason (e.g. 동일 연도 인구 데이터 없음) when the value is
  `null` — never `0원` — and always carries the not-an-actual-payment
  description plus both reference periods.
- **Four-column regional table** (semantic `<table>`, `overflow-x-auto` on
  mobile, right-aligned `tabular-nums` numerics): 지역 / 반입량 / 공식 반입수수료
  / 주민 1인당 환산 반입수수료. `전체` → 서울시·인천시·경기도 rows; a specific
  origin → only that row. The Phase 1 `서울시 ▶ 수도권매립지` arrow list is
  removed.
- **Charts** (hand-rolled inline SVG / bars — no new chart dependency): 월별
  반입량, 월별 공식 반입수수료, 출발지 비교, 폐기물 구성.
- **Filter scope** (no stale values): the summary request carries all four
  filters and drives the KPIs, the table, 출발지 비교, and 폐기물 구성 — so an
  origin selection never leaves a stale all-origin comparison on screen. Two
  intentional, labelled scope differences: the monthly trends span the whole
  selected year (a month-filtered trend would be a single bar), and
  `/composition` (year + origin) is used **only** to populate the waste dropdown
  so its options are not narrowed by the waste filter itself. A failed request
  clears the data and shows an error — previous-filter values are never left on
  screen.
- **Evidence & caveats:** the 공식 보고값 / 공식자료 기반 계산 split (now naming
  population as an official input and both derivation versions), source dataset
  IDs and snapshot dates, the fee and population reference periods, the
  population definition/source, the derivation formula, the accounting basis, and
  every served caveat.

The frontend never calls government APIs; all requests go to the platform backend
(and, in the two map modes, the public OSM basemap). The Playwright guard
asserting no request leaves for a non-allowlisted host is unchanged in strictness
and now also asserts the absence of `.maplibregl-canvas` in this mode.

---

## 8. Geographic limitations

1. Origin is **metropolitan-only** (서울시/인천시/경기도). Sub-metropolitan
   origin→destination flow is `UNAVAILABLE` and is never inferred.
2. Destination is a single facility implied by the dataset scope. The destination
   coordinate is a reviewed representative point of the Sudokwon Landfill site
   (인천 서구) — not a precise boundary or a geocoded facility coordinate. Since
   V2 Phase 2 it is **not displayed anywhere**: it survives only in the read-only
   `/flows` response. The source declares no route, no distance, and no municipal
   origin point, which is why the schematic straight-line map was removed.
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
- **Per-capita probe:** `GET /api/v1/landfill/summary?year=2024` →
  `fee_per_capita.fee_per_capita_krw` non-null with
  `population_reference_year = 2024`; a year without a matching SGIS population
  year → `fee_per_capita_krw: null` with
  `unavailable_reason: "NO_MATCHING_POPULATION_YEAR"`. Both are correct states.
- **Freshness:** `dataset_freshness` rows for `15064381` and `15064394` report the
  latest reference period and `FRESH` after a successful apply; failed runs mark
  the `IngestionRun` `FAILED` with a sanitized error.
- **Screenshots (git-ignored):** `backups/capital_region_landfill_flow_screenshots/`
  holds the V2 Phase 1 map-era captures (`flow_desktop_default_2025.png`,
  `flow_desktop_evidence.png`, `flow_desktop_seoul_only.png`, `flow_mobile.png`).
  They predate the Phase 2 dashboard and no longer depict the shipped UI.

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
- **V2 Phase 2 (dashboard + per-capita):** revert the branch. It adds no table,
  no column, and no migration, so there is nothing to downgrade — the per-capita
  fields simply stop being served and the mode returns to its previous view.
  Equity/Suitability are untouched either way.

Phase 1 was fully additive: no existing table, endpoint, metric, or map mode was
modified. Phase 2 changes only this mode's presentation (map → dashboard) and
adds nullable derived fields to `/summary`; every pre-existing official quantity,
fee, effective-fee, source, period, and caveat field is retained.

---

## 12. Known limitations

1. Metropolitan-only origin (see §8.1); no municipal/district flow.
2. The rate table `15064397` (current-rate) is **deferred**; period-correct cost
   comes from `반입수수료` (15064394). No current 단가 is applied to historical
   months.
3. KONEPS public-contract data is **deferred** (not in this MVP).
4. Destination coordinate is a schematic representative point (§8.2), no longer
   displayed.
5. 2 waste names carry a 0 fee in some periods; effective fee/tonne is `null`
   (never 0) when quantity is zero.
6. **주민 1인당 환산 반입수수료 is available for 2024 only.** SGIS population is
   ingested for 2024 alone, so every other landfill year — including the default
   latest-complete year — serves `null` + `NO_MATCHING_POPULATION_YEAR` by the
   same-year rule. Ingesting a further SGIS population year (a separate,
   authorized ingestion run) is all that is needed; no code change is required.
7. The per-capita denominator is total **resident** population; daytime/service
   population is not available from the ingested sources. The value is an
   analytical conversion of an official fee, never an amount a resident paid.
8. The origin↔canonical-region code systems disagree for 인천/경기 (§5.1). The
   read-side crosswalk resolves it; the stored landfill origin codes were left
   unchanged (changing them would require a migration and re-ingestion).

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
  flow output, and 422/404 paths. **Per-capita (Phase 2):** 2024 fee with valid
  2024 population (per origin and aggregate); a 2025/2026 fee never falling back
  to 2024 population; zero population → `null`; competing definitions rejected
  while identical vintage duplicates are accepted; non-SIDO and unexpected-name
  denominators refused; aggregate = Σfee ÷ Σpop and provably *not* the mean;
  aggregate unavailable when one origin lacks population; monthly fee ÷ same-year
  annual population; waste-filtered numerator; exact `Decimal` rounding
  (`ROUND_HALF_EVEN` ties); empty/no-data behavior; and the existing official
  fields/caveats surviving the addition.
  The SQLite tier creates `regions` without its PostGIS geometry column
  (`tests/conftest.py`), which is what lets the population join be covered in the
  fast tier; seeding uses a core `insert(Region)`.
- **Frontend** (`frontend/src/lib/landfill.test.ts`,
  `frontend/src/components/LandfillDashboard.test.tsx`,
  `frontend/src/app/page.test.tsx`, `frontend/e2e/landfill.spec.ts`): formatter
  and reason-label units, including that a `null` per-capita fee never formats as
  `0원`; four KPI cards; the four-column table with three metropolitan rows for
  `전체` and one for a selected origin; per-capita formatting; unavailable →
  served reason in both the KPI and the table cell; both reference periods
  visible; no schematic flow text or `▶` rows; error/loading/empty/partial-year
  states; **flow mode renders no map while Equity and Suitability do**. The live
  e2e smoke additionally asserts the absence of `.maplibregl-canvas` in flow
  mode, filter-driven value changes, the same-year population rule (or an
  explicit unavailable reason), a mobile viewport with no horizontal body
  overflow, map restoration on switching back — and keeps, unweakened, the guard
  that no request ever leaves for a government API host.
