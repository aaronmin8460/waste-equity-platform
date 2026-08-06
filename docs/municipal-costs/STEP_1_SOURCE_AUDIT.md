# Step 1 — Municipal Waste-Management Cost Source Audit (reference year 2024)

**Status:** audit only. No schema, ingestion, API, frontend, or deployment work was
performed. Nothing was committed, pushed, merged, or deployed. No Alembic migration was
run and nothing was written to any database.

**Branch:** `feature/municipal-waste-costs-2024` (created from `main` @ `272b5b4`)
**Generated:** 2026-08-05
**Machine-readable companions:**
`artifacts/municipal-costs/step1_source_inventory.json` (64 workbooks, full per-file detail)
`artifacts/municipal-costs/step1_municipality_coverage.csv` (66 expected municipalities)

---

## 1. Executive conclusion

64 workbooks were parsed with `openpyxl` — every file, not a sample. All 64 opened
without error. No OCR was used and no source workbook was opened, resaved, or modified.

The source set **does support** a municipal cost indicator, but for a **minority** of the
capital region and **only** on a payment-per-capita basis. Three findings dominate:

1. **DATA_A carries payments; DATA_B never does.** DATA_B is a single fixed
   3-category × 12-month tonnage layout with no monetary field anywhere in any of its 35
   files. It is a quantity cross-check only. DATA_A is the sole payment source (29 files).

2. **In Gyeonggi, quantity cannot be attached to a payment.** In 15 of the 22 Gyeonggi
   DATA_A workbooks the monthly quantity block is **duplicated verbatim under every
   contract row** — the same city-wide 12-month series repeated 4–14 times. Summing
   quantity across contract rows would multiply the true city total by the contract count.
   This makes the tonnage-weighted landfill allocation **structurally impossible** for
   those cities: the payment is per-contract, the quantity is city-wide, and the source
   provides no key to split one against the other.

3. **Seoul has no payment data at all.** `DATA_A/서울/` exists as a directory but is
   **empty**. All 12 Seoul files are DATA_B tonnage. Therefore **zero of Seoul's 25
   autonomous districts** can produce the primary indicator.

Headline coverage against the 66 expected 2024 municipalities:

| | Count |
|---|---:|
| Expected municipalities | **66** |
| `AVAILABLE` | **14** |
| `PARTIAL` | **33** |
| `UNAVAILABLE` | **19** |
| `PRIMARY_VALUE_SUPPORTED` | **14** |
| `PRIMARY_VALUE_PARTIAL` | **6** |
| `PRIMARY_VALUE_UNAVAILABLE` | **46** |
| `LANDFILL_ESTIMATE_SUPPORTED` | **1** (미추홀구) |
| `LANDFILL_ESTIMATE_UNAVAILABLE` | **65** |

Two hard blockers must be resolved by you before Step 2 can produce a correct result:
the **missing city-level Gyeonggi geography** (§9, blocks 7 cities including 수원/성남/
고양/용인) and the **two unattributable workbooks** (§10). Both are decisions, not code.

---

## 2. Git and repository baseline

Inspected before any action was taken:

| Item | Value |
|---|---|
| Working directory | `/Users/byeongilmin/dev/waste-equity-platform` |
| Branch at start | `main` |
| `main` vs `origin/main` | identical — `272b5b4`, 0 ahead / 0 behind |
| Last 5 commits | `272b5b4`, `3d29ff3`, `31aa81e`, `3e7bd28`, `839b577` |
| Alembic head (dev DB) | `0020` — matches latest file `20260728_0020_land_cover_cell_statistics.py` |
| Compose services | `database`, `backend` |
| Worktree initially clean | **NO** |

**The worktree was not clean and nothing was discarded.** Two pre-existing user changes
were found and preserved intact:

- `M .gitignore` — an uncommitted edit already adding `data/import/municipal-costs/` and
  `data/raw/municipal-costs/`.
- `?? docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` — untracked, unrelated to this work.

Both carried over to `feature/municipal-waste-costs-2024` unchanged. The branch did not
previously exist and was created from the current `HEAD`.

### Docker / database note (an action worth flagging)

The Docker daemon was **down** at session start. Because §8 requires reading population
coverage from the development database, Docker Desktop was started. On start it
auto-restored the `backend` container, whose entrypoint is `sh -c 'alembic upgrade head…'`
— that would have run a migration, which this step forbids. **The backend container was
stopped and removed before the database was started**, so no Alembic command ever ran.
Only the `database` service was brought up, and it was queried read-only. Its head was
already `0020`; nothing was written.

---

## 3. Existing landfill semantic contract (must remain unchanged)

Inspected: model, migration, ingestion, analysis, schemas, routes, frontend types,
dashboard components, region table, tests, deployment scripts, and production docs.

| Layer | Path |
|---|---|
| Model | [landfill_inbound.py](backend/src/waste_equity_backend/models/landfill_inbound.py) |
| Migration | [20260714_0013_landfill_inbound_flow.py](backend/alembic/versions/20260714_0013_landfill_inbound_flow.py) |
| Ingestion | [landfill_inbound.py](ingestion/src/waste_equity_ingestion/landfill_inbound.py) |
| Analysis | [landfill.py](backend/src/waste_equity_backend/analysis/landfill.py) |
| Schemas | [landfill.py](backend/src/waste_equity_backend/schemas/landfill.py) |
| Routes | [landfill.py](backend/src/waste_equity_backend/api/routes/landfill.py) |
| Frontend types | [api.ts](frontend/src/lib/api.ts), [landfill.ts](frontend/src/lib/landfill.ts) |
| Dashboard | [LandfillDashboard.tsx](frontend/src/components/LandfillDashboard.tsx) + [components/landfill/](frontend/src/components/landfill/) |
| Region table | [LandfillRegionTable.tsx](frontend/src/components/landfill/LandfillRegionTable.tsx) |
| Tests | [test_landfill_analysis.py](backend/tests/test_landfill_analysis.py), [test_landfill_routes.py](backend/tests/test_landfill_routes.py) |
| Deployment | [verify-production-data.sh](scripts/deployment/verify-production-data.sh) |
| Docs | [CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md](docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md), [SL_LANDFILL_DATA_DICTIONARY.md](docs/SL_LANDFILL_DATA_DICTIONARY.md) |

**Confirmed accounting basis and grain**, read directly from the code:

- Accounting basis `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` — a **third,
  distinct** basis, never summed/differenced/ratioed against
  `ORIGIN_BASED_TREATMENT_OUTCOME` or `FACILITY_LOCATION_BASED_THROUGHPUT`.
- Origin level is metropolitan-only, enforced by a CHECK constraint:
  `ALLOWED_ORIGIN_REGION_CODES = ("KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41")` — 서울 / 인천 /
  경기 exactly, `origin_region_level = 'SIDO'`.
