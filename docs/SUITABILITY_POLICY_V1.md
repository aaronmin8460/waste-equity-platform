# Suitability Screening Policy v1

`policy_version: suitability-policy-v1`
`derivation_version: suitability-screening-v1`
`candidate_grid_version: capital-grid-500m-v1`

> **Versioned successor — policy v2.** The current engine runs at
> `policy_version: suitability-policy-v2` / `derivation_version:
> suitability-screening-v3`. v2 is **purely additive**: it adds the data-derived
> `critic` weight profile and per-candidate weight-sensitivity stability, and
> leaves every rule in this document — the four **static** weight profiles
> (`baseline` is still the operational default and is **not** an expert/AHP
> result), the hard-exclusion and review rules, the component-score formulas, the
> road-distance curve, and all thresholds — **byte-for-byte unchanged**. This v1
> document is preserved as the historical explanation of those unchanged rules;
> the additive CRITIC/stability method is documented in
> [SUITABILITY_CRITIC_STABILITY.md](SUITABILITY_CRITIC_STABILITY.md).

> **Presentation-only transparency pass (Phase 0).** A separate Phase 0 changed only
> how this screening is *labelled and disclosed* to citizens — the disclaimer wording,
> the component **display** names (`토지이용 적합성` → `용도지역 호환성`; `도로 접근성` →
> `도로 근접성 대리지표`), the status **display** labels, and a "not yet modelled"
> disclosure. **No calculation in this document changed**: the four static weight
> profiles, the hard-exclusion and review rules, the component-score formulas, the
> road-distance curve, every threshold, and the `ELIGIBLE` / `REVIEW_REQUIRED` /
> `EXCLUDED` backend enum values are **byte-for-byte unchanged**, and no
> `policy_version` / `derivation_version` was bumped for it. See
> [SUITABILITY_PHASE_0_TRANSPARENCY.md](SUITABILITY_PHASE_0_TRANSPARENCY.md).

This document is the **project-approved analytical screening policy** for the
Phase 5.4 waste-facility suitability screen over the Seoul Metropolitan Area
(Seoul / Incheon / Gyeonggi-do). It records every classification, exclusion,
penalty, weight, normalization, and threshold used by the suitability engine, so
no screening result reaches a user without a documented, versioned rationale.

The machine-readable form of this policy is
`backend/src/waste_equity_backend/analysis/suitability/policy.py`. That module is
the single registry the engine, API, and tests read; this document describes it.
The two must always agree — a `SuitabilityPolicyConsistencyError` / test failure
is raised if they diverge, and any change to either requires a version bump
(§ Versioning).

## 1. What this is — and is NOT

The suitability screen is an **analytical decision-support screen**, not a legal,
permitting, engineering, or final siting decision. Concretely:

- A candidate status of `ELIGIBLE` means **"passes the v1 analytical screening
  rules"** — it is *not* "legally eligible", "permitted", "approved", or
  "developable". Every API response and UI surface labels it as analytical
  screening only and never emits a legal-eligibility boolean.
- A candidate status of `EXCLUDED` is a `PROJECT_SCREENING_EXCLUSION` — a project
  policy choice to screen out a location that intersects a chosen constraint
  layer. It is **not** a statutory prohibition. The underlying layers cite law
  names (개발제한구역, 상수원보호구역, 습지보전법, 산림보호법, 국토계획법,
  교육환경보호법, 국가유산) but the audited datasets do **not** carry the article
  -level statutory effect, so no statutory determination is claimed.
- A boundary intersection with a road line never proves truck accessibility,
  route capacity, legal entry, or turning feasibility. Distance-to-road is an
  access **proxy** only.
- Candidate cells are a **regional 500 m screening device**, never parcel-level.
  No claim is made about parcel ownership, availability, developability, or legal
  eligibility.
- `OFFICIAL_SOURCE_UNAVAILABLE` is never treated as a confirmed absence of a
  constraint (see §6).

