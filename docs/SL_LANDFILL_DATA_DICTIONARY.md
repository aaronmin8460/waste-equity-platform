# Sudokwon Landfill Data Dictionary (V2 Phase 0)

**Status: LIVE-VERIFIED against real API rows on 2026-07-14.** All three file
datasets were fetched in full from the odcloud API (data.go.kr) under the
authorized `DATA_GO_KR_SERVICE_KEY` and inspected row-by-row. Raw rows and
normalized CSVs are preserved under
`backups/public_data_integration_proof_20260714T152820/` (git-ignored). Field
names below are the **actual JSON field names returned by the API**, which differ
in places from the portal/Swagger column labels — the real names are used here.

Evidence classes: `OFFICIAL_REPORTED_VALUE` (source reports it directly),
`OFFICIAL_INPUTS_DERIVED_VALUE` (computed by us), `VERIFIED`, `UNAVAILABLE`.

---

## 1. Inbound quantities — 15064381

`수도권매립지관리공사_통합반입관리_수도권폐기물 반입량`. Issuer 수도권매립지관리공사.
Quarterly. License 이용허락범위 제한 없음. **9,212 rows (fetched = totalCount).**
Destination: the **Sudokwon Landfill** — the entire dataset is that corporation's
integrated inbound (반입) record; there is no per-row destination field because
every row is inbound to this one facility.

| # | Field (real JSON) | Type | Unit | Canonical meaning | Nullability (measured) | Value set / range (measured) | Normalization |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `마감년월` | string | year-month | Reference month | 0 null | `1999-08` … `2026-05`, 322 distinct months | Parse `YYYY-MM` |
| 2 | `소재지` | string | — | **Metropolitan** origin | 0 null | **exactly `서울시`(2810), `인천시`(3034), `경기도`(3368)** | Map to canonical SIDO |
| 3 | `폐기물명` | string | — | Waste name (no code) | 0 null | **28 distinct** names | Trim; join key to fee & rate |
| 4 | `반입량` | integer | **kg** | Inbound quantity | 0 null | min 2,320 · max 196,809,480 · **0 neg · 0 zero** | `quantity_kg = 반입량` |

- **Canonical grain `마감년월 × 소재지 × 폐기물명` is UNIQUE (0 duplicate keys).**
- **Geography VERIFIED metropolitan-only:** the field holds only 서울시 / 인천시 /
  경기도. No 시/군/구/동 value exists anywhere in 9,212 rows.
- Portal/Swagger label was `광역지자체명`/`반입량(kg)`; the real JSON keys are
  `소재지`/`반입량`. Unit kg confirmed by the field label **and** by the fee
  cross-check (§4).

### Normalized `inbound_normalized.csv` (built, 9,212 rows)

`reference_month, origin_source_name (소재지 verbatim), origin_canonical_level
('SIDO'), origin_canonical_code (서울시→KR-SGIS-11, 인천시→KR-SGIS-28,
경기도→KR-SGIS-41), source_waste_name, quantity_original, quantity_unit_original
('kg'), quantity_kg, destination_facility_code ('SUDOKWON_LANDFILL' — reviewed
constant, whole-dataset destination), source_id ('15064381'), source_row_number`.

---

## 2. Inbound fees — 15064394

`수도권매립지관리공사_통합반입관리_폐기물반입수수료`. Quarterly. License 제한 없음.
**9,212 rows.** This dataset was **added during live verification** (it was one of
the four newly-authorized datasets) and is the most valuable cost source.

| # | Field | Type | Unit | Meaning | Nullability | Range (measured) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `광역지자체명` | string | — | Metropolitan origin | 0 null | `서울시`/`인천시`/`경기도` (same 3) |
| 2 | `마감년월` | string | year-month | Reference month | 0 null | `1999-08`…`2026-05` |
| 3 | `폐기물명` | string | — | Waste name | 0 null | joins to inbound |
| 4 | `반입수수료` | integer | **KRW** | Inbound fee for that (month,origin,waste) | 0 null | min 0 · max 5,298,371,160 · 621 zeros · 0 neg |

- **1:1 with inbound:** every one of the 9,212 `(마감년월, origin, 폐기물명)` keys
  matches inbound exactly (0 inbound-only, 0 fee-only). Origin token is
  `광역지자체명` here vs `소재지` in inbound, but values are identical.