- Values are official Sudokwon Landfill Corporation odcloud datasets `15064381`
  (inbound quantity, kg) and `15064394` (inbound fee, KRW), evidence class
  `OFFICIAL_REPORTED_VALUE`.
- There is **no** city / county / district disaggregation, and the model docstring states
  a 광역 value is *"never disaggregated to a city, county, or district."*
- `LANDFILL_INBOUND_FEE_PER_CAPITA` (`landfill-fee-per-capita-v2`) divides the official
  metropolitan fee by the MOIS monthly resident-registration population.

**Consequence for this work, and it is not negotiable:** the municipal workbooks are a
different accounting basis (contracted municipal service payments, city/district grain,
mixed destinations). They must be stored in **new additive tables** and must **never** be
inserted as extra rows in `landfill_inbound_monthly`, which would violate its
origin-level CHECK constraint anyway. The existing indicator is untouched by this work.

---

## 4. Source directory inventory

Actual structure, confirmed by recursive walk — it does **not** match the assumed layout:

```
data/import/municipal-costs/2024/
├── DATA_A/
│   ├── 서울/                                        ← EXISTS BUT IS EMPTY (0 files)
│   ├── 인천/                                        7 xlsx + 1 docx
│   └── 경기도(31개 중 22개 완료 8.4 기준)/            22 xlsx + 1 docx
└── DATA_B/
    ├── 단위는 톤 .txt                                ← 0 bytes; the FILENAME is the note
    ├── 서울/                                        12 xlsx
    ├── 인천/                                        3 xlsx + 1 docx
    └── 경기도(31개중 19개 완료 8.4기준)/              19 xlsx + 1 docx
```

**Deviations from the assumed layout:**

1. `DATA_A/서울/` exists but contains **no files**. Seoul has no payment data whatsoever.
2. The Gyeonggi folder names embed progress counts (`22개 완료`, `19개 완료`) and differ
   between DATA_A and DATA_B. A parser must not treat the folder name as a clean key.
3. `DATA_B/단위는 톤 .txt` is a **zero-byte** file. Its filename ("the unit is tonnes") is
   the only unit declaration at the DATA_B set level; per-file `※ 단위: 톤(t)` rows confirm it.
4. Four `.docx` files enumerate not-yet-received municipalities (transcribed in §12).
5. Three stray `.DS_Store` files.

### Git-ignore protection

All three required paths are ignored. `artifacts/municipal-costs/` was **not** ignored and
was added — `.gitignore` is the **only** repository file modified in this step:

```
.gitignore:78  data/import/municipal-costs/    ← pre-existing (your uncommitted edit)
.gitignore:79  data/raw/municipal-costs/       ← pre-existing (your uncommitted edit)
.gitignore:80  artifacts/municipal-costs/      ← added by this step
```

Verified with `git check-ignore -v`: all three match, and a probe path
`artifacts/municipal-costs/step1_source_inventory.json` is ignored. `git status` shows no
XLSX and no artifact. **No source workbook was modified** — every file was opened
read-only and its SHA-256 recorded in the JSON inventory.

---

## 5. Complete workbook inventory

64 XLSX files, all parsed, **0 read errors**. Per-file detail — path, filename, parent
folders, size, SHA-256, sheet names, hidden sheets, used range, merged cells, header row,
unit labels, reference year, all three municipality signals and whether they agree,
payment/quantity/monthly/annual fields, contract and contractor names, waste categories,
destinations, treatment methods, source notes, blank/dash/zero counts, formulas vs cached
values, total rows, duplicates, inconsistencies — is in
`artifacts/municipal-costs/step1_source_inventory.json`.

Set-level facts:

| Property | Value |
|---|---|
| Workbooks | 64 (DATA_A 29, DATA_B 35) |
| Read errors | 0 |
| **Hidden sheets** | **0** — every sheet in every file is `visible` |
| Extra empty sheets | `Sheet2`/`Sheet3` present and empty in all 29 DATA_A files |
| Merged cells | 196 total, in exactly 2 files: 미추홀구 (154), 제물포구 (42) |
| Formula cells | present throughout; **cached values present for 100%** |
| **Formulas without a cached value** | **0** — so `FORMULA_WITHOUT_CACHED_VALUE` is unused |
| Dash `-` placeholder cells | 507 |
| Explicit numeric zeros | 49 |
| Sum of all DATA_A contract payments | 659,567,684,767 KRW |
| Duplicate files by SHA-256 | none — all 64 hashes distinct |

**Reference year.** Every DATA_B sheet is named `2024년`. Every DATA_A `년도` cell is
`2024`, with one exception: 가평군, whose `년도` cells hold explicit part-year ranges
(`2024.2.26.~4.5`, `2024.5.22.~7.30`). `MISSING_REFERENCE_YEAR` is therefore unused.

**Unit labels.** DATA_B: tonnes (set-level filename + per-file `※ 단위: 톤(t)`). DATA_A:
`총 금액(총 지급액)` in KRW (서해구 uses `총 금액(원)`), quantities in tonnes
(제물포구/서해구 label the columns `반출량(톤)` explicitly). No unit is expressed in a
different or ambiguous scale, so `UNSUPPORTED_UNIT` is unused. One conversion is recorded
in-source: 제물포구's remark states the original settlement table was in 천원 and was
multiplied by 1,000 to reach 원.

**Municipality signal agreement.** DATA_A has a `기관명` column giving an in-workbook
municipality; DATA_B has **no such column at all**, so DATA_B files carry only two signals
(filename, folder). Disagreements are enumerated in §8 and §10.

---

## 6. Source layout families

**7 distinct worksheet layouts.**

| # | Set | Sheet | n | Shape |
|---|---|---|---:|---|
| 1 | DATA_B | `2024년` | 35 | `구분 / 1월…12월 / 계` × rows `일반, 음식물, 재활용, 계` |
| 2 | DATA_A | `Sheet1` | 24 | `년도, 기관명, 계약명, 총 금액(총 지급액), [label,value]×k, 최종 처리시설, 처리방식, 비고` |
| 3 | DATA_A | `Sheet1` | 1 | 계양구 — family 2 **plus** a payment ledger `지급월, 구분, 월별 지급액 합계(원)` |
| 4 | DATA_A | `Sheet1` | 1 | 남동구 — family 2, columns named `(E의 수치)`, `(G의 수치)` |
| 5 | DATA_A | `Sheet1` | 1 | 서해구 — 3 destination pairs (`매립`/`소각`/`청라크린넷`), `총 금액(원)` |
| 6 | DATA_A | `Sheet1` | 1 | 옹진군 — family 2 with all quantity cells `-` |
| 7 | DATA_A | `Sheet1` | 1 | 제물포구 — pairs named `반출량(톤)` / `반출량2(톤)` |

