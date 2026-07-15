# Analytical Methods, Assumptions, And Review Workflow

This document is the registry of every derived analytical indicator the
platform serves, the assumptions and spatial methods behind them, the rules
for weighting, and the review workflow an analytical output must pass before
it is served. It exists so that no derived number reaches a user without a
documented method, source, and caveat trail.

Derived indicators are decision-support outputs. They are never final siting
decisions and never a substitute for legal, environmental, engineering, or
community review.

## Indicator Registry

Every served indicator has a `derivation_version`. Any change to a formula,
unit handling, exclusion rule, or precision must bump the version and update
this registry in the same change.

### PER_CAPITA_WASTE_GENERATION (`per-capita-v1`)

- Endpoint: `GET /api/v1/equity/waste-per-capita` (Phase 5.1)
- Formula: `generation_quantity[톤/년] × 1000 ÷ population[persons]`,
  served in kg/인/년.
- Numerator: RCIS regional grand-total generation per waste stream
  (`regional_waste_statistics`), accounting basis
  `ORIGIN_BASED_TREATMENT_OUTCOME`, annual.
- Denominator: SGIS total population (`regional_population`), annual.
- Arithmetic: exact `Decimal`, quantized to six decimal places
  (`ROUND_HALF_EVEN`), matching the storage scale of the source quantities.
  No binary floating point touches served values.
- Availability: a reference year is served only when both datasets have rows
  for it (intersection of years).
- Exclusions (reported in `excluded_regions`, never zero-filled):
  `NO_POPULATION_DENOMINATOR`, `AMBIGUOUS_POPULATION_DEFINITION`,
  `ZERO_POPULATION`, `UNEXPECTED_QUANTITY_UNIT` (only 톤/년 is converted;
  anything else refuses).
- Caveats: the indicator is a residential-burden proxy. Business
  (non-facility), industrial-facility, and construction streams are driven by
  workplace and site activity in the region, so their per-capita values carry
  an interpretation caveat in the UI.

### FACILITY_BURDEN (`facility-burden-v1`)

- Endpoint: `GET /api/v1/equity/facility-burden` (Phase 5.2)
- Formula: `sum(throughput_quantity[톤/년]) × 1000 ÷ population[persons]`,
  served in kg/인/년, for two documented facility sets per SIGUNGU:
  - **Located**: facilities whose canonical `region_id` is the region.
    Includes name-crosswalk matches without coordinates.
  - **Within buffer**: facilities with official VWorld coordinates within
    5,000 m geodesic distance of the region boundary (`ST_DWithin` over
    EPSG:4326 geography; facilities inside the region are distance zero).
- Numerator: RCIS facility throughput (`waste_treatment_facilities`),
  accounting basis `FACILITY_LOCATION_BASED_THROUGHPUT`, annual.
- Denominator and arithmetic: identical to `per-capita-v1`.
- Coverage gaps are served, never hidden: envelope-level counts of
  facilities without coordinates (absent from the buffer measure) and
  without a canonical region (absent from the located measure); per-region
  `*_missing_throughput_count` and `*_throughput_is_partial` flags whenever
  a facility's throughput was missing or in an unexpected unit (the row is
  counted, never estimated into the sum).
- Zeros for facility-free regions are real observed absences.
- Guards that fail visibly instead of serving a wrong number:
  `CRS_MISMATCH` (a region boundary not recorded as EPSG:4326 is refused
  before distance is measured) and `MIXED_PROVENANCE` (facility rows that
  disagree on source, period, or basis are refused as one aggregate).

### SUITABILITY_SCREENING (`suitability-screening-v1`) — Phase 5.4

- Endpoints: `GET /api/v1/suitability/*` (policies, runs, latest, summary,
  candidates, candidate detail).
- The first served **weighted composite**, adopted under the project-approved
  analytical screening policy v1 (`docs/SUITABILITY_POLICY_V1.md`,
  `policy_version: suitability-policy-v1`, `candidate_grid_version:
  capital-grid-500m-v1`). It screens a deterministic 500 m candidate grid over
  Seoul/Incheon/Gyeonggi for waste-facility siting decision support.
- Composite: `Σ (component_score × weight)` over four dimensionless `[0,100]`
  components — zoning compatibility (0.35), road proximity (0.25), equity burden
  avoidance (0.25), waste demand context (0.15) — in exact `Decimal`
  (`ROUND_HALF_EVEN`, 4 dp). Weights sum to 1.0; three alternative sensitivity
  profiles (equal / equity-focused / access-focused) are served for robustness.
