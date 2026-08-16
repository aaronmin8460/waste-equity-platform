# Suitability V3 Data Spike

**Lane:** read-mostly empirical data / formula research (documentation-only).
**Branch:** `research/suitability-v3-data-spike` · **Starting SHA:** `5148caa058b305e355100700bd85e534370b81c7`
**Date:** 2026-08-16 · **Scope:** empirical questions blocking safe activation of
`air_impact_proxy`, `resident_impact`, `land_conversion`.

This document contains **no runtime change**. It creates no table, no migration, no
API, no score, no weight, and no policy or derivation version bump. It is evidence
and recommendation only, for the writer lane that is implementing the backend
foundation separately.

> **Naming note.** `air_impact_proxy`, `resident_impact`, and `land_conversion` do
> **not** exist anywhere in this repository at `5148caa` — not in `policy.py`, not in
> `engine.py`, not in any migration, schema, test, or document. A repository-wide
> search for those identifiers returns zero hits. They are v3 proposals defined only
> in this lane's brief. Everything below therefore audits the **inputs** those three
> components would need, not an existing implementation.

---

## 1. Executive Verdict

| Component | Verdict | One-line reason |
| --- | --- | --- |
| `air_impact_proxy` | **BLOCKED — do not activate at native SIGUNGU grain** | The four canonical streams are complete for only **57 of 79** capital-region SIGUNGU. Requiring all four demotes currently-`ELIGIBLE` candidates in **인천 옹진군** — inside Incheon, where the entire eligible set is concentrated. |
| `resident_impact` | **CONDITIONAL — formula is under-resolved, not un-computable** | The finest population geography in the platform is **SIGUNGU (79 point masses)**. Three of the four research floors (500 m / 1 km / 2 km) are **smaller than the equivalent-circle radius of the average SIGUNGU in every SIDO** — and 5 km exceeds it only in Seoul — so the floor is being calibrated against positional noise in an arbitrary representative point. |
| `land_conversion` | **CONDITIONAL — best-founded of the three; one policy decision + one blocked inventory** | The 2025 land-cover cell statistics are complete, verified, idempotent, and **already in production** (47,893 cells / 1,142,780 class rows). But **15.4 % of candidates have no land-cover coverage at all**, and the exact 41-class L3 dictionary is **not recoverable from the repository** — only L1 (7) and L2 (22) are. |

**Single most important finding.** All three components would, under the existing
status rule (`engine.py:751-757` — any missing component ⇒ `REVIEW_REQUIRED`),
*shrink* the eligible set rather than re-rank it. The current run has **1,099
ELIGIBLE of 47,893**, and `land_conversion` alone would strip the component from the
**7,387 `NO_COVERAGE` cells**. The writer lane must decide the missing-value contract
**before** wiring any of the three, not after.

**Database mutation: NONE.** No live or local database was reachable, queried, or
written. See §17.

---

## 2. Evidence Sources

### 2.1 Live database availability — NOT AVAILABLE

Checked at the start of this lane, in this working directory:

| Probe | Result |
| --- | --- |
| `docker ps` | `Cannot connect to the Docker daemon` — daemon not running |
| `psql` on `PATH` | not installed |
| TCP `127.0.0.1:5432` | **closed** |
| `postgres` / `postgis` processes | none |
| `/opt/homebrew/var` (brew Postgres data) | absent |
| `.env` in the working tree | **does not exist** |
| Local `*.db` / `*.sqlite*` files | none |
| `data/raw` / `data/samples` | empty except a README (12 KB total) |

No database was started, and none could be: `docker compose up`, `alembic upgrade`,
seeding, and importing are all outside this lane's permission set. **No SQL was
executed against any database.** Every quantitative statement below is therefore
either (a) copied from a committed report that recorded a measurement against the
live local or production database, or (b) arithmetic I derived from such measurements
— and is labelled accordingly.

### 2.2 Evidence classification used throughout

| Label | Meaning |
| --- | --- |
| `DOCUMENTED_MEASURED` | A committed report records this value as measured against the live local dev DB or production. |
| `DERIVED` | Arithmetic performed in this lane over `DOCUMENTED_MEASURED` values. Reproducible from the cited inputs. |
| `INFERRED` | A logically supported reading of documented facts that is **not** directly measured. Must be confirmed by SQL before use. |
| `NOT_EMPIRICALLY_EVALUABLE` | Requires per-row data that exists only in a database this lane could not reach. |

### 2.3 Repository sources actually read

| Source | Used for |
| --- | --- |
| `AGENTS.md` | Data-integrity constraints binding every recommendation here |
| `docs/RCIS_REPORTING_GEOGRAPHY_AUDIT.md` | The complete four-stream × region coverage matrix (§4) |
| `docs/API_CONTRACTS/waste_statistics.md` | Units, accounting basis, PID→stream mapping, grain (§5) |
| `docs/SUITABILITY_POLICY_V1.md` | Live run results, candidate status counts, stated 57–59/79 limitation |
| `docs/METRIC_FEASIBILITY_MATRIX.md` | Source feasibility classes; population-grid status |
| `docs/LAND_COVER_DATA_CONTRACT.md` | L1/L2 class dictionaries, CRS, encoding, taxonomy rules (§9) |
| `docs/LAND_COVER_CANDIDATE_CELL_STATISTICS.md` | Cell-stat release, coverage tallies, L1 area totals, dominant-L1 distribution (§12) |
| `docs/LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md` | What actually reached production (§12.4) |
| `docs/LAND_COVER_MAP_LAYER_LEGEND_FILTERS.md` | Live dominant-class counts 7 / 21 / 34 |
| `docs/MOIS_POPULATION_2008_2026.md` | Monthly population grain — SIDO only (§6) |
| `docs/SUITABILITY_CRITIC_STABILITY.md` | CRITIC normalization + zero-variance semantics (§13) |
| `docs/DEPLOYMENT.md` | Production expected-state counts |
| `docs/SUITABILITY_ENVIRONMENTAL_ROADMAP.md` / `_DATA_AUDIT.md` | Layer lifecycle; confirms no ingested air dataset |
| `backend/src/.../analysis/suitability/{policy,engine,critic}.py` | Status rule, component contract, distance/CRS conventions |
| `backend/src/.../models/{suitability,regions,waste,metadata,environmental,reporting_geography}.py` | Exact column contracts for the SQL in §16 |

---

## 3. Capital-Region Coverage Baseline

`DOCUMENTED_MEASURED` unless noted.

| Property | Value | Source |
| --- | --- | --- |
| Expected SIGUNGU count used by suitability | **79** (서울 25 · 인천 10 · 경기 44) | `RCIS_REPORTING_GEOGRAPHY_AUDIT.md` §2 |
| SIDO | 3 | same |
| `regions` rows total (2024 vintage) | 82 | `DEPLOYMENT.md`, LC3 baseline |
| `regional_population` rows, 2024 annual | 82 — exactly one per region, **all 79 SIGUNGU covered** | `RCIS_REPORTING_GEOGRAPHY_AUDIT.md` §2 |
| Region selection in the engine | `region_level='SIGUNGU' AND extract(year FROM valid_from)=:year` | `engine.py:511-529` |
| Candidate cells (canonical) | **47,893** | LC3 §2.2; `SUITABILITY_POLICY_V1.md` §12 |
| Candidate status split | **1,099 ELIGIBLE · 34,534 REVIEW_REQUIRED · 12,260 EXCLUDED** | `SUITABILITY_POLICY_V1.md` §12 |
| Candidate grid | `capital-grid-500m-v1`, 500 m squares tiled in EPSG:5179 from origin (0,0) | `policy.py:52-55` |
| Candidate geometry | `MULTIPOLYGON(4326)` (clipped, `MakeValid`) **+ stored `POINT(4326)` centroid** | `models/suitability.py:180-181` |
| Cells by SIDO | Seoul 2,470 · Incheon 4,104 · Gyeonggi 41,319 | LC3 §9.2 |
| Clipped cell area by SIDO | 617.964 / 1,004.955 / 10,303.485 km² (total 11,926.404) | LC3 §9.2 |

**`DERIVED` — mean clipped area per SIGUNGU, and its equivalent-circle radius.**
Load-bearing for §8; computed as (SIDO clipped cell km²) ÷ (SIGUNGU count in that SIDO).

| SIDO | SIGUNGU | Mean clipped km²/SIGUNGU | Equivalent-circle radius |
| --- | ---: | ---: | ---: |
| 서울특별시 | 25 | 24.72 | **2.81 km** |
| 인천광역시 | 10 | 100.50 | **5.66 km** |
| 경기도 | 44 | 234.17 | **8.63 km** |
| **All** | **79** | **150.97** | **6.93 km** |

*Caveat:* this is candidate-grid clipped area (cells whose centroid falls inside the
SIDO union), not official statutory region area. It understates regions with large
maritime extent. It is used here only as an order-of-magnitude scale for the distance
floor, which is exactly what §8 needs.

---

## 4. Air-Impact Four-Stream Coverage

### 4.1 Canonical stream → PID mapping (`DOCUMENTED_MEASURED`)

| Stream constant | RCIS PID | Official form name | Grand-total label |
| --- | --- | --- | --- |
| `HOUSEHOLD` | `NTN007` | 2-나-1). (시군구) 생활(가정)폐기물 발생량 | `총계` |
| `BUSINESS_NON_FACILITY` | `NTN008` | 2-나-2). (시군구) 사업장비(非)배출시설계폐기물 | `합계` |
| `INDUSTRIAL_FACILITY` | `NTN018` | 1-나. (시군구) 사업장배출시설계폐기물 발생량 | `총계` |
| `CONSTRUCTION` | `NTN022` | 1-나. (시군구) 건설폐기물 발생량 | `합계` |

Source: `docs/API_CONTRACTS/waste_statistics.md` §"Phase 2.2"; stream constants stored
in `regional_waste_statistics.waste_stream` (`models/waste.py:90-92`).

### 4.2 Coverage at the **native SIGUNGU** grain — the grain suitability actually uses

The suitability engine reads `regional_waste_statistics` **by `region_id`**
(`engine.py:600-615`), i.e. native SGIS SIGUNGU. This is the grain that matters.

| Question from the brief | Answer | Class |
| --- | ---: | --- |
| Expected SIGUNGU count | **79** | `DOCUMENTED_MEASURED` |
| With `HOUSEHOLD` | **59** | `DOCUMENTED_MEASURED` |
| With `BUSINESS_NON_FACILITY` | **59** | `DOCUMENTED_MEASURED` |
| With `INDUSTRIAL_FACILITY` | **57** | `DOCUMENTED_MEASURED` |
| With `CONSTRUCTION` | **59** | `DOCUMENTED_MEASURED` |
| **With ALL FOUR** | **57** | `DERIVED` (59 − the 2 NTN018 omissions, which are a strict subset of the 59) |
| Total normalized rows | **234** = 59+59+57+59 | `DOCUMENTED_MEASURED` |

