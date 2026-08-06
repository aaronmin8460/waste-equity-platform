# Step 2 — Backend Implementation Report

Branch: `feature/municipal-waste-costs-2024` (based on `main` @ `272b5b4`)
Date of the recorded execution: **2026-08-06**
Status: **implemented, ingested locally, and verified. Uncommitted, unmerged,
not deployed.**

Companion documents: [`METHODOLOGY.md`](METHODOLOGY.md) (semantics),
[`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md) (commands and operational
results), [`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md) (source audit).

Every figure below was measured. Nothing is projected.

---

## 1. What was delivered

| # | Component | State | Where |
| --- | --- | --- | --- |
| 1 | Additive municipal analytical geography registry | ✅ | `municipal_cost_geographies` |
| 2 | Seven derived Gyeonggi city populations | ✅ | `municipal_cost_geography_components` |
| 3 | Source-file provenance table | ✅ | `municipal_cost_source_files` |
| 4 | Contract payment table | ✅ | `municipal_waste_contracts` |
| 5 | Quantity observation table | ✅ | `municipal_waste_quantities` |
| 6 | Indicator value table | ✅ | `municipal_cost_indicator_values` |
| 7 | Alembic migration | ✅ | `0021`, revises `0020`, single head |
| 8 | Seven XLSX layout parsers | ✅ | `municipal_cost_parser.py` |
| 9 | Unicode NFC path handling | ✅ | `nfc()` in `analysis/municipal_cost.py` |
| 10 | Reviewed municipality mapping | ✅ | `REVIEWED_FILE_MAPPINGS` |
| 11 | Rejected-file handling | ✅ | `REJECTED_FILE_RULES` |
| 12 | Repeated Gyeonggi quantity-block handling | ✅ | `MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT` |
| 13 | Deterministic ingestion CLI | ✅ | `municipal-costs-ingest` |
| 14 | Dry-run support | ✅ | `--dry-run`, zero writes verified |
| 15 | Transactional write | ✅ | single transaction |
| 16 | Idempotent second write | ✅ | `idempotent_no_op = true` |
| 17 | Indicator computation | ✅ | `evaluate_indicator()` / `payment_per_capita()` |
| 18 | Read-only municipal-cost API | ✅ | `GET /api/v1/landfill/municipal-costs` |
| 19 | Backend tests | ✅ | 53 tests across 3 files |
| 20 | Ingestion tests | ✅ | 92 tests across 2 files |
| 21 | Official landfill regression tests | ✅ | `test_landfill_contract_regression.py` |
| 22 | Step 2 documentation | ✅ | this file + the two companions |

---

## 2. Files

### Created (untracked)

| Lines | Path |
| --- | --- |
| 631 | `backend/alembic/versions/20260805_0021_municipal_waste_costs.py` |
| 924 | `backend/src/waste_equity_backend/models/municipal_cost.py` |
| 615 | `backend/src/waste_equity_backend/analysis/municipal_cost.py` |
| 121 | `backend/src/waste_equity_backend/schemas/municipal_cost.py` |
| 404 | `backend/src/waste_equity_backend/api/routes/municipal_costs.py` |
| 1,177 | `ingestion/src/waste_equity_ingestion/municipal_cost_parser.py` |
| 1,356 | `ingestion/src/waste_equity_ingestion/municipal_cost_ingestion.py` |
| 665 | `backend/tests/test_municipal_cost_routes.py` |
| 556 | `backend/tests/test_migration_municipal_cost_integration.py` |
| 244 | `backend/tests/test_landfill_contract_regression.py` |
| 917 | `ingestion/tests/test_municipal_cost_parser.py` |
| 959 | `ingestion/tests/test_municipal_cost_ingestion.py` |
| 265 | `ingestion/tests/municipal_cost_fixtures.py` |
| — | `docs/municipal-costs/STEP_2_BACKEND_IMPLEMENTATION.md` (this file) |
| — | `docs/municipal-costs/METHODOLOGY.md` |
| — | `docs/municipal-costs/INGESTION_RUNBOOK.md` |

