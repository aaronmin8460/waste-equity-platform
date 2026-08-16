# Suitability Successor — Phase 3 Real-Data Validation

> **Status: RESEARCH / EVIDENCE ONLY.** The successor model is **NOT ACTIVATED**.
> No successor run was written, no weight was persisted, no runtime source
> changed, no migration ran, no API behaviour moved, and no historical
> `zoning` / `road` / `equity` / `demand` value was read into a successor
> calculation or modified.
>
> Every weight vector in this document is a **research diagnostic**. None is
> approved, recommended, default, or production policy. Every distance floor is a
> **sensitivity probe**; in particular **2 km is not an approved default**. The
> land-cover classification used here is **RESEARCH-ONLY and NOT PRODUCTION
> POLICY**.
>
> Nothing here is a legal, permitting, engineering, environmental-review, or
> final siting determination.

Machine-readable evidence: [`phase3_evidence.json`](phase3_evidence.json)
(50 KB; every figure below is reproducible from it).

---

## 1. What this phase answers

Phase 2 implemented the four proposed successor components and proved they are
*internally* consistent. It could not say what they do on real data, because
nothing had ever computed them on real data. This phase does exactly that, and
only that.

The four components, unchanged from the Phase-2 contract:

| Component | Grain | Raw unit | Direction |
| --- | --- | --- | --- |
| `existing_burden` | SIGUNGU | `kg/인/년` | lower raw → better |
| `air_impact_proxy` | SIGUNGU | `kg/인/년` | lower raw → better |
| `resident_impact` | candidate cell | `persons/m` | lower raw → better |
| `land_conversion` | candidate cell | share of evaluated area | lower raw → better |

**`air_impact_proxy` is not emissions, not pollution concentration, not a
dispersion model, and not a health-risk estimate.** It is total reported waste
*generation* per resident. No air-quality dataset exists in this platform and the
proxy has never been validated against any measured air variable.

---

## 2. Exact data source

Read-only, local, no production contact of any kind.

| Property | Value |
| --- | --- |
| Source | Local PostGIS 16 / PostGIS 3.4, Docker volume `waste-equity-platform_pgdata` |
| Access | A separate read-only container (`default_transaction_read_only=on`), on its own network, not attached to any compose project |
| Schema version | alembic `0021` |
| Production contact | **none** — no SSH, no production query, no production credential |

The dev volume predates the Phase-2 successor migrations (`0022` run-level
identity, `0023` candidate-level `component_scores`). That is immaterial here:
this phase writes nothing and reads no successor column.

**One session setting was applied:** `work_mem = 256MB`. It is session-scoped and
planner-only — it touches no data, schema, or other connection. Without it the
3.8-million-pair aggregate spills to an external sort and takes minutes instead
of seconds.

### 2.1 Dataset snapshot and reference periods

| Dataset | Identity | Reference period |
| --- | --- | --- |
| Suitability run | id **47**, `SUCCEEDED`, `suitability-policy-v1` / `suitability-screening-v2` / `capital-grid-500m-v1` | created 2026-07-13 |
| Candidates | **47,893** | run 47 |
| Regions | **79 SIGUNGU**, 3 SIDO | — |
| Population | `SGIS_TOTAL_POPULATION`, annual, 79/79 SIGUNGU | **2024** |
| Facilities | `waste_treatment_facilities`, 651 rows | **2024** |
| Waste generation | `regional_waste_statistics`, 4 streams | **2024** |
| Land cover | `land-cover-cell-stats-v1`, statistics version 1, `EPSG:5186` | 47,893 cells |

All four components draw on the **same 2024 reference year**, so no cross-period
mixing occurs.

**Population denominator.** `regional_population` holds two non-interchangeable
series. Only the annual SGIS series has SIGUNGU resolution (79/79); the MOIS
monthly series covers the three SIDO only. The SIGUNGU series is used throughout
and the monthly series is never substituted for it.

Measured counts match the historical scale quoted for comparison (≈79 SIGUNGU,
≈47,893 candidates) exactly — but they were measured, not assumed.

---

## 3. Component coverage

| Component | Region coverage | Candidate coverage | Null share | Unavailability reasons |
| --- | --- | --- | --- | --- |
| `existing_burden` | **79/79** | 47,340 / 47,893 | 1.15% | 553 candidates carry no SIGUNGU code |
| `air_impact_proxy` | **57/79** | 38,592 / 47,893 | 19.42% | `MISSING_WASTE_STREAM` × 22 regions; 553 no-code candidates |
| `resident_impact` | n/a (cell-level) | **47,893 / 47,893** | 0.00% | none |
| `land_conversion` | n/a (cell-level) | 28,853 / 47,893 | 39.76% | `CLASS_AREA_EXCEEDS_DENOMINATOR` × 11,653; `NO_LAND_COVER_COVERAGE` + `NO_EVALUATED_AREA` × 7,387 |