This authorization covers analytical screening policy v1 only. It does not
authorize presenting the output as a permit decision, engineering certification,
final facility decision, or statutory determination.

## 2. Candidate statuses

Every candidate has exactly one status. Precedence is
`EXCLUDED` > `REVIEW_REQUIRED` > `ELIGIBLE`.

| Status | Meaning | Rank | Composite score |
| --- | --- | --- | --- |
| `ELIGIBLE` | passes all v1 screening rules and has all four components | official rank | full composite |
| `REVIEW_REQUIRED` | insufficient / ambiguous / unavailable / policy-sensitive information prevents automatic eligibility | **no** official rank; excluded from the default top-candidates list | **provisional** component breakdown + provisional score (clearly badged) |
| `EXCLUDED` | intersects a project-approved hard screening constraint | none | **none** (only exclusion reasons) |

These are analytical workflow statuses, not legal determinations. Unknown or
ambiguous values become `REVIEW_REQUIRED`; they never silently become `ELIGIBLE`.

## 3. Candidate geometry — `capital-grid-500m-v1`

A deterministic 500-meter square grid:

- Generated in **EPSG:5179** (Korea 2000 / Unified CS, meters) so cell dimensions
  are exactly 500 m × 500 m. Latitude/longitude degree grids are never used for
  area or distance.
- **Fixed grid origin**: the EPSG:5179 coordinate origin `(0, 0)`. Every cell
  edge falls on an integer multiple of 500 m in EPSG:5179 (`PostGIS ST_SquareGrid(500, …)`
  tiles from that origin), so the grid is reproducible independent of the data
  extent. A cell's stable index `(i, j)` = `(floor(x/500), floor(y/500))` in
  EPSG:5179.
- Covers the bounding extent of the union of the Seoul / Incheon / Gyeonggi
  **SIDO** boundaries (`regions`, `region_level='SIDO'`, latest `valid_from`).
- A cell is **retained** when its centroid lies inside or on the capital-region
  union (`ST_Covers(union, centroid)`).
- Retained cells are **clipped** to the capital-region union.
- Stored per candidate: stable `candidate_key` (`grid version + i_j`), original
  cell area (m², 250,000 for a full cell), clipped area (m²), clipped-area ratio,
  centroid, clipped geometry, containing SIDO, and containing SIGUNGU when the
  centroid resolves to exactly one SIGUNGU (else `REVIEW_REQUIRED`, see §6).
- Stored geometries and centroid are transformed to **EPSG:4326**.

The grid is a regional screening device, not parcel-level analysis. The clipped
-area ratio is exposed so a partial edge cell is visible, not silently treated as
a whole cell.

## 4. Hard-screening exclusions (`PROJECT_SCREENING_EXCLUSION`)

A candidate becomes `EXCLUDED` when its **clipped geometry has a non-zero-area
intersection** (`ST_Intersects` on the polygon, area > 0) with any of the layers
below whose official layer code is unambiguous. **Every** matching exclusion is
recorded independently — evaluation never stops after the first match.

| Layer code | Layer | Source table / column | Basis |
| --- | --- | --- | --- |
| `UD801` | 개발제한구역 (development-restriction / greenbelt) | `structural_protected_features.official_layer_code` | project screening |
| `UM710` | 상수원보호구역 (water-source protection) | `structural_protected_features` | project screening |
| `UM901` | 습지보호지역 (wetland protection) | `structural_protected_features` | project screening |
| `UF151` | 산림보호구역 (forest protection) | `structural_protected_features` | project screening |
| `WGISNPGUG` | 국립자연공원 (national natural park) | `structural_protected_features` | project screening |
| `UQ114` | 자연환경보전지역 (natural-environment conservation zoning) | `structural_features.official_zoning_code` | project screening |

Two hard-exclusion rules from the intended policy have **no matching data in the
ingested v1 datasets** and are therefore documented as inactive in v1 (never
silently applied, never faked):