Cross-confirmed independently in two places: `RCIS_REPORTING_GEOGRAPHY_AUDIT.md` §7
(per-PID matrix reconciling to ingestion run 233: received 263 = inserted 234 +
rejected 29) and `SUITABILITY_POLICY_V1.md` §11 ("Waste statistics cover 57–59 of 79
SIGUNGU per stream (2024)"). `DEPLOYMENT.md` lists `waste_statistics | 234` as the
production expected state.

### 4.3 Exact regions missing one or more streams (`DOCUMENTED_MEASURED`)

**22 of 79 SIGUNGU are incomplete.** Two distinct causes, which must never be merged:

**Cause A — `COARSER_REPORTING_GEOGRAPHY` — 20 regions missing ALL FOUR streams.**
RCIS reports these seven Gyeonggi cities once at city level; SGIS splits them into 구.
The crosswalk classifies the city records `REQUIRES_AGGREGATION` and the ingestion
rejects them from `regional_waste_statistics`, so **no child district has any waste
row for any stream**.

| Parent city (RCIS reports here) | SGIS child districts with **zero** waste rows |
| --- | --- |
| 수원시 | 31011 장안구 · 31012 권선구 · 31013 팔달구 · 31014 영통구 |
| 성남시 | 31021 수정구 · 31022 중원구 · 31023 분당구 |
| 안양시 | 31041 만안구 · 31042 동안구 |
| 부천시 | 31051 원미구 · 31052 소사구 · 31053 오정구 |
| 안산시 | 31091 상록구 · 31092 단원구 |
| 고양시 | 31101 덕양구 · 31103 일산동구 · 31104 일산서구 |
| 용인시 | 31191 처인구 · 31192 기흥구 · 31193 수지구 |

**Cause B — `SOURCE_NOT_REPORTED` — 2 regions missing exactly one stream.**

| Region | SGIS code | NTN007 | NTN008 | **NTN018** | NTN022 |
| --- | --- | :-: | :-: | :-: | :-: |
| 인천광역시 **옹진군** | `KR-SGIS-23520` | ✓ | ✓ | **✗** | ✓ |
| 경기도 **연천군** | `KR-SGIS-31550` | ✓ | ✓ | **✗** | ✓ |

Both are **absent from the NTN018 source payload entirely** — verified against the
stored raw response (0 rows, vs 42 category rows each in NTN007). Not blank, not
rejected, not a mapping failure. **This is an official source omission and must never
be zero-filled.**

**Excluded non-region:** `인천 경제청` (Incheon Free Economic Zone office) appears in
NTN022 only, is `UNMATCHED_REGION_LABEL`, has no SGIS boundary, and is not a canonical
administrative region. It is correctly absent.

### 4.4 Missing-stream combinations (`DERIVED`)

| Combination | Regions | Count |
| --- | --- | ---: |
| Complete (all four) | — | **57** |
| Missing {HOUSEHOLD, BUSINESS_NON_FACILITY, INDUSTRIAL_FACILITY, CONSTRUCTION} | the 20 child districts | **20** |
| Missing {INDUSTRIAL_FACILITY} only | 옹진군, 연천군 | **2** |
| Any other combination | — | **0** |
| **Total** | | **79** |

There is no partially-covered middle case. Every incomplete region is either
all-four-missing or exactly-one-missing. That is a clean structure and it makes the
writer lane's missing-value contract simple to state.

### 4.5 Coverage at the **reporting-geography** grain (`DOCUMENTED_MEASURED`)

Migration `0012` added a separate reporting geography — deployed to production
(`DEPLOYMENT.md`: `reporting_regions 7`, `reporting_members 20`, `reporting_waste 28`,
7 rows per PID). At that grain:

| Grain | Regions | HOUSEHOLD | BUS_NON_FAC | IND_FAC | CONSTRUCTION | ALL FOUR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native SGIS SIGUNGU (`regional_waste_statistics`) | 79 | 59 | 59 | 57 | 59 | **57** |
| RCIS reporting geography (59 native + 7 derived cities) | 66 | 66 | 66 | 64 | 66 | **64** |

The reporting geography raises complete coverage from **57/79 → 64/66**. But the seven
derived city polygons are `ST_Union`-of-children **display** geometry, and the audit
explicitly rejected rebuilding suitability against city geography as "an
analytical-policy change explicitly out of scope". Using it for `air_impact_proxy` is
therefore a live option but a **policy decision with a documented prior rejection** —
see §15, R3.

### 4.6 Duplicate canonical observations

**Zero.** `DERIVED` from three independent facts:

1. `UniqueConstraint(region_id, reference_year, source_pid, waste_category_name)` on
   `regional_waste_statistics` (`models/waste.py:46-52`);
2. exactly one grand-total label per PID, identified by waste-type group `총계`/`합계`
   **and** `WSTE_M_CODE_NM = EMPTY` **and** `WSTE_CODE_NM = EMPTY` (the contract
   explicitly notes the `EMPTY` placeholder alone is insufficient because each region
   also carries a memo re-breakdown line);
3. the row count reconciles exactly: 59+59+57+59 = 234 = ingestion run 233
   `rows_inserted` = production expected state.

`RCIS_REPORTING_GEOGRAPHY_AUDIT.md` §9 additionally records **0** `AMBIGUOUS`,
**0** `INVALID_NUMERIC`, **0** `MISSING_GRAND_TOTAL`, and **0** observed zeros in the
2024 capital-region data.

---

## 5. Four-Stream Accounting Compatibility

**Verdict: the four values ARE arithmetically valid to aggregate at the same grain —
and that arithmetic validity is NOT sufficient to license the "air impact" label.**

### 5.1 Compatibility audit

| Property | Value | Same across all four? | Source |
| --- | --- | :-: | --- |
| Unit | **톤/년** (tonnes per year), read from `result[0].DUNIT = "( 단위 : 톤/년 )"` — never inferred from field names | ✅ | contract §"Phase 2.2" |
| Storage | `NUMERIC(20,6)` exact decimal | ✅ | `models/waste.py:40` |
| Accounting basis | **`ORIGIN_BASED_TREATMENT_OUTCOME`** — enforced by a DB `CheckConstraint` that permits no other value | ✅ | `models/waste.py:35, 77-80` |
| Reference year / period | **2024**; latest available (re-verified live 2026-07-08) | ✅ | contract §"Latest Available Reference Period" |
| Schema era | 2020-onward; `YEAR ≤ 2019` rejected outright as unsupported | ✅ | contract §"Format-Era Rule" |
| Row grain | one row per (region, year, PID) = region grand total across all waste categories | ✅ | contract §"Row grain"; `models/waste.py` docstring |
| Geographic level | SIGUNGU (시군구) | ✅ | contract §"Live-Verified PIDs" |
| Provenance | same provider (RCIS / 한국환경공단), same crosswalk, same ingestion transformation `rcis-waste-capital-region-v1` | ✅ | audit §5 |
| Blank handling | blanks parsed explicitly, **kept distinct from zero**; negatives and invalid numerics rejected | ✅ | contract §"Phase 2.2" |
| Internal reconciliation | generation = Σ(recycling, incineration, landfill, other) exactly, **mismatch count 0** | ✅ | contract §"Phase 2.2" |

**Category disjointness.** The four PIDs partition Korean waste by origin type —
생활(가정) / 사업장비배출시설계 / 사업장배출시설계 / 건설. They are mutually exclusive
categories of the same national accounting frame, so their sum is a total, not a
double-count. One schema asymmetry exists and is harmless at the grand-total grain:
`NTN008` carries an extra `WSTE_S_CODE_NM` sub-category column the other three lack.

### 5.2 Population coverage — an unresolved caveat specific to HOUSEHOLD

RCIS publishes `NTN002` — `1-나. (시군구) 생활폐기물관리구역현황` — which reports, per
SIGUNGU, the **household-waste management area** and the **management-excluded** area,
population, 동 count and household count, plus the excluded ratios
(`LIFEWT_MNGEXCPT_POP`, `MNGEXCPT_POP_RATIO`, …).

**`NTN002` is not ingested.** It appears only in
`ingestion/src/waste_equity_ingestion/probes/waste_statistics_discovery.py:50` as a
discovery entry. There is no model, no table, and no migration for it.

Consequence: **it cannot be verified from this platform's data that the `HOUSEHOLD`
generation figure covers 100 % of a region's resident population.** Where a region has
a management-excluded area, `NTN007` generation covers a sub-population while any
per-capita denominator uses the full SGIS population. The other three streams are not
population-denominated at source, so the caveat is asymmetric across the four.

This is `NOT_EMPIRICALLY_EVALUABLE` here and is a genuine open item for the writer
lane (§14, B5).

### 5.3 Why the *aggregation* is fine but the *label* is not

Three constraints from `AGENTS.md` bear directly on calling this sum an air-impact
proxy:

- *"Clearly identify unverified assumptions in code, documentation, user-facing
  analysis, and review notes."*
- *"Every displayed analytical metric must include its source and reference period."*
- *"Real-time weather and air-quality readings must not be directly treated as
  permanent facility-siting evidence."*

And two data facts:

1. **No air-quality dataset is ingested.** AirKorea is `CONFIRMED_DIRECT` in
   `METRIC_FEASIBILITY_MATRIX.md` but has never been ingested; the environmental
   audit records that no real-time reading is treated as siting evidence. So there is
   no measured air variable to validate any proxy against.
2. **Origin-based generation is not emission.** `ORIGIN_BASED_TREATMENT_OUTCOME`
   describes *how a region's own generated waste was treated*. It is explicitly **not**
   facility throughput, not import/export, not transfer, and — per the contract and
   `AGENTS.md` — **no origin-to-destination flow table exists in the official PID
   catalog**. Total tonnes generated in a region says nothing about where combustion
   or handling physically occurred.

**A better-founded alternative already in the same rows.** Every stream row already
stores `incineration_quantity` (`TOT_INCI_QTY`, 톤/년, same basis, same grain,
`models/waste.py:100`). Origin-based incinerated tonnage is a materially closer proxy
for combustion-linked air burden than total generation, at zero additional ingestion
cost. It remains origin-based — still not facility-located emission — but the
assumption chain is one link shorter. See §15, R4.

---

## 6. Resident-Impact Available Geometry

### 6.1 Population assets — the binding constraint

| Asset | Grain | Periods | Rows | Class |
| --- | --- | --- | ---: | --- |
| SGIS annual (`regional_population`, `ANNUAL`) | **SIDO + SIGUNGU** | 2024 | 82 (3 + 79) | `DOCUMENTED_MEASURED` |
| MOIS monthly (`regional_population`, `MONTHLY`) | **SIDO only** | 2008-01 → 2026-06 | 666 (222 months × 3 시도) | `DOCUMENTED_MEASURED` |
| **Total `regional_population`** | | | **748** | reconciles: 666 + 82 = 748 (LC3 baseline) |
| Population grid | — | — | **none** | `METRIC_FEASIBILITY_MATRIX.md`: SGIS population grids = `UNVERIFIED`, never ingested |
| 행정동 (dong) population | — | — | **none** | MOIS source *is* 행정동별, but ingestion stores 시도 only |

**There is exactly one population geography usable for `resident_impact`: the 79
annual 2024 SGIS SIGUNGU rows.** The monthly series cannot substitute — it is
SIDO-only, and the model enforces this with granularity-scoped partial unique indexes
plus a `CheckConstraint` so a monthly value can never be read as an annual denominator
(`models/metadata.py:121-173`).

So `SUM_r population_r / max(distance(candidate, representative_r), floor)` is a sum
over **79 point masses**, and its spatial resolution is entirely determined by how
those 79 points are placed.

### 6.2 Geographic assets actually present

| Asset | Type | SRID | Count | Notes |
| --- | --- | --- | ---: | --- |
| `regions.geometry` | `MULTIPOLYGON` | 4326 | 82 (3 SIDO + 79 SIGUNGU) | Versioned by `valid_from`/`valid_to`; SGIS 2024 vintage; carries `boundary_source_crs`/`boundary_target_crs`/`boundary_geometry_hash` provenance |
| `suitability_candidates.geometry` | `MULTIPOLYGON` | 4326 | 47,893 canonical | Clipped to the SIDO union, `MakeValid`-repaired; all canonical geometries valid |
| `suitability_candidates.centroid` | **`POINT`** | 4326 | 47,893 | **Already stored.** `ST_Centroid` taken in EPSG:5179 then transformed to 4326 (`engine.py:279, 298`) |
| `waste_reporting_regions.geometry` | `MULTIPOLYGON` | 4326 | 7 | `geometry_kind = DERIVED`, `derived_geometry_method = ST_UNION_OF_SGIS_CHILDREN` |
| `environmental_wetland_inventory_features.geometry` | `MULTIPOLYGON` | 4326 | 2,704 | Not population |
| `environmental_land_cover_features.geometry` | `MULTIPOLYGON` | 4326 | 6,901,309 **local only** | Not in production (§12.4) |

No external coordinate dataset is introduced, proposed, or needed.

### 6.3 Meter-correct distance — the project already has a convention, and it is sound

`engine.py:396` and `:404` compute nearest-road distance as:

```sql
ST_Distance(g.centroid::geography, k.geometry::geography)   -- spheroidal metres
```

with a `<->` KNN prefilter over the GiST index, taking the top 5 by planar operator
distance and then re-ranking those 5 by true geography distance. `SUITABILITY_POLICY_V1.md`
§12 records the top candidate's road distance as a **"geodesic nearest road 54.544 m"**,
confirming the geography cast is the live path.

**Recommendation: reuse this verbatim.** `::geography` distance on WGS84 is
spheroidal metres and is correct capital-region-wide without picking a projected CRS.
The KNN-prefilter-then-rerank pattern is also directly reusable for `resident_impact`,
though with only 79 region points a prefilter is unnecessary — a full 47,893 × 79
cross join is 3.78 M distance evaluations, trivial for PostGIS in one set-based
statement.

*(For reference, the project uses EPSG:5179 for grid construction and EPSG:5186 for
all areal measurement. Neither is needed for this distance.)*

---

## 7. Representative-Point Recommendation

### 7.1 Is there an existing project convention that should take precedence?

**For candidate cells: yes.** `ST_Centroid`, computed in EPSG:5179, transformed to
4326, stored on the row, and used for region assignment (`ST_Covers(region.geometry,
cell.centroid)`), zoning lookup, and road distance.

**For region polygons: no.** A repository-wide search for `ST_PointOnSurface` returns
**zero hits**, and `ST_Centroid` is never applied to `regions.geometry` anywhere in
`backend/src` or `ingestion/src`.

Critically, **the cell convention does not transfer.** `ST_Centroid` is safe on a
candidate cell because a 500 m grid square is convex, so its centroid is always
interior. A SIGUNGU boundary is neither convex nor necessarily single-part.

### 7.2 Can a centroid fall outside a capital-region SIGUNGU?

**Yes, and the capital region contains textbook cases.** `INFERRED` from documented
geography — flagged for SQL confirmation (§16, Q-G1):

- **인천광역시 옹진군** is an archipelago of scattered West Sea islands with no
  contiguous mainland part. The centroid of a multipart geometry is the area-weighted
  mean of its parts, which for widely separated islands lies in **open water, outside
  every constituent polygon** — plausibly tens of kilometres from any inhabited part.
- **인천광역시 강화군** is likewise island-based.
- **경기도 안산시 단원구** combines a mainland district with the 대부도 island group.
- Several Gyeonggi cities are concave or wrap around neighbours.

Corroborating repository evidence for Incheon's large maritime/island extent: LC3 §9.2
records Incheon at **1,580 `NO_COVERAGE` cells of 4,104** and a coverage ratio of
**0.6137** — by far the lowest of the three SIDO — and LC2 attributes the shortfall
partly to "SIDO boundaries including coastal/maritime/island extent" and to the
acquired tile extent "not reaching Incheon's far West Sea islands".

For `resident_impact` this is not a cosmetic problem: an 옹진군 centroid in open water
places that county's entire population at a location where nobody lives, and the error
propagates into every one of the 47,893 candidates' sums.

### 7.3 Is `ST_PointOnSurface` consistently valid?

**Yes, for the guarantee it makes — and that guarantee is narrower than it looks.**
PostGIS `ST_PointOnSurface` returns a point guaranteed to lie **on** the input surface,
so it can never land in open water. It is deterministic for a fixed geometry.

But on a `MULTIPOLYGON` it lands on **one** constituent polygon. For 옹진군 that means
one island — guaranteed to be land, but still not representative of where the county's
population is distributed. It converts an obviously-wrong answer (open sea) into a
plausible-looking but still arbitrary one, which is in some ways the more dangerous
failure mode.

### 7.4 Recommendation

**Use `ST_PointOnSurface(regions.geometry)` as the representative point, and make the
centroid/point-on-surface divergence a first-class, stored, audited fact.**

Rationale:
1. It cannot place population outside the region — a hard guarantee `ST_Centroid`
   does not provide, and one this geography demonstrably needs.
2. It is deterministic and project-native (a plain PostGIS predicate, no tolerance, no
   invented parameter) — consistent with how this codebase resolved the analogous
   `ST_Covers`-vs-residual choice in LC3 §6.6.
3. It requires no new dataset and no new coordinate source.

Mandatory accompanying conditions:

- **Store both** the `ST_PointOnSurface` representative and the `ST_Centroid`, plus
  `ST_Contains(geometry, ST_Centroid(geometry))` and
  `ST_Distance(pos::geography, centroid::geography)`, in the run's component
  provenance — so the disagreement is auditable rather than hidden behind whichever
  point was picked. This mirrors the LC3 precedent of storing
  `topological_cover_predicate` alongside the residual-based status.
- **Flag, do not silently accept,** any region where the centroid is outside the
  polygon or the two points differ by more than the region's own equivalent-circle
  radius. Under the project's `Missing ≠ safe` invariant, such a region's contribution
  should be surfaced as a review-visible caveat, not quietly summed.
- **Never present a single point mass as the location of a region's residents.** Any
  UI or provenance text must state that population is modelled at SIGUNGU resolution
  from one representative point per region.

**Honest limitation the writer lane must carry:** no choice of representative point
fixes the underlying problem, which is that the finest available population geography
is a 79-region partition whose members average 151 km². The representative-point
decision determines *how wrong* the near field is, not *whether* it is wrong.

---

## 8. Distance-Floor Sensitivity

### 8.1 Empirical status — NOT EVALUABLE IN THIS LANE

The brief asks for min / p10 / p25 / median / p75 / p90 / max, null count, zero count,
outlier concentration, top-candidate rank sensitivity, containing-region dominance, and
pathological spikes, for floors of 500 m / 1 km / 2 km / 5 km.

**Every one of these requires per-candidate values.** With no reachable database, none
can be measured. **I am not going to fabricate percentiles**, and no defensible sample
exists either — the repository contains no candidate-level export, no population-by-
region table in text form, and no region geometry. Sampling nothing is still nothing.

Status: **`NOT_EMPIRICALLY_EVALUABLE`.** §16 contains the complete, ready-to-run
set-based SQL that produces every requested statistic for all four floors in one
statement over the full 47,893 × 79 space — no sampling, no intermediate file.

### 8.2 What *is* determinable now: the floors are mis-scaled

This is `DERIVED`, and it is the substantive finding of this section.

The floor `f` only ever binds for a candidate–region pair when the candidate's centroid
falls within `f` of that region's representative point. Compare the four proposed
floors against the equivalent-circle radius of the average SIGUNGU (§3):

| Floor | vs Seoul mean radius (2.81 km) | vs Incheon (5.66 km) | vs Gyeonggi (8.63 km) | vs all-79 mean (6.93 km) |
| ---: | ---: | ---: | ---: | ---: |
| 500 m | 0.18× | 0.09× | 0.06× | **0.07×** |
| 1 km | 0.36× | 0.18× | 0.12× | **0.14×** |
| 2 km | 0.71× | 0.35× | 0.23× | **0.29×** |
| 5 km | 1.78× | 0.88× | 0.58× | **0.72×** |

**Every proposed floor is smaller than the average SIGUNGU's own radius in every
SIDO** (the single exception being 5 km against Seoul). The floor is therefore being
tuned far below the spatial resolution the underlying population data actually
supports. At 500 m the floor is ~7 % of the mean region radius — it is calibrating
against the arbitrary placement of a representative point inside a region that is
14× larger than the floor.

### 8.3 Expected magnitude of the binding set (`DERIVED`, order-of-magnitude)

Cells whose centroid falls within `f` of *any* of the 79 representatives, estimated as
79 · π·f² ÷ 0.25 km² per cell, ignoring overlap and boundary clipping (both of which
reduce the count, so these are upper bounds):

| Floor | Union area upper bound | Cells (upper bound) | Share of 47,893 |
| ---: | ---: | ---: | ---: |
| 500 m | 62.0 km² | ~248 | ~0.5 % |
| 1 km | 248.2 km² | ~992 | ~2.1 % |
| 2 km | 992.7 km² | ~3,970 | ~8.3 % |
| 5 km | 6,204.6 km² | ~24,818 | ~51.8 % |

Reading: at 500 m and 1 km the floor is nearly inert — it touches under ~2 % of
candidates — so those two settings differ from each other almost not at all, and the
sensitivity sweep across them will look deceptively stable. At 5 km the floor binds for
roughly half the grid and starts to flatten genuine near-field variation. **2 km is the
only proposed value in the regime where the floor is doing real work without
saturating.**

### 8.4 Does the containing region dominate?

**Not usually — and that is itself a finding.** `DERIVED` from the geometry:

For a typical Gyeonggi candidate, the containing region's representative sits ~4–8 km
away (bounded by the 8.63 km mean radius), while adjacent-county representatives sit
~15–25 km away. With broadly comparable populations, the containing region contributes
on the order of 2–4× a single neighbour's term but is summed against dozens of
neighbours, so it typically supplies a **minority** of the total. In Seoul, with a 2.81
km mean radius and 25 districts packed within ~15 km of each other, the containing
district's share is smaller still.

The exception is precisely the pathology:

### 8.5 Pathological spikes — the real risk at small floors

**Yes, small floors create artifact spikes, and their location is arbitrary.**

A candidate whose centroid happens to land within `f` of a representative point
receives `population_r / f` from that region. At `f = 500 m` and a 400,000-person
district, that single term is `800 persons·m⁻¹`; the same district contributes `80` to
a candidate 5 km away — a **10× jump** produced entirely by proximity to an
artificially chosen point, not by any property of the ground.

Three compounding factors:

1. The spike locations are the 79 representative points, which are themselves an
   artifact of the `ST_Centroid`-vs-`ST_PointOnSurface` choice (§7). Change the
   representative rule and the spikes move.
2. Because only ~248 cells are affected at 500 m, these are **low-count extreme
   outliers** — exactly the shape that distorts a mean/σ but hides in a headline
   summary.
3. The affected cells sit near region representatives, which for the compact Seoul and
   Incheon districts tend to be near population centres — so the artifact correlates
   with urbanness and will not look random.

**Mitigating factor.** If `resident_impact` is normalized by the project's existing
`policy.percentile_ranks` (as `equity` and `demand` are), the raw spike is compressed —
percentile rank is outlier-robust. The spike then no longer distorts the *scale*, but it
still distorts the *ranking* of those ~248 cells, and those are precisely the cells a
"most residents affected" reading would surface. See §13.

### 8.6 Floor recommendation

**Research default: 2 km.** Report all four for the sensitivity table, but treat 500 m
and 1 km as *demonstrations that the floor is inert at that scale*, not as candidate
production values. Justification: 2 km is the smallest proposed floor that is a
non-trivial fraction (0.71×) of the smallest SIDO's mean region radius, and it is the
only one in the 5–15 % binding regime.

**These remain research parameters. None is an approved production value.**

---

## 9. Active 2025 Land-Cover Class Inventory

### 9.1 Active release identity (`DOCUMENTED_MEASURED`)

| Property | Local dev | Production |
| --- | --- | --- |
| `environmental_dataset_versions.id` (`layer_name='land_cover'`) | 212 | **2** |
| `reference_period` | **2025** (`reference_date` **NULL** — never fabricated) | same |
| Source | 환경부/EGIS 세분류 [2025] 전국 토지피복지도 (Level-3) | same |
| Source CRS → target | EPSG:5186 (resolved by exact TM-parameter match, not by name) → EPSG:4326 `always_xy=True` | same |
| Encoding | CP949, proven from the DBF LDID byte `0x4E` + strict decode (no `.cpg` shipped) | same |
| `transformation_version` | `land-cover-v1` | same |
| Stored features | 6,901,309 / 2,013 map sheets | **0 — not transferred** |
| Cell-stat release | version 1, `SUCCEEDED`, `is_active` | **1**, `SUCCEEDED`, active |
| `environmental_land_cover_cell_statistics` | 47,893 | **47,893** |
| `environmental_land_cover_cell_class_areas` | 1,142,780 | **1,142,780** |
| Class rows by level | L1 205,525 · L2 435,933 · L3 501,322 | same |
| `derivation_version` / `area_crs` | `land-cover-cell-stats-v1` / EPSG:5186 | same |

Authorization: `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`; deployment status
`PUBLIC_DEPLOYED`. No EGIS-specific KOGL type is asserted, and raw SHP files are not
redistributable.

### 9.2 Hierarchy levels present

Three official levels, verified in the loaded release with **zero** code/name conflicts
and **zero** hierarchy conflicts (each L3 → exactly one L2, one L1, one name; each L2 →
one L1, one name):

| Level | Korean | Classes in dictionary | Classes observed as a **dominant** class |
| --- | --- | ---: | ---: |
| 1 | 대분류 | **7** | 7 |
| 2 | 중분류 | **22** | 21 |
| 3 | 세분류 | **41** | 34 |

### 9.3 Level-1 (대분류) — complete inventory with measured coverage

All seven codes and official names are recorded verbatim in
`LAND_COVER_DATA_CONTRACT.md` §6 (verified against the source files); the area and
cell-presence columns are measured over the active release (LC3 §10 E).

| L1 code | Official name | Cells present in | Total km² | Share of evaluated area | Cells where dominant |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 | 시가화건조지역 | 35,778 | 1,837.7359 | 18.41 % | 7,939 |
| 200 | 농업지역 | 30,135 | 1,521.0495 | 15.24 % | 7,579 |
| 300 | 산림지역 | 34,194 | **4,370.9409** | **43.78 %** | **21,361** |
| 400 | 초지 | 35,740 | 1,298.5683 | 13.01 % | 1,564 |
| 500 | 습지 | 18,935 | 175.2973 | 1.76 % | 396 |
| 600 | 나지 | 33,803 | 498.8570 | 5.00 % | 689 |
| 700 | 수역 | 16,940 | 280.3838 | 2.81 % | 978 |
| — | (no coverage → NULL) | — | — | — | 7,387 |

Sum = 9,982.833 km² = the aggregate evaluated area exactly — the source behaves as a
partition (total cross-class overlap across ~10,000 km² is **0.0562 m²**). Share
columns are `DERIVED` (class km² ÷ 9,982.833).

### 9.4 Level-2 (중분류) — complete official dictionary, **no measured distribution**

All 22 codes and names, verbatim from `LAND_COVER_DATA_CONTRACT.md` §6:

| L2 | Name | Parent L1 | | L2 | Name | Parent L1 |
| --- | --- | --- | --- | --- | --- | --- |
| 110 | 주거지역 | 100 | | 310 | 활엽수림 | 300 |
| 120 | 공업지역 | 100 | | 320 | 침엽수림 | 300 |
| 130 | 상업지역 | 100 | | 330 | 혼효림 | 300 |
| 140 | 문화·체육·휴양지역 | 100 | | 410 | 자연초지 | 400 |
| 150 | 교통지역 | 100 | | 420 | 인공초지 | 400 |
| 160 | 공공시설지역 | 100 | | 510 | 내륙습지 | 500 |
| 210 | 논 | 200 | | 520 | 연안습지 | 500 |
| 220 | 밭 | 200 | | 610 | 자연나지 | 600 |
| 230 | 시설재배지 | 200 | | 620 | 인공나지 | 600 |
| 240 | 과수원 | 200 | | 710 | 내륙수 | 700 |
| 250 | 기타재배지 | 200 | | 720 | 해양수 | 700 |

Parent assignment is by the documented 3-digit prefix hierarchy, verified
conflict-free in the loaded release.

**No per-L2 area total or per-L2 cell-presence count exists anywhere in the
repository.** Only the aggregate `l2_class_area_sum_m2` and the count 435,933 L2 class
rows are recorded. An L2-based registry is therefore **semantically** constructible
from committed evidence but **quantitatively** unverifiable without SQL.

### 9.5 Level-3 (세분류) — **BLOCKED**

**The 41 L3 codes and official names are not recoverable from this repository.**

- `LAND_COVER_DATA_CONTRACT.md` §6 states the count (41) and explicitly says the full
  Korean L3 dictionary "is validated by the tool but not reproduced verbatim here to
  avoid a bulk attribute dump."
- No production code contains an L3 dictionary — correctly, because codes and names
  are stored verbatim in `environmental_land_cover_cell_class_areas` and the schema
  deliberately keeps the dictionary out of the code (LC3 §5).
- Fixtures in `ingestion/tests/` and `backend/tests/` contain Korean class strings, but
  those are **synthetic test-only** values and must never be treated as the official
  dictionary.
- Only four L3 names appear anywhere in committed documentation, as incidental
  examples: 활엽수림 (2,693.70 km²), 도로 (1,249.22 km²), 침엽수림 (1,156.30 km²),
  기타초지 (1,117.49 km²) — the four largest L3 classes (LC3 §10 E) — plus 단독주거시설
  and 암벽·바위 mentioned as decode/rendering samples.

The brief says **"DO NOT GUESS ANY CLASS CODE FROM MEMORY."** I have not. §16 contains
the one-line SQL that produces the authoritative inventory.

**This is a hard blocker for any L3-based registry — and, per §10, it is also an
argument that no L3 registry should be built.**

---

## 10. Developed/Artificial Registry Proposal

### 10.1 Recommended level — Level 2 (중분류), with a Level-1 fallback

The brief asks for "the simplest defensible classification registry" and to "prefer a
stable official hierarchy level over an unnecessarily brittle hyper-detailed mapping."
Three candidate levels:

| Level | Classes to classify | Defensible? | Distribution evidence in repo | Brittleness |
| --- | ---: | --- | --- | --- |
| **L1** | 7 | Partly — collapses two artificial/natural splits | **Full** (§9.3) | Lowest |
| **L2** | 22 | **Yes** — the 자연/인공 distinction is explicit in the official names | **None** | Low |
| L3 | 41 | Unknown — dictionary not recoverable | None | Highest |

**L3 is rejected** on both counts: hyper-detailed and, right now, unknowable.

**L1 alone is insufficient, and the reason is specific and official.** Two L1 classes
each split at L2 into an explicitly natural and an explicitly artificial child, using
the source's own words:

- `400 초지` → `410 자연초지` (**natural** grassland) / `420 인공초지` (**artificial**
  grassland)
- `600 나지` → `610 자연나지` (**natural** bare) / `620 인공나지` (**artificial** bare)

An L1-only registry that treats `400` and `600` as "not developed" discards a
distinction the official taxonomy makes explicitly, and does so for two classes
covering **1,298.57 km² and 498.86 km²** — 18.0 % of the evaluated area combined.
`620 인공나지` in particular is where construction sites, quarries, and earthworks sit —
the most unambiguously converted land in the entire scheme.

### 10.2 Proposed registry (L2, 22 classes)

Status labels use the brief's three categories. `Ev` = share of evaluated area, shown
only where the L1 parent total is documented.

**CLEAR DEVELOPED / ARTIFICIAL — 8 classes**

| L2 | Name | Parent | Reasoning |
| --- | --- | --- | --- |
| 110 | 주거지역 | 100 | Residential built-up. Under 시가화건조지역 ("urbanized/dry land"), the scheme's own developed class. |
| 120 | 공업지역 | 100 | Industrial built-up. |
| 130 | 상업지역 | 100 | Commercial built-up. |
| 140 | 문화·체육·휴양지역 | 100 | Culture/sport/recreation **facilities**. Classified by the source itself under 시가화건조지역, not under 초지 — the source has already made this call. |
| 150 | 교통지역 | 100 | Transport. Contains 도로, the **second-largest L3 class in the region at 1,249.22 km²**. |
| 160 | 공공시설지역 | 100 | Public facilities. |
| 420 | **인공초지** | 400 | "인공" = artificial, in the official name. Land whose grass cover exists because it was made — golf fairways, verges, engineered lawn. |
| 620 | **인공나지** | 600 | "인공" = artificial, in the official name. Construction sites, quarries, earthworks — the most strongly converted surface in the scheme. |

**CLEAR NOT DEVELOPED / ARTIFICIAL — 11 classes**

| L2 | Name | Parent | Reasoning |
| --- | --- | --- | --- |
| 210 | 논 | 200 | Paddy. Cultivated, but a vegetated, un-built, permeable surface. |
| 220 | 밭 | 200 | Dry field. Same. |
| 240 | 과수원 | 200 | Orchard. Same. |
| 250 | 기타재배지 | 200 | Other cultivated. Same. |
| 310 | 활엽수림 | 300 | Broadleaf forest — **largest L3 class, 2,693.70 km²**. |
| 320 | 침엽수림 | 300 | Coniferous forest — 1,156.30 km². |
| 330 | 혼효림 | 300 | Mixed forest. |
| 410 | 자연초지 | 400 | "자연" = natural, in the official name. |
| 510 | 내륙습지 | 500 | Inland wetland. Also independently protected (`UM901` hard-exclusion layer). |
| 520 | 연안습지 | 500 | Coastal wetland. |
| 610 | 자연나지 | 600 | "자연" = natural, in the official name. |

**AMBIGUOUS — POLICY DECISION REQUIRED — 3 classes** (see §11)

| L2 | Name | Parent |
| --- | --- | --- |
| 230 | 시설재배지 | 200 |
| 710 | 내륙수 | 700 |
| 720 | 해양수 | 700 |

Registry totals: **8 developed · 11 not developed · 3 ambiguous = 22.** Complete, no
class unassigned, no invented class.

### 10.3 Level-1 fallback registry (if L2 proves unworkable)

Only if the writer lane needs the L1 fallback: **developed = {100}**, everything else
not developed. This is the **only** registry whose distribution is verifiable from
committed evidence today (§12), and it is what §12's numbers describe. Its cost is
stated plainly: it reclassifies 인공초지 and 인공나지 as "not developed", contrary to
their official names.

**Recommendation: implement L2, and validate it against the L1 fallback** — the L1
developed share is a strict lower bound on the L2 developed share, so
`L2_share ≥ L1_share` for every cell is a free integrity assertion the writer lane can
run as a regression check.

### 10.4 Registry status

**PROPOSED — NOT VALIDATED.** Every code and name above is copied verbatim from
`LAND_COVER_DATA_CONTRACT.md` §6, which records them as verified against the source
files. But the mapping from those 22 codes to the three suitability categories is
**this lane's proposal**, not an official designation and not measured. Before use it
requires (a) confirmation that the 22 stored codes match this list exactly (§16, Q-L1),
and (b) an explicit policy sign-off on §11.

---

## 11. Ambiguous Land-Cover Classes

### 11.1 `230 시설재배지` (facility/protected cultivation — greenhouses, vinyl houses)

| For "developed" | For "not developed" |
| --- | --- |
| Physically covered by structures (plastic/glass), largely impervious, a built footprint. | The source places it under `200 농업지역`, not under `100 시가화건조지역` — the official taxonomy calls it agriculture. |
| Reversible only with demolition, like a building. | Land use is agricultural production, not settlement or industry. |

**Recommendation: NOT developed**, i.e. follow the source's own L1 placement. Rationale:
the registry's authority comes from the official hierarchy, and overriding a parent
assignment the source made explicitly is exactly the kind of "corrective" reclassification
`LAND_COVER_DATA_CONTRACT.md` §6 forbids for codes and names. **Flag it in the policy
snapshot** so the decision is visible and reversible. Also note the Korean capital
region has extensive greenhouse agriculture, so this is not a negligible class — its
area is unmeasured in the repo and should be quantified before the decision is frozen
(§16, Q-L2).

### 11.2 `710 내륙수` (inland water) and `720 해양수` (marine water)

| For "developed" | For "not developed" | For neither |
| --- | --- | --- |
| Reservoirs and canals are engineered. | Water is not built land. | **Water is not developable at all** — it belongs in neither numerator nor denominator. |

The scheme provides no natural/artificial split for water (unlike 초지 and 나지), so a
reservoir and a river carry the same code. Three coherent treatments exist:

1. **Not developed** (in the denominator) — dilutes the developed share of every coastal
   and riverside cell, making them look less converted purely because they contain water.
2. **Developed** — plainly wrong for a natural river.
3. **Excluded from both numerator and denominator** — the developed share becomes
   `developed / (evaluated − water)`, i.e. "share of the *land* in this cell that is
   developed".

**Recommendation: option 3 — exclude water from both.** Rationale: `land_conversion`
is by name a statement about *land*, and 280.3838 km² (2.81 % of evaluated area) sits
in `700 수역`, concentrated in exactly the coastal and riverside cells where the
distortion would be largest — Incheon and the Han river corridor. Option 3 is also
the only treatment that keeps the metric comparable between an inland cell and a
half-water coastal cell.

**Cost, stated honestly:** option 3 introduces a second denominator
(`evaluated − water`) alongside the two the schema already distinguishes
(`share_of_evaluated_area`, `share_of_cell_area`). LC3 §6.7 is emphatic that those two
"are genuinely different and are never conflated." A third must be named explicitly,
stored explicitly, and never silently substituted. If that is judged too much
machinery, option 1 is acceptable **provided the water share is reported alongside**
the developed share so a reader can see why a coastal cell scores low.

### 11.3 Classes deliberately NOT treated as ambiguous

- `140 문화·체육·휴양지역` — a golf course could arguably be grassland, but the source
  filed it under `100 시가화건조지역`. Follow the source, as in §11.1.
- `410 자연초지` / `610 자연나지` — the official names say 자연 (natural). Not ambiguous.
- `420 인공초지` / `620 인공나지` — the official names say 인공 (artificial). Not
  ambiguous. Their exclusion is precisely what makes the L1-only registry inadequate.

---

## 12. Land-Conversion Distribution

### 12.1 Empirical status

Per-cell percentiles require per-row data. What follows is split cleanly into what is
**exactly derivable** from committed measurements and what is not. All figures use the
**L1 fallback registry** (developed = `{100}`), the only one with repository-side
evidence (§10.3).

### 12.2 Exactly derivable (`DERIVED` from LC3 §9.2 and §10 D/E)

| Quantity | Value | Derivation |
| --- | ---: | --- |
| Candidate cells | **47,893** | measured |
| Cells with **no coverage** → share is **NULL, not 0** | **7,387** (15.42 %) | measured |
| Cells with coverage (`COMPLETE_EXACT` + `PARTIAL`) | **40,506** | 35,902 + 4,604 |
| — of which `COMPLETE_EXACT` | 35,902 | measured |
| — of which `PARTIAL` (partial coverage) | 4,604 | measured |
| Cells containing **any** `100 시가화건조지역` | **35,778** | measured |
| **Cells with coverage and developed share exactly 0** | **4,728** | 40,506 − 35,778 |
| Cells with developed share > 0 | 35,778 | measured |
| **Reconciliation** | 7,387 + 4,728 + 35,778 = **47,893** ✓ | exact |
| Aggregate developed share (evaluated denominator) | **18.41 %** | 1,837.7359 ÷ 9,982.833 km² |
| Aggregate developed share (cell-area denominator) | **15.41 %** | 1,837.7359 ÷ 11,926.404 km² |
| Cells where `100` is the **dominant** L1 | **7,939** (16.58 %) | measured |

**Provable percentile bounds** (`DERIVED`):

- Over the **40,506 covered** cells, the exact-zero block is 4,728 = **11.67 %**.
  Since 11.67 % > 10 %, **p10 = 0.000 exactly**. This is a proof, not an estimate.
- A cell can only have developed share > 50 % if `100` is its dominant L1. Therefore
  **at most 7,939 cells (19.60 % of covered) exceed 50 %**. Since 19.60 % < 25 %, it
  follows that **p75 ≤ 0.50** and hence **median ≤ 0.50**, both exactly. (p90 is *not*
  bounded by this argument — the top 10 % sits inside the 19.60 %, so p90 may well
  exceed 0.50.)
- If `NO_COVERAGE` were (wrongly) zero-filled, the zero block becomes 12,115 =
  **25.30 % of 47,893** — which exceeds 25 %, so **both p10 and p25 would collapse to
  exactly 0**. This is a concrete demonstration of why the project's `Missing ≠ safe`
  invariant matters numerically here, not just philosophically.

### 12.3 Not derivable without SQL (`NOT_EMPIRICALLY_EVALUABLE`)

p25 · median · p75 · p90 · max (exact) · the count of cells at share == 1 / 100 % ·
the full tie profile · geographic concentration of the distribution beyond the
region-level coverage table below. §16 provides the SQL.

### 12.4 Geographic concentration — measured at the coverage level

The dominant geographic effect is already measured, and it is severe:

| SIDO | Cells | `COMPLETE_EXACT` | `PARTIAL` | **`NO_COVERAGE`** | Coverage ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| 서울 (KR-SGIS-11) | 2,470 | 2,146 | 242 | 82 (3.3 %) | 0.950379 |
| 인천 (KR-SGIS-23) | 4,104 | 2,308 | 216 | **1,580 (38.5 %)** | **0.613652** |
| 경기 (KR-SGIS-31) | 41,319 | 31,448 | 4,146 | 5,725 (13.9 %) | 0.852026 |
| **Total** | **47,893** | **35,902** | **4,604** | **7,387 (15.4 %)** | **0.837036** |

**This is the most consequential fact in this section, and it interacts directly with
§4.** The current eligible set is concentrated in Incheon — and Incheon is the SIDO
where **38.5 % of candidates have no land-cover value at all**. Activating
`land_conversion` under the existing status rule would strip the component from those
cells and demote them to `REVIEW_REQUIRED`, hitting hardest exactly where the eligible
candidates live.

`NO_COVERAGE` means the acquired land-cover extent does not reach that cell. It does
**not** mean the ground there is unvegetated, empty, or available. LC3 §16 makes
presenting it otherwise a documented prohibition.

**Production availability note.** Production holds the derived cell statistics and
class areas (47,893 / 1,142,780) but **not** the 6,901,309 raw
`environmental_land_cover_features` — those were deliberately not transferred. Any
production `land_conversion` derivation must therefore read
`environmental_land_cover_cell_class_areas`, never the feature table. A design that
re-intersects raw polygons will work locally and fail in production.

### 12.5 Option A (raw share 0–100) vs Option B (percentile rank)

| Dimension | A — raw developed share ×100 | B — percentile rank ×100 |
| --- | --- | --- |
| Interpretability | **Strong.** "This cell is 18 % built-up" is a physical fact with a unit and a source. | **Weak.** "This cell is at the 62nd percentile" is a statement about the other 40,505 cells, not about this one. |
| Cross-run comparability | **Yes.** Fixed to the land-cover release; stable while the release is stable. | **No.** Run-relative. Changing the candidate set changes every score, with no change on the ground. |
| Tie behaviour | 4,728-cell exact-zero block (11.67 % of covered). | **Identical.** `policy.percentile_ranks` assigns rank = (count strictly less)/(n−1), so all 4,728 zeros still share rank 0. **B does not resolve ties; it rescales them.** |
| Outlier robustness | Left-skewed with a long thin right tail. | Robust by construction. |
| CRITIC interaction | σ reflects the true clustered distribution. | **Inflates σ toward the uniform maximum (~0.289), mechanically raising the component's CRITIC weight** relative to a naturally-clustered one. See §13.3. |
| Project consistency | Differs from `equity`/`demand`. | Matches `equity`/`demand` (`policy.py:335-344`). |
| Provenance burden | Needs a documented denominator choice (§11.2). | Needs the same, **plus** a documented population definition for the rank. |

**Recommendation: A — raw developed share, expressed 0–100.**

The reasoning is not that A's distribution "looks prettier" — the brief rightly warns
against that, and A's distribution is in fact the uglier of the two (skewed, with an
11.67 % zero block). The reasons are substantive:

