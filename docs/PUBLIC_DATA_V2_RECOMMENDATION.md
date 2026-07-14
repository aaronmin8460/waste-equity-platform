# Public-Data V2 Recommendation (smallest honest scope)

Research date: **2026-07-14**. Basis: `docs/PUBLIC_DATA_INTEGRATION_PROOF.md`,
`docs/SL_LANDFILL_DATA_DICTIONARY.md`,
`docs/KONEPS_WASTE_CONTRACT_SEARCH_REPORT.md`. This document specifies the
smallest V2 that can be built **honestly using internet-accessible data only**,
and states, per candidate feature, whether it is IN or OUT.

> **Gating precondition for everything below:** the three datasets (15064381,
> 15064397, 15129427) must first be 활용신청-authorized for the account that owns
> `DATA_GO_KR_SERVICE_KEY` (they currently return odcloud `-4` / KONEPS `403`),
> and a short live-verification pass must confirm units, period span, and exact
> region tokens. No V2 feature should ship on Phase-0 *descriptions* alone.

---

## Feature decisions

| Candidate feature | Decision |
| --- | --- |
| Metropolitan (서울/인천/경기) → Sudokwon Landfill inbound-flow map | **INCLUDE** (after live-verify) |
| Municipal waste scorecards | **CONDITIONAL** — only on existing RCIS 시군구 metrics, **not** on landfill inbound |
| Facility-burden comparison | **INCLUDE (unchanged)** — already served from RCIS facility PIDs; landfill inbound adds a labelled metropolitan context layer only |
| Official-rate-derived landfill cost | **EXCLUDE** (rate basis/period unverified, multi-component) |
| KONEPS contract totals | **EXCLUDE for now** (authorization + classification unproven) |
| City/district → facility arrows | **EXCLUDE (hard no)** — unsupported by every available source |

---

### 1. Metropolitan → Sudokwon Landfill inbound-flow view — **INCLUDE**

- **Data source:** 15064381 (`통합반입관리_수도권폐기물 반입량`), odcloud OpenAPI,
  license 이용허락범위 제한 없음.
- **Geographic resolution:** **광역 (metropolitan) only** — 서울특별시, 인천광역시,
  경기도. Three origin nodes → one destination (Sudokwon Landfill).
- **Update frequency:** quarterly snapshots; monthly `마감년월` grain inside.
- **Evidence status:** `OFFICIAL_REPORTED_VALUE` for quantities (once rows are
  fetched); this is the **only** source-declared origin→destination waste flow
  available to the platform.
- **Calculation method:** sum `반입량(kg)` by `광역지자체명` × `마감년월` (and by
  `폐기물명`); present monthly and annual totals, plus 2024 total and 2023–2025
  comparison where the file covers those months. Quantities already in kg.
- **User-facing caveat:** "Inbound quantity **reported by** Sudokwon Landfill
  Management Corp for each **metropolitan** government (서울/인천/경기), by month.
  Not municipal or district level. A destination flow, not a generation or
  responsibility metric."
- **Integrity guardrail:** never disaggregate a 광역 value to any city/district;
  never mix with RCIS origin-based generation or facility throughput without
  explicit labels (different accounting bases — see `models/waste.py`,
  `models/facilities.py`).

### 2. Municipal waste scorecards — **CONDITIONAL (unchanged data source)**

- **Data source:** existing RCIS `regional_waste_statistics` (시군구 generation /
  treatment), **not** landfill inbound.
- **Resolution:** SGIS 시군구 (+ the seven RCIS reporting cities).
- **Why not landfill inbound:** inbound is 광역-only, so it cannot populate a
  municipal scorecard without inventing sub-metropolitan values (forbidden).
- **Caveat:** keep the existing "Reported Treatment-to-Generation Imbalance Ratio"
  framing; do not add a landfill-inbound column at municipal level.

### 3. Facility-burden comparison — **INCLUDE (unchanged)**

- **Data source:** existing RCIS facility PIDs (`waste_treatment_facilities`,
  `FACILITY_LOCATION_BASED_THROUGHPUT`). Landfill inbound may appear only as a
  separate, clearly-labelled **metropolitan inbound** context panel — never
  merged into facility throughput.
- **Caveat:** facility throughput ≠ origin→destination movement.

### 4. Official-rate-derived landfill cost — **EXCLUDE**

- **Data source (rejected for now):** 15064397 rate table.
- **Why excluded:** (a) **no unit basis** (per kg/ton/vehicle unknown); (b) **no
  effective period** (current-only per snapshot); (c) price is **multi-component**
  (처리비 + 운영비 + 환경개선비), so it is not a clean disposal tariff; (d) inbound↔rate
  join is **name-only** (no shared code). Any cost figure now would violate the
  "no unverified assumptions / no derived value presented as official" rules.
- **Re-entry condition:** only after the rate **basis** is confirmed out-of-band
  (e.g. 반입수수료 dataset 15064394 or SL-Corp's published fee schedule), the
  name-join reaches high coverage on real values, and the result is labelled
  `OFFICIAL_INPUTS_DERIVED_COST` as a **present-rate scenario only** (never a past
  "paid cost").

### 5. KONEPS contract totals — **EXCLUDE for now**

- **Data source (pending):** 15129427 `getCntrctInfoListServcPPSSrch`.
- **Why excluded:** key not yet authorized (403); classification reliability,
  false-positive rate, and cost decomposability are unproven on real results.
- **Re-entry condition:** after 활용신청, run the search matrix in the KONEPS
  report, validate classification on real rows, and present only
  `PUBLIC_CONTRACT_TOTAL` values with the "not transport-only, no implied
  destination" caveat.

### 6. City/district → facility arrows — **EXCLUDE (hard no)**

- No available official source provides sub-metropolitan origin→destination flow.
  RCIS explicitly does not (see `docs/DATA_SOURCE_AUDIT.md`); landfill inbound is
  광역-only; KONEPS contracts do not encode physical destination. Drawing such an
  arrow would fabricate movement. **Never build this.**

---

## Evidence-label vocabulary (apply on every V2 surface)

`OFFICIAL_REPORTED_VALUE` (e.g. landfill inbound kg) · `OFFICIAL_INPUTS_DERIVED_VALUE`
(only if a rate scenario is ever built, labelled) · `PUBLIC_CONTRACT_TOTAL`
(KONEPS) · `CONTRACTUAL_DESTINATION` (only when a contract names it) ·
`UNVERIFIED` · `UNAVAILABLE`.

## Recommended build order

1. **Authorize** the three datasets (free 활용신청) + live-verify.
2. Ship **Feature 1** (metropolitan → landfill inbound flow) — the highest-value,
   fully-honest addition unlocked by this research.
3. Keep Features 2–3 on existing RCIS data; add landfill inbound only as labelled
   context.
4. Revisit Features 4–5 only after their explicit re-entry conditions are met.
5. Never build Feature 6.