- **Residential zoning subclass** → the ingested 용도지역 data is top-level only
  (UQ111–UQ114); it carries **no** 주거지역 residential subclass. A residential
  hard exclusion cannot be evaluated, so urban zoning is sent to `REVIEW_REQUIRED`
  instead (§5, §6). Not treated as eligible.
- **Absolute education-environment protection (`UO101` 절대보호구역)** → the
  ingested `UO101` rows do not carry a documented absolute/relative field (only an
  undecoded `mnum` substring that is not a validated attribute), so absolute
  protection cannot be reliably identified. `UO101` overlaps are sent to
  `REVIEW_REQUIRED` (§6), never auto-excluded.

These are project screening exclusions, not final statutory prohibitions.

## 5. Zoning classification registry

The ingested zoning (`structural_features`) resolves land use to the **top-level
용도지역 only** — UQ111 도시지역, UQ112 관리지역, UQ113 농림지역, UQ114
자연환경보전지역 (`official_zoning_code`/`official_zoning_name`). It does **not**
carry the sub-district (제1종/제2종주거, 상업, 공업, 녹지, 계획/생산/보전관리)
detail. The classification is therefore keyed on the top-level code, and the
consequences of that granularity are made explicit rather than guessed:

| Code | Name | Classification | Zoning score (0–100) | Status effect | Rationale |
| --- | --- | --- | --- | --- | --- |
| `UQ114` | 자연환경보전지역 | `HARD_EXCLUSION` | — | `EXCLUDED` (`PROJECT_SCREENING_EXCLUSION`) | conservation zoning; screened out |
| `UQ113` | 농림지역 | `SOFT_PENALTY_STRONG` | `25` | eligible-with-penalty | agricultural/forest land; strong zoning penalty, not excluded |
| `UQ112` | 관리지역 | `SOFT_PENALTY_MODERATE` | `55` | eligible-with-penalty | management zone; the outside-urban development-buffer where some facilities are permitted. Subtype (계획/생산/보전관리) is **unresolved** in the ingested data → moderate penalty with a documented subtype caveat |
| `UQ111` | 도시지역 | `URBAN_SUBCLASS_UNRESOLVED` | — | `REVIEW_REQUIRED` (`UNRESOLVED_URBAN_ZONING_SUBCLASS`) | urban area contains residential (a would-be hard exclusion), commercial, industrial, and green subclasses that are **not** distinguishable in the ingested NA_24 data. Cannot be auto-excluded (not provably residential) nor auto-eligible (not provably industrial) → review |
| (centroid in no zoning polygon) | — | `NO_ZONING_COVERAGE` | — | `REVIEW_REQUIRED` (`NO_ZONING_COVERAGE`) | zoning not resolvable at the cell |
| (code not in registry) | — | `UNMAPPED` | — | `REVIEW_REQUIRED` (`UNMAPPED_ZONING`) | never eligible automatically |

Consequence, documented plainly: because industrial-zone identification is not in
the ingested data, **no candidate can earn the industrial "high-compatibility"
zoning score in v1**. The maximum zoning score achievable in v1 is the management
level (55). Urban land goes to review. This caps zoning scores honestly rather
than inventing a subclass the data does not contain.

The zoning classification for scoring is taken at the **candidate centroid**
(single deterministic point → single zoning polygon → single class). The hard
exclusion for `UQ114` is separately evaluated as any-area intersection (§4), so a
candidate whose centroid is in UQ112 but whose cell clips a UQ114 polygon is
`EXCLUDED`.

## 6. Review-required policy

A non-excluded candidate is `REVIEW_REQUIRED` when **any** of the following holds
(all applicable reasons are recorded, not just the first):