1. **B does not solve the problem it appears to solve.** The tie mass, the biggest
   pathology in this component, survives percentile ranking unchanged.
2. **A is a physical quantity with a unit, a source, and a reference period.**
   `AGENTS.md` requires that every displayed analytical metric carry its source and
   reference period; "18.4 % 시가화건조지역, EGIS 세분류 [2025]" satisfies that
   directly. A percentile does not — its meaning depends on a candidate set the reader
   cannot see.
3. **B silently inflates the component's CRITIC weight** (§13.3), which would let a
   normalization choice masquerade as a data-derived importance finding — precisely
   what `SUITABILITY_CRITIC_STABILITY.md` §4 argues against when it rejects a second
   observed min-max transform for making weights "depend on the incidental spread of
   one run's scores."
4. A slots directly into the existing CRITIC normalization (`x/100` on a policy-fixed
   `[0,100]` scale) with no new machinery.

**Unresolved and NOT a data question — the score direction.** Whether a high developed
share should score *high* (prefer already-disturbed land, avoid converting nature) or
*low* (developed land means neighbours and structures) is a **policy decision**. The
data supports either. It must be decided explicitly, with a written rationale, in the
policy registry — never inferred from which direction produces a nicer ranking.

---

## 13. Normalization Diagnostics

### 13.1 The existing model already has severe tie structure

