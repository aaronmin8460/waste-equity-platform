# Public-Data Integration Proof (V2 Phase 0)

Research date: **2026-07-14** (live-verified). Branch:
`research/public-data-integration-proof`. Scope: research and data-validation only
— no schema, migration, ingestion, production, or application-behavior change was
made. Real API rows are preserved under
`backups/public_data_integration_proof_20260714T152820/` (git-ignored).

**Geographic scope: CAPITAL REGION ONLY** — Seoul Metropolitan Government (서울시),
Gyeonggi Province (경기도), Incheon Metropolitan City (인천시), with the **Sudokwon
Landfill** as the verified destination. No nationwide coverage; no
sub-metropolitan origin.

This report answers the three Phase-0 questions:

- **A.** Seoul / Gyeonggi / Incheon waste **inbound quantities → Sudokwon Landfill**
- **B.** Official Sudokwon Landfill **fees / rates** (cost)
- **C.** **KONEPS** public waste-related **contracts**

---

## 1. Executive conclusion

**Verdict: GO** for the capital-region landfill inbound-flow and official-fee
features; **KONEPS DEFERRED** (accessible but out of the V2 MVP).

After the account owner completed the free 활용신청, all previously blocked
datasets were fetched **in full** and inspected **row-by-row**. The landfill
integration is fully verified against real data:

| Dataset | Real rows | Status |
| --- | ---: | --- |
| 15064381 landfill inbound quantities | **9,212** | VERIFIED |
| 15064394 landfill inbound fees | **9,212** | VERIFIED |
| 15064397 landfill waste rates | **191** | VERIFIED |
| 15129427 KONEPS contracts | n/a | **DEFERRED** (access confirmed; not in MVP) |

Key verified facts (real rows, not descriptions):

- **Origin geography is metropolitan-only:** the inbound `소재지` field contains
  **exactly `서울시` (2,810), `인천시` (3,034), `경기도` (3,368)** across all 9,212
  rows — **no city, county, or district value exists.**
- **Destination is the Sudokwon Landfill** — the whole dataset is that
  corporation's integrated inbound (반입) record.
- **Quantity unit is kg** (`반입량`); canonical grain `마감년월 × 소재지 × 폐기물명`
  is **unique** (0 duplicates), 0 nulls, no negatives/zeros; coverage **1999-08 →
  2026-05**.
- **inbound ↔ fee join is exact 1:1** (9,212 / 9,212). `반입수수료` is a
  **period-correct officially reported inbound fee**.
- **inbound ↔ rate name join is 100%** (28 / 28 waste names, 0 ambiguous). Rate
  basis is **KRW per tonne** (cross-verified). The rate table (15064397) is a
  **current-rate reference** only and must not represent historical paid cost —
  the period-correct fee already lives in 15064394.

### One-line answers

1. **Inbound parsed/normalized reliably?** **YES** — 9,212 clean rows, unique
   grain, verified metropolitan origins, kg, 1999–2026. Normalized to
   `inbound_normalized.csv`.
2. **Inbound joined to official cost with verified units/periods?** **YES** — the
   fee dataset (15064394) joins 1:1 and gives a **period-correct official fee**;
   the rate table (15064397) is verified KRW/tonne but **current-only** (use the
   fee, not the rate, for historical cost).
3. **KONEPS contracts findable/classifiable?** Access is **confirmed** (auth
   propagated to HTTP 200, endpoint + params verified), but KONEPS is **DEFERRED**
   from the V2 MVP by decision; see §10.

---

## 2. Source inventory

Machine-readable inventory with SHA-256, license, period, cycle:
`backups/…20260714T152820/source_inventory.csv`. Summary:

| source_id | Title | Issuer | Rows | Cycle | License |
| --- | --- | --- | ---: | --- | --- |
| 15064381 | 통합반입관리_수도권폐기물 반입량 | 수도권매립지관리공사 | 9,212 | 분기 | 제한 없음 |
| 15064394 | 통합반입관리_폐기물반입수수료 | 수도권매립지관리공사 | 9,212 | 분기 | 제한 없음 |
| 15064397 | 통합반입관리_폐기물정보 (rates) | 수도권매립지관리공사 | 191 | 분기 | 제한 없음 |
| 15129427 | 나라장터 계약정보서비스 (KONEPS) | 조달청 | DEFERRED | 실시간 | 제한 없음 |

Access method: odcloud API (`api.odcloud.kr/api/{ns}/v1/{uuid}`) under the
authorized `DATA_GO_KR_SERVICE_KEY` (loaded from env; never printed/committed).

---

## 3. Exact source schemas (real JSON field names)