| Review reason | Trigger |
| --- | --- |
| `UNRESOLVED_URBAN_ZONING_SUBCLASS` | centroid zoning is UQ111 도시지역 (residential/industrial subclass not distinguishable) |
| `NO_ZONING_COVERAGE` | centroid lies in no zoning polygon |
| `UNMAPPED_ZONING` | zoning code not in the registry |
| `EDUCATION_PROTECTION_UO101` | cell intersects `UO101` (absolute vs relative not documented — cannot confirm absolute; never auto-excluded) |
| `HERITAGE_PROTECTION_UO301` | cell intersects `UO301` 국가유산 지정/보호구역 (heritage / historical-environment; policy-sensitive, not a default hard exclusion) |
| `COVERAGE_GAP_<LAYER>` | a hard-exclusion layer has **no effective coverage** for the candidate's SIDO — some active dataset records it `OFFICIAL_SOURCE_UNAVAILABLE` and no active dataset evaluates it — so the candidate cannot be confirmed clear of that constraint |
| `AMBIGUOUS_OR_MISSING_SIGUNGU` | centroid does not resolve to exactly one SIGUNGU |
| `MISSING_EQUITY_COMPONENT` | the candidate's SIGUNGU has no usable facility-burden value |
| `MISSING_DEMAND_COMPONENT` | the candidate's SIGUNGU has no usable per-capita demand value |

The `COVERAGE_GAP` rule is the honest handling of `OFFICIAL_SOURCE_UNAVAILABLE`,
computed as **effective coverage** across the run's *active* protected dataset
versions (`derivation_version` `suitability-screening-v2`): a `(SIDO, layer)`
cell is a gap only when some active dataset records it
`OFFICIAL_SOURCE_UNAVAILABLE` **and** no active dataset evaluates it with a valid
source (`COMPLETE_WITH_FEATURES` / `COMPLETE_ZERO_FEATURES` /
`NATIONWIDE_SOURCE_EVALUATED`). So a newly obtained, approved official version can
satisfy coverage for a region/layer that an older, immutable version recorded as
unavailable — without that older record ever being modified — while a region/layer
that no active dataset evaluates stays a gap. Where a hard-exclusion layer has no
effective coverage, absence of an intersection is **not** evidence of absence of
the constraint, so the candidate is `REVIEW_REQUIRED` (coverage gap), never
`ELIGIBLE` on a false clear. Only active dataset versions contribute both the
protected-feature intersections and the coverage matrices read here, so the review
set follows the selected coverage exactly. As of release 202606 + the Gyeonggi
UM901 supplement, the remaining gaps are **Seoul `UM901`** and **Seoul `UF151`**
(no official source obtained); **Gyeonggi `UM901`** now has effective coverage.

## 7. Soft-screening, penalties, and informational display

Non-legal, transparent screening treatment (never a hard exclusion by default):

- `UQ113` agricultural/forest zoning → strong zoning penalty (score 25).
- `UQ112` management zoning → moderate zoning penalty (score 55), subtype caveat.
- `UQ111` unresolved urban subclasses → review (§6), not a silent penalty.
- `UO301` heritage → review flag (§6); no default composite penalty in v1.
- Optional `UM221` / `UQ162` layers are **not ingested** in v1; when present in a
  future version they are display/review or soft penalty only (documented then).
- Road proximity → accessibility **proxy** only (§8.2).
- Existing facility burden → equity component (§8.3).
- Waste generation → demand-context component (§8.4).

All classifications live in the single registry
(`analysis/suitability/policy.py`), never scattered through SQL or UI code. The
registry records, per entry: official layer code, normalized attribute condition,
classification, penalty/component value, rationale, legal-status disclaimer,
unknown-value behavior, source/provider, and source reference period.

## 8. Component scores (all dimensionless, `[0, 100]`)

### 8.1 Weights and profiles

Baseline weights (sum exactly `1.0`):

| Component | Weight | Rationale |
| --- | --- | --- |
| `zoning_compatibility` | `0.35` | land-use context is fundamental to screening — largest weight |
| `road_proximity` | `0.25` | supports operational access; does **not** prove truck accessibility |
| `equity_burden_avoidance` | `0.25` | prevents already-burdened communities from being favored |
| `waste_demand_context` | `0.15` | service-need context; must not dominate constraints or equity |

Sensitivity profiles (each sums to 1.0; no hidden weights):