Before adding anything, this is what the four current components look like among the
1,099 ELIGIBLE candidates that form the CRITIC population (`DERIVED` from
`policy.py:208-264` and `engine.py:735-750`):

| Component | Distinct values possible among ELIGIBLE | Why |
| --- | ---: | --- |
| `zoning` | **2** | Only UQ112→55 and UQ113→25 are `ELIGIBLE_WITH_PENALTY`. UQ111 ⇒ review; UQ114 ⇒ excluded. Nothing else can score. |
| `road` | continuous | Piecewise-linear over geodesic metres. The only genuinely continuous component. |
| `equity` | ≤ number of distinct SIGUNGU hosting eligible cells | Region-level value broadcast to every cell in the region. |
| `demand` | same | Same. |

And the eligible set is concentrated in Incheon (all top-50 candidates fall in Incheon
under every profile), which has **10 SIGUNGU** — so `equity` and `demand` plausibly
carry on the order of **≤10 distinct values across ~1,099 candidates**.

`SUITABILITY_POLICY_V1.md` §12 already reports the consequence honestly: baseline
top-10/top-50 overlap with the equal and access-focused profiles is **0**, and
"the leading candidates are **not** robust to weight choice."

**This is the baseline any new component is being added to.** It is not a healthy
ranking substrate, and two of the three proposals make it worse.