**15064381 inbound:** `마감년월` (string, YYYY-MM), `소재지` (string, metropolitan
origin), `폐기물명` (string), `반입량` (integer, **kg**). *(Portal/Swagger labelled
these 광역지자체명 / 반입량(kg); the real JSON keys are 소재지 / 반입량.)*

**15064394 fees:** `광역지자체명` (string, origin), `마감년월` (string), `반입수수료`
(integer, **KRW**), `폐기물명` (string).

**15064397 rates:** `폐기물코드` (integer), `폐기물명` (string), `폐기물단가`
(integer, **KRW per tonne**).

Full field-level dictionary: `docs/SL_LANDFILL_DATA_DICTIONARY.md`.

---

## 4. Geography resolution (VERIFIED capital-region-only)

The inbound origin field `소재지` holds **only** three values across 9,212 rows:

| Source token | Count | Canonical | SIDO code |
| --- | ---: | --- | --- |
| `서울시` | 2,810 | 서울특별시 | KR-SGIS-11 |
| `인천시` | 3,034 | 인천광역시 | KR-SGIS-28 |
| `경기도` | 3,368 | 경기도 | KR-SGIS-41 |

**No 시/군/구/동 value exists anywhere.** This is the platform's only
source-declared origin→destination waste flow, and it is strictly **metropolitan**.

> **HARD RULE:** never disaggregate a 서울시/인천시/경기도 total to a city, county,
> or district, and never draw a city/district → landfill (or → any facility)
> arrow. Sub-metropolitan origin-to-destination flow is `UNAVAILABLE`.

---

## 5. Reference periods

- **Inbound 15064381 / Fees 15064394:** monthly grain (`마감년월`), **1999-08 →
  2026-05** (322 months). 2023, 2024, 2025 are complete 12-month years; 2026 is
  partial (Jan–May). Quarterly file refresh.
- **Rates 15064397:** a single **current** snapshot (2026-06-11). No in-row
  effective period ⇒ `period_status = CURRENT_RATE_ONLY`; historical rates differ
  and are only reconstructable by snapshot-diff.

---

## 6. Inbound-data quality (VERIFIED)

9,212 rows = totalCount. 4 columns, 0 nulls in any column. `반입량` integer kg:
min 2,320 · max 196,809,480 · **0 negative · 0 zero**. Canonical grain `마감년월 ×
소재지 × 폐기물명` **unique (0 duplicate keys)**. 28 distinct waste names, all
non-null. Origin set exactly {서울시, 인천시, 경기도}.

**Verified aggregates (metropolitan → Sudokwon Landfill):**

| Year | 서울시 (t) | 인천시 (t) | 경기도 (t) | Total (t) | Shares (서울/인천/경기) |
| --- | ---: | ---: | ---: | ---: | --- |
| 2023 | 490,846 | 187,162 | 614,795 | **1,292,803** | 38.0 / 14.5 / 47.6 % |
| 2024 | 408,491 | 154,881 | 508,177 | **1,071,548** | 38.1 / 14.5 / 47.4 % |
| 2025 | 420,404 | 156,160 | 482,346 | **1,058,911** | 39.7 / 14.7 / 45.6 % |

2024 waste-type composition: 생활 51.7% · 하수오니(자원화) 18.3% · 음폐수 13.2% ·
음식물탈리액 11.4% · 중간처리잔재폐기물 2.0% (건설폐기물 = 0 t in 2024).

---

## 7. Landfill-fee & rate quality (VERIFIED)

**Fees (15064394):** 9,212 rows, joins **1:1** to inbound on
`(마감년월, origin, 폐기물명)` (0 inbound-only, 0 fee-only). `반입수수료` integer KRW,
0 nulls, 621 zero-fee rows, no negatives. Verified as **period-correct**:
`반입수수료 ≈ (반입량 ÷ 1000) × (rate in effect that month)` — 2026-05 matches
within 0.9%; historical months use historically-lower rates (2020/2010/1999
diverge from current), so the column reflects the **actual assessed fee at the
time**, an `OFFICIAL_REPORTED_VALUE`.

Verified annual official fee totals and effective rate (fee ÷ tonnes):

| Year | Total official inbound fee | Effective fee/tonne |
| --- | ---: | ---: |
| 2023 | ~115.7 billion KRW (1,156.8억원) | 89,483 KRW/t |
| 2024 | ~108.2 billion KRW (1,081.8억원) | 100,953 KRW/t |
| 2025 | ~105.5 billion KRW (1,055.2억원) | 99,654 KRW/t |

**Rates (15064397):** 191 rows, 191 unique codes (0 dup), 175 unique names (16
names duplicated across codes), `폐기물단가` integer, min 0 · max 900,000 · **86
zeros**. Basis verified **KRW per tonne** (2026-05 implied rate == 단가).
`CURRENT_RATE_ONLY`.

