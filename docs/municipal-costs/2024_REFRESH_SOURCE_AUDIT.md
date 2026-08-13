# 2024 Municipal Waste Cost — Source Refresh Audit

Status: **audit complete, parser compatibility complete, semantic blockers NOT
fixed.** Dry run only — zero database writes, nothing deployed.

Companion documents: [`METHODOLOGY.md`](METHODOLOGY.md),
[`INGESTION_RUNBOOK.md`](INGESTION_RUNBOOK.md),
[`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md),
[`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md).

Every figure below was measured on 2026-08-13. Nothing is projected.

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

**This distribution is provisional and must not be published** until the two
blockers in §5 are resolved.

---

## 5. Semantic blockers — NOT fixed

Both are properties of the new source data, not of the parser. Neither is a
layout problem, so neither was addressed by the compatibility work above.

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

All five currently evaluate to `AVAILABLE`.

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

**Partly on a different basis (7):** 양평군 78%, 남양주시 17%, 하남시 11%,
송파구 7%, 동작구 4%, 의왕시 4%, 광명시 2%.

강서구 is the sharpest case: its entire value is the official Sudokwon Landfill
inbound fee, which `METHODOLOGY.md` forbids conflating with this indicator. It
also explains the low outliers — 영등포구 at 909 KRW/인 is 1.8% of the 49,966
median because it is a treatment contract, not a collection programme.

---

## 6. What this baseline does and does not contain

Contained:

- parser compatibility for the four newly observed layout/format variants
- regression tests for each variant, including negative tests proving
  `계약금액` / `낙찰금액` / `예산액` are still never read as a payment
- a test-helper return annotation that removes 97 pre-existing `mypy` errors
- this document

Explicitly **not** contained, and deferred:

- any fix for §5a or §5b
- any new reason code, eligibility rule, or reviewed per-municipality mapping
- any database write, migration, API change, frontend change, or deployment

### Recommended next step

Add a deterministic, name-based accounting-basis rule that makes
`반입수수료` / `처리` / `소각` / `선별` contracts ineligible for this numerator
under a new reason code, and reinstate the five §5a limitations as reviewed
per-municipality entries alongside the existing `REVIEWED_FILE_MAPPINGS`. Until
then, only the AVAILABLE municipalities that are unaffected by §5a and §5b —
**32 of 66** — are safe to display.