### 13.2 Per-component diagnostics for the three proposals

| Diagnostic | `air_impact_proxy` | `resident_impact` | `land_conversion` |
| --- | --- | --- | --- |
| **Grain** | SIGUNGU (region-level) | cell-level continuous | cell-level continuous |
| **Ties** | **Severe.** ≤ number of eligible-hosting SIGUNGU (~10). Block-constant per region. | **Low.** Distinct per cell — 47,893 distinct sums expected. | **Moderate.** 4,728-cell exact-zero block over covered cells (11.67 %). |
| **Nulls** | **22 of 79 regions** ⇒ cells in the 20 child districts + 옹진군 + 연천군 | None expected once representatives exist (all 79 have population) | **7,387 cells (15.42 %)** — structural, not fixable by re-derivation |
| **Extreme saturation** | Unknown; skewed by 용인/고양 industrial+construction tonnage (§4.5 table shows 용인 NTN018 at 1,110,472 t/yr vs 수원 133,331 — an 8× spread) | **Yes at small floors** — artifact spikes at 79 arbitrary points (§8.5) | Low. Bounded [0,1] by construction. |
| **Near-constant** | Possible within a single SIDO — if the eligible set is Incheon-only, this is ~10 values | No | No |
| **Regional clustering** | **Total** — it *is* a regional variable by construction | **High** — a smooth function of position, so neighbouring cells are near-identical | **High** — 38.5 % null in Incheon vs 3.3 % in Seoul |
| **Outlier domination** | Moderate | **High at f ≤ 1 km** | Low |
| **CRITIC risk** | **High** — could approach zero variance if the eligible set collapses into few regions | Low | Moderate |