| Profile | zoning | road | equity | demand |
| --- | --- | --- | --- | --- |
| `baseline` | 0.35 | 0.25 | 0.25 | 0.15 |
| `equal` | 0.25 | 0.25 | 0.25 | 0.25 |
| `equity_focused` | 0.30 | 0.15 | 0.40 | 0.15 |
| `access_focused` | 0.25 | 0.40 | 0.20 | 0.15 |

### 8.2 Road proximity

Exact distance from the candidate **centroid** to the nearest accepted road
feature (`structural_line_features`, all 2,971,494 rows), measured with a
meter-correct geodesic operation over EPSG:4326 `geography`, using the GiST
index for a KNN prefilter (`<->` nearest-neighbour) followed by the exact
`ST_Distance(geography, geography)`. No Python loop over road features. No truck
-access / capacity / legal-entry claim. Nearest-road dataset, layer, and distance
are exposed. Road classification is not used to rank in v1 (표준노드링크 road
-class field reliability is unvalidated); it may populate a separate informational
field only.

Distance-score curve (stored in the registry):

| Distance (m) | Score |
| --- | --- |
| 0–250 | 100 |
| 250–1,000 | linear 100 → 70 |
| 1,000–3,000 | linear 70 → 20 |
| 3,000–5,000 | linear 20 → 0 |
| > 5,000 | 0 |

### 8.3 Equity burden avoidance

Reuses the Phase 5.2 facility-burden derivation (`facility-burden-v1`). The
selected burden metric is the **located** facility-burden per capita (kg/인/년)
for the candidate's SIGUNGU — facilities whose canonical `region_id` is the
SIGUNGU, summed throughput (`FACILITY_LOCATION_BASED_THROUGHPUT`, 톤/년) ÷ SIGUNGU
population, per `facility-burden-v1`. Lower existing burden → higher avoidance
score, via a deterministic percentile normalization over the SIGUNGU burden
distribution: `equity_score = 100 × (1 − percentile_rank(burden))`, so the lowest
-burden SIGUNGU scores near 100 and the highest near 0. Ties share a rank
deterministically.

Exposed raw provenance: the original located burden value, unit (kg/인/년),
`accounting_basis = FACILITY_LOCATION_BASED_THROUGHPUT`, facility `source_id`, and
reference period. This burden term is **never** added to, differenced from, or
ratioed against the demand term (§8.4) — only the two dimensionless normalized
scores are combined. A candidate whose SIGUNGU has no usable burden value is
`MISSING_EQUITY_COMPONENT` → `REVIEW_REQUIRED` (never zero-filled).

### 8.4 Waste demand context

Reuses the Phase 5.1 per-capita waste-generation indicator (`per-capita-v1`),
`HOUSEHOLD` stream (the headline residential-burden proxy), for the candidate's
SIGUNGU: generation (`ORIGIN_BASED_TREATMENT_OUTCOME`, 톤/년) × 1000 ÷ population,
kg/인/년. Higher service-need context → higher demand score, via the same
deterministic percentile normalization over the SIGUNGU household per-capita
distribution: `demand_score = 100 × percentile_rank(per_capita)`.

Exposed raw provenance: the original per-capita value, unit (kg/인/년),
`accounting_basis = ORIGIN_BASED_TREATMENT_OUTCOME`, waste `source_id`, and
reference period. The origin-based accounting basis is kept distinct from the
facility-location basis in §8.3 — they are never merged, and no waste
origin-to-destination flow is implied. A candidate whose SIGUNGU has no usable
per-capita value is `MISSING_DEMAND_COMPONENT` → `REVIEW_REQUIRED`.

### 8.5 Composite

For candidates that are not excluded:

```
weighted_score = zoning_score  × zoning_weight
               + road_score    × road_weight
               + equity_score  × equity_weight
               + demand_score  × demand_weight
```

- Exact deterministic arithmetic in Python `Decimal`; each component score is
  quantized to 4 decimals and the weighted total to 4 decimals with
  `ROUND_HALF_EVEN`. No binary float touches a stored score.
