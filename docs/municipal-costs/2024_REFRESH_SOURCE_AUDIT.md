# 2024 Municipal Waste Cost — Source Refresh Audit

Status: **audit complete, parser compatibility complete, both semantic blockers
fixed.** Dry run only — zero database writes, nothing merged, nothing deployed.

Companion documents: [`METHODOLOGY.md`](METHODOLOGY.md) (§2a accounting basis,
§4 reviewed municipality limitations), [`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md),
[`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md),
[`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md).

Every figure below was measured on 2026-08-13. Nothing is projected. §1–§4 record
the audit as it stood before the semantic fix; §5 states the two defects it
found, and §6–§8 record the fix and the corrected result that supersedes §4's
provisional distribution.

---

## 1. Provenance

A new disclosure delivery replaced the previously audited source set. The
workbooks themselves are Git-ignored local data and are **not** committed; only
this sanitized summary is.

| Field | Value |
| --- | --- |
| Archive | `DATA-20260813T043813Z-1-001.zip` |
| Size | 613,667 bytes |
| SHA-256 | `b217902342fb629b85e8e2d67a00ffa96075040a4b08eae2c506c96c9449e0df` |
| Members | 103 — 102 `.xlsx` + one supplier note `폐기물량/비고.txt` |
| Archive integrity | `testzip()` clean; no unsafe member path |
| macOS metadata | none (`__MACOSX`, `.DS_Store`, AppleDouble all absent) |

Git-ignored locations (see `.gitignore`):

| Purpose | Path |
| --- | --- |
| Incoming archive | `data/import/municipal-costs/incoming/2024/` |
| Extracted, verbatim | `data/import/municipal-costs/staging/2024-refresh/extracted/` |
| Loader-shaped tree | `data/import/municipal-costs/staging/2024-refresh/ingestion-ready/` |
| Machine-readable artefacts | `artifacts/municipal-costs/2024-refresh/` |
| Previously verified set | `data/import/municipal-costs/2024/` — **not overwritten** |

Extraction was traversal-protected and byte-verified (CRC + size per member).
Source workbooks are opened read-only and are never resaved; no OCR and no
LibreOffice are involved.

---

## 2. Inventory and classification

The delivered folders are `계약시설,지급액` (→ `DATA_A`) and `폐기물량`
(→ `DATA_B`). The folder name alone is **not** trusted: every workbook's role was
re-derived from its own header row. All 102 agreed with their delivered folder.

| | DATA_A | DATA_B | total |
| --- | --- | --- | --- |
| 서울 | 21 | 21 | 42 |
| 인천 | 7 | 5 | 12 |
| 경기 | 24 | 24 | 48 |
| **total** | **52** | **50** | **102** |

- accepted 102, **rejected 0**, ambiguous 0
- no duplicate quantity series across municipalities
- no post-2024 Incheon unit names appear at all — this delivery uses the 2024
  units `동구` / `서구` directly, so the previous reviewed renames are not needed
- previous delivery for comparison: 64 files (DATA_A 29, DATA_B 35), with **no
  Seoul DATA_A at all**

### Municipalities with no DATA_A payment workbook (14)

서울 성동구·동대문구·중랑구·마포구 · 인천 중구·연수구·강화군 ·
경기 의정부시·안양시·평택시·구리시·시흥시·안성시·여주시

### Municipalities with no DATA_B tonnage workbook (16)

서울 동대문구·중랑구·구로구·강남구 · 인천 중구·동구·연수구·계양구·서구 ·
경기 안양시·평택시·구리시·시흥시·군포시·화성시·가평군

---

## 3. Parser compatibility changes

The refresh introduced a narrower seven-column `DATA_A` spine (tonnage moved
wholly into `DATA_B`) plus two supplier-specific spellings. Four deterministic,
header-based changes were made in `municipal_cost_parser.py`. **No payment
semantic rule was altered**: the actual-paid / contract-award / budget-estimate
distinction still comes only from wording the source itself writes.

| # | Change | Why | Guard |
| --- | --- | --- | --- |
| 1 | `연도` accepted alongside `년도` | 오산시 uses the alternative spelling of the same word | exact match against a two-item tuple, never a substring |
| 2 | `<year>년 금액` accepted as a payment header | 오산시 labels the column `2024년 금액` | anchored to the reference year; `계약금액` / `낙찰금액` / `예산액` / `2024년 계약금액` are all proven not to match |
| 3 | A repeated header row inside the data region is skipped | 미추홀구 restates the full header on row 2 | exact `계약명 == "계약명"` test; also stops `기관명` polluting municipality resolution |
| 4 | `parse_money_text()` reads an amount stored as text | 미추홀구 formats every payment as `"6,556,861,120원"` | anchored pattern; `확인 불가`, `-`, ranges and `약 …원` stay missing, never zero |

Change 4 is self-checking: the six text-formatted rows sum to exactly the
workbook's own `합계` of 18,403,834,210 KRW. The verbatim source text is retained
in `payment_source_text` so a text-delivered amount keeps its provenance.

### Verification

| Check | Result |
| --- | --- |
| `pytest` ingestion (parser + ingestion) | **136 passed** |
| `pytest` backend (municipal-cost routes + landfill regression) | **37 passed** |
| New regression tests | 9 functions, +9 parametrized cases |
| `ruff check` / `ruff format --check` | clean |
| `mypy` municipal-cost errors | **102 → 5** (the 5 are pre-existing SQLAlchemy typing in `test_municipal_cost_ingestion.py`) |

---

## 4. Dry run — zero database writes

Run against the staged `ingestion-ready` tree with `--dry-run`.
`status = DRY_RUN_OK`, exit 0, `writes = {}`, `ingestion_run_id = null`.

Before/after snapshots were byte-identical, including `max(id)` on contracts and
quantities, `max(run_id)` on `ingestion_runs`, `sum(value)` on the indicator, and
an MD5 over every `reason_codes` array:

```
geog|comp|files|contracts|qty|ind|max(kid)|max(qid)|sum(value)|runs|max(run)|landfill|md5(reasons)
before  66|20|64|205|2701|66|205|2701|1455186.6612|106|1249|9212|3396ac32…
after   66|20|64|205|2701|66|205|2701|1455186.6612|106|1249|9212|3396ac32…
```

`landfill_inbound_monthly` unchanged at 9,212 rows, all
`VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`.

### Provisional indicator distribution

| | AVAILABLE | PARTIAL | UNAVAILABLE |
| --- | --- | --- | --- |
| 서울 (11) | 15 | 6 | 4 |
| 인천 (28) | 7 | 0 | 3 |
| 경기 (41) | 23 | 1 | 7 |
| **total** | **45** | **7** | **14** |

Previously 20 / 5 / 41. Observations: 315 contracts, 314 eligible, 2,600
quantities; numerator total 1,136,798,997,978 KRW.

**This distribution is provisional and was rejected.** It is retained only as the
before-state of the §5 blockers; the published distribution is §7a, and §7c
explains municipality by municipality why 45 / 7 / 14 was not a correct
measurement of this indicator.

---

## 5. Semantic blockers found by the audit

Both are properties of the new source data, not of the parser. Neither is a
layout problem, so neither was addressed by the compatibility work above; both
are fixed in §6, and this section states them as the audit found them.

### 5a. Five municipalities silently lost a previously supported limitation

The new seven-column format dropped the 지급월 ledger, the detailed 비고 notes,
the part-year `년도` ranges, and the narrowing contract-name tokens. Those were
the *evidence* for four PARTIAL reason codes. The numerators are identical **to
the won** — only the caveats disappeared.

| Municipality | Numerator (unchanged, KRW) | Reason code lost | Evidence removed by the new format |
| --- | --- | --- | --- |
| 남동구 | 7,241,023,460 | `PARTIAL_WASTE_SCOPE` | names dropped `(일반)`; payments are still 생활폐기물(일반) only |
| 부평구 | 10,028,548,010 | `PARTIAL_WASTE_SCOPE` | filename scope annotation removed |
| 옹진군 | 1,241,721,000 | `PARTIAL_GEOGRAPHIC_SCOPE` | names dropped `영흥면` / `북도·영흥면` |
| 가평군 | 412,324,750 | `PARTIAL_PERIOD_COVERAGE` | `년도` was `2024.2.26.~4.5` / `2024.5.22.~7.30`, now bare `2024` |
| 계양구 | 13,199,926,510 | `PAYMENT_PERIOD_COVERAGE_INCOMPLETE` | per-contract payment ledger removed |

All five evaluated to `AVAILABLE` in the provisional run. §6b reinstates them.

### 5b. Some DATA_A contracts are not collection-and-transport payments

`METHODOLOGY.md` §1 defines this indicator over collection-and-transport contract
payments only, and states explicitly that it is **not** the Sudokwon Landfill
inbound fee and not a treatment cost. The previous delivery contained only
수집·운반 대행 contracts, so no rule was ever needed. The refresh mixes in
반입수수료 and 처리 contracts, and the parser has no rule to exclude them.

**Entire numerator on a different accounting basis (6):**

| Municipality | KRW | Contract wording |
| --- | --- | --- |
| 강서구 | 18,300,939,000 | `수도권매립지 반입수수료(월정산 총액)` |
| 강북구 | 3,690,680,230 | `종량제 생활폐기물 반입수수료` (노원자원회수시설 + 수도권매립지) |
| 성북구 | 1,732,450,195 | `재활용품 선별처리` |
| 연천군 | 805,561,740 | `위탁처리용역` |
| 가평군 | 412,324,750 | `외부 위탁처리` |
| 영등포구 | 364,322,290 | `민간위탁(소각) 처리 용역` |

**Partly on a different basis (7):** 양평군, 남양주시, 하남시, 송파구, 동작구,
의왕시, 광명시. The audit's first-pass share estimates were computed with a
blunter screen that flagged any contract naming 처리; the reductions the final
rule actually makes are in §7c, and they are smaller — most sharply for 양평군,
where the screen flagged 78% but ten of its twelve remaining contracts are
`운반·처리` haulage contracts that must not be excluded, leaving 8.8%.

강서구 is the sharpest case: its entire value is the official Sudokwon Landfill
inbound fee, which `METHODOLOGY.md` forbids conflating with this indicator. It
also explains the low outliers — 영등포구 at 909 KRW/인 is 1.8% of the 49,966
median because it is a treatment contract, not a collection programme.

---

## 6. The semantic fix

Two additions, both deterministic, both driven by source evidence, neither
municipality-keyed except where a reviewed decision is recorded as such. No
migration: nothing in the fix needs a new column.

### 6a. Contract-level accounting basis — for §5b

`classify_contract_accounting_basis()` reads the source's own `계약명` and
assigns one of four bases; only the first two may enter the numerator.

| Basis | Wording | Eligible |
| --- | --- | --- |
| `COLLECTION_TRANSPORT` | 수집 / 운반 / 수송 / 청소 | yes |
| `COLLECTION_TRANSPORT_WITH_TREATMENT` | haulage bundled with disposal — `운반·처리`, `수집·운반 처리 대행용역` | yes |
| `FACILITY_INBOUND_FEE` | `반입수수료` | **no** |
| `TREATMENT_SERVICE` | `위탁처리` / `소각처리` / `선별처리` / `처리용역` / `처리대행` | **no** |

Two signals, one asymmetry: a contract is excluded only when it carries basis
wording **and** no collection/transport wording at all. `반입수수료` is the single
unconditional exclusion, because it is the accounting basis of
`landfill_inbound_monthly` and no surrounding wording can change that.

Three deliberate properties, each measured against this delivery:

- **A bare `처리` decides nothing.** 27 of the 315 contracts mention 처리 while
  being ordinary 수집·운반 대행 contracts.
- **Compound contracts are kept** — 12 of the 30 treatment-adjacent names are
  `운반·처리` / `수집·운반 처리` contracts that really do pay for haulage.
- **Only `계약명` is read.** `처리방식` is a *destination* field: 45 of the 49
  rows whose `처리방식` is `소각` are ordinary 수집·운반 대행 contracts, so using
  it as basis evidence would have excluded real collection payment at scale.

An excluded contract is kept in full — row, amount, verbatim payment text, true
`payment_type`, destinations, note — with `is_primary_numerator_eligible = false`
and `NON_COLLECTION_TRANSPORT_BASIS` in its `limitation_reasons`.
`payment_type` and accounting basis stay orthogonal: a 반입수수료 remains a true
`ACTUAL_PAID_AMOUNT`.

Because a workbook is kept in full, `primary_classification` was corrected to
describe what the file *delivered* rather than what survived eligibility.
Otherwise the six all-excluded DATA_A files would have been filed as
`EMPTY_OR_NO_DATA` alongside the very contract rows the same run stores against
them. All 102 files now classify as
`DATA_A_PAYMENT_ONLY` 48 / `DATA_A_PARTIAL_WASTE_SCOPE` 4 /
`DATA_B_QUANTITY_VALIDATION` 50. No `PRIMARY_CLASSES` member was added, so the
existing CHECK constraint is untouched and no migration is required.

### 6b. Reviewed municipality limitations — for §5a

The five §5a limitations are reinstated in one centralized table,
`REVIEWED_MUNICIPALITY_LIMITATIONS`, keyed exactly on
`(metropolitan_code, display_name, reference_year)` — never a prefix, never a
parser `if`. Each entry carries the evidence that established the limitation and
the reason the refresh's silence does not retire it; the full table is in
[`METHODOLOGY.md` §4](METHODOLOGY.md). A limitation is applied only where an
accepted DATA_A workbook exists, because all five qualify *payment* evidence.

### 6c. Null semantics

A municipality whose every contract is on another basis has no eligible payment,
so it is `UNAVAILABLE` with `value IS NULL` and `numerator_amount_krw IS NULL` —
never `0` and never `0 KRW/인`, which would read as "spends nothing on
collection". `NON_COLLECTION_TRANSPORT_BASIS` sits alongside `MISSING_PAYMENT` in
its reason codes so the blank is explained rather than merely blank.

---

## 7. Corrected dry run — zero database writes

Same source tree, same `--dry-run`, `status = DRY_RUN_OK`, exit 0, `writes = {}`,
`ingestion_run_id = null`. Before/after snapshots byte-identical across all six
tables, `max(id)`, `max(run_id)`, `sum(value)`, `sum(numerator)`, an MD5 over
every indicator row's status/value/reason_codes and one over every contract's
eligibility/amount, and `dataset_freshness.last_success_at`:

```
geog|comp|files|contracts|qty|ind|max(kid)|max(qid)|max(fid)|sum(value)|sum(numerator)|runs|max(run)|landfill|md5(ind)|md5(contract)
before  66|20|64|205|2701|66|205|2701|64|1455186.6612|659366684767.00|106|1249|9212|0af9e25e…|db486e07…
after   66|20|64|205|2701|66|205|2701|64|1455186.6612|659366684767.00|106|1249|9212|0af9e25e…|db486e07…
```

`landfill_inbound_monthly` unchanged at 9,212 rows.

### 7a. Corrected indicator distribution

| | AVAILABLE | PARTIAL | UNAVAILABLE |
| --- | --- | --- | --- |
| 서울 (11) | 13 | 4 | 8 |
| 인천 (28) | 3 | 4 | 3 |
| 경기 (41) | 22 | 0 | 9 |
| **total** | **38** | **8** | **20** |

315 contracts parsed, **296 eligible**, 18 excluded on accounting basis (one
further row was already ineligible for its payment type). Numerator total
**1,098,984,023,933 KRW** — the provisional 1,136,798,997,978 minus exactly
37,814,974,045 KRW of non-collection/transport payment.

**AVAILABLE (38)**

- **서울** (13): 종로구, 중구, 광진구, 노원구, 서대문구, 구로구, 금천구, 동작구,
  관악구, 서초구, 강남구, 송파구, 강동구
- **인천** (3): 동구, 미추홀구, 서구
- **경기** (22): 수원시, 성남시, 부천시, 광명시, 동두천시, 안산시, 고양시, 과천시,
  남양주시, 오산시, 군포시, 의왕시, 하남시, 용인시, 파주시, 이천시, 김포시, 화성시,
  광주시, 양주시, 포천시, 양평군

**PARTIAL (8)**

| Municipality | Value (KRW/인) | Reason codes |
| --- | --- | --- |
| 서울 용산구 | 63,157.9093 | `PARTIAL_WASTE_SCOPE` |
| 서울 도봉구 | 39,982.5594 | `PARTIAL_WASTE_SCOPE` |
| 서울 은평구 | 45,711.1518 | `PARTIAL_WASTE_SCOPE` |
| 서울 양천구 | 41,788.1298 | `PARTIAL_WASTE_SCOPE` |
| 인천 남동구 | 14,690.0581 | `PARTIAL_WASTE_SCOPE` (reviewed) |
| 인천 부평구 | 19,863.0342 | `PARTIAL_WASTE_SCOPE` (reviewed) |
| 인천 계양구 | 47,379.4921 | `PAYMENT_PERIOD_COVERAGE_INCOMPLETE` (reviewed), `MISSING_QUANTITY` |
| 인천 옹진군 | 64,699.9271 | `PARTIAL_GEOGRAPHIC_SCOPE` (reviewed) |

**UNAVAILABLE (20)**

| Municipality | Reason codes | Cause |
| --- | --- | --- |
| 서울 동대문구, 중랑구 · 인천 중구, 연수구 · 경기 안양시, 평택시, 구리시, 시흥시 | `NO_SOURCE_FILE`, `MISSING_PAYMENT` | no workbook of either kind |
| 서울 성동구, 마포구 · 인천 강화군 · 경기 의정부시, 안성시, 여주시 | `MISSING_PAYMENT` | DATA_B tonnage only, no DATA_A payment workbook |
| 서울 성북구, 강북구, 강서구, 영등포구 · 경기 연천군 | `MISSING_PAYMENT`, `NON_COLLECTION_TRANSPORT_BASIS` | DATA_A delivered, but every contract in it is on another accounting basis |
| 경기 가평군 | `MISSING_PAYMENT`, `PARTIAL_PERIOD_COVERAGE`, `MISSING_QUANTITY`, `NON_COLLECTION_TRANSPORT_BASIS` | both contracts are 외부 위탁처리; its reviewed period limitation is still recorded, and the stricter status wins |

### 7b. The 18 excluded contracts

| Municipality | Row | Basis | KRW | `계약명` |
| --- | --- | --- | --- | --- |
| 서울 강북구 | 2 | `FACILITY_INBOUND_FEE` | 3,428,753,720 | 종량제 생활폐기물 반입수수료(노원자원회수시설) |
| 서울 강북구 | 3 | `FACILITY_INBOUND_FEE` | 261,926,510 | 종량제 생활폐기물 반입수수료(수도권매립지) |
| 서울 강서구 | 2 | `FACILITY_INBOUND_FEE` | 18,300,939,000 | 수도권매립지 반입수수료(월정산 총액) |
| 서울 성북구 | 2 | `TREATMENT_SERVICE` | 1,732,450,195 | 재활용품 선별처리 |
| 서울 영등포구 | 2 | `TREATMENT_SERVICE` | 364,322,290 | 생활폐기물 민간위탁(소각) 처리 용역 |
| 서울 동작구 | 7 | `TREATMENT_SERVICE` | 853,209,480 | 생활폐기물 민간위탁 처리 용역 |
| 서울 송파구 | 11 | `TREATMENT_SERVICE` | 1,461,763,370 | 생활폐기물 민간위탁 소각처리 용역 |
| 경기 가평군 | 2 | `TREATMENT_SERVICE` | 152,884,450 | 생활폐기물 외부 위탁처리 1차 |
| 경기 가평군 | 3 | `TREATMENT_SERVICE` | 259,440,300 | 생활폐기물 외부 위탁처리 2차 |
| 경기 연천군 | 2 | `TREATMENT_SERVICE` | 381,571,740 | 음식물폐기물 위탁처리용역 |
| 경기 연천군 | 3 | `TREATMENT_SERVICE` | 423,990,000 | 대형폐기물 위탁처리용역 |
| 경기 광명시 | 9 | `TREATMENT_SERVICE` | 526,602,550 | 생활폐기물 민간소각 처리 용역 |
| 경기 남양주시 | 12 | `TREATMENT_SERVICE` | 2,558,532,020 | 폐합성수지 소각 처리대행 |
| 경기 남양주시 | 13 | `TREATMENT_SERVICE` | 5,075,725,545 | 폐합성수지 재활용 처리대행 |
| 경기 의왕시 | 10 | `TREATMENT_SERVICE` | 496,818,670 | 생활폐기물 위탁처리용역 |
| 경기 하남시 | 5 | `TREATMENT_SERVICE` | 1,275,847,930 | 생활폐기물 처리용역 |
| 경기 양평군 | 2 | `TREATMENT_SERVICE` | 195,001,275 | 음식물류폐기물 대행처리 용역 |
| 경기 양평군 | 4 | `TREATMENT_SERVICE` | 65,195,000 | 생활폐기물(재활용잔재물) 처리용역 |

Every row above is still stored, with its amount and provenance, and
`is_primary_numerator_eligible = false`.

### 7c. Why the provisional 45 / 7 / 14 was rejected

45 AVAILABLE was not a correct measurement of this indicator. It counted
37.8 billion KRW of payments the methodology explicitly excludes, and it reported
five municipalities as unqualified whose qualifications the source had merely
stopped printing. Concretely, three of the provisional AVAILABLE values were
*entirely* something else: 강서구's 33,643 KRW/인 was the official Sudokwon
Landfill inbound fee — the one number `METHODOLOGY.md` §1 forbids conflating with
this indicator — 강북구's 13,159 was two facility gate fees, and 영등포구's
909 KRW/인, 1.8% of the median, was a single incineration contract rather than a
collection programme.

17 municipalities changed; 49 are byte-identical to the provisional run.

| Change | Count | Municipalities |
| --- | --- | --- |
| AVAILABLE → UNAVAILABLE | 3 | 강북구, 영등포구, 가평군 |
| PARTIAL → UNAVAILABLE | 3 | 성북구, 강서구, 연천군 |
| AVAILABLE → PARTIAL | 4 | 남동구, 부평구, 계양구, 옹진군 (reviewed limitations) |
| numerator + value reduced, status unchanged | 7 | 동작구, 송파구, 광명시, 남양주시, 의왕시, 하남시, 양평군 |

The seven reduced values: 동작구 52,553.06 → 50,314.67; 송파구 33,890.70 →
31,565.45; 광명시 84,809.99 → 82,876.58; 남양주시 63,738.00 → 53,111.03;
의왕시 78,349.41 → 75,065.87; 하남시 35,075.92 → 31,099.73; 양평군 24,254.33 →
22,114.94 KRW/인. The four reviewed municipalities' values are unchanged — only
their status and reason codes moved, which is the point: the numerator was never
in doubt, the caveat was.

---

## 8. What this baseline does and does not contain

Contained:

- parser compatibility for the four newly observed layout/format variants (§3)
- the contract-level accounting-basis rule and the `NON_COLLECTION_TRANSPORT_BASIS`
  reason code (§6a)
- the centralized reviewed municipality limitations table (§6b)
- 56 new regression cases across the parser and the pipeline, including negative
  tests for near-matches, compound wording, NFD input, and leakage of a reviewed
  limitation onto an unrelated municipality
- this document and [`METHODOLOGY.md`](METHODOLOGY.md) §2a / §4

Explicitly **not** contained:

- any database write, migration, API change, frontend change, or deployment
- any manual per-municipality display blacklist — the 38 AVAILABLE municipalities
  are demo-safe because the backend semantics now encode the truth, not because
  anything was hidden

### Verification

| Check | Result |
| --- | --- |
| `pytest` municipal-cost parser + ingestion | **192 passed** |
| `pytest` full ingestion suite | 626 tests, no failure attributable to this change |
| `pytest` backend municipal-cost + landfill regression | **100 passed, 25 skipped** (PostGIS tier, no `TEST_DATABASE_URL`) |
| `ruff check` | clean |
| `ruff format --check` | clean on every changed file (one pre-existing deviation remains in the untouched `20260719_0016` migration) |
| `mypy` on all changed files | no new error; the 4 remaining are pre-existing SQLAlchemy typing in the test fixture, byte-identical at the base SHA (lines 128/186/187/637 there) |
| Dry run | `DRY_RUN_OK`, `writes = {}`, before/after snapshots identical |
