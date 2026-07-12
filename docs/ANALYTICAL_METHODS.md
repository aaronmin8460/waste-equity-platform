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

## Accounting Bases Are Never Merged

`ORIGIN_BASED_TREATMENT_OUTCOME` (how a region's own generated waste was
treated) and `FACILITY_LOCATION_BASED_THROUGHPUT` (what facilities located in
a region processed) answer different questions. They live on separate
endpoints, are labeled per item, and must never be summed, differenced, or
ratioed against each other. Waste origin-to-destination movement is not
inferred from them; it may only ever come from a source that explicitly
provides it (none is ingested).

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