- Components reuse existing derivations without merging accounting bases: equity
  reuses `facility-burden-v1` (`FACILITY_LOCATION_BASED_THROUGHPUT`, located per
  SIGUNGU, lower burden → higher score) and demand reuses `per-capita-v1`
  (`ORIGIN_BASED_TREATMENT_OUTCOME`, HOUSEHOLD per SIGUNGU, higher → higher
  score); only the normalized dimensionless scores are combined, never the raw
  quantities. Zoning and road are structural-layer screens.
- Statuses are analytical: `ELIGIBLE` (official rank), `REVIEW_REQUIRED`
  (provisional score, no rank), `EXCLUDED` (`PROJECT_SCREENING_EXCLUSION`, no
  score). `ELIGIBLE` is never "legally eligible"; no legal-eligibility boolean is
  emitted. `OFFICIAL_SOURCE_UNAVAILABLE` coverage is `REVIEW_REQUIRED`, never a
  confirmed absence. Full classification/exclusion/review/weight registry and
  live counts: `docs/SUITABILITY_POLICY_V1.md`.
- Live result (2026-07-13, reference year 2024): 47,893 candidate cells —
  **1,099 ELIGIBLE / 34,534 REVIEW_REQUIRED / 12,260 EXCLUDED**; identical second
  write is idempotent (0 new candidates); all candidate geometry valid EPSG:4326
  MultiPolygon (0 null/empty/invalid), 0 duplicate keys, all scores in [0,100];
  the eligible set is profile-invariant with high rank correlation (Spearman
  0.86–0.94) but a top set that is **not** robust across profiles (baseline
  top-50 overlap 0 with equal/access) — reported honestly, never claimed robust.
  Hand-checks (zoning class, geodesic nearest-road distance, equity/demand
  percentile) reproduce the served values against the stored inputs. Spatial
  work is set-based PostGIS (`ST_SquareGrid`, GiST nearest-road KNN, bounding-box
  viewport queries); a full build is ~6 minutes.

### LANDFILL_EFFECTIVE_FEE_PER_TONNE (`landfill-effective-fee-v1`) — V2 Phase 1

- Endpoints: `GET /api/v1/landfill/*` (summary, trends, composition, flows).
- Formula: `inbound_fee_krw ÷ (quantity_kg ÷ 1000)`, served in `KRW/톤`, exact
  `Decimal` (`ROUND_HALF_EVEN`, 2 dp). Returns `null` when quantity is zero.
- Inputs are two **official reported values** on one 1:1-joined row of
  `landfill_inbound_monthly`: inbound quantity (`OFFICIAL_REPORTED_VALUE`,
  odcloud `15064381`, kg) and inbound fee (`OFFICIAL_REPORTED_VALUE`, odcloud
  `15064394`, KRW). The ratio, plus monthly/annual totals and origin/waste
  shares, are `OFFICIAL_INPUTS_DERIVED_VALUE`.
- Accounting basis: `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` — a
  verified metropolitan-origin → single-destination inbound flow (the only
  source-declared origin→destination flow the platform ingests). It is **never**
  merged with the two bases below.
- Availability: the default reporting period is the latest complete year (12
  present months), derived from stored data, never hardcoded; a partial year is
  labelled `is_complete_year=false` with `available_through_month`.
- Caveats (served): origin is metropolitan-only (서울시/인천시/경기도), never
  disaggregated to a city/district; `반입수수료` is a reported inbound fee, not
  transport-only cost or total waste-management cost. Full method:
  `docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md`.

### LANDFILL_INBOUND_FEE_PER_CAPITA (`landfill-fee-per-capita-v2`) — V2 Phase 3

Supersedes `landfill-fee-per-capita-v1`, which divided the fee by the **SGIS
annual** population of the same reference *year*. v2 changes **both** the
denominator source and the temporal alignment, so the version is bumped rather
than silently redefined. v1 is retired; nothing serves it.

- Endpoint: `GET /api/v1/landfill/summary` — served as the nested
  `fee_per_capita` object on the response envelope (the all-origin aggregate) and
  on every `origin_shares[]` row (the per-metropolitan value).