### Modified (tracked)

| Path | Change |
| --- | --- |
| `.gitignore` | ignore `data/import/municipal-costs/`, `data/raw/municipal-costs/`, `artifacts/municipal-costs/` |
| `backend/src/waste_equity_backend/api/app.py` | import + `include_router(municipal_costs.router)` |
| `backend/src/waste_equity_backend/models/__init__.py` | export the six ORM models |
| `backend/tests/conftest.py` | register the six (non-spatial) tables in the SQLite tier |
| `backend/tests/test_migration_land_cover_cell_stats_integration.py` | assert *one* head instead of pinning `"0020"` |
| `backend/alembic/versions/20260719_0016_suitability_critic_stability.py` | formatting only (one call joined to one line) |
| `ingestion/pyproject.toml` | add `openpyxl>=3.1`, `types-openpyxl>=3.1` |
| `ingestion/src/waste_equity_ingestion/cli.py` | register `municipal-costs-ingest`, `--source-dir`, `--report-path` |

`docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` is an unrelated untracked file. It was
**not** modified, staged, or included.

---

## 3. Migration 0021

Revision `0021`, revises `0020`. `alembic heads` prints exactly one head.

**Purely additive.** Six new tables and one `data_sources` row
(`municipal_waste_cost_disclosure`, publication frequency `STRUCTURAL`, endpoint
`local-file://data/import/municipal-costs/2024`). No existing table, column,
constraint, index, or row is altered. `landfill_inbound_monthly` is untouched.
No `regions` row is added, modified, renamed, or invalidated; the seven Gyeonggi
cities get a registry row that *references* the existing 일반구 rows, with no
city-level region and no synthetic geometry.

### Tables

| Table | Rows loaded | Purpose |
| --- | --- | --- |
| `municipal_cost_geographies` | 66 | 2024 analytical municipality registry |
| `municipal_cost_geography_components` | 20 | constituent 일반구 populations |
| `municipal_cost_source_files` | 64 | one row per discovered workbook, rejected included |
| `municipal_waste_contracts` | 205 | one row per source contract header |
| `municipal_waste_quantities` | 2,701 | one row per **logical** quantity observation |
| `municipal_cost_indicator_values` | 66 | the served per-capita indicator |

### Constraints carrying the data-integrity promises

| Constraint | Guarantee |
| --- | --- |
| `ck_municipal_waste_quantities_value_state_consistent` | a missing value can never be stored as numeric `0`, nor a measured `0` as missing |
| `ck_municipal_cost_indicator_values_unavailable_is_null` | an `UNAVAILABLE` indicator can never be stored as `0` |
| `ck_municipal_waste_contracts_eligibility_consistent` | only a non-null `ACTUAL_PAID_AMOUNT` may be numerator-eligible |
| `ck_municipal_cost_geographies_population_status_consistent` | a usable denominator is `> 0`; an unusable one is `NULL` |
| `ck_municipal_cost_geographies_population_method_consistent` | direct-population rows name their region; derived rows must not fabricate one |
| `ck_municipal_cost_source_files_rejected_has_no_geography` | a rejected workbook resolves to no municipality |
| `ck_municipal_cost_geographies_boundary_vintage_fixed` | vintage is `'2024'` |
| `ck_municipal_waste_quantities_unit_tonne`, `ck_municipal_waste_contracts_currency_krw` | unit / currency pinned |

Plus 21 single-column indexes and 4 composite indexes. `downgrade()` removes
only what `0021` added.

### Applied state

| Database | Before | After |
| --- | --- | --- |
| Development (`waste_equity`, port 5432) | `0020` | `0021` |
| Test (`test`, container `wep-testdb`, port 5433) | `0020` | `0021` |

Both were already at `0021` when this session began; the migration was **not**
re-applied and no second/competing `0021` was created.

---

## 4. Ingestion results