### 13.3 The CRITIC normalization trap

`SUITABILITY_CRITIC_STABILITY.md` §4 and `critic.py:30` fix the normalization as
`x = score / 100` on the policy `[0,100]` scale, with **no** second observed min-max
transform — deliberately, so weights do not "depend on the incidental spread of one
run's scores."

That reasoning has a consequence the writer lane must not walk into:

> **Any component that is percentile-ranked before entering CRITIC arrives with a
> near-uniform distribution, hence a standard deviation near the theoretical maximum
> (~0.289 for uniform [0,1]), and therefore a mechanically inflated information value
> and CRITIC weight — relative to a component that carries its natural, clustered
> shape.**

`equity` and `demand` are already percentile-ranked; `zoning` and `road` are not. Adding
three more percentile-ranked components would make five of seven criteria uniform by
construction, and the resulting "data-derived" weights would substantially reflect the
normalization choice rather than the data. This is a direct argument for §12.5
Option A, and it should be applied consistently to all three new components.

### 13.4 Zero-variance failure mode — a real risk, not theoretical

`critic.py` raises `CriticUndefinedError` (`CRITIC_UNDEFINED`) when fewer than 2
complete ELIGIBLE candidates exist, or when every varying criterion is perfectly
redundant, or when all criteria are constant. `SUITABILITY_CRITIC_STABILITY.md` §19
calls this "a guard, not an expected path" because "real capital-region runs have ~10³
eligible candidates."

**That assumption weakens with every component added.** Each new required component
demotes candidates to `REVIEW_REQUIRED` (`engine.py:751-757`). Starting from 1,099:

- `land_conversion` removes cells in the 7,387 `NO_COVERAGE` set — concentrated in
  Incheon, where the eligible set lives.
- `air_impact_proxy` removes cells in 22 of 79 regions, including 옹진군 (Incheon).
- If the surviving eligible set collapses into one or two SIGUNGU, then
  `air_impact_proxy` becomes **exactly constant** → listed in
  `zero_variance_criteria`, weight 0. If it happens to two region-level criteria
  simultaneously, CRITIC could approach the undefined condition and **fail the whole
  build** with `CRITIC_UNDEFINED`.

This is the concrete mechanism by which "technically computes but performs poorly as a
ranking factor" turns into "the build stops." It must be tested before activation, not
discovered in production.

### 13.5 Components flagged as poor ranking factors

| Component | Flag | Statement |
| --- | --- | --- |
| `air_impact_proxy` | 🔴 **Flagged** | A region-level variable broadcast to ~48,000 cells cannot discriminate *between* cells within a region. Combined with an eligible set concentrated in one SIDO, it may carry ≤10 distinct values and approach zero variance. It adds a **coverage penalty** (22 regions) without adding cell-level discrimination. |
| `resident_impact` | 🟡 **Conditional** | Genuinely cell-level and continuous — the best-behaved of the three as a ranking factor. But its resolution is an illusion: it varies smoothly with position while its information content is still only 79 numbers. At floors ≤ 1 km it also injects artifact spikes. |
| `land_conversion` | 🟡 **Conditional** | Genuinely cell-level, physically meaningful, bounded, and already production-deployed. Its problems are an 11.67 % tie block, a 15.42 % structural null rate concentrated in Incheon, and one unresolved policy direction. |

---

## 14. Exact Blockers

### Blocking — must be resolved before activation

| # | Blocker | Component | Resolution |
| --- | --- | --- | --- |
| **B1** | Four-stream coverage is 57/79 SIGUNGU. 20 child districts have **zero** rows for **all four** streams; 옹진군 and 연천군 lack `INDUSTRIAL_FACILITY`. | `air_impact_proxy` | Choose a grain (§15 R3) **and** a missing-value contract. Never zero-fill. |
| **B2** | 7,387 candidates (15.42 %) have **no** land-cover coverage; 38.5 % of Incheon candidates, where the eligible set is concentrated. | `land_conversion` | Decide the missing-value contract explicitly. `NO_COVERAGE` ≠ 0 % developed. |
| **B3** | The 41 official L3 codes/names are **not recoverable from the repository**. | `land_conversion` | Run §16 Q-L1. Do not guess. (§10 recommends L2 anyway, so this blocks only an L3 design.) |
| **B4** | The ambiguous-class policy decisions (`230 시설재배지`; `710`/`720` water) are unmade. | `land_conversion` | Policy sign-off on §11. |
| **B5** | The `land_conversion` **score direction** is undecided (high developed share = good or bad?). | `land_conversion` | Policy decision with written rationale. Not a data question. |
| **B6** | Adding required components shrinks the eligible set and can drive CRITIC toward `CRITIC_UNDEFINED`. | all three | Measure the post-activation eligible count and per-component variance **before** committing (§16 Q-N1). |

### Non-blocking but must be recorded

| # | Item | Component |
| --- | --- | --- |
| B7 | Origin-based generation is **not** an emission measurement, and no air-quality dataset is ingested to validate any proxy against. | `air_impact_proxy` |
| B8 | `NTN002` (생활폐기물관리구역현황) is not ingested, so `HOUSEHOLD` population coverage cannot be verified. | `air_impact_proxy` |
| B9 | Population exists only at SIGUNGU (79 point masses); no population grid, no dong-level data. Monthly MOIS series is SIDO-only. | `resident_impact` |
| B10 | No project convention exists for a region representative point; `ST_Centroid` can fall outside multipart regions such as 옹진군. | `resident_impact` |
| B11 | All four proposed floors are below the mean SIGUNGU equivalent-circle radius in every SIDO. | `resident_impact` |
| B12 | Production lacks the 6.9 M raw land-cover features; only the derived cell tables are there. | `land_conversion` |
| B13 | Using the RCIS reporting geography for suitability was **explicitly rejected** in a prior audit as out of scope. Revisiting it is a policy reversal, not a data fix. | `air_impact_proxy` |

