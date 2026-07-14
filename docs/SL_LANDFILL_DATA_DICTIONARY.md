# Sudokwon Landfill Data Dictionary (V2 Phase 0 research)

Source of truth: official data.go.kr dataset pages + public odcloud OpenAPI
(Swagger) specs, captured 2026-07-14 (saved under
`backups/public_data_integration_proof_20260714T144735/metadata/`). Field names,
types, and envelope are **verified from the Swagger definitions**. Field
*semantics, units, nullability, and value sets* marked **UNVERIFIED** could not be
confirmed against real rows — the datasets are not yet 활용신청-authorized for the
available key (odcloud returned `code -4 등록되지 않은 인증키`).

---

## 1. Inbound dataset — 15064381

`수도권매립지관리공사_통합반입관리_수도권폐기물 반입량`. Issuer 수도권매립지관리공사.
Quarterly. License: 이용허락범위 제한 없음. Latest snapshot 9,212 rows. Destination
(from official description): **Sudokwon Landfill** — "수도권매립지관리공사로 반입되는
지자체별 반입량 정보".

### Response envelope (odcloud)

| Field | Type | Meaning |
| --- | --- | --- |
| `page` | integer | Requested page index |
| `perPage` | integer | Page size |
| `totalCount` | integer | Total rows in the version |
| `currentCount` | integer | Rows in this page |
| `matchCount` | integer | Rows matching the query |
| `data` | array | Row objects (below) |

### Data-item fields

| # | Field (KO) | Type | Unit | Canonical meaning | Nullability | Normalization rule | Provenance | Known limitations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `마감년월` | string | year-month | Closing/reference month of the inbound total | UNVERIFIED (assume NOT NULL) | Parse to `YYYY-MM`; verify format (likely `YYYYMM` or `YYYY.MM`) against real rows | odcloud 15064381 | Exact format & min/max month UNVERIFIED |
| 2 | `광역지자체명` | string | — | **Metropolitan** origin government | UNVERIFIED (assume NOT NULL) | Map to canonical 광역: 서울특별시 / 인천광역시 / 경기도. Reject anything finer | odcloud 15064381 | **Metropolitan-only**; NO 시군구/구. Exact tokens UNVERIFIED |
| 3 | `폐기물명` | string | — | Waste name (no code) | UNVERIFIED (assume NOT NULL) | Trim/normalize whitespace; treat as the join key to the rate table | odcloud 15064381 | No `폐기물코드` present ⇒ code-based join impossible; value set UNVERIFIED |
| 4 | `반입량(kg)` | integer | **kg** | Inbound quantity into the landfill | UNVERIFIED (assume NOT NULL) | `quantity_kg = value` (already kg); to tonnes `/1000` only if a tonne view is needed | odcloud 15064381 | Unit is asserted by the **field name** (`반입량(kg)`); confirm no unit drift across snapshots |

### Proposed normalized columns (for `inbound_normalized.csv`, not built here)

`reference_month, origin_source_name (=광역지자체명 verbatim),
origin_canonical_level ('SIDO'), origin_canonical_code (KR-SGIS 11/28/41),
source_waste_name (=폐기물명), quantity_original (=반입량(kg)),
quantity_unit_original ('kg'), quantity_kg, destination_facility_code (reviewed
constant = Sudokwon Landfill, applied ONLY after confirming every row shares that
destination), source_id ('15064381'), source_row_number`.

---

## 2. Rate dataset — 15064397

`수도권매립지관리공사_통합반입관리_폐기물정보`. Issuer 수도권매립지관리공사. Quarterly.
License: 이용허락범위 제한 없음. 191 rows. Price is **multi-component** per the
official description ("폐기물 처리비용, 매립지 운영비, 환경개선비 등").

### Response envelope

Same odcloud envelope as §1 (`page…data[]`).

### Data-item fields

| # | Field (KO) | Type | Unit | Canonical meaning | Nullability | Normalization rule | Provenance | Known limitations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `폐기물코드` | integer | — | Waste code (rate table only) | UNVERIFIED (assume NOT NULL) | Keep as string key; verify uniqueness | odcloud 15064397 | Not present on inbound side ⇒ unusable as inbound join key |
| 2 | `폐기물명` | string | — | Waste name | UNVERIFIED (assume NOT NULL) | Normalize whitespace; **this is the only inbound↔rate join key** | odcloud 15064397 | Name equality vs inbound `폐기물명` UNVERIFIED; may differ in spacing/synonyms |
| 3 | `폐기물단가` | integer | **KRW (basis unknown)** | Unit price | UNVERIFIED | Store raw; **do NOT assume per-kg/per-ton/per-vehicle** | odcloud 15064397 | **No unit basis**, **no effective period**, **multi-component** price |

### Proposed normalized columns (for `landfill_rates_normalized.csv`, not built here)

`source_waste_code (=폐기물코드), source_waste_name (=폐기물명),
unit_price_krw (=폐기물단가), price_basis_unit ('UNVERIFIED' until confirmed),
effective_from / effective_to (derive ONLY by diffing snapshot versions; else
NULL), period_status (see below), source_id ('15064397'), source_row_number`.

`period_status` ∈ `PERIOD_MATCHED | CURRENT_RATE_ONLY |
HISTORICAL_PERIOD_UNKNOWN | INVALID_OR_AMBIGUOUS`. With no in-table period, the
default for the latest snapshot is **`CURRENT_RATE_ONLY`**; snapshot-diff–derived
periods (if reconstructed) become `PERIOD_MATCHED` only when a value actually
changed between two dated snapshots.

---

## 3. Version history (both datasets)

17 quarterly snapshots each (each is a full re-publish; the UUID is the odcloud
path segment). Inbound: 2021-09-27 → 2026-05-31. Rate: 2021-09-27 → 2026-06-11.
Full UUID list in `backups/…/metadata/dataset_metadata_extracts.md` and the saved
Swagger JSONs.

---

## 4. Cross-dataset join contract

| Property | Value |
| --- | --- |
| Join keys available | `폐기물명` (name) only |
| Preferred code join | **Not possible** (inbound has no code) |
| Allowed final match methods | `EXACT_NAME`, `REVIEWED_CROSSWALK` |
| Fuzzy matching | Review candidates only — never a final match |
| Unit compatibility | Inbound = kg (from field name); rate basis = **unknown** ⇒ compatibility UNVERIFIED |
| Period compatibility | Rate has no period ⇒ `CURRENT_RATE_ONLY`; historical cost disallowed |

---

## 5. Global known limitations

1. **No real rows inspected** — every "UNVERIFIED" above stays that way until a
   free 활용신청 authorizes the key for 15064381 / 15064397.
2. Inbound geography is **광역-only** (metropolitan); no municipal/district origin.
3. Rate is **current-only, unit-basis-unknown, multi-component** — unsuitable for
   clean historical or disposal-only cost claims.
4. The two tables share **no code**; joins are name-based and fragile to spacing
   / synonym differences that can only be assessed on real values.