Command and full operational detail: [`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md).

| Metric | Value |
| --- | --- |
| Source files discovered | 64 |
| Parsed | 64 |
| Accepted | 62 |
| Rejected | 2 |
| DATA_A / DATA_B | 29 / 35 |
| Contracts stored | 205 |
| Numerator-eligible contracts | 196 |
| Numerator total | 659,366,684,767 KRW |
| Quantity observations stored | 2,701 |
| Files with repeated quantity blocks | 15 |
| Logical quantities from repeated blocks | 221 |
| Indicator rows | 66 (20 AVAILABLE / 5 PARTIAL / 41 UNAVAILABLE) |

### Layout families (all seven audited layouts supported)

| Family | Files |
| --- | --- |
| `DATA_B_MONTHLY_CATEGORY_GRID` | 35 |
| `DATA_A_CONTRACT_QUANTITY_PAIRS` | 24 |
| `DATA_A_CONTRACT_WITH_PAYMENT_LEDGER` | 1 |
| `DATA_A_CONTRACT_NUMBERED_PAIRS` | 1 |
| `DATA_A_CONTRACT_DESTINATION_SPLIT` | 1 |
| `DATA_A_CONTRACT_DASH_ONLY_QUANTITY` | 1 |
| `DATA_A_CONTRACT_TONNE_LABELLED_PAIRS` | 1 |

### Rejected files (preserved in provenance, not relocated)

- `DATA_B/인천/서해구xlsx.xlsx` — `BOUNDARY_MISMATCH`, `AMBIGUOUS_REGION_MAPPING`,
  `DUPLICATE_SOURCE_RECORD`, `ZERO_TOTAL_QUANTITY`
- `DATA_B/경기도(31개중 19개 완료 8.4기준)/양천구.xlsx` — `AMBIGUOUS_REGION_MAPPING`

---

## 5. API

`GET /api/v1/landfill/municipal-costs` — read-only. It reads only the six
municipal tables, never `landfill_inbound_monthly`, never a government API, and
never credentials. The `/api/v1/landfill` prefix is dashboard placement only.

### Parameters

| Parameter | Values | Default |
| --- | --- | --- |
| `year` | `2024` | `2024` |
| `sido` | `11` \| `28` \| `41` | none (all) |
| `status` | `AVAILABLE` \| `PARTIAL` \| `UNAVAILABLE` | none (all) |
| `sort` | `payment_per_capita_desc` \| `total_payment_desc` \| `region_name_asc` | `payment_per_capita_desc` |

### Verified live behaviour (2026-08-06, against the development database)

| Check | Result |
| --- | --- |
| Full scope row count | **66** |
| `?year=2024` | 200 |
| `?year=2023` | 422 |
| `sido=11 / 28 / 41` | 25 / 10 / 31 |
| `sido=99` | 422 |
| `status=AVAILABLE / PARTIAL / UNAVAILABLE` | 20 / 5 / 41 (sums to 66) |
| `sort=payment_per_capita_desc` | first 이천시 213,905.7731; last 하남시 `null` |
| `sort=total_payment_desc` | first 수원시; last 하남시 `null` |
| `sort=region_name_asc` | first 강남구; last 화성시 |
| `sort=bogus` | 422 |
| UNAVAILABLE rows | 41; population, payment, and per-capita all `null`; **no zeros** |
| Deferred landfill-associated estimate | not present anywhere in the response |

Nulls sort last on both value sorts, so an unavailable municipality is never
ordered as if it were the cheapest.

### Response shape

Top level: `meta`, `sido_filter`, `status_filter`, `sort`, `municipalities`.

`meta` states the separation from the official dataset in the payload itself:
`is_official_landfill_fee = false`, plus prose in
`difference_from_official_landfill_fee`, `geography_policy`,
`population_policy`, `numerator_definition`, and a five-item `caveats` array. It
also carries `expected_count` 66, `available_count`, `partial_count`,
`unavailable_count`, `returned_count`, `rejected_source_file_count` 2, the
`rejected_source_files` detail, and `source_coverage`.

Each municipality row carries `municipality_key`, `display_name`,
`metropolitan_code`/`_name`, `direct_region_code`, `boundary_vintage`,
`population`, `population_method`, `population_definition`,
`population_components`, `total_eligible_payment_krw`, `eligible_contract_count`,
`payment_per_capita_krw`, `status`, `evidence_status`, `reason_codes`,
`limitations`, `source_files`, `has_data_a`, `has_data_b`, and
`quantity_coverage`.

---

## 6. Official landfill regression

| Check | Result |
| --- | --- |
| `landfill_inbound_monthly` rows | 9,212, all `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` |
| Municipal rows in that table | **0** |
| `/api/v1/landfill/summary` | 200, contains `LANDFILL_INBOUND_FEE_PER_CAPITA`, no municipal content |
| `/api/v1/landfill/trends` | 200, no municipal content |
| `/api/v1/landfill/composition` | 200, no municipal content |
| `/api/v1/landfill/flows` | 200, no municipal content |
| `backend/tests/test_landfill_contract_regression.py` | 8 tests, all pass |
| Migration 0021 effect on the table | none (additive migration; the integration test asserts the definition and rows are unchanged) |

`landfill_inbound_monthly`, `LANDFILL_INBOUND_FEE_PER_CAPITA`,
`landfill-fee-per-capita-v2`, and the metropolitan-only origin contract are all
semantically unchanged.

---

## 7. Validation results

All commands below were actually run in this session and the results are as
printed.

### Static checks

| Check | Command | Result |
| --- | --- | --- |
| Backend format | `ruff format --check .` | 122 files already formatted |
| Backend lint | `ruff check .` | All checks passed |
| Backend types | `mypy` (strict, configured scope) | no issues in 58 source files |
| Ingestion format | `ruff format --check .` | 88 files already formatted |
| Ingestion lint | `ruff check .` | All checks passed |
| Ingestion types | `mypy` (strict) | no issues in 46 source files |
| Alembic heads | `alembic heads` | `0021 (head)` — exactly one |

### Targeted tests

| Suite | Result |
| --- | --- |
| `test_municipal_cost_routes.py` | **29 passed** |
| `test_landfill_contract_regression.py` | **8 passed** |
| `test_migration_municipal_cost_integration.py` | 17 passed, 1 skipped by design |
| `test_municipal_cost_parser.py` + `test_municipal_cost_ingestion.py` | **119 passed** |

The single skip is `test_loaded_registry_has_exactly_66_rows_for_2024`, which
skips cleanly when the *test* database holds no ingested registry. The 66-row
assertion is verified directly against the development database instead.

### Full suites

| Suite | Result |
| --- | --- |
| Backend (`TEST_DATABASE_URL` set) | **662 passed**, 8 failed, 3 errors, 1 skipped |
| Ingestion | **554 passed**, 51 skipped, exit 0 |

The 11 backend failures/errors are **pre-existing on `main` and not caused by
this branch.** Proven by controlled comparison rather than assumption: an
isolated `git worktree` of `origin/main` and this branch were each run against
their own freshly-created, identically-empty PostGIS database
(`premain` / `prebranch`). Both produced **109 failures/errors, and the two sets
were byte-identical** — `comm` reported zero lines unique to either side.

The 11 that surface on the shared `test` database:

- `test_facility_mapping_transparency_integration.py::test_migration_head_is_0016`
  and `test_suitability_scenario_routes_integration.py::test_migration_head_is_0016_and_no_new_migration`
  — both pin the head to `"0016"` and therefore fail for any migration after it
  (they already failed at `0020` on `main`).
- 6 × `test_migration_population_monthly_integration.py` — require a `regions`
  row the test database does not have (`a regions row is required by the FK`).
- 3 × `test_reporting_routes_integration.py` errors — require an
  `ingestion_runs` row with `id = 1` that the test database does not have.

None involve municipal-cost code.

---

## 8. Defects found and fixed while resuming

Two real defects existed in the partially-completed work and were repaired.

### 8a. `?year=2024` returned 422

`YearParam` was declared `Literal[2024]`. A query value always arrives as the
string `"2024"`, and Pydantic does not coerce a string into an `int` literal, so
the endpoint rejected the only year it publishes:

```
{"detail":[{"type":"literal_error","loc":["query","year"],
            "msg":"Input should be 2024","input":"2024"}]}
```

The existing test suite missed it because it asserted only the *rejection*
(`year=2023` → 422), never the acceptance.

Fixed by using a bounded `int` (`Query(ge=REFERENCE_YEAR, le=REFERENCE_YEAR)`),
matching the convention already documented in `land_cover_cells.py` ("A bounded
`int`, not `Literal[1, 2, 3]`: query values always arrive as strings"). The
contract is identical — 2024 accepted, every other year 422. Added
`test_supported_year_is_accepted_as_a_query_string` to pin the acceptance case.

### 8b. 남동구 was reported as having been renamed

All three reviewed filename mappings unconditionally received
`POST_2024_FILENAME_RESOLVED_TO_2024_UNIT`. That is correct for
`제물포구.xlsx` → 동구 and `서해구.xlsx` → 서구, but wrong for
`남동구xlsx.xlsx` → 남동구: 남동구 *is* a 2024 unit and was never renamed — only
the filename is malformed (a doubled extension). The API surfaced this to users
as "파일명은 2024년 이후 행정구역명이지만 …", asserting a boundary change that
did not happen.

Fixed by giving `ReviewedFileMapping` a per-entry `reason` field and adding the
distinct code `MALFORMED_FILENAME_RESOLVED_BY_WORKBOOK` with its own Korean
description. Both codes are grouped in `REVIEWED_RESOLUTION_REASONS` and remain
informational — neither degrades indicator status. No migration was needed
(reason codes live in JSON columns with no per-code CHECK). Added
`test_malformed_filename_is_not_reported_as_a_post_2024_rename`.

Re-running the loader updated exactly one indicator row
(`indicator_values_updated: 1`, all 65 others unchanged) and the following run
returned to `idempotent_no_op = true`.

---

## 9. Remaining blockers and inputs for Step 3 (frontend)

Nothing blocks Step 3 technically. The API is complete, verified, and stable.
Points the frontend must honour:

1. **Never label this as the official landfill fee.** The dataset is a different
   accounting basis at a different spatial grain. `meta.is_official_landfill_fee`
   is `false` and `meta.difference_from_official_landfill_fee` carries the
   required wording — surface it, do not paraphrase it away.
2. **Never render an unavailable value as 0 or as ₩0.** 41 of 66 municipalities
   are `null`. Show the reason codes / `limitations` instead.
3. **PARTIAL is not AVAILABLE.** Five municipalities carry a numeric value with a
   scope or period limitation and must be visually distinguished, not ranked
   naively against AVAILABLE ones.
4. **Seoul is entirely empty** (25/25 UNAVAILABLE). A choropleth will show Seoul
   blank; that must read as "no data supplied", not "zero cost".
5. **Derived populations must be disclosed.** The seven Gyeonggi cities carry
   `population_method = DERIVED_SUM_OF_CONSTITUENT_WARDS` and a
   `population_components` array; the UI must say the population is a computed
   ward sum, not a source-reported city figure.
6. **No map geometry exists for this registry.** It intentionally stores none. To
   draw a choropleth, join to existing `regions` geometry via `direct_region_code`
   — which is `null` for the seven derived cities, so those need the ward
   geometries unioned at render time or a different presentation.
7. **CORS is `http://localhost:3000` / `http://127.0.0.1:3000` only** in
   development.

### Deployment status

Not deployed. Deploying this release requires applying migration `0021` on the
target and running `municipal-costs-ingest --write` there, which depends on the
Git-ignored raw workbooks being available on that host. That decision, and the
licensing/publication question for the disclosure workbooks, are out of scope for
Step 2 and are not resolved here.
