# Step 4 — Production Release Report (OCI)

Release SHA: `43ad1b5c955b443ad19955b875f26638cf551144` (`origin/main`)
Date of the recorded execution: **2026-08-09 (KST)**
Status: **deployed, ingested, and verified on the public OCI origin.**

Companion documents: [`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md),
[`STEP_3_FRONTEND_IMPLEMENTATION.md`](STEP_3_FRONTEND_IMPLEMENTATION.md),
[`METHODOLOGY.md`](METHODOLOGY.md), [`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md),
[`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md).

Every figure below was measured against the live production host. Nothing is projected.
No secret, credential, private key path, or workbook content appears in this file.

---

## 1. Release identity

| Field | Value |
| --- | --- |
| Previous production SHA | `272b5b460777ad59893d27b16185a563432b11fc` (detached HEAD, clean worktree) |
| Intended release SHA | `43ad1b5c955b443ad19955b875f26638cf551144` |
| Actual deployed SHA | `43ad1b5c955b443ad19955b875f26638cf551144` (printed by `deploy.sh`, re-read with `git rev-parse HEAD`) |
| `origin/main` at release time | `43ad1b5c955b443ad19955b875f26638cf551144` — had **not** advanced beyond the expected SHA |
| Ancestry | `063d977` and `79f5508` are both ancestors of `origin/main`; the previous production SHA is an ancestor of the release SHA (forward-only) |
| Alembic head in code | `0021`, single head — the whole chain `0001 → 0021` is linear, verified from the revision graph |

All seven release files were confirmed present on `origin/main` before deployment
(migration `0021`, the ORM model, the API route, the ingestion and parser modules,
`MunicipalCostSection.tsx`, and the Step 3 report).

---

## 2. Pre-deploy production state

| Field | Value |
| --- | --- |
| Host | OCI, `waste-equity-vcn`, up 21 days |
| Disk before | 193 G total, 23 G used, **171 G available** (12 %) |
| Memory | 11 Gi total, 7.8 Gi available |
| Compose project / file / env | `waste-equity-prod` / `docker-compose.prod.yml` / `.env.production` |
| Containers | backend, frontend, database **healthy**; caddy running (this service defines no healthcheck) |
| Restart counts | 0 on every container |
| DB volume | `waste-equity-prod_pgdata` (local driver, created 2026-07-18) — **not** recreated, deleted, or pruned at any point |
| Other volumes | `waste-equity-prod_caddy_data`, `waste-equity-prod_caddy_config` — untouched |
| Alembic revision | **`0020`** |
| Municipal tables | **none present** |
| `landfill_inbound_monthly` | **9,212** rows, all `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`, all `origin_region_level = SIDO`, 3 origins, months `1999-08`…`2026-05`, `sum(quantity_kg) = 107,725,502,157.000000`, `sum(inbound_fee_krw) = 3,977,236,816,206.00` |
| `regions` / `regional_population` | 82 / 748 |
| `data_sources` | 11 |
| Database size | 4,883 MB |

Public baseline (read-only, before any change):

| Path | Status |
| --- | --- |
| `/` | 200 |
| `/health` | 200 — `{"status":"ok","database":"ok","app_env":"production"}` |
| `/ready` | **404 — no such route exists in this repository**; `/health` is the readiness probe and reports `database: ok`. Pre-existing, not a release defect. |
| `/api/v1/landfill/summary` `/trends` `/composition` `/flows` | 200, 200, 200, 200 |
| `/api/v1/landfill/municipal-costs?year=2024` | 404 (route not yet deployed) |

The four official landfill payloads were captured and canonically hashed for the
post-deploy comparison in §11.

---

## 3. Production database backup

Taken with the repository's documented production backup convention
(`docs/OPERATIONS_RUNBOOK.md` → *Backups*, `docs/OCI_DEPLOYMENT_CHECKLIST.md` step 2):
`pg_dump --format=custom --no-owner --no-privileges` through the running database
service, written to the Git-ignored `backups/` directory with a unique timestamped
name under `set -o noclobber`.

| Field | Value |
| --- | --- |
| Path (on the server) | `backups/prod_pre_municipal_costs_20260809_014048.dump` |
| Size | **899,326,907 bytes** |
| SHA-256 | `5ef2b1d9c33cb2ae481f7849e5e8a4eb46eef988b0a0330aec19989121959b44` |
| Magic | begins `PGDMP` |
| Archive header | `Format: CUSTOM`, `Dump Version: 1.15-0`, `Compression: gzip`, 412 TOC entries |
| `pg_restore -l` | exit **0**, 407 numbered TOC lines read |
| Critical tables in the TOC | `landfill_inbound_monthly`, `regions`, `regional_population`, `data_sources`, `alembic_version`, `ingestion_runs`, `suitability_candidates`, `environmental_land_cover_cell_statistics` — all present |
| `municipal*` entries in the TOC | **0** — confirming a genuine *pre-`0021`* snapshot |
| Revision represented | **`0020`** |

> The runbook's gotcha holds: piping the dump into a container's `pg_restore` via a
> pipe fails on the header seek. The TOC was read instead by mounting `backups/`
> **read-only** into a throwaway `postgis/postgis:16-3.4` container. The production
> stack was not modified to perform this check.

Rollback release SHA recorded at this point: `272b5b460777ad59893d27b16185a563432b11fc`.

---

## 4. Private source transfer

The 64 workbooks are private ingestion inputs. They were **not** placed inside the
Git checkout: `docker-compose.prod.yml`'s `ingestion` service bind-mounts no repository
directory, so a mount is required regardless, and `--source-dir` is a first-class
reviewed CLI option. They therefore live outside the working tree entirely.

| Field | Value |
| --- | --- |
| Remote private root | `/home/ubuntu/private/municipal-costs/2024` (outside the Git checkout) |
| Permissions | directories `700`, files `600`, owner `ubuntu` only; no world/group access anywhere under `/home/ubuntu/private` |
| Transfer | `rsync -rlt` over SSH, **no `--delete`**, `.DS_Store` excluded; Unicode filenames preserved |
| Local workbooks | 64 (`DATA_A` 29 + `DATA_B` 35) |
| Remote workbooks | 64 (`DATA_A` 29 + `DATA_B` 35) |
| SHA-256 verification | **64/64 match** the local files *and* `artifacts/municipal-costs/step1_source_inventory.json` (paths compared NFC-normalised); zero missing, zero extra, zero mismatches |
| Local pre-flight | the 64 local workbooks were themselves re-verified against the Step 1 inventory before transfer — byte-identical, nothing altered since Step 1/2 |
| Source mutation | none — no workbook was opened, resaved, OCR'd, or rewritten |
| Container mount | read-only at `/srv/municipal-costs/2024` in the ephemeral ingestion container; the report directory `/home/ubuntu/private/municipal-cost-reports` (`700`) mounted read-write |
| Container user | `--user 1001:1001` — the host `ubuntu` uid; the image's `appuser` is uid 1000 and could not read a `700` host directory |

Not public, not Git-tracked — verified:

- `git ls-files | grep municipal-costs` on the production checkout returns only the
  five `docs/municipal-costs/*.md` files; no workbook is tracked.
- `find` over the checkout returns **no** `*.xlsx`.
- Caddy reverse-proxies only `backend:8000` and `frontend:3000`; it runs no
  `file_server` and mounts no host data directory. Probes for
  `/data/…/미추홀구.xlsx`, `/data/`, `/municipal-costs/`, `/private/municipal-costs/2024/`
  and `/backups/<dump>` all resolve to the application **404** page — no directory
  listing, no file.
- No running container mounts the private directory; the ingestion containers were
  `--rm` and are gone.
- The served API embeds no absolute server path and no file bytes: workbook
  *filenames* appear only as provenance, which is the intended Step 2/3 disclosure.

---

## 5. Deployment

```bash
./scripts/deployment/deploy.sh \
  --ref 43ad1b5c955b443ad19955b875f26638cf551144 \
  --env-file .env.production \
  --base-url https://waste-161-33-2-143.sslip.io \
  --expect-data
```

`check-production-env.sh` passed first (all seven guards, `5432` not published).
The script then checked out the release SHA, built the backend and frontend images,
started the database (already healthy), started backend / frontend / caddy, waited
for backend health, and ran the smoke test.

- **Deployed Git SHA printed: `43ad1b5c955b443ad19955b875f26638cf551144`**
- Smoke test: 7/7 checks passed, including `database reachable via health`
- Worktree clean after checkout; `.env.production` **not** modified
- database and caddy containers were **not** recreated (identical image IDs and start
  times before and after); backend and frontend were rebuilt and recreated
- Volumes after deploy: the same three, unchanged

---

## 6. Migration `0021`

Applied automatically by the backend container's start command. The backend log shows
exactly one upgrade:

```
INFO  [alembic.runtime.migration] Running upgrade 0020 -> 0021,
      2024 municipal waste collection-and-transport contract payments (Step 2).
```

| Check | Expected | Actual |
| --- | --- | --- |
| Previous revision | `0020` | `0020` |
| Final revision | `0021` | **`0021`** |
| Rows in `alembic_version` | 1 | **1** (single head) |
| Municipal tables created | 6 | **6**, exactly the Step 2 set, and **no** other `municipal%` table |
| `ck_municipal%` CHECK constraints | 39 | **39** |
| `uq_municipal%` UNIQUE constraints | 6 | **6** |
| `ix_municipal%` indexes | 25 (21 single-column + 4 composite) | **25** |
| Municipal table row counts before ingestion | 0 | **0** on all six |
| `data_sources` | +1 (`municipal_waste_cost_disclosure`, `STRUCTURAL`, enabled) | present; total 11 → **12** |

PostgreSQL truncates the repository's `ck_%(table_name)s_%(constraint_name)s` names to
63 characters with a hash suffix, so the constraints are verified by **definition**,
not by literal name. All the load-bearing ones are present as written:

- `CHECK (status <> 'UNAVAILABLE' OR value IS NULL)` — an unavailable indicator can
  never be stored as `0`
- `CHECK ((status='AVAILABLE' AND population IS NOT NULL AND population > 0) OR (status='UNAVAILABLE' AND population IS NULL))`
- `CHECK (population_method='DIRECT_REGION_POPULATION' AND direct_region_id IS NOT NULL) OR (…='DERIVED_SUM_OF_CONSTITUENT_WARDS' AND direct_region_id IS NULL)`
- `CHECK (NOT is_primary_numerator_eligible OR (payment_type='ACTUAL_PAID_AMOUNT' AND payment_amount_krw IS NOT NULL))`
- `CHECK (boundary_vintage = '2024')`
- the `value_state` / `quantity_value` consistency CHECK, branch by branch

`landfill_inbound_monthly` after the migration: **9,212** rows, one accounting basis,
all `SIDO`, sums and month range identical to §2 — unchanged.

---

## 7. Application verification before any data write

| Check | Result |
| --- | --- |
| backend / frontend / database containers | healthy |
| caddy | running (no healthcheck defined for this service) |
| `/` | 200 |
| `/health` | 200, `database: ok` |
| `/ready` | 404 (pre-existing; no such route — see §2) |
| `/api/v1/landfill/summary` `/trends` `/composition` `/flows` | 200 |
| `/api/v1/landfill/municipal-costs?year=2024` | **200** with `expected_count = 66`, `returned_count = 0`, `municipalities: []` |

The pre-ingestion state is an explicit "66 expected, 0 returned" — the endpoint never
implied zero cost. This state existed only between the migration and the write.

---

## 8. Production dry run — zero writes

```bash
docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production \
  --profile ingestion run --rm -T --user 1001:1001 \
  -v /home/ubuntu/private/municipal-costs/2024:/srv/municipal-costs/2024:ro \
  -v /home/ubuntu/private/municipal-cost-reports:/reports \
  ingestion municipal-costs-ingest --dry-run \
    --source-dir /srv/municipal-costs/2024 \
    --report-path /reports/prod_dry_run.json
```

`status = DRY_RUN_OK`, exit 0, `ingestion_run_id = null`, `writes = {}`, no warnings.

| Metric | Reviewed contract | Production dry run |
| --- | --- | --- |
| Source files discovered / parsed / accepted / rejected | 64 / 64 / 62 / 2 | **64 / 64 / 62 / 2** |
| DATA_A / DATA_B | 29 / 35 | **29 / 35** |
| Registry total | 66 | **66** |
| 서울 11 / 인천 28 / 경기 41 | 25 / 10 / 31 | **25 / 10 / 31** |
| Derived-population cities | 7 | **7** (수원·성남·안양·부천·안산·고양·용인), every stored population exactly equal to its component sum |
| Contracts | 205 | **205** |
| Numerator-eligible contracts | 196 | **196** |
| Quantity observations | 2,701 | **2,701** |
| Files with repeated quantity blocks / logical quantities from them | 15 / 221 | **15 / 221** |
| Numerator total | 659,366,684,767 KRW | **659,366,684,767 KRW** |
| AVAILABLE / PARTIAL / UNAVAILABLE | 20 / 5 / 41 | **20 / 5 / 41** |
| Rejected files | `DATA_B/경기도(…)/양천구.xlsx`, `DATA_B/인천/서해구xlsx.xlsx` | **exactly those two**, with their Step 2 reason codes |

**Zero database writes proven by snapshot, not by claim.** A fingerprint taken
immediately before and immediately after the dry run was byte-identical, including
`max(id)` on every table, the `ingestion_runs` count, and the landfill totals:

```
g=0|c=0|f=0|k=0|q=0|i=0|maxg=-|maxk=-|maxq=-|maxi=-|sumval=-|sumnum=-|
md5reason=-|md5sha=-|runs=68|landfill=9212|landfill_fee=3977236816206.00
```

---

## 9. First production write

The same command with `--write` and `--report-path /reports/prod_write_1.json`.
The whole load runs in one transaction.

`status = SUCCEEDED`, `ingestion_run_id = 601`, `idempotent_no_op = false`, no warnings.

| Inserted | Count |
| --- | --- |
| geographies | **66** |
| population components | **20** |
| source files | **64** |
| contracts | **205** |
| quantity observations | **2,701** |
| indicator values | **66** |

Indicator: 20 AVAILABLE / 5 PARTIAL / 41 UNAVAILABLE, numerator **659,366,684,767 KRW**,
unit `KRW/인`. `ingestion_runs` row 601 records `rows_received 64`,
`rows_inserted 3122` (= 66+20+64+205+2701+66), `rows_updated 0`, `rows_rejected 2`.

---

## 10. Idempotency — second write

Run immediately afterwards, byte-identical command.

`status = SUCCEEDED`, `ingestion_run_id = 602`, **`idempotent_no_op = true`**.

```json
{"components_unchanged": 20, "geographies_unchanged": 66,
 "indicator_values_unchanged": 66, "observations_unchanged": 2906,
 "source_files_unchanged": 64}
```

There is **no** `*_inserted` and **no** `*_updated` key in the report at all — the
loader reconciled by stored content and found nothing to change. This is not
"uniqueness constraints rejected the duplicates".

Snapshot before and after the second write, identical in every field:

```
before: g=66|c=20|f=64|k=205|q=2701|i=66|maxg=66|maxk=205|maxq=2701|maxi=66|
        sumval=1455186.6612|sumnum=659366684767.00|
        md5reason=dcf24be7ff481a17dba23b9db64b4dc5|md5sha=d7c88eb7829b12c3804f071c300b7db9|
        landfill=9212|landfill_fee=3977236816206.00
after:  (identical)
```

Only `ingestion_runs` moved (69 → 70): that is the audit run log, not a data change.
`sum(value) = 1455186.6612` and the reason-code MD5 `dcf24be7…` are the **same values
the Step 2 local run recorded**, so the production load is content-identical to the
reviewed local load.

---

## 11. Production database verification

All read-only SQL, run after both writes.

| Check | Expected | Actual |
| --- | --- | --- |
| `municipal_cost_geographies` | 66 | **66** |
| `municipal_cost_geography_components` | 20 | **20** |
| `municipal_cost_source_files` | 64 | **64** |
| `municipal_waste_contracts` | 205 | **205** |
| `municipal_waste_quantities` | 2,701 | **2,701** |
| `municipal_cost_indicator_values` | 66 | **66** |
| Metropolitan split 11 / 28 / 41 | 25 / 10 / 31 | **25 / 10 / 31** |
| `DIRECT_REGION_POPULATION` | 59 | **59** |
| `DERIVED_SUM_OF_CONSTITUENT_WARDS` | 7 | **7** |
| Status AVAILABLE / PARTIAL / UNAVAILABLE | 20 / 5 / 41 | **20 / 5 / 41** |
| Indicator rows stored as `0` | 0 | **0** in every status bucket |
| UNAVAILABLE rows with NULL value, NULL numerator, NULL denominator | 41 / 41 / 41 | **41 / 41 / 41**; zero of them hold any `0` |
| Rejected source files | 2 | **2**, neither resolving to a geography |
| DATA_B payment contribution | 0 | **0 contracts, 0 eligible, 0 KRW** |
| Eligible numerator | 659,366,684,767 KRW | **659,366,684,767.00 KRW** across **196** eligible contracts; the indicator numerator sum agrees exactly |
| Deferred `MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE` rows | 0 | **0** — the only `indicator_code` present is `MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA` |

The seven derived city populations, each equal to the exact ward sum:

| City | Wards | Stored population | Component sum | Exact |
| --- | --- | --- | --- | --- |
| 고양시 | 3 | 1,044,968 | 1,044,968 | ✓ |
| 부천시 | 3 | 794,082 | 794,082 | ✓ |
| 성남시 | 3 | 900,867 | 900,867 | ✓ |
| 수원시 | 4 | 1,224,979 | 1,224,979 | ✓ |
| 안산시 | 2 | 701,551 | 701,551 | ✓ |
| 안양시 | 2 | 545,800 | 545,800 | ✓ |
| 용인시 | 3 | 1,077,481 | 1,077,481 | ✓ |

Missing is never zero — quantity `value_state` distribution matches the methodology
exactly: `MEASURED` 2,158 · `MEASURED_ZERO` 47 (the only rows holding `0`) ·
`SOURCE_DASH_NO_DATA` 479 · `SOURCE_TEXT_NO_DATA` 3 · `BLANK` 14. Attribution:
`MUNICIPAL_TOTAL_SINGLE` 1,716 · `PER_CONTRACT` 764 ·
`MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT` 221.

Rejected workbooks and their stored reasons:

| File | `rejection_reasons` |
| --- | --- |
| `DATA_B/경기도(31개중 19개 완료 8.4기준)/양천구.xlsx` | `["AMBIGUOUS_REGION_MAPPING"]` |
| `DATA_B/인천/서해구xlsx.xlsx` | `["BOUNDARY_MISMATCH","AMBIGUOUS_REGION_MAPPING","DUPLICATE_SOURCE_RECORD","ZERO_TOTAL_QUANTITY"]` |

**Official landfill regression (database):** `landfill_inbound_monthly` still holds
9,212 rows, one accounting basis, all `SIDO`, 3 origins, `sum(quantity_kg)` and
`sum(inbound_fee_krw)` and the month range all identical to the pre-deploy baseline.
Rows that are not metropolitan-origin flow: **0**. No municipal row was inserted.
`regions` 82 and `regional_population` 748 are unchanged.

---

## 12. Public municipal-cost API

`GET https://waste-161-33-2-143.sslip.io/api/v1/landfill/municipal-costs?year=2024` → **200**, 66 rows.

| `meta` field | Value |
| --- | --- |
| `indicator_code` | `MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA` |
| `display_name` | 주민 1인당 생활폐기물 수집·운반 계약 지급액 |
| `unit` | `KRW/인` |
| `is_official_landfill_fee` | **false** |
| `accounting_basis` | `MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT` |
| `expected_count` / `returned_count` | 66 / 66 |
| `available_count` / `partial_count` / `unavailable_count` | **20 / 5 / 41** |
| `rejected_source_file_count` | 2, with both files and their reasons |
| `source_coverage` | 64 discovered / 62 accepted / 2 rejected; DATA_A 29, DATA_B 35; 19 municipalities with no source file |

| Query | Result |
| --- | --- |
| `sido=11 / 28 / 41` | **25 / 10 / 31** (HTTP 200) |
| `status=AVAILABLE / PARTIAL / UNAVAILABLE` | **20 / 5 / 41** (sums to 66) |
| `sido=28&status=PARTIAL` | 4 — 옹진군, 계양구, 부평구, 남동구 |
| `sort=payment_per_capita_desc` | first 이천시 `213905.7731`, last 하남시 `null` |
| `sort=total_payment_desc` | first 수원시, last 하남시 `null` |
| `sort=region_name_asc` | first 강남구, last 화성시 |
| `year=2023` · `sido=99` · `status=BOGUS` · `sort=bogus` · `year=abc` | **422** on all five — invalid values are rejected, never silently reinterpreted |
| UNAVAILABLE rows | 41; `payment_per_capita_krw` and `total_eligible_payment_krw` all `null`; **no zeros** |
| Deferred landfill-associated estimate | **absent** from the whole payload |

`meta.difference_from_official_landfill_fee` is served verbatim and names the official
indicator explicitly, stating the two values are not to be added, subtracted, or ratioed.

---

## 13. Public frontend

Measured in headless Chromium against
`https://waste-161-33-2-143.sslip.io/?v=1&mode=flow&metric=HOUSEHOLD`.

**Desktop, 1440×900** — HTTP 200, no console error, no page error, no horizontal overflow.

| Check | Result |
| --- | --- |
| Section heading | **시·군·구별 생활폐기물 수집·운반 계약 지급액 — 2024년**, visible |
| Error state | none — 0 `role="alert"` inside the section |
| Table rows | **66** |
| Column headers | 지자체 · 광역 · 주민 1인당 지급액 · 총 지급액 · 자료 상태 · 데이터 참고 |
| Scope summary | 대상 지자체 **66** · 계산 가능 **20** · 일부 제한 **5** · 자료 없음 **41**; "값이 없는 지자체는 0이 아니라 자료 없음으로 표시하며 목록에서 제외하지 않습니다." |
| Per-row status tally | 계산 가능 **20** · 일부 제한 **5** · 자료 없음 **41** |
| AVAILABLE rows | all render a real `원/인` value |
| PARTIAL rows | all render a real value **and** the served limitation in the row itself (옹진군 일부 읍·면 / 계양구 지급 기록 없는 월 / 부평구·남동구 일부 품목 / 가평군 일부 기간) |
| UNAVAILABLE rows | 41/41 show `자료 없음` in **both** money cells, and 41/41 carry the served reason sentence |
| Cells rendering a bare zero (`0억원`, `0원/인`, `₩0`) | **none** |
| Derived-population rows | **7** — 수원·성남·안양·부천·안산·고양·용인, each labelled `인구: 구성 일반구 인구 합산` |
| Official-landfill distinction | the served difference statement is rendered verbatim, outside any disclosure, and names `LANDFILL_INBOUND_FEE_PER_CAPITA`; the section never labels itself 반입수수료 / 공식 매립지 수수료 / 폐기물 총관리비 |
| Deferred estimate | absent from the served HTML |
| Indicator code disclosed | `MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA` present in the methodology disclosure |
| Official landfill area | 수도권매립지 반입 현황 still rendered above, unaffected |

Controls (지역 / 자료 상태 / 정렬), all native `<select>`:

| Action | Result |
| --- | --- |
| 지역 = 인천 | **10** rows; URL `…&mcSido=28` |
| + 자료 상태 = 일부 제한 | **4** rows; URL `…&mcSido=28&mcStatus=PARTIAL` |
| reset to 전체 | back to **66** rows |
| 정렬 = 1인당 지급액 많은 순 (default) | 이천시 `213,906원/인` … 하남시 `자료 없음` |
| 정렬 = 총 지급액 많은 순 | 수원시 … 하남시 `자료 없음` |
| 정렬 = 지역 이름순 | 강남구 … 화성시 |

Nulls sort last on both value sorts, so an unavailable municipality is never ordered
as if it were the cheapest.

**Mobile, 390×844** — HTTP 200, no console error.

| Check | Result |
| --- | --- |
| Desktop table | hidden |
| Municipality card list | **66** cards |
| Derived-population markers in the cards | **7** |
| Bare zero money values in the cards | **0** |
| Horizontal overflow (`scrollWidth > clientWidth`) | **false** |

No map was added for the 66 municipalities — the registry stores no geometry and the
seven ward-split cities have no city-level region, exactly as Step 3 decided.

---

## 14. Official landfill regression (public)

The four official endpoints were fetched again and compared to the §2 baseline as
canonicalised JSON:

| Endpoint | Status | Byte-identical to pre-deploy |
| --- | --- | --- |
| `/api/v1/landfill/summary` | 200 | **yes** (`d8e9c04f…`) |
| `/api/v1/landfill/trends` | 200 | **yes** (`589a6496…`) |
| `/api/v1/landfill/composition` | 200 | **yes** (`51fc903d…`) |
| `/api/v1/landfill/flows` | 200 | **yes** (`70651417…`) |

None contains any municipal content. `LANDFILL_INBOUND_FEE_PER_CAPITA` is unchanged:
`4045.92 KRW/인`, `landfill-fee-per-capita-v2`, `OFFICIAL_INPUTS_DERIVED_VALUE`,
fee `105,524,217,420.00 KRW` for reference year 2025, population 26,081,644 at
`2025-12`, `population_region_level = SIDO`. The summary's
`accounting_basis` is still `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`, with
`row_count 325`, `total_quantity_kg 1058910570.000000`,
`total_inbound_fee_krw 105524217420.00`. The metropolitan-only semantics are intact.

---

## 15. Release health

| Check | Result |
| --- | --- |
| `/` | 200 |
| `/health` | 200, `{"status":"ok","database":"ok","app_env":"production"}` |
| `/ready` | 404 — pre-existing; the repository defines no such route |
| `scripts/deployment/smoke-test.sh --expect-data` | **7/7 passed** |
| `scripts/deployment/verify-production-data.sh --allow-drift` | **passed**; every strict integrity metric (`dup_city_stats`, `city_stats_on_child`, `invalid_derived_geom`, `child_in_two_cities`) is `0`, and `regions`/`waste_statistics`/`facilities`/`zoning`/`roads`/all reporting-geography metrics match exactly. The `population`, `protected`, and `suitability_*` DIFFs are the pre-existing OCI drift recorded in earlier deployments, unchanged by this release. |
| backend / frontend / database | healthy |
| caddy | running (no healthcheck defined) |
| Restart counts | **0** on all four containers — no restart loop |
| backend / frontend / database logs since deploy | **0** matches for ERROR, FATAL, Traceback, Exception |
| Caddy access log 5xx | none |
| Disk after release | 193 G total, 27 G used, **167 G available** (14 %) — 4 G consumed by the new images, the backup, and the workbooks |
| Docker volumes | the same three; none recreated, pruned, or replaced |

---

## 16. Rollback readiness

**No rollback was performed and none was rehearsed destructively.** Nothing was
downgraded, dropped, or deleted to "test" it.

| Field | Value |
| --- | --- |
| Previous application SHA | `272b5b460777ad59893d27b16185a563432b11fc` |
| New release SHA | `43ad1b5c955b443ad19955b875f26638cf551144` |
| Database backup | `backups/prod_pre_municipal_costs_20260809_014048.dump` (899,326,907 bytes) |
| Backup SHA-256 | `5ef2b1d9c33cb2ae481f7849e5e8a4eb46eef988b0a0330aec19989121959b44` |
| Backup revision | `0020` |

Documented application-rollback command:

```bash
./scripts/deployment/rollback-app.sh --ref <previous-release-SHA> --env-file .env.production
```

Migration `0021` is additive and now holds production data, so an application-only
rollback must not touch the schema. The script enforces this itself: it refuses when
the target ref does not contain the migration file for the live revision. Simulated
read-only (the same `git grep` the script runs, against live revision `0021`):

| Candidate ref | Guard outcome |
| --- | --- |
| `272b5b4` (previous production) | **STOP** — does not contain `0021`; rolling back to it would require a destructive downgrade |
| `b03ac55` (backend merged, pre-frontend) | would proceed — contains `0021` |
| `063d977` (Step 2 backend) | would proceed — contains `0021` |
| `43ad1b5` (this release) | would proceed |

So the safe rollback targets are `b03ac55` / `063d977` (application rolls back, schema
and municipal data stay). Returning all the way to `272b5b4` means restoring the §3
backup through the reviewed
`scripts/deployment/restore-production-database.sh --dump … --confirm-production`
path — a deliberate decision, never an automatic one. **`alembic downgrade` was not
run and must not be run** unless a disaster-recovery decision explicitly calls for it;
it would destroy the six municipal tables and their 3,122 rows.

---

## 17. Raw workbook handling and publication limits

The repository documents no retention policy for raw ingestion inputs (only
`BACKUP_RETENTION_DAYS` for database dumps), so the workbooks were **kept, not
deleted**: destroying reproducibility inputs without a policy is the riskier choice.

They remain only in `/home/ubuntu/private/municipal-costs/2024`, mode `700`/`600`,
owned by the deployment user, outside the Git checkout, unreachable through Caddy, and
mounted read-only into an ephemeral container only for the duration of a run.

**This release does not assert or grant any right to redistribute the source
workbooks.** They are private ingestion inputs. Public download or redistribution of
the raw XLSX files is out of scope and was not enabled. What *is* published is the
derived material Step 2/3 intentionally implemented: the per-capita indicator, the
status and reason codes, the population provenance, the source-coverage counts, and
the two rejected filenames with their reasons.

That unresolved publication question is about the **workbooks**, not about the
labelling of the derived values. The derived values remain explicitly labelled
`LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE` with
`is_official_landfill_fee = false`; they are never presented as official landfill
data.

---

## 18. Known limitations (carried forward, unchanged by this release)

1. **Seoul has no payment data at all** — all 25 자치구 are UNAVAILABLE. A source-supply
   gap, shown as 자료 없음 with the served reason, never as `0`.
2. **Coverage is 25 of 66** (20 AVAILABLE + 5 PARTIAL); the other 41 are `null`.
3. **PARTIAL is not comparable to AVAILABLE** — contract scope, geography, or period
   differs; each row states which.
4. **Quantity coverage is incomplete** (46 of 66 have any tonnage) and does not affect
   the payment indicator.
5. **The denominator is SGIS annual population**, which may differ from a
   municipality's own resident-registration figure.
6. **Two workbooks are rejected outright**, preserved as provenance and contributing
   nothing.
7. **Only 2024 is published**; every other year is a 422.
8. **No map layer** for the 66 municipalities — the registry stores no geometry.
9. **`/ready` returns 404** — the repository defines no such route; `/health` is the
   readiness probe. Pre-existing, unrelated to this release.
10. `verify-production-data.sh` needs `--allow-drift` on this host for the
    pre-existing population / protected / suitability drift; all strict integrity
    checks still pass exactly.

---

## 19. Operational record

| Item | Value |
| --- | --- |
| Public origin | `https://waste-161-33-2-143.sslip.io` |
| Compose project / file / env file | `waste-equity-prod` / `docker-compose.prod.yml` / `.env.production` |
| Deployed SHA | `43ad1b5c955b443ad19955b875f26638cf551144` |
| Alembic revision | `0021` |
| Ingestion runs | `601` (first write, SUCCEEDED) · `602` (idempotent no-op, SUCCEEDED) |
| Private source root (server) | `/home/ubuntu/private/municipal-costs/2024` — 700, outside Git, not web-served |
| Sanitized reports (server, outside Git) | `/home/ubuntu/private/municipal-cost-reports/prod_dry_run.json`, `prod_write_1.json`, `prod_write_2.json` |
| Deploy log (server, outside Git) | `/home/ubuntu/deploy-municipal-costs-20260808_164705.log` |
| Database backup (server, Git-ignored) | `backups/prod_pre_municipal_costs_20260809_014048.dump` |
| `.env.production` | **not modified** |
| AWS/EC2 environment | untouched, left as the older rollback environment |