- Score bounded to `[0, 100]`; never negative.
- No score is produced when any mandatory component is absent — the candidate is
  `REVIEW_REQUIRED` and receives a **provisional** score only from the components
  that are present, clearly badged, never an official rank.
- Raw component inputs and normalized component scores are stored **separately**.
- The full weight profile is stored with every analysis run.

### 8.6 Ranking and tie-breaking

Only `ELIGIBLE` candidates receive an official rank. Ranking is by descending
total score for the active profile; ties are broken deterministically by
ascending `candidate_key` (stable, grid-derived). The same rule produces the same
ranking on every run. `REVIEW_REQUIRED` candidates get a provisional score but no
rank and are excluded from the default top-candidates list; `EXCLUDED` candidates
get neither.

All four profiles' totals and ranks are computed and stored per candidate at
build time (the component scores are profile-independent; only the weighted total
differs), so the sensitivity analysis and API re-weight deterministically without
recomputing the spatial components.

## 9. Provenance and reference periods

Every component carries its source and reference period:

- zoning: `vworld_structural`, 용도지역지구도 (LSMD/NA_24), reference `2026-06-01`,
  `structural_dataset_versions` id 18.
- protected: `vworld_structural`, LSMD 용도구역·보호구역 (`2026-06-01`) + KNPS
  국립공원 (`2023-12-31`), version ids 62 (LSMD) + national-park version.
- roads: `vworld_structural`, NGII 도로중심선 (`2024-04-18`, EPSG:5179) + ITS
  STDLINK (`2026-07-01`, EPSG:5186), version ids 77 + 100.
- equity: `waste_statistics` facility throughput + `sgis` population, 2024.
- demand: `waste_statistics` generation + `sgis` population, 2024.

The exact ingested dataset-version ids and reference periods are captured in the
analysis run's `input_dataset_version_ids` and `input_provenance` at build time
(not hard-coded), so a run is reproducible against the same inputs.

## 10. Versioning

Any change to candidate geometry, classification, scoring, normalization,
weights, thresholds, or exclusions **must** bump the relevant version:

- `candidate_grid_version` — grid size / origin / retention / clipping change.
- `policy_version` — classification, exclusions, review rules, penalties, weights,
  profiles, or the distance curve change.
- `derivation_version` — the scoring/normalization/coverage computation changes.
  Bumped to `suitability-screening-v2`: coverage gaps became effective coverage
  and structural screening/inputs are restricted to active dataset versions. The
  policy registry (codes, weights, curves, thresholds) did not change, so
  `policy_version` stays `suitability-policy-v1`.

The analysis run records all three plus an `analysis_signature` (a sha-256 over
policy version, grid version, reference year, boundary vintage, input structural
dataset-version ids, population/waste/facility reference periods, derivation
version, and active weight profile). An identical signature is idempotent: it
reuses the existing run and writes zero new candidates. A changed input or policy
produces a distinct signature and a distinct run — earlier runs are never
overwritten.

## 11. Limitations (v1)

- Regional 500 m screening device; not parcel-level; no ownership /
  developability / legal-eligibility claim.
- Zoning is top-level 용도지역 only; no residential/industrial subclass → no
  industrial high-compatibility score and urban land is review, not eligible.
- Wetland (`UM901`) and forest (`UF151`) coverage has no effective coverage for
  **Seoul `UM901`/`UF151`** → those candidates are `REVIEW_REQUIRED` (coverage
  gap), which concentrates the `ELIGIBLE` set where coverage is complete. Gyeonggi
  `UM901` is now covered by the approved LSMD supplement (a coverage gap no
  longer); Gyeonggi `UF151` was already covered.
- Road proximity is an access proxy only; no truck-accessibility claim.
- Waste statistics cover 57–59 of 79 SIGUNGU per stream (2024); demand-missing
  SIGUNGU are review, never interpolated.