---

## 15. Exact Recommendations to Writer Lane

**R1 — Decide the missing-value contract first, as one explicit policy rule.**
This is the single decision that determines whether v3 is viable. The current rule
(`engine.py:751-757`) is "any missing component ⇒ `REVIEW_REQUIRED`", and under it all
three components *shrink* the eligible set. Options, in order of preference:

- **(a) Optional-component renormalization** — extend the existing
  `provisional_composite()` pattern (`policy.py:373-392`), which already renormalizes
  weights over present components, from a review-only device to a first-class rule for
  a declared set of optional components. Preserves the eligible set, never zero-fills,
  already implemented and tested.
- **(b) Keep the strict rule** and accept a materially smaller eligible set — but only
  after measuring it (§16 Q-N1).
- **(c) Zero-fill — forbidden.** Violates `Missing ≠ safe` and `AGENTS.md`.

**R2 — Do not activate all three at once.** Sequence them: `land_conversion` first (best
data foundation, already in production, cell-level), then `resident_impact`, then
`air_impact_proxy` (weakest). Each gets its own `policy_version`/`derivation_version`
bump and its own run, per the roadmap's additive-versioning invariant.

**R3 — For `air_impact_proxy`, pick one of three grains, explicitly:**

| Grain | Complete coverage | Cost |
| --- | --- | --- |
| Native SGIS SIGUNGU | **57/79** | 20 child districts + 옹진군 + 연천군 lose the component |
| RCIS reporting geography (7 derived cities + 59 native) | **64/66** | Reverses a documented prior rejection (B13); requires a candidate→reporting-region join the engine does not have |
| Three-stream sum (drop `INDUSTRIAL_FACILITY`) | **59/79** | Recovers 옹진군 and 연천군; drops the stream most associated with industrial emission — analytically backwards for an air proxy |

My recommendation, if `air_impact_proxy` proceeds at all: **native SIGUNGU with the R1(a)
optional-component contract**, so the 22 incomplete regions lose *this component only*
rather than their eligibility.

**R4 — Consider `incineration_quantity` instead of total generation** as the air proxy
numerator. Same table, same unit (톤/년), same basis, same grain, same coverage, zero
extra ingestion — and one link shorter in the assumption chain (§5.3). Whichever is
chosen, label it explicitly as an unverified proxy with its source and reference period,
and never present it as an emission measurement.

**R5 — For `resident_impact`, use `ST_PointOnSurface`,** store the centroid and the
divergence alongside it, and flag regions where they disagree materially (§7.4).

**R6 — Use `::geography` distance** exactly as `engine.py:396` already does. With 79
region points a full 47,893 × 79 set-based cross join is 3.78 M evaluations — one SQL
statement, no sampling, no intermediate file.

**R7 — Research floor default 2 km.** Report 500 m / 1 km / 2 km / 5 km for
sensitivity, but state in the report that 500 m and 1 km bind for under ~2 % of
candidates and are therefore near-inert, and that 5 km binds for roughly half the grid.
None is an approved production value.

**R8 — For `land_conversion`, define the registry at L2 (§10.2)** and assert
`L2_developed_share ≥ L1_developed_share` per cell as a free integrity check.

**R9 — Read `environmental_land_cover_cell_class_areas`, never
`environmental_land_cover_features`.** The feature table does not exist in production
(B12). Use the class-area rows, which are identical in both environments (content md5
`30e5bda3d4ef4cbec2de056e3cca290f` locally; cell md5 `421be51cad458841001c001f62c74ad5`
verified identical in production).

**R10 — Use raw developed share 0–100, not percentile rank** (§12.5), and apply the
same reasoning to the other two components to avoid the CRITIC inflation trap (§13.3).

**R11 — Run the §16 verification queries before writing any scoring code.** Nine of the
brief's questions are answerable in a single read-only session and would convert most
`INFERRED` items here into `DOCUMENTED_MEASURED` ones.

**R12 — Add a CRITIC pre-flight assertion.** Before persisting a run, assert that every
new component has non-zero variance over the complete ELIGIBLE population and that the
population size exceeds a stated minimum — so a degenerate configuration fails loudly at
build time rather than producing a weight vector that is an artifact of a collapsed
eligible set (§13.4).

---

## 16. Commands / SQL Executed

### 16.1 Actually executed in this lane — all read-only, all local filesystem

No database client was invoked; no database existed to invoke one against.

```bash
# Preflight
git status --short              # clean
git branch --show-current       # research/suitability-v3-data-spike
git rev-parse HEAD              # 5148caa058b305e355100700bd85e534370b81c7
git remote -v
git log --oneline -20

# Repository instructions
find . -name "AGENTS.md" -not -path "*/node_modules/*" -not -path "*/.git/*"

# Database availability probes (all negative)
docker ps                                  # daemon not running
which psql                                 # not found
nc -z -w 2 127.0.0.1 5432                  # closed
netstat -an -p tcp | grep LISTEN           # no 5432
ps aux | grep -iE "postgres|postgis"       # none
ls /opt/homebrew/var                       # absent
ls -la .env                                # absent
find . -name "*.db" -o -name "*.sqlite*"   # none
du -sh data                                # 12K

# Evidence gathering (read-only)
grep -rn "air_impact_proxy\|resident_impact\|land_conversion" \
     --include="*.py" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.sql" -l .
                                                                             # 0 hits
grep -rn "ST_Centroid\|ST_PointOnSurface\|centroid" --include="*.py" backend/src ingestion/src
grep -rn "NTN002\|LIFEWT_MNG\|관리구역" --include="*.py" --include="*.md" .
grep -rn "waste_stream" --include="*.py" backend/ ingestion/
ls backend/alembic/versions/
# plus targeted Read of the sources listed in §2.3
```

**Zero SQL statements were executed. Zero writes of any kind were made to any
database.**

### 16.2 Prepared, **NOT EXECUTED** — verification queries for the writer lane

Every query below is `SELECT`-only and set-based, produces a small aggregate result,
and materializes no file. Run them in a single read-only session against the local dev
database.

**Q-A1 — four-stream coverage matrix at native SIGUNGU grain (confirms §4.2/§4.4)**

```sql
WITH s AS (
  SELECT r.region_code, r.region_name,
         bool_or(w.waste_stream = 'HOUSEHOLD')              AS household,
         bool_or(w.waste_stream = 'BUSINESS_NON_FACILITY')  AS business,
         bool_or(w.waste_stream = 'INDUSTRIAL_FACILITY')    AS industrial,
         bool_or(w.waste_stream = 'CONSTRUCTION')           AS construction
  FROM regions r
  LEFT JOIN regional_waste_statistics w
         ON w.region_id = r.id AND w.reference_year = 2024
  WHERE r.region_level = 'SIGUNGU'
    AND extract(year FROM r.valid_from)::int = 2024
  GROUP BY r.region_code, r.region_name)
SELECT count(*)                                                        AS sigungu_total,
       count(*) FILTER (WHERE household)                               AS with_household,
       count(*) FILTER (WHERE business)                                AS with_business,
       count(*) FILTER (WHERE industrial)                              AS with_industrial,
       count(*) FILTER (WHERE construction)                            AS with_construction,
       count(*) FILTER (WHERE household AND business
                          AND industrial AND construction)             AS with_all_four
FROM s;
-- Expected from this report: 79 / 59 / 59 / 57 / 59 / 57
```

**Q-A2 — the exact incomplete regions and their missing-stream combination**

```sql
WITH s AS (
  SELECT r.region_code, r.region_name,
         bool_or(w.waste_stream = 'HOUSEHOLD')              AS household,
         bool_or(w.waste_stream = 'BUSINESS_NON_FACILITY')  AS business,
         bool_or(w.waste_stream = 'INDUSTRIAL_FACILITY')    AS industrial,
         bool_or(w.waste_stream = 'CONSTRUCTION')           AS construction
  FROM regions r
  LEFT JOIN regional_waste_statistics w
         ON w.region_id = r.id AND w.reference_year = 2024
  WHERE r.region_level = 'SIGUNGU'
    AND extract(year FROM r.valid_from)::int = 2024
  GROUP BY r.region_code, r.region_name)
SELECT region_code, region_name,
       concat_ws(',',
         CASE WHEN NOT household    THEN 'HOUSEHOLD' END,
         CASE WHEN NOT business     THEN 'BUSINESS_NON_FACILITY' END,
         CASE WHEN NOT industrial   THEN 'INDUSTRIAL_FACILITY' END,
         CASE WHEN NOT construction THEN 'CONSTRUCTION' END) AS missing_streams
FROM s
WHERE NOT (household AND business AND industrial AND construction)
ORDER BY missing_streams, region_code;
-- Expected: 22 rows — 20 with all four missing, 2 (옹진군/연천군) with INDUSTRIAL_FACILITY only
```

**Q-A3 — duplicate canonical observations (expected: 0 rows)**

```sql
SELECT region_id, reference_year, source_pid, count(*) AS n
FROM regional_waste_statistics
GROUP BY 1,2,3 HAVING count(*) > 1;
```

**Q-A4 — units / basis / period homogeneity (expected: one row per stream, all identical)**

```sql
SELECT waste_stream, source_pid,
       array_agg(DISTINCT quantity_unit)      AS units,
       array_agg(DISTINCT accounting_basis)   AS bases,
       array_agg(DISTINCT reference_period)   AS periods,
       array_agg(DISTINCT source_geographic_level) AS levels,
       count(*) AS rows
FROM regional_waste_statistics WHERE reference_year = 2024
GROUP BY 1,2 ORDER BY 1;
```

**Q-G1 — region representative-point audit (resolves §7.2, currently `INFERRED`)**

```sql
SELECT r.region_code, r.region_name,
       ST_NumGeometries(r.geometry)                                AS parts,
       ST_Contains(r.geometry, ST_Centroid(r.geometry))            AS centroid_inside,
       round(ST_Distance(ST_Centroid(r.geometry)::geography,
                         ST_PointOnSurface(r.geometry)::geography)::numeric, 1)
                                                                   AS centroid_to_pos_m,
       round((ST_Area(r.geometry::geography)/1e6)::numeric, 2)     AS area_km2
FROM regions r
WHERE r.region_level = 'SIGUNGU'
  AND extract(year FROM r.valid_from)::int = 2024
ORDER BY centroid_inside, centroid_to_pos_m DESC;
-- Expect 옹진군 / 강화군 / 안산시 단원구 near the top with centroid_inside = false
```

**Q-D1 — full distance-floor sensitivity, all four floors, all 47,893 × 79 pairs**