**All four components are computable on real candidates.** None is structurally
undefined. But two of them lose a large, *systematically located* share of the
population, and one of those losses is not a data gap at all — see §5 and §7.

**553 candidates carry no `sigungu_region_code`.** They can never receive a
region-level component, whatever the missing-data policy says. This is a
candidate-geometry / region-attribution gap, not a source-data gap.

---

## 4. `existing_burden`

* **Numerator** `sum(throughput_quantity[톤/년]) × 1000`, reusing
  `facility_burden.aggregate_throughput` — the component cannot drift from the
  burden number the rest of the platform computes.
* **Denominator** resident population [persons], SGIS 2024.
* **Coverage** 79/79 regions.

| min | p10 | p25 | median | p75 | p90 | max | mean | std | var |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 86.66 | 319.08 | 476.68 | 2824.11 | 213.42 | 369.98 | 136,884.76 |

nulls **0** · zeros **27** · unique **53** · skew **+4.73** ·
warnings `HIGH_SKEW`, `EXTREME_OUTLIERS`

### The 27 zeros are not evidence of absence

27 of 79 regions report zero located throughput. Per the Phase-2 contract that is
an *available observation* (no located facility rows is an observed fact, not a
missing value) — and it is correct as specified. But **99 facility rows carry
`region_mapping_status = REQUIRES_GEOCODE` and no region at all.** A region
reading zero burden may genuinely have no facilities, or may have facilities
sitting in those 99 unattributed rows. The component cannot distinguish the two.

Because `existing_burden` is `LOWER_RAW_IS_BETTER`, **zero is the best possible
score**. A geocoding gap therefore promotes exactly the regions whose facility
inventory is least complete. This is not a defect in the component — it is a
prerequisite on the facility geocoding pipeline that must close before
`existing_burden` can carry weight in a production screen.

---

## 5. `air_impact_proxy`

* **Numerator** `HOUSEHOLD + BUSINESS_NON_FACILITY + INDUSTRIAL_FACILITY + CONSTRUCTION` [톤/년] × 1000.
* **Denominator** resident population [persons], SGIS 2024.
* **Reference period** 2024 for all four streams — no period mixing.
* **Missing stream is never zero.**

Per-stream region coverage: `HOUSEHOLD` 59 · `BUSINESS_NON_FACILITY` 59 ·
`CONSTRUCTION` 59 · `INDUSTRIAL_FACILITY` 57.

Stream combinations across the 79 regions:

| Combination | Regions |
| --- | --- |
| all four streams | **57** |
| three streams (no `INDUSTRIAL_FACILITY`) | 2 |
| **no streams at all** | **20** |

| min | p10 | p25 | median | p75 | p90 | max | mean | std | var |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 601.96 | 819.39 | 1151.94 | 2073.61 | 3445.35 | 5090.07 | 16995.89 | 2706.64 | 2440.44 | 5,955,745.12 |

nulls **22** · zeros **0** · unique **57** · skew **+3.63** ·
warnings `HIGH_SKEW`, `EXTREME_OUTLIERS`

### 5.1 The missingness is a geographic-grain mismatch, not random gaps

The 22 regions without a complete four-stream observation are not scattered. They
are, almost exactly, the **자치구 of the seven large Gyeonggi cities that RCIS
reports at CITY grain**:

| CITY reporting region | Child districts |
| --- | --- |
| 경기도 수원시 | 4 |
| 경기도 성남시 | 3 |
| 경기도 안양시 | 2 |
| 경기도 부천시 | 3 |
| 경기도 안산시 | 2 |
| 경기도 고양시 | 3 |
| 경기도 용인시 | 3 |
| **total** | **20** |

plus 인천광역시 옹진군 and 경기도 연천군 = **22**.

`reporting_region_waste_statistics` holds exactly 7 CITY-grain rows per stream
for these cities. Summing a CITY-grain value into a SIGUNGU total would mix
geographies, so the component refuses with `INCOMPATIBLE_GEOGRAPHIC_GRAIN` and
the districts stay unmeasured. **This is the component behaving correctly.** The
data is not missing — it exists at a coarser grain than the component's declared
unit.

### 5.2 Why this matters more than the count suggests

By SIDO: Seoul 25/25 regions complete, Incheon 9/10, Gyeonggi **23/44**.

The 22 unmeasured regions hold **6,349,306 residents of the capital region's
26,307,956 — 24.1% of the population**, and they are among its densest urban
jurisdictions. Any complete-case rule therefore removes roughly a quarter of the
capital region's residents from consideration, concentrated in Gyeonggi's largest
cities. That is an equity property of the *data pipeline*, not of the candidates.

Resolving this is a data-integration decision (disaggregate CITY to district, or
adopt a mixed-grain contract), and it is squarely inside the existing
`AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED` blocker.

---

## 6. `resident_impact`

* **Formula** `Σ population_r / max(distance_r, floor)`.
* **Geometry** real candidate centroids from `suitability_candidates.centroid`
  against `ST_PointOnSurface(regions.geometry)` — no screen, SVG, or synthetic
  coordinates anywhere.
