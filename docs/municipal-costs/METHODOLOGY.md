# 2024 Municipal Waste Collection-and-Transport Payment — Methodology

Status: **implemented and verified locally on `feature/municipal-waste-costs-2024`.
Not committed, not merged, not deployed.** Every number below was measured against
the local development database on 2026-08-06; nothing here is projected.

---

## 1. The indicator

| Field | Value |
| --- | --- |
| Code | `MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA` |
| Korean name | 주민 1인당 생활폐기물 수집·운반 계약 지급액 |
| Unit | `KRW/인` |
| Accounting basis | `MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT` |
| Evidence class | `LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE` |
| Methodology version | `municipal-collection-transport-payment-per-capita-v1` |
| Reference year | 2024 (only) |
| Boundary vintage | 2024 |

```
                sum of eligible, verified 2024 actual paid amounts (KRW)
value  =  ───────────────────────────────────────────────────────────────────
           verified or explicitly derived 2024 municipal population (persons)
```

All arithmetic uses `Decimal` against `NUMERIC` columns. The final value is
quantised with `ROUND_HALF_EVEN` to 4 decimal places.

### What this indicator is *not*

It is **not** the official Sudokwon Landfill inbound fee, and the two must never
be added, subtracted, or ratioed. The API states this in the payload itself
(`meta.is_official_landfill_fee = false`, plus a prose
`meta.difference_from_official_landfill_fee`).

| | This indicator | `LANDFILL_INBOUND_FEE_PER_CAPITA` |
| --- | --- | --- |
| Provider | Individual 기초지자체 (정보공개청구 회신 workbooks) | 수도권매립지관리공사 (official dataset) |
| Spatial grain | 66 시·군·구 | 3 metropolitan governments |
| Accounting basis | Contracted collection-and-transport payment | Landfill inbound fee |
| Storage | `municipal_*` tables (this release) | `landfill_inbound_monthly` (untouched) |

It is also **not** a total waste-management expenditure, a waste-disposal fee, or
a landfill cost. It covers collection-and-transport contract payments only —
excluding facility investment, in-house labour, and treatment-facility inbound
fees.

`MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE` is **deferred** and is
neither computed nor exposed in this release. Only the underlying verified
observations are stored.

---

## 2. The numerator

Summed: the `총 금액(총 지급액)` contract-header value (`총 금액(원)` in the 서구
workbook) of each DATA_A contract, where that value is confirmed to be an
**actual paid amount** *and* a payment on this indicator's **accounting basis**.

**Excluded** — by parser rule, and structurally by the
`ck_municipal_waste_contracts_eligibility_consistent` CHECK constraint, which
makes anything other than a non-null `ACTUAL_PAID_AMOUNT` ineligible:

- source total / 소계 rows treated as if they were separate contracts
- contract award amounts (계약금액 / 낙찰금액)
- budget or projected cost estimates
- text values such as `확인 불가`
- separate payment ledgers whose amounts are already inside a contract total
- any amount whose meaning is ambiguous
- **every DATA_B value** — DATA_B is quantity validation only and can never
  contribute payment
- contracts on a different accounting basis — see §2a

Measured result: **205 contracts stored, 196 eligible, numerator total
659,366,684,767 KRW.**

### 2a. Accounting basis — which *kind* of payment may be summed

"Was it actually paid" and "is it a collection-and-transport payment" are two
different questions, and the loader answers them separately. A 수도권매립지
반입수수료 is a perfectly real `ACTUAL_PAID_AMOUNT`; it is simply a facility gate
fee, which is the accounting basis of `landfill_inbound_monthly` — the very thing
§1 says must never be conflated with this indicator. Each contract therefore
carries an accounting basis derived from the source's own `계약명`:

| Basis | Meaning | In the numerator |
| --- | --- | --- |
| `COLLECTION_TRANSPORT` | 수집·운반 / 수송 / 청소 대행 | yes |
| `COLLECTION_TRANSPORT_WITH_TREATMENT` | haulage bundled with disposal of the same load (`운반·처리`, `수집·운반 처리 대행용역`) | yes |
| `FACILITY_INBOUND_FEE` | `반입수수료` — a gate fee paid to a facility | **no** |
| `TREATMENT_SERVICE` | treatment bought as a service: `위탁처리` / `소각처리` / `선별처리` / `처리용역` / `처리대행` | **no** |

The rule is two-signal and deterministic. A contract is excluded only when its
name carries basis wording **and** carries no collection/transport wording at
all. `반입수수료` is the single unconditional exclusion, because no surrounding
wording can turn a facility gate fee into a collection payment.