---

## 8. Waste-name join coverage (VERIFIED)

- unique waste-name match: **100.0% (28 / 28)**
- quantity-weighted match: **100.000%**
- exact-**code** match: 0% (inbound carries no 폐기물코드 → name-join only)
- exact-**name** match: 100%
- ambiguous mappings: **0** (no inbound name maps to multiple prices)
- unmatched inbound names: **0**
- quantity under a nonzero current rate: **99.999%** (only `낙엽`, `탈수용응집제`
  are 0-rate)
- rate-unit verified: **TRUE (KRW/tonne)**

Reports: `inbound_fee_join_report.csv` (1:1, OFFICIAL_REPORTED_VALUE) and
`inbound_rate_join_report.csv` (name-join, per-waste status).

---

## 9. Allowed vs disallowed cost calculations

- **ALLOWED — official fee (preferred):** `반입수수료` from 15064394 is the
  period-correct official inbound fee for every (month, origin, waste), 1:1 with
  quantity. Label `OFFICIAL_REPORTED_VALUE`. Effective fee/tonne = official fee ÷
  official quantity(tonnes) is an `OFFICIAL_INPUTS_DERIVED_VALUE`.
- **ALLOWED, present scenario only — current rate:** `(반입량/1000) × 단가` using
  15064397 is valid **only for the current period** (rate is current-only),
  labelled `OFFICIAL_INPUTS_DERIVED_VALUE` / present-rate scenario. **DEFERRED**
  in favour of the official fee.
- **DISALLOWED:** applying the current 단가 to a historical month (would misstate
  past cost); presenting any fee as a procurement/contract paid amount; any
  sub-metropolitan cost allocation.

---

## 10. KONEPS (DEFERRED)

KONEPS is **not part of the V2 MVP** and was not searched to completion. What is
established (kept for a future capital-region-scoped phase): the authorization
propagated to **HTTP 200**; the working endpoint is
`apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListServcPPSSrch` with
required params `inqryDiv=1`, `inqryBgnDate`/`inqryEndDate` (`YYYYMMDD`); `cntrctNm`
filters server-side; the municipality (수요기관) is only client-filterable from the
`dminsttList` field. If revisited, scope must be **Seoul / Gyeonggi / Incheon
municipalities only**, and any contract total is a `PUBLIC_CONTRACT_TOTAL` (never
transport-only cost, never proof of a destination facility). Details:
`docs/KONEPS_WASTE_CONTRACT_SEARCH_REPORT.md`.

---

## 11. Limitations

1. Inbound origin is **metropolitan-only**; sub-metropolitan origin→destination
   flow is `UNAVAILABLE`.
2. The rate table (15064397) is **current-only**; use `반입수수료` for period cost.
3. `반입수수료` is SL-Corp's reported inbound fee (tariff × quantity), **not** a
   contract/market price.
4. Destination is a single facility (Sudokwon Landfill) implied by dataset scope;
   there is no per-row destination field.
5. KONEPS is deferred; no contract data is included in the MVP.

---

## 12. GO / CONDITIONAL GO / NO-GO decision

**GO** for the capital-region landfill inbound-flow and official-fee features. All
GO-gate conditions for the landfill datasets are met on **real data**: inbound
parses (9,212 rows), Seoul/Gyeonggi/Incheon origin mapping is 100% and
metropolitan-only, destination = Sudokwon Landfill, quantity unit = kg, waste-name
→ cost join = 100% (quantity-weighted 100%), rate unit verified (KRW/tonne), and
period-correct official fees are available for all reference periods. KONEPS is
**DEFERRED** (its own gate — contracts for ≥3 municipalities — was not exercised by
decision, not by failure).

---

## 13. Recommended implementation scope

See `docs/PUBLIC_DATA_V2_RECOMMENDATION.md`. In brief (capital region only): build
the **서울시 / 경기도 / 인천시 → 수도권매립지 official inbound-flow view**, monthly &
annual inbound charts, waste-type composition, official inbound-fee totals
(15064394), and effective fee/tonne. Keep RCIS scorecards / facility-burden for
capital-region municipalities. **Defer** KONEPS and the current-rate scenario.
**Never** build sub-metropolitan or nationwide features.

## 14. Change log vs the 2026-07-14T1447 metadata-only draft

The earlier draft's blockers are **resolved**: real rows were obtained and
inspected; datasets are no longer authorization-blocked; join coverage is verified
(100% name, 100% quantity-weighted); and the inbound-fee meaning is established
(15064394 = period-correct official inbound fee, KRW). The verdict moves from
"CONDITIONAL GO (blocked)" to **GO** for the landfill features.