* **Distance** geodesic metres, `ST_Distance(::geography)`.
* **Coverage** 47,893 / 47,893 candidates, 79 population units each
  (3,783,547 pairs). The candidate's own containing region is included, per the
  contract's `SELF_UNIT_EXCLUSION = False`.

### 6.1 The set-based derivation was verified against the module

The raw sums are derived set-based in PostGIS (which is what the contract
prescribes), not by a Python loop over 3.8 million pairs. To make sure the
published numbers are the contract's numbers, twelve candidates were pushed
through `resident_impact.observe()` in Python on identical inputs and compared:

**12 samples, 0 mismatches, agreement exact at the module's 10-dp quantization.**

### 6.2 Distance-floor sensitivity — RESEARCH ONLY, none approved

| Floor | floored pairs | candidates w/ any floored unit | min | p25 | median | p75 | p90 | max | mean | std |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 m | 245 | 245 | 126.45 | 486.43 | 635.36 | 954.86 | 1387.36 | **2704.30** | 773.19 | 394.96 |
| 1 km | 1,001 | 1,001 | 126.45 | 486.43 | 634.79 | 954.64 | 1382.18 | **2131.73** | 769.74 | 386.26 |
| 2 km | 3,970 | 3,921 | 126.45 | 486.09 | 633.51 | 948.69 | 1358.66 | **1945.60** | 762.85 | 373.47 |
| 5 km | 24,420 | 15,426 | 126.45 | 484.54 | 632.04 | 928.24 | 1288.69 | **1731.90** | 742.23 | 341.66 |

nulls 0 · zeros 0 · unique 47,893 at every floor. Only the 500 m floor trips an
`EXTREME_OUTLIERS` warning; the others are clean.

The floor is almost inert in the body of the distribution (the median moves 0.5%
across a tenfold change) and decisive in the tail (the maximum falls 36%). It is
a **tail-shaping parameter**, and the tail is exactly what a top-N screen reads.

### 6.3 Cross-floor rank stability

| Pair | Spearman | Top-10 | Top-50 | mean rank move | max move | moved > 1000 |
| --- | --- | --- | --- | --- | --- | --- |
| 500 m ↔ 1 km | 0.99977 | 10/10 | 50/50 | 50.5 | 8,961 | 388 |
| 500 m ↔ 2 km | 0.99870 | 10/10 | 50/50 | 199.2 | 14,823 | 1,282 |
| 500 m ↔ 5 km | 0.99560 | 10/10 | **33/50** | 577.9 | 20,979 | 4,917 |
| 1 km ↔ 2 km | 0.99939 | 10/10 | 50/50 | 154.9 | 7,076 | 1,239 |
| 1 km ↔ 5 km | 0.99660 | 10/10 | **33/50** | 541.3 | 14,636 | 4,548 |
| 2 km ↔ 5 km | 0.99832 | 10/10 | **33/50** | 420.6 | 7,898 | 3,315 |

Spearman is ≥0.9956 everywhere, which looks like near-perfect stability and is
**misleading at the scale that matters**: the same pairs move individual
candidates by up to 20,979 rank positions, and the 5 km floor replaces a third of
the top 50. A global rank correlation over 47,893 units is dominated by the
undisturbed middle.

### 6.4 The representative point is the deeper problem

`representative_point_audit` over all 79 regions:

* **2 regions have a centroid outside their own geometry**:
  **인천광역시 옹진군** (74 parts, centroid **99,650.7 m** from its
  point-on-surface) and **경기도 안산시 단원구** (13 parts, 11,353.0 m).
* Centroid↔point-on-surface separation: median 619.9 m, p90 2,387.2 m,
  max 99,650.7 m.
* Region equivalent-circle radius: min 1,522.6 m, median 3,625.8 m,
  mean **5,541.3 m**, max 16,705.4 m.

**Every research floor — including 5 km — is smaller than the average region's
own equivalent-circle radius.** The component resolves distance at 500 m–5 km
while the population it weights is known only as one number per region whose
typical radius is ~3.6 km. The apparent per-cell precision exceeds the resolution
of the data behind it, which is precisely what
`POPULATION_RESOLUTION_DISCLOSURE` exists to say.

This is not academic. **At every floor, the entire `resident_impact` top-50 sits
in a single region — 인천광역시 옹진군** (35/50 at 500 m–2 km, 44/50 at 5 km,
`distinct_regions = 1`). That is the archipelago whose representative point is
the least defensible of all 79. The component's best-scoring candidates are
exactly the ones where the geometry convention is weakest.

Choosing a floor before resolving the representative point and the population
resolution would be fitting a parameter to an artifact.

---

## 7. `land_conversion`

* **Raw value** share of the evaluated cell area that is **not** already
  developed (the conversion-exposed share). `developed_share` is recorded
  alongside it.