Family 2 varies in **physical** width — 9 cols (17 files), 11 (7), 13 (2), 15 (2) —
because `k`, the number of `[label, value]` quantity pairs, varies from 1 to 4. The named
header spine is identical, so one parser handles all of family 2 if it locates the
trailing `최종 처리시설 / 처리방식 / 비고` block **by name** rather than by index.

### Family 1 (DATA_B) semantics

Row 5 `계` is `=SUM(row2:row4)`; column N `계` is `=SUM(B:M)`. Cached values are always
present. Three Incheon files append `※` note rows (7–15) carrying facility, method,
location, and caveat prose. **No monetary field exists in any DATA_B file.**

### Family 2 (DATA_A) semantics — the critical structure

A contract row carries `년도`, `기관명`, `계약명`, and the payment in column D. The rows
**below** it, until the next contract row, carry that contract's quantity block. A final
`합계` row holds `=SUM(D…)`.

**The decisive finding:** in 15 of 22 Gyeonggi files the quantity block is *byte-identical*
under every contract:

| Municipality | Contracts | Quantity block | Repeats |
|---|---:|---|---:|
| 고양시 | 12 | `수도권매립지 반입` (+`민간소각`) | 12 |
| 파주시 | 13 | `일반+음식물+재활용 처리량` | 13 |
| 양평군 | 14 | `위탁처리 총반출량` | 14 |
| 성남시 | 10 | `성남·판교 환경에너지시설 반입 합계` | 10 |
| 용인시 | 10 | `일반+음식물+불연성+재활용+대형 처리량` | 10 |
| 부천시 | 9 | `수도권매립지 반출(생활폐기물+연탄재)` | 9 |
| 김포시 | 8 | `외부 위탁·매립 합계(화엔텍+수도권매립지)` | 8 |
| 광주시 / 양주시 | 7 | 각 시 합계 | 7 |
| 과천시 / 이천시 / 의정부시 | 5 | 각 시설 반입 | 5 |
| 포천시 | 4 | `생활폐기물 반입량` | 4 |
| 동두천시 | 2 | 월별 반입량 | 2 |

Verified by comparing the full `(family, label, value)` signature of each contract block.
The quantity is a **city-wide figure copied down**, not a per-contract measurement.

By contrast, **all five Incheon DATA_A files with quantities are genuinely per-contract**
(미추홀구 23/23, 남동구 7/7, 부평구 6/6, 서해구 5/5, 제물포구 6/6 distinct blocks).

---

## 7. Expected 2024 municipality registry

**66 municipalities**: Seoul 25 + Incheon 10 + Gyeonggi 31. The full registry — canonical
region code, official 2024 name, parent metropolitan code and name, level, boundary
vintage, population presence, DATA_A presence, DATA_B presence — is
`artifacts/municipal-costs/step1_municipality_coverage.csv` (66 rows + header).

Canonical codes come from the platform `regions` table, all rows
`valid_from = 2024-01-01`, `valid_to = 2024-12-31`, `boundary_reference_period = 2024`:

- **Seoul** `KR-SGIS-11` → `KR-SGIS-11010` … `KR-SGIS-11250`, 25 자치구, complete.
- **Incheon** `KR-SGIS-23` → 10 rows, exactly the 2024 geography (see §8).
- **Gyeonggi** `KR-SGIS-31` → **44 rows, not 31** (see §9 — this is a blocker).

Note the metropolitan code divergence already documented in this repo: `regions` uses
`KR-SGIS-23` (Incheon) and `KR-SGIS-31` (Gyeonggi), while the landfill table's origin
CHECK uses `KR-SGIS-28` and `KR-SGIS-41`. Step 2 must not cross these without the
reviewed crosswalk.

---

## 8. Incheon 2024 boundary policy

**Policy applied:** 2024 observations are expressed **only** in 2024 geography — 중구,
동구, 미추홀구, 연수구, 남동구, 부평구, 계양구, 서구, 강화군, 옹진군. The 2026 restructuring is
**not** applied. 제물포구, 영종구, 서해구, 검단구 were **never created or inferred**, and the
2024 values of 중구 / 동구 / 서구 were **never redistributed**. The database agrees: all 10
Incheon `regions` rows are the 2024 units.

Four files use post-2024 names. They split cleanly into two groups:

**Resolvable — the workbook itself states the 2024 unit** (a documented, reproducible
conversion, so **not** a boundary mismatch):

| File | Filename says | Workbook `기관명` says | Resolved to |
|---|---|---|---|
| `DATA_A/인천/제물포구.xlsx` | 제물포구 | **인천광역시 동구청** | 동구 (`KR-SGIS-23020`) |
| `DATA_A/인천/서해구.xlsx` | 서해구 | **인천광역시 서구** | 서구 (`KR-SGIS-23080`) |
| `DATA_B/인천/남동구xlsx.xlsx` | 남동구 | *(no 기관명 column)* — note r14: `남동구 자료로 확인(사용자 확인 완료)` | 남동구 (`KR-SGIS-23050`) |

These three are flagged `POST_2024_FILENAME_RESOLVED_TO_2024_UNIT` and carry the deciding
evidence string in the JSON inventory.

**Not resolvable → `BOUNDARY_MISMATCH`:**

| File | Why |
|---|---|
| `DATA_B/인천/서해구xlsx.xlsx` | DATA_B has **no `기관명` column**, so the only signal is a post-2024 filename. There is **no documented, reproducible conversion back to 2024 geography**, so per policy it is classified `BOUNDARY_MISMATCH` (+ `AMBIGUOUS_REGION_MAPPING`) and attributed to no municipality. |

That file additionally carries two independent defects (see §10): its `음식물` row is
**byte-identical** to 미추홀구's, and its `일반`/`재활용` annual totals are `0` produced by
`=SUM()` over twelve `-` placeholders.

Post-2024 names also appear inside two DATA_B Incheon **note rows** (남동구 r12 names
수도권매립지-검단구 and 청라자원환경센터-서해구; 미추홀구 r9 names 검단구 백석동). These are
facility-location prose, not observation geography, and were not used for mapping.

---

## 9. Population coverage

Read from the development database, read-only. **Nothing was written.**

The platform holds two non-interchangeable series (a distinction this repo already
enforces):

| Series | Source | Granularity | 2024 rows | Municipal? |
|---|---|---|---:|---|
| SGIS annual | `sgis` | `ANNUAL` | 82 | **yes** — 79 SIGUNGU + 3 SIDO |
| MOIS resident registration | `mois_resident_population` | `MONTHLY` | 36 | **no** — 3 SIDO × 12 months only |

**The MOIS monthly series — the denominator the landfill v2 indicator uses — is
metropolitan-only and cannot serve a municipal indicator.** The only municipal 2024
denominator available is the **SGIS annual** series, `population_definition =
SGIS_TOTAL_POPULATION`, `reference_period = 2024`.