- Korean metric name: **주민 1인당 환산 반입수수료** (an analytical conversion —
  never a resident's actual payment, bill, or tax burden).
- Formula: `inbound_fee_krw(선택 기간) ÷ population[persons](필요한 기준월)`, served
  in `KRW/인` (KRW per person), exact `Decimal` (`ROUND_HALF_EVEN`, 2 dp) — the
  same precision as the fee itself. The denominator is converted with
  `Decimal(int)`, so no binary float touches a served value.
- Numerator: the official reported `반입수수료` for **exactly** the selected
  filters (year or month × origin × waste type) — `OFFICIAL_REPORTED_VALUE`,
  odcloud `15064394`. A waste-type filter narrows the numerator to that type.
- Denominator: **MOIS monthly resident-registration population** — 행정안전부
  주민등록 인구통계, dataset 행정동별 주민등록 인구 및 세대현황
  (`source_id = mois_resident_population`, `population_definition =
  MOIS_RESIDENT_REGISTRATION_TOTAL`, `population_temporal_granularity =
  MONTHLY`, `unit = persons`), month-end, for the matching metropolitan `SIDO`
  region — `OFFICIAL_REPORTED_VALUE`. Definition: `전체 = 거주자 + 거주불명자 +
  재외국민`, 외국인 제외 (verified arithmetically against the source). The ratio is
  `OFFICIAL_INPUTS_DERIVED_VALUE`. Full source contract, era evidence, and
  ingestion: `docs/MOIS_POPULATION_2008_2026.md`.
- **Exact-period rule (mandatory).** A value is derived *only* when the MOIS
  population exists for exactly the month the selected period requires
  (`required_population_month`, served). The previous month, the next month,
  December, the latest month, the nearest month, and any other year are **never**
  substituted. **SGIS rows are excluded in SQL** and can never act as a landfill
  fallback; SGIS remains the Equity/reporting denominator, unchanged.
- **Required denominator month:**
  - a **selected month** → that exact `YYYY-MM`;
  - a **complete** landfill year → `YYYY-12` (December month-end of the same year);
  - a **partial** landfill year → the **final month actually included in the fee
    numerator**. MOIS may publish a month later than the landfill fee data covers
    (live: MOIS through 2026-06, landfill through 2026-05); borrowing it would
    divide a partial-year fee by a population from outside that period, so the
    denominator is **never** allowed to post-date the numerator.
- **All-origin aggregation.** `Σ fee(서울+인천+경기) ÷ Σ same-month
  population(서울+인천+경기)` — a population-weighted ratio. The three per-origin
  values are **never averaged** (a mean would reweight the regions as if equal in
  size; live 2024 annual: aggregate 4,153.03 vs. mean-of-three 4,416.59).
  Coverage must be complete: if any included origin lacks the required
  denominator the aggregate is `null` with `INCOMPLETE_POPULATION_COVERAGE`, never
  a partially covered number. When *every* origin fails identically, the shared
  reason is reported instead (more precise than "incomplete").
- Unavailability vocabulary (served as `unavailable_reason`; value is `null`,
  never `0`): **`NO_MATCHING_POPULATION_PERIOD`** (the origin has population, but
  not for the exact required month — v2 never describes a missing month as a
  missing *year*), `NO_METROPOLITAN_POPULATION` (no accepted SIDO population row
  for that origin), `ZERO_POPULATION` and `AMBIGUOUS_POPULATION_DEFINITION`
  (reused verbatim from the `per-capita-v1` / `facility-burden-v1` exclusion
  vocabulary; competing accepted denominators are refused rather than silently
  resolved — identical duplicate rows from different boundary vintages are *not*
  ambiguous), and `INCOMPLETE_POPULATION_COVERAGE` (aggregate only).
- **Longitudinal comparability limit (served, not only documented).** The MOIS
  total-population definition changed twice inside the covered window —
  거주불명자 included from **2010-10**, 재외국민 from **2015-01** (both boundaries
  confirmed against the official source, see `docs/MOIS_POPULATION_2008_2026.md`
  §3). A 2008 value and a 2024 value are therefore **not like-for-like**. Each row
  carries `population_definition_version` and `population_comparability_note`, and
  the dashboard shows the notice. This is a comparability limitation, never a
  reason to discard official data.
- **Coverage limit.** Landfill data starts 1999-08; MOIS population starts
  2008-01 (the earliest the official source offers, and the earliest this project
  is authorized to ingest). Landfill periods before 2008 serve `null` +
  `NO_MATCHING_POPULATION_PERIOD` — an honest gap, never back-filled.
- **Three-code-system crosswalk (reviewed).** MOIS 행정구역 codes, the canonical
  SGIS region codes, and the landfill origin codes disagree, and are **never**
  joined on numeric resemblance:

  | MOIS | Official name | Canonical SGIS region | Landfill origin |
  | --- | --- | --- | --- |
  | `1100000000` | 서울특별시 | `KR-SGIS-11` | `KR-SGIS-11` |
  | `2800000000` | 인천광역시 | **`KR-SGIS-23`** | **`KR-SGIS-28`** |
  | `4100000000` | 경기도 | **`KR-SGIS-31`** | **`KR-SGIS-41`** |

  **Only Seoul is 11 everywhere.** MOIS and the landfill fact table use standard
  administrative sido codes (11/28/41); the canonical `regions` rows ingested
  from SGIS use SGIS's own codes (11/23/31). Joining the code systems directly
  would resolve only Seoul and silently report Incheon and Gyeonggi as having no
  population. Every entry of both crosswalks is verified against the canonical
  region's official `region_name` before the population is used; an unexpected
  name refuses the denominator (`NO_METROPOLITAN_POPULATION`) rather than
  attaching a different region's population.
- Provenance served for both inputs: fee amount + `fee_reference_year` /
  `fee_reference_period` / `fee_period_complete` / `required_population_month`;
  and `population`, `population_reference_month`, `population_reference_year`,
  `population_reference_period`, `population_temporal_granularity`,
  `population_definition`, `population_definition_version`,
  `population_comparability_note`, `population_source_id`,
  `population_source_dataset_id`, `population_source_administrative_code`,
  `population_region_level`, `population_unit`, plus
  `included_origin_region_codes`, `unit`, `derivation_version`,
  `derivation_formula`, `evidence_status`, and `interpretation_caveat`
  (`caveat` retained as the v1-compatible alias).
- Caveat (served with every value): 선택 기간의 공식 반입수수료를 동일 기간 기준의
  해당 지역 인구로 나눈 분석용 환산값입니다. 개인의 실제 납부액이 아닙니다.
- Accounting basis: `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` for the
  numerator. The landfill fee is never combined with RCIS municipal generation,
  and this indicator is never compared against `per-capita-v1` (different bases,
  different units).

## Accounting Bases Are Never Merged

`ORIGIN_BASED_TREATMENT_OUTCOME` (how a region's own generated waste was
treated), `FACILITY_LOCATION_BASED_THROUGHPUT` (what facilities located in
a region processed), and `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW`
(official metropolitan → Sudokwon Landfill inbound flow) answer different
questions. They live on separate endpoints, are labeled per item, and must never
be summed, differenced, or ratioed against each other. In particular, landfill
inbound values are never combined with RCIS municipal generation to claim a
municipal dependency ratio. Waste origin-to-destination movement is inferred from
none of them; it only ever comes from a source that explicitly provides it — the
capital-region landfill inbound datasets (`15064381`/`15064394`) are the sole such
source ingested, and they are metropolitan-only.

## Spatial Methods

- All served geometry is EPSG:4326 (transformed from SGIS EPSG:5179 during
  Phase 2.1 ingestion, with the source and target CRS recorded per region
  row). The burden endpoint validates the recorded CRS before measuring.
- Distance is geodesic: `ST_DWithin` over `geography`, meters on the
  spheroid. Planar degree math is never used for distance.
- Performance prefilters must be provably conservative. The buffer join uses
  an `&&`/`ST_Expand` bounding-box prefilter (0.07°, ≥ 5.7 km everywhere at
  the platform's latitudes) so the GiST indexes prune candidates; the exact
  geography check still decides membership, so the prefilter can only cost
  speed, never correctness.
- Administrative boundaries are versioned (`valid_from`/`valid_to`); every
  spatial result is computed against the boundary vintage of its reference
  year so analyses are reproducible against the same geography.

## Weighting Policy

One weighted composite is served: `SUITABILITY_SCREENING`
(`suitability-screening-v1`, Phase 5.4), adopted under the project-approved
analytical screening policy v1 (`docs/SUITABILITY_POLICY_V1.md`). It satisfies
the adoption requirements below — per-weight rationale and sensitivity profiles,
the review workflow recorded in its PR, a distinct `derivation_version`, and
honest UI labeling as analytical screening (never a legal/permit determination).
All other served indicators remain single-derivation.

Adopting any weighted composite requires, before it is served:

1. A written rationale per weight in this document, including what the weight
   claims to represent and its sensitivity (how the ranking changes under
   reasonable alternative weights).
2. Constraint layers appropriate to the claim. A "suitability" score in
   particular is blocked until the minimum official constraint package in
   `docs/SUITABILITY_DATA_REQUIREMENTS.md` (land-use/zoning, protected-area,
   and road feature layers audited in Phase 2.5A) is production-ingested
   (see Phase 5.4); burden and demand indicators alone must not be presented
   as siting suitability. As of Phase 2.5B the capital-region package is
   production-ingested — zoning (88,252 features), protected/restricted areas
   (`structural_protected_features`), and road/road-network lines
   (`structural_line_features`) for Seoul/Incheon/Gyeonggi. These are **spatial
   screening layers**, not legal determinations: a boundary intersection (e.g.
   with a national-park screening polygon or a proximity buffer to a road line)
   flags a location for review and never proves a permitting outcome, legal
   protection status, or truck accessibility. Some official cells are documented
   `OFFICIAL_SOURCE_UNAVAILABLE` (the provider publishes no shapefile), which is
   distinct from a verified absence of the constraint on the ground.
3. The review workflow below, with the reviewer recorded in the PR.
4. A distinct `derivation_version` and clear UI labeling as a weighted,
   assumption-laden composite.

## Real-Time Data Rule

No real-time reading (air quality, weather, wind) is used in any served
indicator; AirKorea and KMA are not ingested (`CREDENTIAL_MISSING`). If they
are ingested later, real-time readings must be labeled as such and must never
be treated as permanent facility-siting evidence without a separately sourced
historical analysis.

## Review Workflow For Analytical Outputs

An analytical output (new indicator, changed derivation, new spatial method,
or any weighted composite) may only be merged when all of the following hold.
The PR description must record the checklist result; the phase status in
`docs/DEVELOPMENT_PHASES.md` records the completion evidence.

1. **Method documented** — this registry describes the formula, inputs,
   units, precision, exclusion rules, and caveats; `derivation_version` is
   new or bumped.
2. **Provenance served** — every item carries required source and
   reference-period fields for every input (dual provenance for two-source
   derivations); a row that cannot cite its sources fails response
   validation instead of being served.
3. **Bases unmerged** — no value mixes accounting bases; each is labeled.
4. **Gaps reported** — everything that could not be computed honestly is
   excluded with a served reason or counted as a coverage gap; nothing is
   zero-filled, estimated, or silently dropped; known undercounts are
   flagged partial.
5. **CRS validated** — spatial measures verify the recorded CRS before
   measuring; prefilters are provably conservative; boundary vintage matches
   the reference year.
6. **Tested** — analytical unit tests cover the math and edge cases (zero
   and missing denominators, unexpected units, empty sets); PostGIS
   integration tests cover data-bearing responses and spatial membership
   against seeded geometries; the structured 404/422 paths are covered.
7. **Checks green** — formatting, linting, strict type checking, and the
   full test suites pass in both packages; the Playwright live smoke passes,
   including the guard that no browser request leaves for a government API
   host.
8. **Live-verified** — the endpoint is exercised against the real database
   and at least one served value is hand-checked against the stored inputs;
   the result is recorded in the phase status.
9. **Honest UI** — the frontend labels the indicator as derived, shows both
   sources, reference periods, unit, and the served assumptions and caveats;
   real-time inputs (if ever used) are labeled real-time.

## Known Limitations (Current)

- Waste statistics cover 57–59 of the 79 SIGUNGU per stream (2024); regions
  without a served value render as "no data", never interpolated.
- 104 of 651 facilities have no official coordinates (geocode failed) and are
  absent from buffer measures; 2 facilities have no canonical region and are
  absent from located measures. Both counts are served per response.
- The 5,000 m buffer is a documented analytical choice, not a legal or
  environmental threshold; per-facility impact radii are not modeled.
- Population denominators are total resident population; daytime/service
  population is not available from the ingested sources.