* **Denominator** `EVALUATED_AREA`.
* **Normalization** `BOUNDED_RATIO` (the component's default; unapproved).
* **Registry** supplied explicitly. `land_conversion.PRODUCTION_REGISTRY` **is
  and remains `None`**.

### 7.1 The registry used here is RESEARCH-ONLY

`registry_id = RESEARCH-ONLY-l2-first-digit-v0-NOT-PRODUCTION-POLICY`,
`approved = False`, class level **2 (중분류)**, 22 observed classes enumerated
**from the data**, not from an assumed taxonomy.

* **Developed** = the `1xx` 시가화·건조지역 grouping only
  (110 주거, 120 공업, 130 상업, 140 문화·체육·휴양, 150 교통, 160 공공시설).
  This is a reading of the source code structure, **not an authority's
  classification**.
* **Excluded from numerator and denominator** = `7xx` 수역 (710 내륙수, 720 해양수).
* **Flagged ambiguous** = 230 시설재배지, 420 인공초지, 620 인공나지, 710, 720 —
  each still resolved into exactly one bucket so the registry stays total, with
  the contested call recorded in every observation's provenance.

**This registry must not be used to produce, rank, or publish any candidate
result.** The approved registry is a separate lane's deliverable and remains
blocked.

### 7.2 Coverage

Coverage status across 47,893 cells: `COMPLETE_EXACT` 35,902 ·
`PARTIAL` 4,604 · `NO_COVERAGE` **7,387**.

**Genuine no-coverage: 7,387 cells = 15.42%.**

Available observations 28,853 (60.24%), partial 2,814, unavailable 19,040.

### 7.3 A 24.33% loss that is a precision artifact, not missing data

11,653 cells (24.33% of all candidates) were rejected with
`CLASS_AREA_EXCEEDS_DENOMINATOR`. That code exists to catch a structurally
impossible cell — a double-counted overlay or a mismatched denominator — and the
component correctly reports rather than clamps.

**These cells are not structurally impossible.** Recomputing the exact excess
from the component's own inputs:

| affected | min | median | p90 | **max** | mean | cells exceeding by > 1 m² |
| --- | --- | --- | --- | --- | --- | --- |
| 11,653 | 0.0 m² | 1.0 × 10⁻¹⁰ m² | 2.0 × 10⁻¹⁰ m² | **7.33 × 10⁻⁶ m²** | 1.3 × 10⁻⁹ m² | **0** |

The largest disagreement anywhere is **7.3 square micrometres**, against a
250,000 m² cell — a relative error of 3 × 10⁻¹¹. `evaluated_area_m2` and
`class_area_m2` are stored `double precision`; the successor contract does exact
`Decimal` arithmetic; the exact sum of the per-class doubles differs from the
separately-stored total double in the last unit in the last place. Confirmed
independently in SQL: the maximum exact-decimal excess across all 40,506 covered
cells is 0.00018 m².

**Consequence.** `land_conversion`'s *real* data gap is the 15.42% with no
coverage. The other 24.33% is an engineering defect at the float/exact-Decimal
boundary. Reporting 39.76% as "missing land-cover data" would overstate the gap
by a factor of 2.6 and understate the successor model's achievable population.

This is a genuine runtime-contract defect. **It was not fixed in this lane** —
this lane changes no runtime source. It is recorded as blocker **B16** in §12.

### 7.4 Distributions

Conversion-exposed share (the raw value):

| min | p10 | p25 | median | p75 | p90 | max | mean | std | var | skew |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.0 | 0.3550 | 0.6691 | 0.8710 | 0.9633 | 0.9985 | 1.0 | 0.7729 | 0.2529 | 0.06397 | −1.35 |

zeros 134 · unique 26,375 · no warnings.

Developed share (its complement over the non-water area):

| min | p10 | p25 | median | p75 | p90 | max | mean | std | var | skew |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.0 | 0.00041 | 0.02626 | 0.09552 | 0.25692 | 0.55029 | 1.0 | 0.18733 | 0.22776 | 0.05187 | +1.62 |

zeros (0% developed) **2,616** · 100%-developed cells present at the maximum ·
unique 26,229 · warning `EXTREME_OUTLIERS`.

The distribution is usable and strongly right-skewed in developed share: most
candidate cells are largely undeveloped, which is what a 500 m grid over the
capital region's periphery should look like.

### 7.5 Ambiguous-class exposure is nearly total

**26,795 of 28,853 available cells — 92.87% — touch at least one class whose
developed/not-developed assignment is contested:**

| Class | Name | Cells |
| --- | --- | --- |
| 420 | 인공초지 | 26,066 |
| 620 | 인공나지 | 24,411 |
| 710 | 내륙수 | 16,685 |
| 230 | 시설재배지 | 16,152 |
| 720 | 해양수 | 408 |

Almost every measurable cell rests on at least one unsigned-off classification
call. 620 인공나지 (artificial bare ground — frequently construction sites and
earthworks) is arguably the most "developed" non-`1xx` class and is classified
here as *not* developed; flipping it alone would move 24,411 cells. The
ambiguous-class policy is not a rounding detail — it is a primary driver of this
component's values.

### 7.6 Regional concentration of missingness

Land-cover unavailability spans all 79 regions but concentrates in the rural
periphery: 경기도 연천군 (2,337 cells, 12.27% of all missing),
경기도 파주시 (2,253, 11.83%), 인천광역시 강화군 (1,291),
경기도 양평군 (1,181), 경기도 가평군 (1,176).

---

## 8. Missing-data matrix

| Component | Source | Numerator | Denominator | Region cov. | Candidate cov. | Null % | Missing-reason categories |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `existing_burden` | `waste_treatment_facilities` + `regional_population` | `Σ throughput[톤/년] × 1000` | resident population | 79/79 | 47,340/47,893 | 1.15% | no SIGUNGU code ×553 |
| `air_impact_proxy` | `regional_waste_statistics` (4 streams) + `regional_population` | `Σ 4 streams [톤/년] × 1000` | resident population | **57/79** | 38,592/47,893 | 19.42% | `MISSING_WASTE_STREAM` ×22 regions (CITY-grain); no SIGUNGU code ×553 |
| `resident_impact` | `suitability_candidates.centroid` + `regions.geometry` + `regional_population` | `Σ pop / max(dist, floor)` | floored distance [m] | n/a | **47,893/47,893** | 0.00% | none |
| `land_conversion` | `..._cell_statistics` + `..._cell_class_areas` | non-developed class area [m²] | evaluated cell area [m²] | n/a | 28,853/47,893 | 39.76% | `NO_LAND_COVER_COVERAGE` ×7,387 (**real**); `CLASS_AREA_EXCEEDS_DENOMINATOR` ×11,653 (**precision artifact**) |

**Missing was never substituted with zero.** 48,051 observations were checked
across the three series that produce unavailable observations; **0 violations**.
Every unavailable observation carries at least one machine-readable reason code
and no value; no observation is both available and unavailable.

---

## 9. Staged eligibility shrinkage

Complete-case staging. **This is not a proposal to adopt
`STRICT_ALL_COMPONENTS_REQUIRED`** — the missing-component eligibility policy is
undecided, and screening eligibility remains a separate concept from ranking
score.

| Stage | Remaining | Removed here | Removed cumulative | Remaining share |
| --- | --- | --- | --- | --- |
| ALL CANDIDATES | 47,893 | — | 0 | 100.00% |
| → `existing_burden` | 47,340 | 553 | 553 | 98.85% |
| → `+ air_impact_proxy` | 38,592 | 8,748 | 9,301 | 80.58% |
| → `+ resident_impact` | 38,592 | 0 | 9,301 | 80.58% |
| → `+ land_conversion` | **24,064** | 14,528 | 23,829 | **50.25%** |
| **ALL FOUR COMPLETE** | **24,064** | — | 23,829 | **50.25%** |

**Complete-case eligibility halves the candidate population**, and — decisively —
**collapses regional coverage from 79 regions to 57**. Twenty-two SIGUNGU holding
24.1% of the capital region's residents disappear entirely, not because their
candidates scored badly but because a data grain does not match.

Regional concentration of the removed set: 경기도 연천군 (2,751),
경기도 파주시 (2,253), 경기도 용인시 처인구 (1,864), 인천광역시 강화군 (1,291),
경기도 양평군 (1,181) — plus all 553 candidates with no SIGUNGU code.

Retained set: 경기도 화성시 (2,363), 경기도 양평군 (2,309), 경기도 포천시 (2,240),
경기도 가평군 (2,141), 경기도 여주시 (1,752).

### 9.1 Counterfactual with the precision artifact set aside

**DIAGNOSTIC ONLY — not a proposed tolerance and not a policy.** Identical
staging, except the 11,653 cells removed by the sub-micrometre float boundary
(§7.3) are treated as measurable:

| Stage | Remaining | Removed cumulative | Remaining share |
| --- | --- | --- | --- |
| ALL CANDIDATES | 47,893 | 0 | 100.00% |
| → `existing_burden` | 47,340 | 553 | 98.85% |
| → `+ air_impact_proxy` | 38,592 | 9,301 | 80.58% |
| → `+ resident_impact` | 38,592 | 9,301 | 80.58% |
| → `+ land_conversion` | **33,980** | 13,913 | **70.95%** |

Fixing one precision defect would return **9,916 candidates** — raising
complete-case retention from 50.25% to 70.95%. It would **not** restore any of
the 22 missing regions: that gap is `air_impact_proxy`'s and is unaffected.

---

## 10. Distribution diagnostics summary

| Component | nulls | zeros | unique | std | variance | skew | Warnings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `existing_burden` | 0 | 27 | 53 | 369.98 | 136,884.76 | +4.73 | `HIGH_SKEW`, `EXTREME_OUTLIERS` |
| `air_impact_proxy` | 22 | 0 | 57 | 2,440.44 | 5,955,745.12 | +3.63 | `HIGH_SKEW`, `EXTREME_OUTLIERS` |
| `resident_impact` (500 m) | 0 | 0 | 47,893 | 394.96 | 155,995.53 | +1.28 | `EXTREME_OUTLIERS` |
| `resident_impact` (1 km / 2 km / 5 km) | 0 | 0 | 47,893 | 386.26 / 373.47 / 341.66 | 149,199 / 139,481 / 116,728 | +1.19 / +1.13 / +1.02 | none |
| `land_conversion` | 19,040 | 134 | 26,375 | 0.2529 | 0.06397 | −1.35 | none |

**No component is degenerate.** No zero-variance, no near-zero-variance, no
low-unique-value warning anywhere. Every component varies across its population.

Conventions: variance is **population** variance (÷n — these are complete
enumerations, not samples); percentiles use linear interpolation between closest
ranks.

**Transforms that the data suggests would be worth evaluating** — and which this
phase deliberately does **not** implement or recommend as policy:

* `existing_burden` (skew +4.73) and `air_impact_proxy` (skew +3.63) are heavily
  right-skewed with extreme outliers. Under `BOUNDED_RATIO` they would need
  clipping, robust scaling, or a log transform. Under `PERCENTILE_RANK` the skew
  is irrelevant — but that choice has its own cost, see §11.2.
* `existing_burden`'s 27 zeros (34% of regions) sit at the *best* end of a
  `LOWER_RAW_IS_BETTER` scale and are partly a geocoding artifact (§4).
* `land_conversion` is bounded, mildly left-skewed, and needs no transform.

---

## 11. Successor CRITIC viability — RESEARCH DIAGNOSTIC ONLY

> **NOT PRODUCTION WEIGHTS. NOT ACTIVATED. NOT PERSISTED.**

### 11.1 Historical CRITIC could not be reused, by construction

`critic.compute_critic_weights` iterates the module-level historical
`CRITERION_ORDER` literal and raises `KeyError` on a successor row. The refusal is
the designed behaviour: a stored CRITIC vector is a function of the variance and
correlation of *those* criteria in *that* run's population. No historical CRITIC
vector, weight, stability class, or saved scenario was reused or translated.

The research implementation mirrors the documented method exactly — population
standard deviation, `x = score / 100`, information value `σ_j · Σ_k (1 − r_jk)`,
weights normalized to 1 — so any difference is attributable to the data, not to a
changed method.

### 11.2 Result on the real complete-case population

Population **24,064**. Distinct values per component: `existing_burden` 51,
`air_impact_proxy` 57, `resident_impact` 24,064, `land_conversion` 21,328.
**No constant component. No zero variance. CRITIC is mathematically viable.**

Correlation matrix (research only):

| | `existing_burden` | `air_impact_proxy` | `resident_impact` | `land_conversion` |
| --- | --- | --- | --- | --- |
| `existing_burden` | 1.0000 | 0.4748 | −0.1505 | 0.0974 |
| `air_impact_proxy` | 0.4748 | 1.0000 | −0.3768 | 0.1744 |
| `resident_impact` | −0.1505 | −0.3768 | 1.0000 | −0.4704 |
| `land_conversion` | 0.0974 | 0.1744 | −0.4704 | 1.0000 |

Maximum |r| = 0.475. **No near-collinearity**; no pair is redundant.

**RESEARCH DIAGNOSTIC ONLY — NOT PRODUCTION WEIGHTS — NOT ACTIVATED:**

| Component | σ | information | weight |
| --- | --- | --- | --- |
| `existing_burden` | 0.2056 | 0.5302 | 0.17186125 |
| `air_impact_proxy` | 0.2385 | 0.6505 | 0.21085645 |
| `resident_impact` | 0.2786 | 1.1139 | **0.36106061** |
| `land_conversion` | 0.2471 | 0.7905 | 0.25622169 |

**These weights are not stored anywhere in runtime configuration and must not
be.**

### 11.3 The normalization hazard is visible in the real data

`resident_impact` earns the largest derived weight (0.361) and has the largest
standard deviation (0.2786) — because it is the only component percentile-ranked
across all 24,064 distinct candidate values, which hands CRITIC a near-uniform
distribution whose σ sits near the theoretical maximum. `land_conversion` uses
`BOUNDED_RATIO` and keeps its natural clustered shape.

This is exactly the failure mode the Phase-2 contract warned about: **a
normalization choice masquerading as a data-derived importance finding.** The
weight vector above is not evidence that resident exposure matters most; it is
partly evidence that percentile-ranking inflates σ. The normalization strategy
must be decided *before* any CRITIC derivation is meaningful.

### 11.4 CRITIC is stable against the distance floor

| Floor | `existing_burden` | `air_impact_proxy` | `resident_impact` | `land_conversion` |
| --- | --- | --- | --- | --- |
| 500 m | 0.17186125 | 0.21085645 | 0.36106061 | 0.25622169 |
| 1 km | 0.17182338 | 0.21082056 | 0.36121630 | 0.25613976 |
| 2 km | 0.17178639 | 0.21083605 | 0.36141475 | 0.25596281 |
| 5 km | 0.17179214 | 0.21090381 | 0.36181020 | 0.25549386 |

Weights move by < 0.0008 across a tenfold floor change — because percentile
ranking discards the magnitude changes the floor causes. Reassuring for CRITIC,
and another reminder that the percentile choice is doing heavy lifting.

---

## 12. Research-only ranking diagnostics

> **NEUTRAL MATHEMATICAL DIAGNOSTIC — equal weights (0.25 each). NOT approved,
> NOT recommended, NOT a default, NOT production policy.** No successor weight
> profile exists; a ranking diagnostic needs *some* vector, so the most neutral
> one is used and labelled.

Composite over the 24,064 complete-case candidates:

| min | p10 | median | p90 | max | mean | std | unique |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.43 | 18.88 | 30.70 | 47.85 | 74.82 | 31.92 | 10.69 | 23,860 |

No warnings; the composite is well spread and not degenerate.

### 12.1 Weight-perturbation sensitivity

Each component raised 0.25 → 0.40 with the others at 0.20:

| Upweighted | Spearman | Top-10 overlap | Top-50 overlap | mean rank move | max move |
| --- | --- | --- | --- | --- | --- |
| `existing_burden` | 0.9721 | 10/10 | 50/50 | 1,195 | 8,557 |
| `air_impact_proxy` | 0.9450 | 5/10 | 46/50 | 1,675 | 9,179 |
| `land_conversion` | 0.9287 | 8/10 | 39/50 | 1,992 | 11,410 |
| `resident_impact` | 0.8437 | **0/10** | **0/50** | 3,057 | 9,959 |

**A 0.15 weight shift onto `resident_impact` replaces the entire top 50.** Not
one candidate survives. Global Spearman stays at 0.84 — high enough to look
stable, and completely uninformative about the only part of the ranking a siting
screen would act on.

**Rankings are not stable under research-only diagnostics.** The identity of the
best candidates is currently a property of the weight vector, not of the data.

### 12.2 Regional concentration of the ranking

Under equal weights the top 50 spans **2 regions**:
서울특별시 광진구 (34) and 서울특별시 서대문구 (16). The top 500 spans 24 regions,
led by 경기도 양평군 (85), 서울특별시 영등포구 (74), 서울특별시 광진구 (45).

An extremely narrow head under a neutral vector, drawn from a population that
already excludes 22 regions, is a further reason not to read any current ranking
as a siting signal.

### 12.3 Eligibility is not ranking

Screening eligibility and ranking score are kept strictly separate throughout.
No weighted score was used as a pass/fail test, and changing a research weight
never redefined eligibility. All shrinkage in §9 is availability-driven only.

---

## 13. Policy-blocker register

All twelve blockers declared in `successor/policy.py` remain **OPEN**. Phase 3
supplies evidence for several; it resolves none. A favourable measurement is not
a decision.

| # | Blocker | Status | What Phase 3 adds |
| --- | --- | --- | --- |
| B1 | `SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED` (final successor weights) | **OPEN** | §12.1 shows the top-50 is entirely weight-determined. Weights must be justified analytically, never chosen by which ranking looks better. |
| B2 | `MISSING_COMPONENT_ELIGIBILITY_POLICY_UNDECIDED` (production missing-component policy) | **OPEN** | Complete-case costs 49.75% of candidates and 22 of 79 regions (24.1% of residents). §9.1 shows ~20 points of that is a fixable defect. |
| B3 | `RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED` | **OPEN** | §6.2–6.3: inert in the body, decisive in the tail; 5 km replaces a third of the top 50. **2 km is not a default.** |
| B4 | `LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE` | **OPEN** | `PRODUCTION_REGISTRY` is still `None`. Only a RESEARCH-ONLY L2 registry was used. |
| B5 | Ambiguous land classes | **OPEN** | §7.5: **92.87%** of measurable cells touch a contested class. 620 인공나지 alone affects 24,411 cells. |
| B6 | `AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED` (exact production air-impact contract) | **OPEN** | §5.1–5.2: the gap is a CITY-vs-SIGUNGU grain mismatch removing 22 regions and 6,349,306 residents. |
| B7 | `SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED` | **OPEN** | §11.3: percentile ranking demonstrably inflates `resident_impact`'s derived weight. Must be settled before CRITIC means anything. |
| B8 | `SUCCESSOR_CRITIC_STABILITY_METHOD_UNVALIDATED` (successor CRITIC contract) | **OPEN** | §11.2: CRITIC is *mathematically* viable (no zero variance, max \|r\| 0.475). Viability ≠ validity. |
| B9 | Successor stability contract | **OPEN** | Not measured. Stability requires an approved weight vector and normalization first. |
| B10 | Scenario version behaviour | **OPEN** | Untouched. Successor scenario recombination is still refused. |
| B11 | Production model-version behaviour | **OPEN** | Untouched. `SUCCESSOR_POLICY_VERSION` / `SUCCESSOR_DERIVATION_VERSION` remain `None`. |
| B12 | `SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED` (default-run resolution) | **OPEN** | Untouched. |
| B13 | Historical/successor coexistence | **OPEN** | Verified disjoint (§14). Coexistence *policy* is undecided. |
| B14 | Production switchover strategy | **OPEN** | Untouched. |
| B15 | `SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED` + migration/persistence implications | **OPEN** | Nothing was written. The dev DB is at `0021` and lacks `0022`/`0023`; any activation work must run on a migrated database. |
| B16 | **NEW — `land_conversion` float/Decimal boundary defect** | **OPEN (new)** | §7.3: `double precision` stored areas vs exact `Decimal` arithmetic rejects 11,653 cells (24.33%) for a ≤7.3 µm² disagreement. **Not fixed in this lane.** Owner: backend. |
| B17 | **NEW — `existing_burden` zeros are partly a geocoding gap** | **OPEN (new)** | §4: 99 facility rows are `REQUIRES_GEOCODE`; 27 regions read zero burden, the *best* value on a `LOWER_RAW_IS_BETTER` scale. Owner: ingestion. |
| B18 | **NEW — `PERCENTILE_RANK` is O(n²) at candidate scale** | **OPEN (new)** | `policy.percentile_ranks` scans linearly per key: ~2.3 × 10⁹ Decimal comparisons at n = 47,893, minutes of CPU per component per floor. Fine for the 79-region historical use; a real cost for a candidate-level successor component. **Not fixed in this lane.** Owner: backend. |
| B19 | **NEW — 553 candidates have no SIGUNGU code** | **OPEN (new)** | They can never receive a region-level component under any missing-data policy. Owner: backend (candidate region attribution). |

Blockers B16–B19 are **recorded, not fixed**: this lane changed no runtime
source. B16 and B18 are genuine runtime defects and should be scheduled
independently of the successor policy gate.

---

## 14. Invariants confirmed

| Invariant | Result |
| --- | --- |
| Missing ≠ zero | **CONFIRMED** — 48,051 observations checked, 0 violations. No zero-fill, no imputation, no silent absence. |
| Historical Z/R/E/D untouched | **CONFIRMED** — `("zoning","road","equity","demand")` unchanged; namespaces disjoint; no historical score, weight, rank, CRITIC vector, or stability class read into a successor calculation or written. |
| Successor NOT ACTIVATED | **CONFIRMED** — no successor run, no persisted score, no weight in runtime config; `PRODUCTION_REGISTRY` is `None`; all 12 code-declared blockers open. |
| Runtime / API untouched | **CONFIRMED** — no file under `backend/src/` modified. |
| Migrations untouched | **CONFIRMED** — no migration added or run; dev DB stays at `0021`. |
| Frontend untouched | **CONFIRMED** — no frontend file touched. |
| Production untouched | **CONFIRMED** — no SSH, no production query, no production credential. |

---

## 15. Verdict

**All four components are computable on real capital-region data, none is
degenerate, and a successor CRITIC is mathematically defined.** That is the
positive finding, and it is real.

It is also not sufficient. Three measured facts govern what happens next:

1. **Complete-case eligibility deletes 22 of 79 jurisdictions** holding 24.1% of
   the capital region's residents — because of a reporting-grain mismatch, not
   because of anything about those candidates.
2. **A fifth of the candidate loss is a precision bug** (B16), not missing data.
   The eligible population cannot be honestly measured until it is fixed —
   and `SUCCESSOR_ELIGIBLE_POPULATION_NOT_MEASURED` requires exactly that
   measurement.
3. **The ranking head is entirely weight-determined** — a 0.15 weight shift
   replaces the whole top 50 — and the `resident_impact` top-50 sits wholly
   inside the one region whose representative geometry is least defensible.

None of these argues against the successor model. They argue that the decisions
in front of it are exactly the ones already registered as blockers, and that
Phase 3 has now given them measurements to be decided against instead of
assumptions.

**Recommendation: READY FOR EXPLICIT PHASE-4 POLICY GATE.**

The gate may begin. It should begin with B6 (air-impact grain), B16 (the
precision defect), and B7 (normalization) — because the eligible-population and
weight decisions cannot be made honestly until those three are settled, and every
other blocker depends on them.

**Final verdict: PHASE 3 GREEN WITH EXPLICIT LIMITATION.**

Green: every question this phase was asked has a measured answer, the evidence is
reproducible, and no contract was violated.

Limitation: the measurements were taken on a development database at alembic
`0021` — before the Phase-2 successor persistence migrations — using a
**research-only** land-cover registry against a **research-only** weight vector,
with `land_conversion` coverage depressed by an unfixed precision defect. Every
figure here is valid for the questions asked and **none is a production policy
input on its own.**

**Phase 4 must not begin automatically.**