- Burden uses total resident population denominators (no daytime/service
  population).
- Real-time weather/air-quality is not used as siting evidence.
- No mock, estimated, fallback, or generated value is ever presented as public
  data or as a screening result.

## 12. Live results (2026-07-13)

The first production run (`suitability-build --reference-year 2024 --profile
baseline --write`) over the real capital-region PostGIS database:

- **Candidates:** 47,893 (500 m cells whose centroid is inside the capital
  region). **1,099 ELIGIBLE · 34,534 REVIEW_REQUIRED · 12,260 EXCLUDED.**
- **Inputs:** structural dataset versions zoning 18, protected 62 + 63, roads 77
  + 100; population/waste/facility reference period 2024; boundary vintage 2024.
- **Exclusion reasons** (a cell may match several): UD801 6,781; UF151 3,118;
  UQ114 1,821; WGISNPGUG 1,033; UM710 1,016; UM901 337.
- **Review reasons:** COVERAGE_GAP_UM901 32,064; UNRESOLVED_URBAN_ZONING_SUBCLASS
  10,240; EDUCATION_PROTECTION_UO101 7,284; NO_ZONING_COVERAGE 4,278;
  MISSING_DEMAND_COMPONENT 4,283; COVERAGE_GAP_UF151 1,396; HERITAGE_PROTECTION_
  UO301; AMBIGUOUS_OR_MISSING_SIGUNGU; MISSING_EQUITY_COMPONENT 455. Because
  wetland (UM901) coverage is `OFFICIAL_SOURCE_UNAVAILABLE` in Seoul and
  Gyeonggi, the `ELIGIBLE` set is concentrated in Incheon (full coverage) — an
  honest consequence of the data gaps, not a claim that Seoul/Gyeonggi are
  unsuitable.
- **Idempotency:** an identical second write reused the run and inserted 0
  candidates (~2.7 s vs ~6 min for the first build).
- **Integrity:** all candidate geometry is valid EPSG:4326 MultiPolygon (0 null,
  0 empty, 0 invalid); 0 duplicate candidate keys; all scores in [0,100]; every
  eligible candidate carries four components + provenance; ranks 1..1,099 are
  contiguous; production zoning/protected/road counts unchanged.
- **Hand-checks:** the top candidate (인천 강화군, UQ112 management zoning →
  zoning 55; geodesic nearest road 54.544 m → road 100; lowest-burden SIGUNGU →
  equity 100; lowest household per-capita → demand 0; total 69.25) reproduces
  exactly against the stored inputs; a sampled excluded cell truly intersects its
  UD801 layer; coverage-gap review cells are only in Seoul/Gyeonggi.
- **Sensitivity (four profiles):** the eligible set is identical across profiles
  (only the ranking changes). Spearman rank correlation vs baseline: equal
  0.939, equity-focused 0.861, access-focused 0.939. Top-set stability is **low**
  — the baseline top-10/top-50 overlap is 0 with the equal and access-focused
  profiles (the demand=0 rural leaders drop when demand/road weight rises), so
  the leading candidates are **not** robust to weight choice; all top-50 fall in
  Incheon under every profile. This is reported as-is; rank similarity is not
  taken as robustness.

---

## Cross-reference: user-weight scenario lab (Phase 6)

A read-only **user-weight scenario** feature lets citizens temporarily recombine the
four component scores (zoning/road/equity/demand) of a fixed succeeded run under their
own weights. It introduces **no new stored derivation** — it does not alter status
resolution, exclusions, review rules, component formulas, the distance curve, any
threshold, or the stored profiles — so it carries its **own** method version
`user-weight-scenario-v1` and does **not** bump `suitability-policy-v2`,
`suitability-screening-v3`, `critic-weights-v1`, `suitability-stability-v1`, or
`capital-grid-500m-v1`. A user scenario is never added to `SUPPORTED_PROFILES`,
`STATIC_WEIGHT_PROFILES`, or `DATA_DERIVED_PROFILES`. See
`docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md`.