Set-based, no sampling, no intermediate file. Swap `ST_PointOnSurface` for
`ST_Centroid` to compare representatives.

```sql
WITH rep AS (
  SELECT r.region_code,
         p.population::numeric                     AS pop,
         ST_PointOnSurface(r.geometry)::geography  AS g
  FROM regions r
  JOIN regional_population p
    ON p.region_id = r.id
   AND p.reference_year = 2024
   AND p.population_temporal_granularity = 'ANNUAL'
  WHERE r.region_level = 'SIGUNGU'
    AND extract(year FROM r.valid_from)::int = 2024
    AND p.population > 0),
cand AS (
  SELECT DISTINCT ON (candidate_key)
         candidate_key, sigungu_region_code, centroid::geography AS g
  FROM suitability_candidates
  WHERE candidate_grid_version = 'capital-grid-500m-v1'
  ORDER BY candidate_key, analysis_run_id, id),          -- canonical occurrence, per LC3 §2.1
floors(f) AS (VALUES (500.0), (1000.0), (2000.0), (5000.0)),
pairs AS (
  SELECT c.candidate_key, c.sigungu_region_code, rep.region_code,
         rep.pop, ST_Distance(c.g, rep.g) AS d
  FROM cand c CROSS JOIN rep),
scores AS (
  SELECT f.f AS floor_m, p.candidate_key,
         sum(p.pop / GREATEST(p.d, f.f))                              AS score,
         max(CASE WHEN p.region_code = p.sigungu_region_code
                  THEN p.pop / GREATEST(p.d, f.f) END)                AS own_term,
         count(*) FILTER (WHERE p.d < f.f)                            AS bound_pairs
  FROM pairs p CROSS JOIN floors f
  GROUP BY 1, 2)
SELECT floor_m,
       count(*)                                            AS n,
       count(*) FILTER (WHERE score IS NULL)               AS nulls,
       count(*) FILTER (WHERE score = 0)                   AS zeros,
       min(score)                                          AS min,
       percentile_cont(0.10) WITHIN GROUP (ORDER BY score) AS p10,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY score) AS p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY score) AS median,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY score) AS p75,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY score) AS p90,
       max(score)                                          AS max,
       max(score) / NULLIF(percentile_cont(0.50)
             WITHIN GROUP (ORDER BY score), 0)             AS max_over_median,
       count(*) FILTER (WHERE bound_pairs > 0)             AS cells_where_floor_binds,
       avg(own_term / NULLIF(score, 0))                    AS mean_own_region_share,
       max(own_term / NULLIF(score, 0))                    AS max_own_region_share
FROM scores
GROUP BY floor_m
ORDER BY floor_m;
```

`mean_own_region_share` / `max_own_region_share` answer "does the containing region
dominate?"; `cells_where_floor_binds` and `max_over_median` answer "does the floor
create pathological spikes, and for how many cells?"

**Q-D2 — top-candidate rank sensitivity across floors**

```sql
-- Reuse the `rep` / `cand` / `floors` / `pairs` / `scores` CTEs from Q-D1, then:
ranked AS (
  SELECT floor_m, candidate_key,
         rank() OVER (PARTITION BY floor_m ORDER BY score DESC) AS r
  FROM scores)
SELECT c.candidate_key, c.rank AS current_suitability_rank,
       max(k.r) FILTER (WHERE k.floor_m =  500) AS r_500m,
       max(k.r) FILTER (WHERE k.floor_m = 1000) AS r_1km,
       max(k.r) FILTER (WHERE k.floor_m = 2000) AS r_2km,
       max(k.r) FILTER (WHERE k.floor_m = 5000) AS r_5km
FROM ranked k
JOIN suitability_candidates c USING (candidate_key)
WHERE c.analysis_run_id = (SELECT max(id) FROM suitability_analysis_runs
                           WHERE status = 'SUCCEEDED')
  AND c.status = 'ELIGIBLE' AND c.rank <= 50
GROUP BY c.candidate_key, c.rank
ORDER BY c.rank;
-- Rank churn across the four columns is the direct answer to "how sensitive is the
-- top set to the floor?" Spearman across any two columns quantifies it.
```

**Q-L1 — authoritative class inventory at all three levels (resolves B3)**

```sql
SELECT a.class_level, a.class_code, a.class_name,
       count(DISTINCT a.candidate_key)              AS cells_present_in,
       round((sum(a.class_area_m2)/1e6)::numeric,4) AS total_km2
FROM environmental_land_cover_cell_class_areas a
JOIN environmental_land_cover_cell_stat_versions v
  ON v.id = a.statistics_version_id AND v.is_active
GROUP BY 1,2,3
ORDER BY 1,2;
-- Expected: 7 rows at level 1 (matching §9.3 exactly), 22 at level 2, 41 at level 3
```

**Q-L2 — developed-share distribution for a candidate registry (resolves §12.3)**

Replace the `dev_codes` array to test L1-only vs the §10.2 L2 registry vs any variant.

```sql
WITH v AS (SELECT id FROM environmental_land_cover_cell_stat_versions WHERE is_active),
dev AS (SELECT ARRAY['110','120','130','140','150','160','420','620'] AS dev_codes,
               2 AS lvl),
cell AS (
  SELECT s.candidate_key, s.sido_region_code, s.coverage_status, s.evaluated_area_m2,
         COALESCE(sum(a.class_area_m2) FILTER (WHERE a.class_code = ANY(d.dev_codes)),0)
           AS developed_m2,
         COALESCE(sum(a.class_area_m2) FILTER (WHERE a.class_code IN ('710','720')),0)
           AS water_m2
  FROM environmental_land_cover_cell_statistics s
  JOIN v ON v.id = s.statistics_version_id
  CROSS JOIN dev d
  LEFT JOIN environmental_land_cover_cell_class_areas a
         ON a.cell_statistics_id = s.id AND a.class_level = d.lvl
  GROUP BY 1,2,3,4),
sh AS (
  SELECT *,
         CASE WHEN evaluated_area_m2 > 0
              THEN developed_m2 / evaluated_area_m2 END              AS share_evaluated,
         CASE WHEN (evaluated_area_m2 - water_m2) > 0
              THEN developed_m2 / (evaluated_area_m2 - water_m2) END AS share_land_only
  FROM cell)
SELECT count(*)                                                        AS cells,
       count(*) FILTER (WHERE coverage_status = 'NO_COVERAGE')         AS no_coverage,
       count(*) FILTER (WHERE coverage_status = 'PARTIAL')             AS partial,
       count(*) FILTER (WHERE share_evaluated IS NULL)                 AS null_share,
       count(*) FILTER (WHERE share_evaluated = 0)                     AS share_zero,
       count(*) FILTER (WHERE share_evaluated = 1)                     AS share_one,
       count(DISTINCT round(share_evaluated::numeric, 6))              AS distinct_values,
       min(share_evaluated),
       percentile_cont(0.10) WITHIN GROUP (ORDER BY share_evaluated) AS p10,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY share_evaluated) AS p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY share_evaluated) AS median,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY share_evaluated) AS p75,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY share_evaluated) AS p90,
       max(share_evaluated)
FROM sh;
-- Add `GROUP BY sido_region_code` for the geographic-concentration breakdown.
-- Swap dev_codes to ARRAY['100'] with lvl = 1 to reproduce the §12.2 L1 baseline:
--   expect no_coverage 7,387 · share_zero 4,728 · non-null 40,506 · p10 = 0
```

**Q-N1 — post-activation eligible-set and CRITIC variance pre-flight (resolves B6)**

```sql
-- How many currently-ELIGIBLE candidates would each new component demote?
WITH complete_regions AS (            -- the 57 SIGUNGU carrying all four streams
  SELECT r.region_code
  FROM regions r
  JOIN regional_waste_statistics w
    ON w.region_id = r.id AND w.reference_year = 2024
  WHERE r.region_level = 'SIGUNGU'
    AND extract(year FROM r.valid_from)::int = 2024
  GROUP BY r.region_code
  HAVING count(DISTINCT w.waste_stream) = 4)
SELECT count(*) FILTER (WHERE c.status = 'ELIGIBLE')                      AS eligible_now,
       count(*) FILTER (WHERE c.status = 'ELIGIBLE'
                          AND lc.coverage_status = 'NO_COVERAGE')         AS lose_land_conversion,
       count(*) FILTER (WHERE c.status = 'ELIGIBLE'
                          AND (c.sigungu_region_code IS NULL
                            OR c.sigungu_region_code NOT IN
                               (SELECT region_code FROM complete_regions)))
                                                                          AS lose_air_impact,
       count(DISTINCT c.sigungu_region_code) FILTER (WHERE c.status = 'ELIGIBLE')
                                                                          AS eligible_sigungu_count
FROM suitability_candidates c
LEFT JOIN environmental_land_cover_cell_statistics lc
       ON lc.candidate_key = c.candidate_key
      AND lc.statistics_version_id = (SELECT id FROM
            environmental_land_cover_cell_stat_versions WHERE is_active)
WHERE c.analysis_run_id = (SELECT max(id) FROM suitability_analysis_runs
                           WHERE status = 'SUCCEEDED');
-- `eligible_sigungu_count` is the ceiling on distinct values any region-level
-- component can take in the CRITIC population. If it is small, air_impact_proxy
-- is at risk of zero variance (§13.4).
```

---

## 17. Mutation Statement

**No database mutation of any kind occurred. No runtime file mutation of any kind
occurred.**

Specifically, in the course of this lane:

- **Zero** SQL statements were executed against any database — read or write. No
  database was reachable: the Docker daemon was not running, no `psql` client was
  installed, TCP port 5432 was closed, no PostgreSQL process was running, and no
  `.env` file existed in the working tree. Evidence in §2.1.
- **Zero** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, or DDL statements.
- **Zero** migrations run (`alembic` was not invoked). Alembic head is unchanged at
  `0021`.
- **Zero** seeding, importing, dumping, restoring, or database rebuilds.
- **Zero** ingestion commands run. No CLI in `ingestion/` or `backend/` was invoked.
- **Zero** network calls to any Korean government API, any provider endpoint, or any
  external host.
- **Zero** packages installed. No `npm install`, no `pip install`, no Playwright, no
  Next build, no Docker image build.
- **Zero** large files materialized. No CSV, JSON, dump, or dataset was written; total
  bytes written to disk by this lane = this one Markdown file.
- **Zero** backend runtime code, frontend code, migration, or test files modified. The
  only file created or changed on this branch is
  `docs/research/SUITABILITY_V3_DATA_SPIKE.md`.

Every quantitative value in this document is either copied from a committed report that
recorded a measurement made in an earlier, separately authorized phase, or is
arithmetic derived in this lane from such values — labelled `DOCUMENTED_MEASURED`,
`DERIVED`, `INFERRED`, or `NOT_EMPIRICALLY_EVALUABLE` per §2.2. Nothing here is
estimated, generated, sampled, or fabricated, and no unavailable value has been
substituted with a proxy presented as real.