- **`반입수수료` is a period-correct `OFFICIAL_REPORTED_VALUE`.** Verified:
  `반입수수료 ≈ (반입량 ÷ 1000) × (rate in effect that month)` (2026-05: 29/30 rows
  within 0.9%). Historical months use historically-lower rates (2020-01, 2010-01,
  1999-08 diverge from the current rate), so the column reflects the **actual fee
  assessed at the time**, not a current-rate recompute.

### Normalized `inbound_fees_normalized.csv` (built, 9,212 rows)

`reference_month, origin_source_name, origin_canonical_level, origin_canonical_code,
source_waste_name, inbound_fee_krw (=반입수수료), fee_currency ('KRW'),
destination_facility_code, evidence_class ('OFFICIAL_REPORTED_VALUE'), source_id
('15064394'), source_row_number`.

---

## 3. Waste rates — 15064397

`수도권매립지관리공사_통합반입관리_폐기물정보`. Quarterly. License 제한 없음.
**191 rows.**

| # | Field | Type | Unit | Meaning | Measured facts |
| --- | --- | --- | --- | --- | --- |
| 1 | `폐기물코드` | integer | — | Waste code | 191 **unique** (0 dup codes) |
| 2 | `폐기물명` | string | — | Waste name | 175 unique (16 names duplicated across codes) |
| 3 | `폐기물단가` | integer | **KRW per TONNE** | Current unit price | min 0 · max 900,000 · **86 zeros** · 0 neg |

- **Rate basis VERIFIED = KRW per TONNE** (not per kg): for 2026-05 the implied
  per-tonne rate `반입수수료 ÷ (반입량/1000)` equals `폐기물단가` almost exactly
  (e.g. 하수오니(자원화): 108,670 = 108,670). Per-kg would be off by 1000×.
- **`period_status = CURRENT_RATE_ONLY`:** the table matches only the latest month;
  the 17 dated snapshots carry no in-row effective period, so historical rates are
  reconstructable only by snapshot-diff (derived).
- 86/191 rates are 0 (free / not-currently-priced / discontinued waste types).
- Of the 28 inbound waste names, **all 28 exact-match a rate name, 0 are
  ambiguous** (none map to multiple prices); 2 (`낙엽`, `탈수용응집제`) have a 0 rate.

### Normalized `landfill_rates_normalized.csv` (built, 191 rows)

`source_waste_code, source_waste_name, unit_price_krw, price_basis_unit
('KRW_PER_TONNE'), effective_from_snapshot ('2026-06-11'), effective_to (''),
period_status ('CURRENT_RATE_ONLY'), source_id ('15064397'), source_row_number`.

---

## 4. Cross-dataset join contract (VERIFIED)

| Property | Value |
| --- | --- |
| inbound ↔ fee | **1:1 exact** on `(마감년월, origin, 폐기물명)` — 9,212/9,212 |
| inbound ↔ rate | **exact `폐기물명`** — 28/28 names (100%), 0 ambiguous |
| shared code | none on inbound (inbound has no 폐기물코드); name-join only |
| quantity unit | inbound kg (verified) |
| rate unit | KRW/tonne (verified via fee cross-check) |
| period-correct cost | **available directly** as `반입수수료` (OFFICIAL_REPORTED_VALUE), all periods |
| current-rate scenario | derivable as `(반입량/1000) × 단가`, present-month only, 99.999% of qty |

---

## 5. Known limitations

1. Inbound origin is **metropolitan-only** (서울시/인천시/경기도). No municipal or
   district origin exists — never disaggregate a 광역 value to a city/district.
2. The **rate table (15064397) is current-only**; do not apply current 단가 to
   historical quantities. Use `반입수수료` for period-correct cost instead.
3. `반입수수료` is SL-Corp's reported inbound fee (tariff × quantity), **not** a
   procurement/contract paid amount and not a market price.
4. Destination is a single facility (Sudokwon Landfill) implied by the dataset
   scope; there is no per-row destination field.
5. 2 waste names carry a 0 current rate; 86/191 rate rows are 0 overall.
6. 2026 is partial (through 2026-05); 2023–2025 are complete 12-month years.
