# Public-Data V2 Recommendation (capital region only)

Research date: **2026-07-14** (live-verified). Basis:
`docs/PUBLIC_DATA_INTEGRATION_PROOF.md`, `docs/SL_LANDFILL_DATA_DICTIONARY.md`,
`docs/KONEPS_WASTE_CONTRACT_SEARCH_REPORT.md`.

## Scope (fixed)

**Capital region only:** Seoul Metropolitan Government (서울시), Gyeonggi Province
(경기도), Incheon Metropolitan City (인천시), with the **Sudokwon Landfill** as the
verified destination. The landfill inbound source supports **only** these three
metropolitan origins; they are **never** disaggregated to cities, counties, or
districts. Nationwide coverage and non-capital-region ingestion are out of scope.

## Evidence labels (apply on every surface)

- `OFFICIAL_REPORTED_VALUE` — inbound **quantity** (15064381) and inbound **fee**
  (15064394).
- `OFFICIAL_INPUTS_DERIVED_VALUE` — monthly/annual aggregations, origin shares,
  **effective fee per tonne** (official fee ÷ official quantity in tonnes).
- `PUBLIC_CONTRACT_TOTAL` — future KONEPS values only.
- `UNAVAILABLE` — sub-metropolitan origin-to-destination flow.

---

## GO — build now (all verified on real rows)

| Feature | Source | Resolution | Update | Evidence | Method | User caveat |
| --- | --- | --- | --- | --- | --- | --- |
| **서울시 / 경기도 / 인천시 → 수도권매립지 inbound-flow view** | 15064381 | 3 metropolitan origins → 1 destination | quarterly (monthly grain) | `OFFICIAL_REPORTED_VALUE` | sum `반입량` (kg→t) by origin | "Inbound reported by SL Corp per metropolitan gov't; a destination flow, not generation/responsibility; not municipal/district." |
| **Monthly inbound charts** | 15064381 | metropolitan | monthly | `OFFICIAL_INPUTS_DERIVED_VALUE` (aggregation) | monthly totals by origin / waste | show source + 마감년월 |
| **Annual inbound charts** | 15064381 | metropolitan | annual | `OFFICIAL_INPUTS_DERIVED_VALUE` | annual totals; 2023–2025 complete, 2026 partial | label 2026 partial (through 05) |
| **Waste-type composition** | 15064381 | metropolitan | monthly/annual | `OFFICIAL_INPUTS_DERIVED_VALUE` | share by 폐기물명 (28 types) | 2024 e.g. 생활 51.7%, 하수오니 18.3% |
| **Official inbound-fee totals** | 15064394 | metropolitan | monthly/annual | `OFFICIAL_REPORTED_VALUE` | sum `반입수수료` (KRW) by origin/period | "SL-Corp reported inbound fee; not a contract/market price." |
| **Effective fee per tonne** | 15064394 ÷ 15064381 | metropolitan | annual/monthly | `OFFICIAL_INPUTS_DERIVED_VALUE` | official fee ÷ official tonnes (1:1 join, verified) | "Derived ratio of two official values." |
| **RCIS waste scorecards** | existing RCIS | capital-region **municipalities only** | annual | (existing) | unchanged | keep existing framing |
| **RCIS facility-burden comparison** | existing RCIS | capital region only | annual | (existing) | unchanged | facility throughput ≠ movement |

Verified inputs backing the GO: inbound 9,212 rows (origins 서울시/인천시/경기도
only, kg, unique grain); fees 9,212 rows (1:1 join, period-correct); rates 191 rows
(KRW/tonne). Join coverage: 100% waste-name (28/28), 100.000% quantity-weighted.

---

## DEFERRED — not in the MVP

| Feature | Why deferred | Re-entry condition |
| --- | --- | --- |
| **KONEPS public-contract view** | access confirmed but bundled totals, partial coverage, municipality only client-filterable | future phase, **capital-region municipalities only**, classification reviewed; totals as `PUBLIC_CONTRACT_TOTAL` |
| **Current-rate scenario (15064397)** | rate table is `CURRENT_RATE_ONLY`; official fee (15064394) already gives period-correct cost | only as an explicitly-labelled present-rate scenario if ever needed |

---

## HARD NO — never build

- Nationwide data coverage.
- Non-capital-region ingestion.
- City / district → landfill arrows.
- City / district → individual-facility arrows.
- Allocation of metropolitan totals to municipalities.
- Treating public-contract totals as transport-only costs.

---

## Build order

1. Ship the **metropolitan → Sudokwon Landfill inbound-flow view** + monthly/annual
   inbound charts + waste-type composition (15064381), all with source + 마감년월
   labels.
2. Add **official inbound-fee totals** and **effective fee/tonne** (15064394),
   labelled per the evidence vocabulary.
3. Keep RCIS scorecards / facility-burden for capital-region municipalities.
4. Defer KONEPS and the current-rate scenario.
5. Never build any HARD-NO item.