| Level | Expected | With 2024 population | Missing |
|---|---:|---:|---:|
| Seoul autonomous districts | 25 | **25** | 0 |
| Incheon 2024 counties/districts | 10 | **10** | 0 |
| Gyeonggi cities/counties | 31 | **24** | **7** |
| **Total** | **66** | **59** | **7** |

- **Duplicate population candidates: none.** A group-by over (region, 2024, ANNUAL)
  returns no region with more than one row; partial unique indexes
  `uq_regional_population_annual` / `_monthly` prevent it structurally.
- **Ambiguous definition: none** at municipal level — one definition
  (`SGIS_TOTAL_POPULATION`) for all 79 SIGUNGU rows.
- **Wrong reference year: none.** Every row used is `reference_year = 2024`. No year was
  interpolated or borrowed.
- **No metropolitan fallback was used**, as instructed.

### ⛔ BLOCKER — wrong geographical level for 7 Gyeonggi cities

`regions` stores Gyeonggi at **일반구 (ordinary-ward)** level for seven cities, and **no
city-level row exists** for any of them:

| City | Stored instead as | Ward rows |
|---|---|---:|
| 수원시 | 장안구, 권선구, 팔달구, 영통구 | 4 |
| 성남시 | 수정구, 중원구, 분당구 | 3 |
| 안양시 | 만안구, 동안구 | 2 |
| 부천시 | 원미구, 소사구, 오정구 | 3 |
| 안산시 | 상록구, 단원구 | 2 |
| 고양시 | 덕양구, 일산동구, 일산서구 | 3 |
| 용인시 | 처인구, 기흥구, 수지구 | 3 |

44 = 31 − 7 + 20. Because population is keyed by `region_id`, **there is no city-level
2024 population and no city-level region code** for these seven. The source workbooks are
city-grain (수원시.xlsx, 성남시.xlsx, 고양시.xlsx, 용인시.xlsx, 부천시.xlsx, 안산시.xlsx), and the
requirement is explicit that these must remain city-level observations. Five of the seven
(수원, 성남, 부천, 고양, 용인) **have DATA_A payments that are otherwise usable** but have no
denominator and nowhere to attach a city-grain row.

They are reported `MISSING_POPULATION` → `PRIMARY_VALUE_UNAVAILABLE`. Summing ward
populations to a city total is arithmetically trivial but is a **derived denominator** and
a modelling decision that is yours, not mine — see §19 Blocker B‑1.

---

## 10. Municipality coverage matrix

Full matrix: `artifacts/municipal-costs/step1_municipality_coverage.csv` (66 rows).
Columns include both region codes and names, level, boundary vintage, whether a
city-level region exists, population and availability, DATA_A/DATA_B file counts,
`has_both`, per-set classes, summed payment, status, reason codes, and both support
verdicts.

### Unattributable workbooks (2)

| File | Class | Why |
|---|---|---|
| `DATA_B/경기도(…19개 완료…)/양천구.xlsx` | `AMBIGUOUS_REGION_MAPPING` | **양천구 is a Seoul autonomous district**, filed under the 경기도 folder. There is no 양천구 in Gyeonggi. DATA_B carries no in-workbook municipality, so filename and folder conflict with **no third signal to break the tie**. Most likely a misfiled Seoul 양천구 workbook — but that must be confirmed by you, not assumed. |
| `DATA_B/인천/서해구xlsx.xlsx` | `BOUNDARY_MISMATCH` | Post-2024 filename only, no in-workbook evidence (§8). |

Because 양천구's only candidate file is unattributable, **Seoul 양천구 is reported
`NO_SOURCE_FILE`** in the matrix. Resolving it would move 양천구 from `UNAVAILABLE` to
`PARTIAL` — it would still lack payment.

### Documented internal inconsistencies (source-declared, transcribed verbatim)

- **미추홀구 DATA_B r13** — 음식물/송도자원환경센터 summary vs detailed reconciliation differs
  in 4 months (7월 999.94 vs 960.77; 8월 992.05 vs 947.24; 10월 631.49 vs 595.5;
  12월 924.42 vs 897.12). The source judged this its own error and kept the summary figure.
- **남동구 DATA_A** — monthly collection 5,503.10 t vs planned 5,915.07 t; fee sum
  821,409,070 원 vs actual paid 815,349,990 원.
- **부평구 DATA_A** — original contract 3,304,885,360 원, amended twice (3,287,406,810 →
  3,490,157,990), `총 금액` holds the actual paid amount.
- **계양구 DATA_A** — original contract 3,199,456,000 원 vs payment-ledger sum
  3,525,692,830 원; and **months 1, 4, 5, 6, 7, 8 have no payment record at all**, with
  March and December each holding two entries including a retroactive lump sum.
- **서해구(서구) DATA_A** — the contract file is *named* 2025년도 but its body shows
  2024-01-01 → 2024-12-31; the source treated it as 2024 and flagged it for confirmation.

Every DATA_B `계` column was recomputed against its months: **no arithmetic mismatch**,
apart from the spurious zeros below.

---

## 11. Safe numerator fields

**The only field that may enter the numerator** is DATA_A column D —
`총 금액(총 지급액)` / `총 금액(원)` — on a **contract header row**, when numeric.

Payment type is **actual paid amount** (실제 지급액 / 준공금액), which is what
`총 지급액` denotes and what the remarks confirm. It is *not* the contract award amount:
where both exist the workbooks record the award separately in 비고 and put the paid amount
in D.

**Explicitly excluded from the numerator:**

| Excluded | Reason |
|---|---|
| **Every DATA_B field** | No monetary field exists in any of the 35 DATA_B files. DATA_B is never a payment source. |
| The `합계` row | It is `=SUM(D…)` over the rows above — using it *and* the rows would double count. Use it only as a checksum. |
| `확인 불가` in a `합계` cell | Text, not a value — 시흥시, 안성시, 여주시, 의정부시. |
| Award amounts in 비고 prose | 계약금액 / 최초계약금액 / 변경계약금액 are award figures, not paid amounts. |
| 미추홀구 r266 — 201,000,000 원 | The remark states this is 134,000원/t × 1,500 t **예상량**, an internal-approval **budget**, "실적 정산치 아닌 예산/예상금액". Budget ≠ actual paid. |
| 계양구 columns L–N | A per-month payment ledger. D is already `=SUM(N…)` over it — including both double counts. |

**Payment sums are safe to add across contract rows** (each contract is a distinct
payment) but **quantities are not** (§12).

---

## 12. Safe quantity fields