Three properties this rule deliberately has:

- **A bare `처리` decides nothing.** 27 of the 315 audited 2024 contracts mention
  처리 somewhere while being ordinary 수집·운반 대행 contracts; only an
  action-plus-처리 compound (`위탁처리`, `소각처리`, `선별처리`, `처리용역`,
  `처리대행`) is basis wording.
- **Compound contracts are kept.** `운반·처리 용역` and `수집·운반 처리 대행용역`
  really do pay for haulage; deleting the whole row because the name also says
  처리 would delete real transport payment. They are kept under their own basis
  value so the bundling stays visible.
- **Only `계약명` is read.** `처리방식` and `최종 처리시설` say where the waste
  *ends up*, not what was bought — 45 of the 49 rows whose `처리방식` is `소각`
  are ordinary 수집·운반 대행 contracts hauling to an incinerator, so treating
  either column as basis evidence would exclude real collection payment at scale.

An excluded contract is **kept in full**: its row, amount, verbatim payment text,
true `payment_type`, destinations and note are all stored, with
`is_primary_numerator_eligible = false` and `NON_COLLECTION_TRANSPORT_BASIS` in
its `limitation_reasons`. The municipality's indicator row carries the same code,
so a reader can see why its numerator is smaller than the workbook's own 합계.

`NON_COLLECTION_TRANSPORT_BASIS` never degrades a status by itself: what remains
after the exclusion is exactly what the indicator claims to measure. But a
municipality whose **every** contract is on another basis has no eligible payment
at all, and is `UNAVAILABLE` with a NULL value — never `0`, never `0 KRW/인`,
which would read as "this municipality spends nothing on collection".

---

## 3. The denominator (population)

Source series: the 2024 **SGIS annual** population (`SGIS_TOTAL_POPULATION`) held
in `regional_population`. The MOIS monthly resident-registration series is never
used — it is metropolitan-only and cannot denominate a municipal indicator. No
other year is borrowed, nothing is interpolated, and no parent metropolitan
population is substituted.

### 3a. Direct — 59 municipalities

`DIRECT_REGION_POPULATION`: the municipality exists at 시·군·구 grain in `regions`,
and its own 2024 population is read directly. Evidence status
`OFFICIAL_REPORTED_VALUE`.

### 3b. Derived — the 7 ward-split Gyeonggi cities

`regions` stores these seven only as 일반구. Those ward rows are **referenced,
never modified, renamed, deleted, or invalidated**, and no city-level `regions`
row and no synthetic geometry is created. The city is represented in the additive
`municipal_cost_geographies` registry, and each constituent ward population is
persisted individually in `municipal_cost_geography_components` alongside the
exact sum.

Method `DERIVED_SUM_OF_CONSTITUENT_WARDS`, evidence status
`OFFICIAL_INPUTS_DERIVED_VALUE`. The aggregate is never presented as a
source-reported SGIS city row and is never exposed as map geometry.

Measured 2024 values (20 component rows in total):

| City | Wards | Component populations | Component sum | Stored | Exact |
| --- | --- | --- | --- | --- | --- |
| 수원시 | 4 | 장안구 280,812 + 권선구 370,600 + 팔달구 208,817 + 영통구 364,750 | 1,224,979 | 1,224,979 | ✓ |
| 성남시 | 3 | 수정구 246,990 + 중원구 205,957 + 분당구 447,920 | 900,867 | 900,867 | ✓ |
| 안양시 | 2 | 만안구 229,980 + 동안구 315,820 | 545,800 | 545,800 | ✓ |
| 부천시 | 3 | 원미구 401,522 + 소사구 240,865 + 오정구 151,695 | 794,082 | 794,082 | ✓ |
| 안산시 | 2 | 상록구 348,328 + 단원구 353,223 | 701,551 | 701,551 | ✓ |
| 고양시 | 3 | 덕양구 482,446 + 일산동구 288,578 + 일산서구 273,944 | 1,044,968 | 1,044,968 | ✓ |
| 용인시 | 3 | 처인구 286,273 + 기흥구 429,488 + 수지구 361,720 | 1,077,481 | 1,077,481 | ✓ |

A usable denominator is strictly positive; an unusable one is `NULL`, never `0`
(`ck_municipal_cost_geographies_population_status_consistent`).

---

## 4. Geography — exactly 66 units, 2024 vintage