| Field | Safe to use? |
|---|---|
| DATA_B `일반` / `음식물` / `재활용` monthly, tonnes | **Yes**, as an independent cross-check, per category, per month. Never as a payment proxy. |
| DATA_B `계` row / `계` column | Yes — recomputed and verified, except the spurious zeros below. |
| DATA_A per-contract quantity (**Incheon only**) | **Yes** — genuinely per-contract in all 5 files. |
| DATA_A city-wide repeated block (**15 Gyeonggi files**) | **Only as a city total, read once.** Never summed across contracts. |
| Quantities in 비고 prose | No — not machine-readable (옹진군's 1,010.53 t / 1,332.05 t annual totals exist only in prose). |
| 안성시 `월평균` values | No — monthly *averages*, not a total; and the file has no payment. |
| 미추홀구 `음식물류폐기물 반입량(추정)` = 1,500 | No — an estimate, source-labelled 추정. |

### Missing ≠ zero — four distinct states, kept distinct

The audit treats these as four different things and **never normalises missing to zero**:

| State | Meaning | Count |
|---|---|---:|
| Blank cell | not populated | per-file in JSON |
| `-` dash | source-declared "no data for this cell" | 507 cells |
| Text (`자료 부존재 회신`, `미제공`, `확인 불가`, `자료 없음`) | source states data does not exist | 시흥시, 군포시, 안성시, 여주시, 의정부시 |
| Numeric `0` | a real measured zero | 49 cells |

**One trap found.** `DATA_B/인천/서해구xlsx.xlsx` `일반` and `재활용` show annual total `0`
— but every one of their 12 monthly cells is `-`. The zero is an artefact of
`=SUM()` over dashes, **not** a measured zero. Flagged `ZERO_TOTAL_QUANTITY` with
`spurious_zero_totals_from_dash_sum`. 서해구 DATA_A shows the mirror-image error, its
remark stating outright: *"원본 '-' 표기는 0으로 처리"* — the source itself converted
dashes to zeros, which is exactly the normalisation this audit forbids. Any 서해구
quantity is therefore contaminated at source.

**Duplicate source record.** `DATA_B/인천/서해구xlsx.xlsx` `음식물` is **byte-identical**
to `DATA_B/인천/미추홀구.xlsx` `음식물` across all 12 months and the total (22,825.9 t).
Two different municipalities cannot have identical tonnage to two decimals; one is a
copy-paste of the other. Detected by hashing every category value-series across all 35
DATA_B files — it is the only such collision.

---

## 13. Unsupported assumptions

Each was tested against the sources and **each is false for at least part of the set**:

| Assumption | Verdict |
|---|---|
| Every payment is a landfill fee | **False.** Payments are 수집·운반 대행 (collection/transport) contracts. Destinations include incinerators, recycling sorting, food-waste plants and private processors; several municipalities (수원, 성남, 과천, 양주) send nothing to landfill at all. |
| Every contract covers all municipal waste | **False.** 남동구 and 부평구 payments are 생활폐기물(일반) only, with the workbooks stating recycling and food-waste data are absent and the full-waste contract value differs. |
| Every quantity belongs to the same contract | **False.** In 15 Gyeonggi files the quantity is city-wide and duplicated under every contract (§6). |
| Annual total equals the sum of visible monthly values | **False in general.** True for DATA_B (verified). False for 남동구 (5,503.10 vs 5,915.07 t) and 미추홀구 (4 months disagree); 옹진군's annual total is not in the grid at all. |
| The listed final treatment facility received all material | **False.** `최종 처리시설` is usually a semicolon-separated **list** with no per-facility split — 계양구 lists 6 facilities for one contract and states 권역·유형별 시설 매칭 is not in the source. |
| A contract payment can be allocated by tonnage | **False for Gyeonggi.** The payment is per-contract, the quantity is city-wide; the source provides no key. Valid only where quantity is genuinely per-contract (Incheon). |
| Folder labels identify the dataset role | **Partly false.** DATA_A/DATA_B roles were confirmed from content, not folder names — and 양천구 proves folder placement can be wrong. |
| One reference year per workbook | **False.** 서해구 DATA_A quantities span 2023-06 → 2024-05 (`MIXED_REFERENCE_YEARS`). |
| A contract covers the whole municipality | **False.** 옹진군's two contracts cover 영흥면 / 북도·영흥면 only. |
| A contract covers the whole year | **False.** 가평군's two contracts run 2024.2.26~4.5 and 2024.5.22~7.30. |

### What can be calculated safely, and what needs a stated methodology

**Safe, no estimation:**
- Total 2024 municipal waste-management contract payment per municipality = Σ of DATA_A
  column D over contract rows (excluding `합계`), where the payment is whole-municipality,
  whole-year and whole-scope.
- Payment per capita = that ÷ SGIS 2024 municipal population.
- DATA_B tonnage per category/month/year, as an independent cross-check.
- Where DATA_A and DATA_B overlap, a documented reconciliation (e.g. 고양시's DATA_A
  `수도권매립지 반입` equals DATA_B `일반` exactly — which also proves 고양시's DATA_B `일반`
  is landfill-only, not all general waste).

**Requires an explicit, stated estimation methodology (out of scope for Step 1):**
- Any tonnage-weighted split of a payment (§15).
- Any city-level Gyeonggi denominator built by summing wards (§9).
- Any completion of 계양구's missing payment months.
- Any reconciliation of a source-declared internal inconsistency (§10).

---

## 14. Primary indicator feasibility

**`MUNICIPAL_WASTE_MANAGEMENT_COST_PER_CAPITA` — 주민 1인당 생활폐기물 관리비용**

```
Σ DATA_A 총 금액(총 지급액) over 2024 contract rows        [KRW]
──────────────────────────────────────────────────────────────
SGIS 2024 municipal population (SGIS_TOTAL_POPULATION)     [persons]
```

**Feasible, and it is the indicator to build** — but for 14 of 66 municipalities, and it
must be named for what it measures: the **contracted collection-and-transport service
payment**, not total waste-management expenditure (it excludes in-house labour, facility
capex/opex, and disposal fees paid directly to operators).

| Verdict | n | Municipalities |
|---|---:|---|
| `PRIMARY_VALUE_SUPPORTED` | **14** | 동구, 서구 *(Incheon)*; 광명시, 동두천시, 과천시, 군포시, 파주시, 이천시, 김포시, 화성시, 광주시, 양주시, 포천시, 양평군 *(Gyeonggi)* |
| `PRIMARY_VALUE_PARTIAL` | **6** | 미추홀구 · 남동구 · 부평구 (일반 only), 계양구 (incomplete payment months), 옹진군 (2 면 only), 가평군 (part-year) |
| `PRIMARY_VALUE_UNAVAILABLE` | **46** | all 25 Seoul districts; 중구, 연수구, 강화군; and 20 Gyeonggi |

Breakdown of the 46: **19** have no usable source file; **7** are the Gyeonggi ward-split
cities with payments but no city-level denominator (수원, 성남, 안양, 부천, 안산, 고양, 용인);
the remainder have DATA_B tonnage only, or DATA_A with no payment (의정부시, 시흥시, 안성시,
여주시).

---

## 15. Optional estimate feasibility

**`MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE`**

```
(verified landfill qty ÷ verified total qty) × verified contract payment ÷ 2024 population
```

Each of the six required preconditions was tested per workbook:

| # | Precondition | Fails for |
|---|---|---|
| 1 | payment and quantities are the **same contract and scope** | **all 15 repeated-block Gyeonggi files** — fatal |
| 2 | total quantity verified | 계양구, 옹진군 (no quantity at all) |
| 3 | landfill quantity verified **separately** | 부평구 (`수도권매립지 및 청라사업소` bundled), 남동구, 동구 (facility list, no split), 김포시 (`화엔텍+수도권매립지` bundled) |
| 4 | total quantity > 0 | 서해구 DATA_B (spurious dash-sum zeros) |
| 5 | units compatible | ✅ everywhere — tonnes throughout |
| 6 | allocation would not double count | requires 1; fails wherever 1 fails |

**Result: `LANDFILL_ESTIMATE_SUPPORTED` for exactly 1 of 66 — 미추홀구.**

미추홀구 is the only layout satisfying all six: its 일반 contracts carry
`송도자원환경센터 반입량` and `수도권매립지 반입량` as **separate, per-contract** monthly
series, alongside a per-contract payment, in tonnes, with the total being their sum.

Even there, I recommend **not shipping it in Step 2**. It would be a single-municipality
indicator with no peer to compare against — which is the opposite of an equity metric —
and it inherits the source's own documented 4-month discrepancy (§10). It should be
recorded as *supportable* and deferred.

**All 65 others: `LANDFILL_ESTIMATE_UNAVAILABLE`.**

---

## 16. Proposed status vocabulary

### Status — exactly one per municipality × indicator × year

| Status | Used when |
|---|---|
| `AVAILABLE` | A verified numerator **and** a verified same-year, same-grain denominator both exist, and **no** reason code degrades the value. The number may be published as a measurement. |
| `PARTIAL` | A source exists and something real was extracted, but at least one reason code restricts scope, period, geography, or completeness. Publishable **only** with the reason shown alongside. |
| `UNAVAILABLE` | No value may be published. Either no usable source, or no denominator, or the source cannot be safely attributed. **Never rendered as 0.** |

### Reason codes

| Code | Used exactly when |
|---|---|
| `NO_SOURCE_FILE` | No workbook resolves to this municipality for this year. |
| `MISSING_PAYMENT` | No DATA_A file, or every payment cell is null/text. Always set on DATA_B-only municipalities. |
| `MISSING_QUANTITY` | No numeric quantity anywhere (dashes/prose/`미제공` do not count). |
| `MISSING_POPULATION` | No 2024 population **at the required grain**. Includes the ward-split cities, where ward population exists but city population does not. |
| `PARTIAL_WASTE_SCOPE` | The observation covers fewer than all of 일반 + 음식물 + 재활용. |
| `NO_VERIFIED_LANDFILL_QUANTITY` | No landfill-specific quantity, or landfill is bundled with another destination in one figure. |
| `ZERO_TOTAL_QUANTITY` | A total is `0` **and** no numeric monthly value underlies it — i.e. a `=SUM()` over dashes. Never confused with a measured zero. |
| `BOUNDARY_MISMATCH` | Post-2024 (or otherwise wrong-vintage) geography with **no** documented, reproducible conversion to 2024. |
| `AMBIGUOUS_REGION_MAPPING` | Municipality signals conflict and no in-workbook evidence resolves them. |
| `AMBIGUOUS_SOURCE_MEANING` | A field's meaning cannot be determined. *(Reserved — no current file needs it.)* |
| `DUPLICATE_SOURCE_RECORD` | The same values appear where independent values are required — repeated per-contract blocks, or identical series across municipalities. |
| `UNSUPPORTED_SOURCE_LAYOUT` | The layout is not one of the 7 known families. *(Reserved — currently 0.)* |
| `INCONSISTENT_TOTAL` | A source-reported total disagrees with the recomputed sum of its parts. |
| `UNSUPPORTED_UNIT` | Unit absent or not convertible. *(Reserved — currently 0; all units are tonnes/KRW.)* |

**Four extensions** beyond the required minimum, each raised only from verbatim source
evidence (the brief specifies these as a floor — "at minimum"):

| Code | Raised by |
|---|---|
| `MIXED_REFERENCE_YEARS` | Quantity labels span more than one year (서해구: 2023-06→2024-05). |
| `PARTIAL_GEOGRAPHIC_SCOPE` | Every contract names a sub-municipal 면/읍 (옹진군). |
| `PARTIAL_PERIOD_COVERAGE` | `년도` holds explicit part-year ranges (가평군). |
| `PAYMENT_PERIOD_COVERAGE_INCOMPLETE` | 비고 records months with no payment entry (계양구). |
| `POST_2024_FILENAME_RESOLVED_TO_2024_UNIT` | Informational: filename was post-2024 but the workbook stated the 2024 unit. Not a defect. |

`FORMULA_WITHOUT_CACHED_VALUE` is defined but unused — all 64 files cached every formula.

---

## 17. Proposed normalized schema (design only — no migration created)

Additive. `landfill_inbound_monthly` is **not** touched. Four tables.

### `municipal_cost_source_files`
Provenance, one row per ingested workbook.

`id` PK · `sha256` **UNIQUE NOT NULL** · `relative_path` · `filename` · `dataset_role`
(`DATA_A`|`DATA_B`) · `region_folder` · `file_size_bytes` · `sheet_name` · `used_range` ·
`layout_family` · `source_municipality_name` (verbatim 기관명, nullable — DATA_B has none) ·
`resolved_region_id` FK→`regions.id` (nullable) · `resolution_basis` · `boundary_vintage`
· `reference_year` · `primary_class` · `ingestion_run_id` FK→`ingestion_runs.run_id` ·
`transformation_version` · `imported_at`.

### `municipal_waste_contracts`
One row per contract **header** row — the payment grain.

`id` PK · `source_file_id` FK · `region_id` FK→`regions.id` · `parent_region_code` ·
`reference_year` · `source_row` · `contract_name` · `contractor_name` (nullable) ·
`payment_type` (`ACTUAL_PAID`|`CONTRACT_AWARD`|`BUDGET_ESTIMATE`) · `payment_amount`
`NUMERIC(20,2)` nullable · `currency` (`KRW`) · `waste_scope`
(`ALL_MUNICIPAL`|`GENERAL_ONLY`|`FOOD_ONLY`|`RECYCLING_ONLY`|`MIXED_PARTIAL`) ·
`geographic_scope` (`WHOLE_MUNICIPALITY`|`SUB_MUNICIPAL`) · `period_start`/`period_end`
nullable · `destination_names` · `treatment_methods` · `source_note` ·
`evidence_status` · `completeness_status` · `limitation_reasons` (JSONB/array) ·
`ingestion_run_id` · `transformation_version` · `imported_at`.

- `UNIQUE (source_file_id, source_row)`
- `CHECK (payment_amount IS NULL OR payment_amount >= 0)`
- `CHECK (payment_type IN (...))`, same for the scope and status enums
- `CHECK (evidence_status IN ('SOURCE_REPORTED_VALUE','SOURCE_INPUTS_DERIVED_VALUE'))`
- Index on `(region_id, reference_year)`

### `municipal_waste_quantities`
One row per quantity observation. Deliberately **separate** from payments — that
separation is what prevents a repeated city-wide block from being read as per-contract.

`id` PK · `source_file_id` FK · `contract_id` FK nullable · `region_id` FK ·
`reference_year` · `reference_month` `CHAR(7)` nullable · `quantity_period`
(`MONTHLY`|`ANNUAL`|`MONTHLY_AVERAGE`) · `waste_category`
(`GENERAL`|`FOOD`|`RECYCLING`|`BULKY`|`COMBINED`) · `destination_name` ·
`treatment_method` · **`quantity_value` `NUMERIC(18,3)` NULL-able** ·
`quantity_unit` (`TONNE`) · **`value_state`
(`MEASURED`|`SOURCE_DASH_NO_DATA`|`SOURCE_TEXT_NO_DATA`|`BLANK`|`MEASURED_ZERO`)** ·
`attribution` (`PER_CONTRACT`|`CITY_WIDE_REPEATED`) · `source_row` · `source_label` ·
`evidence_status` · `limitation_reasons` · `ingestion_run_id` ·
`transformation_version` · `imported_at`.

- `UNIQUE (source_file_id, source_row, source_label)`
- `CHECK ((value_state = 'MEASURED' AND quantity_value IS NOT NULL AND quantity_value > 0)
   OR (value_state = 'MEASURED_ZERO' AND quantity_value = 0)
   OR (value_state NOT IN ('MEASURED','MEASURED_ZERO') AND quantity_value IS NULL))`
  — **this constraint is the schema-level guarantee that missing is never stored as zero.**
- `CHECK (reference_month IS NULL OR reference_month LIKE '____-__')`
- `CHECK (quantity_unit = 'TONNE')`
- Index on `(region_id, reference_year, waste_category)`

`attribution = 'CITY_WIDE_REPEATED'` is what stops a later `SUM()` from multiplying a
Gyeonggi city's tonnage by its contract count — aggregation must filter on it.

### `municipal_cost_indicator_values`
The served indicator, one row per municipality × indicator × year.

`id` PK · `region_id` FK · `reference_year` · `indicator_code` · `value` `NUMERIC(20,4)`
nullable · `unit` · `numerator_amount` · `denominator_population` ·
`population_source_id` · `population_definition` · `status`
(`AVAILABLE`|`PARTIAL`|`UNAVAILABLE`) · `reason_codes` · `evidence_status` ·
`method_version` · `ingestion_run_id` · `transformation_version` · `computed_at`.

- `UNIQUE (region_id, reference_year, indicator_code, method_version)`
- `CHECK (status <> 'UNAVAILABLE' OR value IS NULL)` — an unavailable value is never 0.
- `CHECK (value IS NULL OR value >= 0)`

### Deterministic idempotent re-ingestion

1. **Content-addressed.** `sha256` is the file identity; the recorded path is metadata. A
   byte-identical re-run finds the existing `municipal_cost_source_files` row.
2. **Stable natural keys.** Every child row is keyed by
   `(source_file_id, source_row[, source_label])` — derived from position in the sheet,
   not from insertion order — so re-parsing yields identical keys.
3. **Delete-and-reinsert per file, in one transaction.** On re-ingest of a changed SHA,
   delete that file's children and reinsert. The land-cover loader's single-transaction
   pattern already proven in this repo applies: an interrupted run rolls back clean.
4. **Recompute indicators from stored rows**, keyed by `method_version`; changing method
   writes a new version rather than mutating history.
5. **No network, no clock in keys.** Parsing is pure; only `imported_at` varies, and it is
   never part of a key. A second run over unchanged inputs inserts 0 rows.

---

## 18. Exact coverage counts

```
Expected municipalities                          66
  Seoul autonomous districts                     25
  Incheon 2024 counties/districts                10
  Gyeonggi cities/counties                       31

Workbooks inspected                              64   (DATA_A 29, DATA_B 35)
Worksheet layout families                         7
Read errors                                       0
Hidden sheets                                     0
Formulas without cached values                    0

Municipalities with DATA_A                       29 →  resolved to  29 municipality-files
  Seoul 0 · Incheon 7 · Gyeonggi 22
Municipalities with DATA_B                       33 (of 35 files; 2 unattributable)
  Seoul 12 · Incheon 2 · Gyeonggi 19
Municipalities with both                         15   (Incheon 2, Gyeonggi 13)
Municipalities with no usable file               19

Status
  AVAILABLE                                      14   (Seoul 0, Incheon 2, Gyeonggi 12)
  PARTIAL                                        33   (Seoul 12, Incheon 5, Gyeonggi 16)
  UNAVAILABLE                                    19   (Seoul 13, Incheon 3, Gyeonggi 3)

Boundary mismatch (workbooks)                     1
Ambiguous region mapping (workbooks)              2
Ambiguous source meaning                          0
Unsupported layout                                0
Missing population (municipalities)               7

Primary indicator support
  PRIMARY_VALUE_SUPPORTED                        14
  PRIMARY_VALUE_PARTIAL                           6
  PRIMARY_VALUE_UNAVAILABLE                      46

Optional landfill estimate
  LANDFILL_ESTIMATE_SUPPORTED                     1   (미추홀구)
  LANDFILL_ESTIMATE_UNAVAILABLE                  65

Workbook primary classes
  DATA_B_QUANTITY_VALIDATION                     33
  DATA_A_PAYMENT_AND_QUANTITY                    18
  DATA_A_PAYMENT_ONLY                             4
  DATA_A_QUANTITY_ONLY                            3
  DATA_A_PARTIAL_WASTE_SCOPE                      3
  EMPTY_OR_NO_DATA                                1
  AMBIGUOUS_REGION_MAPPING                        1
  BOUNDARY_MISMATCH                               1
```

### Every municipality by name

**No source file (19)**
- Seoul (13): 광진구, 동대문구, 중랑구, 성북구, 강북구, 은평구, 마포구, **양천구**, 구로구, 금천구, 영등포구, 동작구, 서초구
  *(양천구 has one candidate file, unattributable — §10)*
- Incheon (3): 중구, 연수구, 강화군
- Gyeonggi (3): 안양시, 평택시, 구리시

**Missing population (7)** — all Gyeonggi, all ward-split: 수원시, 성남시, 안양시, 부천시, 안산시, 고양시, 용인시

**Boundary mismatch (1 workbook)** — `DATA_B/인천/서해구xlsx.xlsx`

**Ambiguous region mapping (2 workbooks)** — `DATA_B/경기도/양천구.xlsx`, `DATA_B/인천/서해구xlsx.xlsx`

**Ambiguous source meaning (0)** · **Unsupported layout (0)**

**PARTIAL (33)**
- Seoul (12) — all `MISSING_PAYMENT`; 9 also `PARTIAL_WASTE_SCOPE`:
  종로구, 중구, 용산구, 성동구, 도봉구, 노원구, 서대문구, 강서구, 관악구, 강남구, 송파구, 강동구
- Incheon (5): 미추홀구, 남동구, 부평구, 계양구, 옹진군
- Gyeonggi (16): 수원시, 성남시, 의정부시, 부천시, 안산시, 고양시, 남양주시, 오산시, 시흥시, 의왕시, 하남시, 용인시, 안성시, 여주시, 연천군, 가평군

**AVAILABLE (14)**
- Incheon (2): 동구, 서구
- Gyeonggi (12): 광명시, 동두천시, 과천시, 군포시, 파주시, 이천시, 김포시, 화성시, 광주시, 양주시, 포천시, 양평군

### Municipalities the source folders declare as not yet received

Transcribed verbatim from the four `.docx` files:

- `DATA_A/경기도/아직 없는 파일 (9개).docx` — 안산시, 안양시, 남양주시, 평택시, 오산시, 구리시, 의왕시, 하남시, 연천군; `#화성시 병점구(데이터 부재)`, `#여주시(데이터 부재)`
- `DATA_A/인천/없는곳.docx` — 검단구(데이터 부재), 강화군(데이터 부재), 검단구(데이터 부재) *(검단구 listed twice; it is a 2026 unit, not 2024)*
- `DATA_B/경기도/아직 없음 (12곳).docx` — 성남시, 안양시, 광명시, 평택시, 구리시, 시흥시(데이터 부재), 군포시, 안성시, 김포시, 화성시, 포천시, 가평군; `#부천시 오정구(데이터 부재)`
- `DATA_B/인천/없는곳.docx` — 부평구(데이터 부재)

---

## 19. Blockers and risks

### ⛔ Blockers — these need your decision before Step 2

**B‑1 — No city-level Gyeonggi geography for 7 cities.**
수원, 성남, 안양, 부천, 안산, 고양, 용인 exist in `regions` only as 일반구. Five of them have
usable payments. Options: (a) add city-level `regions` rows with SGIS city codes and a
city-level 2024 population (ingested or summed from wards, explicitly labelled derived);
(b) keep them `UNAVAILABLE`. **(a) is required if 수원/성남/고양/용인 are to appear at all.**

**B‑2 — Two unattributable workbooks.**
`DATA_B/경기도/양천구.xlsx` — confirm whether this is Seoul 양천구 misfiled.
`DATA_B/인천/서해구xlsx.xlsx` — confirm the 2024 unit, and note it duplicates 미추홀구's
음식물 series (§12), so it may be wholly invalid rather than merely misplaced.

**B‑3 — Indicator naming.** The numerator is the **contracted collection-and-transport
payment**, not total waste-management cost. Confirm the Korean label, or the published
number will overstate what it measures.

### ⚠ Risks

| Risk | Mitigation |
|---|---|
| Summing the repeated Gyeonggi quantity block multiplies tonnage by 4–14× | `attribution = 'CITY_WIDE_REPEATED'` + filter in every aggregate |
| Coercing `-` / `자료 없음` to 0 | The `value_state` CHECK constraint (§17) makes it structurally impossible |
| 서해구 quantities are contaminated at source (dashes→0 by the source itself) | Exclude from any quantity aggregate; flagged |
| DATA_B mistaken for a payment source | Schema has no payment column on quantities; `MISSING_PAYMENT` always set on DATA_B-only municipalities |
| Contact with `landfill_inbound_monthly` | Separate tables; its origin CHECK would reject municipal rows anyway |
| 14/66 coverage reads as a national gap | Publish `UNAVAILABLE` with reason codes, never 0 or blank |
| Sources arrive incrementally (folder names say `22개 완료`, `19개 완료`) | Content-addressed idempotent re-ingestion (§17) |

---

## 20. Implementation plan for Step 2

1. **Resolve B‑1, B‑2, B‑3** — decisions, no code.
2. **Migration `0021`** — additive only: the four tables in §17 with every constraint, and
   (if B‑1 = option a) city-level Gyeonggi `regions` rows. Do not touch
   `landfill_inbound_monthly`.
3. **Parser** — one module per layout family (7). Locate the trailing
   `최종 처리시설/처리방식/비고` block **by name**, never by index, so the 9/11/13/15-column
   variants of family 2 share one code path. Normalise Korean paths to **NFC** —
   macOS returns NFD and naive matching silently fails (this bit during the audit).
4. **Loader** — content-addressed, single transaction per file, delete-and-reinsert on
   changed SHA; assert 0 inserts on an unchanged second run.
5. **Indicator computation** — `MUNICIPAL_WASTE_MANAGEMENT_COST_PER_CAPITA` against SGIS
   2024 annual population, writing `status` + `reason_codes` for all 66 municipalities
   including the unavailable ones. Defer the landfill estimate (§15).
6. **Tests** — repeated-block detection; `value_state` constraint rejects a null-with-value
   and a value-with-dash row; missing never becomes 0; idempotent re-ingest; the 14/6/46
   split; and a regression asserting `LANDFILL_INBOUND_FEE_PER_CAPITA` and
   `landfill_inbound_monthly` are byte-unchanged.
7. **API + frontend** — read-only endpoint and a dashboard that renders `UNAVAILABLE` as
   an explicit stated reason, never as zero or an empty cell.
8. **Deploy** — only after review, per the existing OCI runbook.

---

## Validation performed for this audit

| Check | Result |
|---|---|
| Workbook inspection (openpyxl, read-only, no OCR, no LibreOffice) | 64/64 parsed, 0 errors |
| Source workbooks modified | **none** — verified by SHA-256 record |
| `step1_source_inventory.json` syntax | valid JSON, 64 workbook records |
| `step1_municipality_coverage.csv` | 67 lines = 1 header + **66** rows; 25+10+31 confirmed |
| Markdown file exists | this file |
| Alembic migration run | **none** — backend container stopped before DB start; head read as `0020` |
| Database writes | **none** — read-only queries only |
| Application test suite | **not run**, per instruction |
| `git status` | `M .gitignore` + `?? docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` only |
| Commits / pushes / merges / deploys | **none** |