| Metropolitan | Code | Units |
| --- | --- | --- |
| 서울특별시 | 11 | 25 자치구 |
| 인천광역시 | 28 | 10 군·구 (2024 geography) |
| 경기도 | 41 | 31 시·군 |
| **Total** | | **66** |

Incheon uses only the 2024 units: 중구, 동구, 미추홀구, 연수구, 남동구, 부평구,
계양구, 서구, 강화군, 옹진군. The 2026 units 제물포구 / 영종구 / 서해구 / 검단구
are **never created, displayed, or inferred as a 2024 observation**, and the 2024
values of 중구 / 동구 / 서구 are never redistributed.

Note: the landfill dashboard's metropolitan codes (11 / 28 / 41) differ from the
canonical SGIS parent codes in `regions` (11 / 23 / 31). Every lookup goes through
the reviewed crosswalk; joining the two systems directly would resolve Seoul and
silently report Incheon and Gyeonggi as having no data.

### Reviewed filename mappings

| File | Resolves to | Evidence | Reason code |
| --- | --- | --- | --- |
| `DATA_A/인천/제물포구.xlsx` | 2024 동구 | Workbook organisation cell reads `인천광역시 동구청` | `POST_2024_FILENAME_RESOLVED_TO_2024_UNIT` |
| `DATA_A/인천/서해구.xlsx` | 2024 서구 | Workbook organisation cell reads `인천광역시 서구` | `POST_2024_FILENAME_RESOLVED_TO_2024_UNIT` |
| `DATA_B/인천/남동구xlsx.xlsx` | 2024 남동구 | Workbook note row reads `남동구 자료로 확인` | `MALFORMED_FILENAME_RESOLVED_BY_WORKBOOK` |

The third case carries a **different** reason code deliberately. 남동구 is a 2024
unit and was never renamed — only the filename is malformed (a doubled
extension). Reporting the post-2024 rename code there would assert a boundary
change that did not happen. Both codes are informational and neither degrades the
indicator status.

### Rejected files

Both are preserved in `municipal_cost_source_files` with
`ingestion_decision = 'REJECTED'` and their reason codes. Neither contributes a
contract or a quantity, and neither resolves to a geography (enforced by
`ck_municipal_cost_source_files_rejected_has_no_geography`). Neither is silently
relocated.

| File | Reason codes |
| --- | --- |
| `DATA_B/인천/서해구xlsx.xlsx` | `BOUNDARY_MISMATCH`, `AMBIGUOUS_REGION_MAPPING`, `DUPLICATE_SOURCE_RECORD`, `ZERO_TOTAL_QUANTITY` |
| `DATA_B/경기도(31개중 19개 완료 8.4기준)/양천구.xlsx` | `AMBIGUOUS_REGION_MAPPING` |

양천구 is a Seoul 자치구 and does not exist in Gyeonggi; DATA_B has no
organisation column, so filename and folder conflict with no third source to
adjudicate. It is not mapped to either side.

서해구xlsx.xlsx is a 2026-named file with no documented route back to 2024
geography; additionally its 음식물 series is identical to 미추홀구's, and its
general/recycling annual totals of 0 are a `SUM` over twelve `-` cells — not a
measured zero.

### Reviewed municipality limitations

A separate mechanism from the two above, and the only one that is *about* a
municipality rather than a file. It exists because a re-delivery can remove the
evidence for a limitation without removing the limitation.

The 2024-refresh delivery replaced the earlier workbooks with a narrower
seven-column spine: no per-contract 지급월 ledger, no part-year `년도` range, no
filename scope annotation, and contract names stripped of their narrowing tokens.
Those fields were the evidence the parser reads. With the wording gone the parser
derives nothing, and five municipalities that were correctly `PARTIAL` would
silently report as complete — with numerators identical to the won.

A payment period that covered six months does not become twelve because the next
workbook stopped printing the ledger, and a contract that served two 읍·면 does
not become municipality-wide because the parenthetical was dropped. Absence of
evidence in a simplified re-delivery is not evidence that a limitation was
resolved, so the five are reinstated in one reviewed table
(`REVIEWED_MUNICIPALITY_LIMITATIONS`), each with the evidence that established it
and the reason the omission does not retire it:

| Municipality | Reason code | Evidence in the earlier delivery | Why the 2024-refresh omission does not retire it |
| --- | --- | --- | --- |
| 인천 남동구 | `PARTIAL_WASTE_SCOPE` | contract names read `생활폐기물(일반) 수집·운반`; no 음식물류/재활용 contract | only the `(일반)` token was dropped; payments are identical to the won and no new stream was added |
| 인천 부평구 | `PARTIAL_WASTE_SCOPE` | filename annotation read `생활(일반)수집운반만 있고 음식물류·재활용 데이터 없음` | the annotation was dropped from the filename; the missing contracts were not supplied |
| 인천 옹진군 | `PARTIAL_GEOGRAPHIC_SCOPE` | the two contracts named `(영흥면)` / `(북도·영흥면)` only | only the 읍·면 parenthetical was dropped; no contract covering the remaining islands appeared |
| 경기 가평군 | `PARTIAL_PERIOD_COVERAGE` | `년도` read `2024.2.26.~4.5` and `2024.5.22.~7.30` | `년도` was simplified to a bare `2024`; the 1차/2차 naming and the amounts are unchanged |
| 인천 계양구 | `PAYMENT_PERIOD_COVERAGE_INCOMPLETE` | the per-contract payment ledger recorded 2·3·9·10·11·12월 only | the ledger columns are simply absent; the six unrecorded months were not evidenced as paid |

Properties of the mechanism:

- Entries are keyed on `(metropolitan_code, display_name, reference_year)` and
  matched exactly — never by prefix. The metropolitan code is part of the key
  because 중구 exists in both Seoul and Incheon; the year is part of it because
  this describes one delivery, not a permanent property of a municipality.
- A limitation is applied only where an accepted **DATA_A** workbook exists. All
  five qualify *payment* evidence, so attaching one where no payment workbook was
  delivered would describe data that does not exist.
- Reason codes are deduplicated, so a future delivery that restores the wording
  derives the identical code without doubling it, and the reviewed entry can then
  be retired without changing any result.
- No municipality outside the table can be reached, and the table is
  test-asserted to name only registry municipalities and only `PARTIAL_REASONS`.

---

## 5. Status rules

Quantity availability does **not** determine this indicator. It is a *payment*
indicator: a valid payment plus a valid population is `AVAILABLE` even when
tonnage is entirely missing.

**AVAILABLE** — eligible verified payment exists, a valid 2024 municipal
population exists, the payment is full-year, whole-municipality, covers the
intended municipal waste scope, and the municipality mapping is unambiguous.

**PARTIAL** — a numeric value is supportable, but the payment carries at least one
limitation: `PARTIAL_WASTE_SCOPE`, `PARTIAL_GEOGRAPHIC_SCOPE`,
`PARTIAL_PERIOD_COVERAGE`, `PAYMENT_PERIOD_COVERAGE_INCOMPLETE`.

**UNAVAILABLE** — no defensible numeric value exists: `NO_SOURCE_FILE`,
`MISSING_PAYMENT`, `MISSING_POPULATION`, `BOUNDARY_MISMATCH`,
`AMBIGUOUS_REGION_MAPPING`, `AMBIGUOUS_SOURCE_MEANING`,
`UNSUPPORTED_SOURCE_LAYOUT`. The value is `NULL`, **never `0`** — enforced by
`ck_municipal_cost_indicator_values_unavailable_is_null`.

The indicator is **not** downgraded merely because DATA_B is missing, tonnage is
missing, a repeated quantity block exists, or landfill-specific tonnage is
missing. Those affect quantity completeness, not the payment numerator.
`MISSING_QUANTITY` is recorded as informational and 군포시 is a live example: it
is `AVAILABLE` while carrying `MISSING_QUANTITY`.

`NON_COLLECTION_TRANSPORT_BASIS` (§2a) is informational in the same way: what
survives the exclusion is exactly what the indicator measures, so 하남시 is
`AVAILABLE` while carrying it. It becomes decisive only indirectly — when every
contract in a workbook is on another basis there is no eligible payment left, and
the municipality is `UNAVAILABLE` under `MISSING_PAYMENT` with the basis code
alongside it saying why.

### Measured distribution (66 rows)

| Metropolitan | AVAILABLE | PARTIAL | UNAVAILABLE |
| --- | --- | --- | --- |
| 서울 (11) | 0 | 0 | 25 |
| 인천 (28) | 3 | 4 | 3 |
| 경기 (41) | 17 | 1 | 13 |
| **Total** | **20** | **5** | **41** |

AVAILABLE: 동구, 미추홀구, 서구 (인천); 고양시, 과천시, 광명시, 광주시, 군포시,
김포시, 동두천시, 부천시, 성남시, 수원시, 양주시, 양평군, 용인시, 이천시, 파주시,
포천시, 화성시 (경기).

PARTIAL (5), with the limitation that caused it:

| Municipality | Value (KRW/인) | Limitation |
| --- | --- | --- |
| 계양구 | 47,379.4921 | `PAYMENT_PERIOD_COVERAGE_INCOMPLETE` (+ informational `MISSING_QUANTITY`) |
| 옹진군 | 64,699.9271 | `PARTIAL_GEOGRAPHIC_SCOPE` (+ informational `MISSING_QUANTITY`) |
| 부평구 | 19,863.0342 | `PARTIAL_WASTE_SCOPE` |
| 남동구 | 14,690.0581 | `PARTIAL_WASTE_SCOPE` |
| 가평군 | 6,828.3776 | `PARTIAL_PERIOD_COVERAGE` |

UNAVAILABLE reason frequency: `MISSING_PAYMENT` 41, `NO_SOURCE_FILE` 19
(codes co-occur). All 25 Seoul 자치구 are UNAVAILABLE — no Seoul DATA_A workbook
was supplied.

---

## 6. Missing versus zero

Four source states are preserved distinctly and never collapsed:

| `value_state` | Meaning | `quantity_value` | Measured rows |
| --- | --- | --- | --- |
| `MEASURED` | Positive measurement | `> 0` | 2,158 |
| `MEASURED_ZERO` | A real measured zero | `= 0` | 47 |
| `SOURCE_DASH_NO_DATA` | Source wrote `-` | `NULL` | 479 |
| `SOURCE_TEXT_NO_DATA` | Source text meaning no data | `NULL` | 3 |
| `BLANK` | Empty cell | `NULL` | 14 |

`ck_municipal_waste_quantities_value_state_consistent` makes it *structurally
impossible* to store a missing value as numeric zero, or a measured zero as
missing. Each branch tests `IS NOT NULL` explicitly, because
`quantity_value = 0` alone evaluates to `NULL` when the column is `NULL`, and a
CHECK that evaluates to `NULL` passes.

---

## 7. Repeated Gyeonggi quantity blocks

Several Gyeonggi DATA_A workbooks repeat the same city-wide tonnage series under
each contract. The loader recognises the repetition, stores **one logical
municipal quantity series**, and records the repeated source rows as provenance in
`source_repetition_rows`. Repeated copies are **not summed** and are **not
allocated** to individual payments.

Measured: 15 files contain repeated blocks; 221 logical quantity observations
originate from them. Attribution distribution across the 2,701 stored
observations:

| `attribution` | Rows |
| --- | --- |
| `MUNICIPAL_TOTAL_SINGLE` | 1,716 |
| `PER_CONTRACT` | 764 |
| `MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT` | 221 |

Because tonnage never enters the numerator, a repeated block cannot change the
indicator regardless.

---

## 8. Known limitations

1. **Seoul has no payment data at all.** All 25 자치구 are UNAVAILABLE. This is a
   source-supply gap, not a computation failure.
2. **Coverage is 25 of 66** (20 AVAILABLE + 5 PARTIAL). The remaining 41 have no
   defensible value and are returned as `null`.
3. **Not comparable across municipalities without care.** Contract scope varies
   (some exclude 음식물 or 재활용), so a PARTIAL value is not on the same basis as
   an AVAILABLE one. The `limitations` array on each row states which.
4. **Quantity coverage is incomplete**: only 46 of 66 municipalities have any
   tonnage observation. This does not affect the payment indicator.
5. **The denominator is SGIS annual population**, which may differ from the
   resident-registration figure a municipality itself would quote.
6. **Two workbooks are rejected outright** (§4). Their municipalities fall back to
   whatever other evidence exists; 양천구 (Seoul) is UNAVAILABLE for lack of a
   Seoul DATA_A file, independent of this rejection.
7. **The 2026 Incheon restructuring is not modelled.** This release publishes 2024
   geography only.

---

## 9. Separation from the official landfill feature

Unchanged by this work, and verified so:

- `landfill_inbound_monthly` — 9,212 rows, all
  `accounting_basis = VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`. Zero
  municipal rows. Migration 0021 does not alter the table; its origin CHECK
  constraint would reject municipal rows anyway.
- `LANDFILL_INBOUND_FEE_PER_CAPITA`, `landfill-fee-per-capita-v2`, and the
  metropolitan-only origin contract are untouched.
- `/api/v1/landfill/summary`, `/trends`, `/composition`, `/flows` all still return
  200 and contain no municipal-cost content.

Municipal contract payments are a separate accounting basis and are never
inserted into `landfill_inbound_monthly`.
