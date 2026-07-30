# 500 m Candidate-Cell Land-Cover Statistics (Phase 1B-LC3)

**Phase:** Suitability land-cover 1B-LC3 — derive and persist versioned land-cover
composition statistics for every unique canonical 500 m candidate-grid cell, from the
already-loaded local PostGIS land-cover release.

**Scope boundary:** LOCAL TECHNICAL DERIVATION ONLY. This phase reads the loaded
`environmental_land_cover_features` table and the existing candidate grid, adds three
additive tables, computes one derived release, verifies it, and re-runs it to prove
idempotency. It does **not** read the raw source root or the external drive, deploy to
OCI, add a public API or vector tiles, change the frontend, expose feature-level
geometry, or change any suitability score, weight, exclusion rule, candidate rank or
status, policy version, derivation version, candidate geometry, or existing analysis
run.

## Lifecycle

| Aspect | Label |
| --- | --- |
| Raw source dataset | `ACQUIRED_LOCALLY` (not accessed in this phase) |
| Source contract validation | `LIVE_VERIFIED` |
| PostGIS feature ingestion | `COMPLETE_LOCALLY` |
| Candidate-cell statistics implementation | `IMPLEMENTED_AND_TESTED` |
| **Complete local cell-stat derivation** | **`COMPLETE`** (local dev database only) |
| Public API | `NOT_IMPLEMENTED` |
| Frontend map | `NOT_IMPLEMENTED` |
| Production / OCI | `NOT_RUN` |
| Scoring integration | `NOT_IMPLEMENTED` |
| Public-use licence | `PENDING_CLARIFICATION` |

**These statistics affect no current suitability result.** They are a *description* of
what land cover occupies each analysed cell. No score, weight, exclusion rule, rank, or
candidate status reads them, and granting them any such role is a separate, explicitly
gated decision with its own `policy_version` / `derivation_version` bump.

---

## 1. No source-root dependency

The derivation is database-only. It takes **no** `--source-root`, never resolves
`data/raw/environment/land_cover`, never dereferences the external-drive symlink, and
never re-runs `land-cover-contract-validate` or `land-cover-ingest`. No committed code,
test, or document depends on a physical source path. The USB source was disconnected
throughout and was not required.

Its two inputs are both resolved from live database metadata:

1. the **active `land_cover` release** in `environmental_dataset_versions` — resolved by
   `layer_name = 'land_cover' AND is_active`, failing visibly if that is missing or
   ambiguous (see §3). No surrogate id is hard-coded anywhere in application code;
2. the **canonical candidate grid**, resolved from
   `suitability_analysis_runs.candidate_grid_version` (§2).

---

## 2. Canonical candidate-grid resolution

`suitability_candidates` stores one row per cell **per analysis run**, so the same grid
cell is repeated once per run. Computing it repeatedly would be wasted work and would
also imply a false relationship between a land-cover fact and one scoring run.

### 2.1 Canonical identity

Identity is `(candidate_grid_version, candidate_key)`. The canonical occurrence is the
one with the lowest `(analysis_run_id, id)` — fully deterministic, and independent of
database row order.

### 2.2 Observed grid state

| Property | Observed |
| --- | --- |
| Distinct `candidate_grid_version` values present | **1** — `capital-grid-500m-v1` |
| Distinct analysis runs on that grid | **2** (run 1, run 47) |
| Total `suitability_candidates` rows | **95,786** |
| **Unique canonical cells** | **47,893** |
| Duplicate candidate occurrences removed by canonicalization | **47,893** |
| Candidate keys with **conflicting geometry** | **0** |
| Candidate keys with a byte-differing but identical geometry representation | **23** |
| Non-canonical occurrences with invalid stored geometry | **23** |
| Keys with conflicting region/scope identity | **0** |
| NULL / EMPTY / invalid **canonical** geometries | **0 / 0 / 0** |

The grid version was **not** assumed from the policy constant: it was read from the
database, and the single value present matched the previously observed
`capital-grid-500m-v1`. The unique cell count was likewise discovered, not assumed —
95,786 is the *row* count, and exactly half of it is duplication across two runs.

### 2.3 Geometry identity — and the 23 representation variants

Requirement: *every repeated occurrence of the same key must have identical geometry; a
conflicting geometry is a hard failure.* "Identical" needs an exact definition, because
23 keys are stored with **byte-differing** geometry across the two runs.

Those 23 were measured before any rule was chosen:

| Test | Result for all 23 |
| --- | --- |
| `md5(ST_AsEWKB(...))` equal | **no** (that is how they were found) |
| `ST_Equals(run 1, run 47)` | **true** |
| `ST_Area` difference (EPSG:5186) | **0.000000 m²** |
| `ST_Area(ST_SymDifference(...))` | **0** |
| `ST_Area(ST_SymDifference(MakeValid, MakeValid))` | **0** |
| `ST_IsValid` | run 1 **valid**, run 47 **invalid** (self-intersection) |

So the two rows describe the **same region exactly**; run 47 stores a self-intersecting
vertex representation of it. All 23 invalid geometries are in run 47; **all 47,893
canonical (lowest-run) geometries are valid**.

The rule adopted, therefore:

- **Geometry identity = `ST_Equals`** — the exact PostGIS topological predicate, which
  needs no invented tolerance. An occurrence that is not `ST_Equals` to the canonical is
  a **hard failure** (nonzero exit, no rows written).
- An occurrence that is `ST_Equals` but not byte-identical is a **representation
  variant**: counted in `representation_variant_count` (per cell) and
  `representation_variant_cell_count` (per release), and surfaced as a CLI warning.
  It is recorded, never hidden.
- The **canonical** geometry must additionally be non-NULL, non-EMPTY, valid,
  MULTIPOLYGON and SRID 4326, or the run fails. Candidate geometry is never repaired,
  replaced, or dropped by this phase — the 23 invalid run-47 rows are pre-existing
  suitability data and were left exactly as they are.

### 2.4 Observed cell-area distribution (EPSG:5186)

| Statistic | m² |
| --- | --- |
| Minimum | **66,882.46** |
| Maximum | **250,228.63** |
| Mean | **249,021.85** |
| Cells below 250,000 m² | **1,103** |

A 500 m grid cell is *nominally* 250,000 m², but the cells are built in EPSG:5179 and
measured in EPSG:5186, and boundary-clipped edge cells are genuinely smaller. The
actual measured area is stored per cell; 250,000 is never assumed.

### 2.5 No new geometry storage

The repository has no pre-existing canonical candidate-grid table, and this phase does
**not** create one. The canonical set is materialized as a *session-temporary* table
inside the derivation and discarded when the session ends, so no second copy of 47,893
cell geometries is persisted. The statistics rows carry a
`candidate_geometry_fingerprint` (sha-256 over the canonical geometry EWKB + grid
version + key) instead, which ties each row to the exact geometry it was measured on
without duplicating it.

---

## 3. Source land-cover release

Resolved from database metadata only:

| Property | Value |
| --- | --- |
| `environmental_dataset_versions.id` | **212** (locally observed; never hard-coded) |
| `layer_name` | `land_cover` |
| `reference_period` | **2025** (`reference_date` NULL — never fabricated) |
| `source_checksum` | `9b3e5d5e…9f2b5e` (aggregate manifest) |
| Stored features | **6,901,309** |
| Canonical map sheets | **2,013** |
| `transformation_version` | `land-cover-v1` |
| Licence note | EGIS/KOGL vector terms — written re-confirmation pending |

Resolution is deliberately strict: **zero** active `land_cover` releases and **several**
active releases are both hard failures with distinct messages. An explicitly supplied
`--dataset-version-id` is verified to be a `land_cover` release before use. The
derivation never falls back to "most recent wins".

---

## 4. Statistics version identity

The derived release is a pure function of its versioned inputs, so its identity is too:

```text
input_signature = sha256(json{
    layer_name, land_cover_dataset_version_id, land_cover_source_checksum,
    candidate_grid_version, candidate_grid_fingerprint,
    derivation_version, area_crs, expected_cell_count })
```

`candidate_grid_fingerprint` is itself `sha256` over every canonical cell's
`candidate_key=candidate_geometry_fingerprint` pair in ascending key order, so it proves
*which* grid the release describes without depending on run ids.

- `derivation_version` = **`land-cover-cell-stats-v1`** — deliberately distinct from
  `suitability-screening-v3` / `suitability-policy-v2`, neither of which is read,
  written, or bumped here.
- Re-deriving the same inputs **reuses** the same version row. A second identical write
  can therefore never create a false second active release.
- `is_active` is guarded by a **partial** unique index, so at most one release can be
  active per (source release, grid version, derivation version) while failed and
  superseded releases are preserved.

---

## 5. Database schema (migration 0020, additive)

Migration **0020** (revises 0019, single head) adds three tables and alters nothing that
already existed. It seeds no rows — every row is written by the CLI. `downgrade` drops
exactly and only these three tables.

### `environmental_land_cover_cell_stat_versions`
One derived release: source release id, grid version + fingerprint, derivation version,
area CRS, `input_signature` (unique), `status` (RUNNING/SUCCEEDED/FAILED),
expected/processed cell counts, COMPLETE_EXACT / PARTIAL / NO_COVERAGE / FAILED tallies,
canonicalization provenance (candidate row count, duplicates removed, representation
variants), aggregate areas and coverage ratio, the source-overlap audit, the numerical
guard audit, class-row count, batch size, owning `ingestion_run_id`, sanitized
`derivation_metadata`, `is_active`, and started/completed/created timestamps.

### `environmental_land_cover_cell_statistics`
One row per canonical cell per version. Unique on
`(statistics_version_id, candidate_grid_version, candidate_key)`.

Holds `candidate_geometry_fingerprint`, region provenance copied verbatim from the
canonical candidate row, `cell_area_m2`, `evaluated_area_m2`, `uncovered_area_m2`,
`coverage_ratio`, `intersection_area_sum_m2`, `overlap_area_m2`, `coverage_status`,
`uncovered_residual_area_m2`, `topological_cover_predicate`, `matched_feature_count`,
dominant L1/L2/L3 code+name, per-level class counts and per-level class-area sums, the
canonicalization audit, the guard flag, `derivation_version`, and `area_crs`.

**No geometry column** — the cell geometry already lives on `suitability_candidates` —
and therefore **no spatial index**.

### `environmental_land_cover_cell_class_areas`
The complete class composition: one row per observed official class at **each** of the
three levels. Unique on `(cell_statistics_id, class_level, class_code)`.

Holds `class_level` (1/2/3 = 대·중·세분류), the official `class_code` and `class_name`
**verbatim**, `class_area_m2`, `share_of_evaluated_area`, and `share_of_cell_area`.

**Why child rows rather than a dominant code plus JSON.** The requirement is that all
7 L1, 22 L2, and 41 L3 class areas and shares present in a cell remain recoverable.
Normalized child rows give that losslessly, keep the class dictionary out of the schema
(a future release with a different dictionary needs no migration), and make
`GROUP BY class_code` aggregation a plain indexed query. Storing only a dominant code —
explicitly forbidden — would discard the rest of the composition.

No table carries a score, weight, rank, exclusion, penalty, policy, or eligibility
column, and none has a foreign key to `suitability_analysis_runs` or
`suitability_candidates`. Both properties are asserted by tests.

---

## 6. Spatial calculation contract

### 6.1 Two CRSs, each used for exactly one job

Stored geometry — candidate cells and land-cover features alike — is **EPSG:4326**.
Every area and intersection is measured in **EPSG:5186** (projected metres). Area is
never measured in degrees.

- **Prefilter in EPSG:4326**, the CRS the GiST indexes are actually built on:
  `f.geometry && b.geometry_4326 AND ST_Intersects(f.geometry, b.geometry_4326)`.
- **Transform only the survivors** to EPSG:5186, then intersect and measure there.

No second persistent EPSG:5186 copy of the 6,901,309 features is created. The measured
plan (§6.2) shows the indexed prefilter is doing its job, so materializing an 11 GB
reprojected table would add storage and maintenance cost for no demonstrated benefit.

### 6.2 Query plan — indexed, not Cartesian

`EXPLAIN` of the heavy step is captured on every run and classified automatically
(`plan_uses_index_prefilter`); an unindexed plan raises a warning. Observed on the real
6,901,309-row table:

```text
Insert on _lc_stage_l3
  ->  GroupAggregate
        ->  Nested Loop
              ->  Bitmap Heap Scan on _lc_cell_canon
                    ->  Bitmap Index Scan on _lc_cell_canon_seq_idx
              ->  Index Scan using idx_environmental_land_cover_features_geometry
                    on environmental_land_cover_features f
                    Index Cond: (geometry && _lc_cell_canon.geometry_4326)
                    Filter: (dataset_version_id = 212 AND st_intersects(...))
```

The feature table is reached **only** through its GiST spatial index, driven by the
batch's cells — never a sequential scan and never a Cartesian join.

### 6.3 Cell area

The canonical cell geometry is transformed to EPSG:5186 and `cell_area_m2` is measured
from the transformed geometry. Clipped edge cells keep their actual area (§2.4).

### 6.4 Evaluated coverage

Per cell: intersect land-cover polygons with the cell, keep polygonal components only
(`ST_CollectionExtract(…, 3)`), and **union before measuring** so overlapping source
features are counted once.

```text
evaluated_area_m2        = ST_Area( union of all polygonal intersections )
intersection_area_sum_m2 = Σ ST_Area( each individual polygonal intersection )   [pre-union]
uncovered_area_m2        = GREATEST(cell_area_m2 - evaluated_area_m2, 0)
coverage_ratio           = LEAST(evaluated_area_m2 / cell_area_m2, 1.0)
overlap_area_m2          = GREATEST(intersection_area_sum_m2 - evaluated_area_m2, 0)
```

The union is built hierarchically along the source's own class hierarchy — per L3, then
per L2 from its L3 members, then per L1 from its L2 members, then the cell total from
its L1 members. The hierarchy was verified consistent in the loaded release (41 L3 codes
→ exactly one L2 and one L1 and one name each; 22 L2 codes → one L1 and one name each;
zero conflicts), so the rollup is exact rather than assumed.

### 6.5 The one numerical guard, stated exactly

The three `GREATEST` / `LEAST` clauses above are a **non-negativity clamp and nothing
else**. They exist only so a floating-point overlay artifact cannot emit a physically
impossible negative area or a ratio above 1. They are **not** a coverage, completeness,
or overlap tolerance, and they never influence `coverage_status`.

Every application is counted: `guard_applied` per cell, `guard_applied_cell_count` and
`max_guard_adjustment_m2` per release. The observed adjustments are of order **1e-8 m²**
(tens of square nanometres) on cells of ~250,000 m² — pure IEEE-754 noise, visible rather
than silently absorbed.

### 6.6 Coverage status — exact, with no completeness threshold

| Status | Rule |
| --- | --- |
| `NO_COVERAGE` | no polygonal land-cover intersection with the cell |
| `COMPLETE_EXACT` | `ST_CollectionExtract(ST_Difference(cell, evaluated union), 3)` is **EMPTY** |
| `PARTIAL` | some polygonal intersection exists, but that residual is non-empty |
| `FAILED` | calculation failed; no such row may be presented as a valid statistic |

The rule is exact set-theoretic **emptiness**, not an area threshold. A cell at 99.999 %
stays `PARTIAL`. No 95 %, 99 %, or any other completeness tolerance exists anywhere in
the code, and the test suite asserts that no such literal appears in the coverage
contract.

**Why the residual, and not `ST_Covers`.** `ST_Covers(union, cell)` is the other exact
topological phrasing, and it was measured first. On the real data it returns **false**
for essentially every fully covered cell — while `ST_Difference(cell, union)` on the same
geometries yields **zero area and zero polygonal parts** in both directions. Measured on
three dense Seoul cells:

| Cell | cell area m² | union area m² | `ST_Difference` area | parts | `ST_Covers` |
| --- | --- | --- | --- | --- | --- |
| `…:1870_3901` | 250,176.883471358 | 250,176.883471361 | **0** | **0** | **false** |
| `…:1871_3900` | 250,177.155069245 | 250,177.155069241 | **0** | **0** | **false** |
| `…:1871_3901` | 250,177.155752230 | 250,177.155752232 | **0** | **0** | **false** |

That is a GEOS predicate robustness artifact on high-vertex clipped unions, not a gap in
the data. Using `ST_Covers` as the rule would have labelled provably, exactly covered
cells `PARTIAL`. So the **constructive residual** is the status rule — equally exact,
numerically stable — and the raw `ST_Covers` result is stored per row as
`topological_cover_predicate` so the disagreement stays auditable instead of being
hidden behind whichever answer was picked. `uncovered_residual_area_m2` (the residual's
area) is likewise stored beside the arithmetic `uncovered_area_m2`, giving two
independent uncovered measures that a reader can compare.

**A genuine geometric cause of tiny residuals.** Some cells are `PARTIAL` with a residual
of order 1e-9 m². This is real, not noise-in-the-predicate: a candidate cell edge is a
straight two-point chord in EPSG:5179, while land-cover features along that same line
contribute a polyline with extra vertices. EPSG:4326 storage plus the EPSG:5186
re-projection is a non-linear map, so the chord and the polyline separate by picometres
and the residual is a genuinely non-empty sliver. Such a cell is honestly `PARTIAL`; the
residual area is stored so its magnitude is visible, and **no tolerance is invented to
reclassify it**.

### 6.7 Class areas and shares

For every observed class at every level, the stored area is that class's **union** of
intersections with the cell, so overlapping same-class features are counted once.

```text
share_of_evaluated_area = class_area_m2 / evaluated_area_m2      -- NULL when evaluated = 0
share_of_cell_area      = class_area_m2 / cell_area_m2
```

The two denominators are genuinely different and are never conflated. When
`evaluated_area_m2` is zero, `share_of_evaluated_area` is **NULL, not 0** (the ratio is
undefined, not zero), `share_of_cell_area` may be 0 with a positive cell area, and every
dominant field is NULL.

`l1_class_area_sum_m2` / `l2…` / `l3…` are stored per cell as the **documented
reconciliation denominators**: each equals `evaluated_area_m2` exactly when the source
partitions the cell, and any difference is the cross-class overlap recorded in §6.9.

**Uncovered area is never a land-cover class.** No synthetic "unknown" class is created.
A `NO_COVERAGE` cell has **zero** class rows; uncovered area lives only in the coverage
fields on the parent row.

### 6.8 Dominant class

Dominant L1/L2/L3 = greatest class intersection area, tie-broken on the **ascending
official class code** — never database row order. The ordering clause is a single named
module constant (`DOMINANT_ORDER_BY`) used to build the SQL, and a test executes that
exact clause against a controlled exact tie (rows inserted in *descending* code order)
to prove the lower code wins.

### 6.9 Source overlaps

The official source is expected to behave as a partition, but that is not assumed.
Recorded per cell and aggregated per release: `intersection_area_sum_m2` (pre-union),
`evaluated_area_m2` (union), `overlap_area_m2`, `cells_with_source_overlap`,
`max_overlap_area_m2`, and `max_overlap_ratio`.

No threshold is invented for whether an overlap is acceptable, and no overlap is
normalized away. The magnitudes are reported in §9 so a reader can distinguish real
source overlap from floating-point overlay noise.

---

## 7. Implementation and performance

Module: `ingestion/src/waste_equity_ingestion/land_cover_cell_statistics.py`.

- **SQL/PostGIS does the spatial work.** Millions of geometries are never transferred
  into Python. Each batch runs six statements against session-temporary staging tables
  (L3 union → L2 → L1 → evaluated → class rows → cell rows), which are truncated every
  batch, so both memory and transient disk are bounded by one batch rather than by the
  cell count.
- **Deterministic batching** in ascending `candidate_key` order via a `seq` column;
  `--cell-batch-size` is configurable and provably does not change the result (tested at
  batch 1 vs batch 100).
- **Bulk `INSERT … SELECT … ON CONFLICT DO NOTHING`** — no row-by-row ORM insert loop.
- **Explicit transactions**, one commit per batch.
- Planner statistics on the two growing target tables are refreshed every 20 written
  batches, so a join plan chosen (and cached by psycopg3's automatic statement
  preparation) while the tables held a few hundred rows is not still in use at ~48,000.
- **Progress to stderr, sanitized JSON to stdout / `--report-json`** — no geometry dump,
  no local path, no personal detail.
- **No temporary artifact is committed**; logs and report JSON live under Git-ignored
  `logs/`.

### Resumability and failure semantics

- A release is created `RUNNING` with `is_active = false`.
- Activation happens **only** in `_finalize_version`, and its completeness proof is read
  back from the **persisted rows** — every expected canonical key present, row count
  equal to the expected cell count, and no impossible area/ratio value — not from
  in-process counters. A run with a missing cell raises and does not activate.
- A failed run sets the release `FAILED` + `is_active = false`. Its `ingestion_runs` row
  stays `FAILED` permanently; a later successful attempt gets its own run row.
- A re-run of the same signature reuses the release row and re-derives every cell,
  inserting only what is missing. A partial run therefore can never appear as a complete
  active release.

---

## 8. CLI

```bash
# Read-only pilot (selectors permitted)
waste-equity-probe land-cover-cell-stats \
  --candidate-grid-version capital-grid-500m-v1 \
  --dry-run \
  --report-json <ignored-local-path> \
  --progress

# Full derivation (no selectors permitted)
waste-equity-probe land-cover-cell-stats \
  --candidate-grid-version capital-grid-500m-v1 \
  --write \
  --cell-batch-size 250 \
  --report-json <ignored-local-path> \
  --progress
```

- Exactly one of `--dry-run` / `--write` is required.
- **No `--source-root`, no USB dependency.**
- The active land-cover release is resolved automatically; `--dataset-version-id`
  overrides it and is verified to be a `land_cover` release.
- `--candidate-grid-version` is required unless exactly one grid version exists.
- Pilot selectors `--candidate-key`, `--region` (seoul/incheon/gyeonggi), `--max-cells`
  are permitted **for `--dry-run` only**; a filtered `--write` is refused outright, so a
  pilot subset can never create or activate a partial release.
- `--no-explain` skips the query-plan capture.
- Nonzero exit on: missing or ambiguous active release, a non-`land_cover` explicit
  version id, unknown/ambiguous grid version, candidate-geometry conflict, unusable
  candidate geometry, database/migration failure, calculation failure, incomplete full
  write, identity conflict, or impossible area values.

---

## 9. Results

### 9.1 Controlled pilot (read-only, before the write)

Deterministic 11-cell pilot spanning all three 시도, selected to include every required
characteristic. Outcomes below are **measured**, not asserted in advance.

| candidate_key | 시도 | status | cell m² | evaluated m² | residual m² | feats | L1 | L3 | dominant L1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `…:1492_4000` | Incheon | NO_COVERAGE | 149,861.5 | 0.0 | 149,862 | 0 | 0 | 0 | — |
| `…:1493_3999` | Incheon | NO_COVERAGE | 250,074.9 | 0.0 | 250,075 | 0 | 0 | 0 | — |
| `…:1752_3840` | Incheon | PARTIAL | **66,882.5** | 66,882.5 | 1.5e-09 | 9 | 2 | 4 | 300 산림지역 |
| `…:1841_3847` | Gyeonggi | COMPLETE_EXACT | **88,774.2** | 88,774.2 | 0 | 16 | 3 | 5 | 100 시가화건조지역 |
| `…:1870_3875` | Incheon | COMPLETE_EXACT | 250,176.9 | 250,176.9 | 0 | 616 | **7** | **20** | 100 시가화건조지역 |
| `…:1870_3901` | Seoul | COMPLETE_EXACT | 250,176.9 | 250,176.9 | 0 | 116 | 6 | 11 | 200 농업지역 |
| `…:1871_3900` | Seoul | COMPLETE_EXACT | 250,177.2 | 250,177.2 | 0 | 139 | 6 | 12 | 200 농업지역 |
| `…:1876_3906` | Seoul | COMPLETE_EXACT | 250,178.5 | 250,178.5 | 0 | 506 | **7** | **19** | 100 시가화건조지역 |
| `…:2045_3856` | Gyeonggi | PARTIAL | **201,379.5** | 201,379.5 | 7.0e-09 | 4 | 1 | 2 | 300 산림지역 |
| `…:2045_3858` | Gyeonggi | COMPLETE_EXACT | **246,317.6** | 246,317.6 | 0 | 1 | **1** | **1** | 300 산림지역 |
| `…:2052_3900` | Gyeonggi | COMPLETE_EXACT | 250,226.4 | 250,226.4 | 0 | 71 | **7** | **16** | 300 산림지역 |

Required characteristics, all present: Seoul ✓ Incheon ✓ Gyeonggi ✓ · fully covered ✓ ·
partially covered ✓ · no-coverage ✓ · multiple L1 classes (7) ✓ · L3 boundaries (up to
20 L3 classes) ✓ · clipped edge cells whose area is **not** 250,000 m² (66,882.5 /
88,774.2 / 201,379.5 / 246,317.6) ✓ · single-class cell ✓.

Pilot measurements: 11 cells, 1,478 spatially matched features, 211 class rows
(40 L1 / 81 L2 / 90 L3), 7 cells with a recorded overlap of at most **2.6e-10 m²**
(ratio 1.0e-15 — floating-point overlay noise, not real source overlap), 3 cells with a
guard application of at most **2.9e-09 m²**, peak RSS ~85 MB, elapsed 19.1 s including
canonicalization. `plan_uses_index_prefilter` = **true**. Exactly **1** of the 11 cells
satisfied the raw `ST_Covers` predicate (the single-feature cell), which is the direct
evidence for the §6.6 decision.

Throughput calibration on representative samples (fixed per-invocation overhead of
canonicalization and selector application subtracted):

| Sample | cells | rate |
| --- | --- | --- |
| Seoul, dense, fully covered | 150 | ~1.4 cells/s |
| Gyeonggi, systematic every-Nth sample | 120 | ~3.1 cells/s |
| Incheon/Gyeonggi coastal, mostly no-coverage | 100–150 | ~10–19 cells/s |

Estimated full duration from those rates: **~4.6 hours**. Estimated additional storage
from the observed ~25 class rows per cell: ~1.2 M class rows, on the order of
**0.3–0.5 GB** including indexes. Host free space before the write: **16 GiB** — far
above the estimate, so the write was safe to proceed. Server tuning (`work_mem` 512 MB,
4 parallel workers) was A/B-measured at only ~6 % improvement on the dominant step, so
no server configuration was changed.

### 9.2 Complete local derivation

The write ran under `caffeinate -i -m -s` as a detached background process, with the
progress log, the report JSON, the caffeinate PID, the CLI PID, and the **real CLI exit
code** each written to separate Git-ignored files under `logs/`. Success is taken from
the CLI's own exit code and its stored report, never from a wrapper's status.

#### Interruption and honest resume (documented, not hidden)

The first attempt (2026-07-28) was **interrupted** at `[write 4250/47893]` when the local
PostgreSQL container was stopped: the log ends in `Connection refused` and the **real CLI
exit code was 1**. Because the connection itself was gone, the module's own failure
handler could not run, so the state was inspected and proven before anything restarted:

| Interruption state | Found |
| --- | --- |
| Live derivation process / caffeinate assertion | none |
| Active queries / open / prepared transactions | 0 / 0 / 0 |
| Statistics version 1 | `FAILED`, `is_active = false` |
| Ingestion run 1242 | `FAILED`, category `INTERRUPTED_BY_USER` |
| Stale `RUNNING` records | **none** — nothing needed marking |
| Persisted partial rows | 4,250 cell rows + 52,691 class rows |

Those partial rows were **inspected, not deleted**. They formed an exactly *contiguous*
canonical-key prefix (seq 1–4,250) — the signature of the per-batch atomic commit — with
0 orphan class rows, 0 duplicate identities, 0 covered cells missing class rows, 0
`NO_COVERAGE` cells carrying class rows, 0 cells missing a class level, 0 impossible
areas, and 0 level-sum mismatches.

The completing run (2026-07-29) was the **identical command**. It resolved the same
`input_signature`, **reused statistics version 1** rather than creating a second one,
reset it to `RUNNING`/inactive under a new ingestion run (1243), and left run 1242
`FAILED` forever. It then recomputed **every** cell — including the 4,250 already
present — relying on `ON CONFLICT DO NOTHING` plus the row-comparison check:

> **`materially_changed_rows = 0`** and **`max_recomputation_delta = 0.0 m²`** across all
> 47,893 cells. The interrupted attempt's 4,250 rows were reproduced bit-for-bit, so they
> were *proven* correct rather than assumed — and nothing had to be deleted.

#### Result (real CLI exit code **0**, status SUCCEEDED)

| Metric | Value |
| --- | --- |
| Elapsed (wall) | **3:58:43** (14,322.9 s; 2026-07-29T13:22:04Z → 17:20:50Z) |
| Throughput | **3.344 cells/s** (192 batches x 250) |
| Peak process RSS | **85.3 MB** (bounded — all geometry work stays in PostgreSQL) |
| Estimated vs actual duration | ~4.6 h estimated → **3.98 h actual** |
| Expected canonical cells | **47,893** |
| **Processed cells** | **47,893** |
| `COMPLETE_EXACT` | **35,902** |
| `PARTIAL` | **4,604** |
| `NO_COVERAGE` | **7,387** |
| `FAILED` | **0** |
| Statistics version id | **1** (reused; `statistics_version_created = false`) |
| Ingestion run id | **1243** (SUCCEEDED) |
| Inserted cell rows / class rows | **43,643** / **1,090,089** |
| Reused rows from the interrupted attempt | **4,250** cells / **52,691** class rows |
| Materially changed rows | **0** |
| Class rows total | **1,142,780** (L1 205,525 / L2 435,933 / L3 501,322) |
| Source features contributing an intersection | **7,602,154** |
| Query plan used the GiST prefilter | **true** |

Status counts sum exactly: 35,902 + 4,604 + 7,387 = **47,893**. Row arithmetic
reconciles: 43,643 inserted + 4,250 reused = 47,893 cells; 1,090,089 + 52,691 =
1,142,780 class rows.

#### Cells and coverage by region

| 시도 | cells | COMPLETE_EXACT | PARTIAL | NO_COVERAGE | cell km² | evaluated km² | uncovered km² | coverage ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Seoul (KR-SGIS-11) | 2,470 | 2,146 | 242 | 82 | 617.964 | 587.300 | 30.664 | **0.950379** |
| Incheon (KR-SGIS-23) | 4,104 | 2,308 | 216 | 1,580 | 1,004.955 | 616.693 | 388.262 | **0.613652** |
| Gyeonggi (KR-SGIS-31) | 41,319 | 31,448 | 4,146 | 5,725 | 10,303.485 | 8,778.840 | 1,524.645 | **0.852026** |
| **Total** | **47,893** | **35,902** | **4,604** | **7,387** | **11,926.404** | **9,982.833** | **1,943.571** | **0.837036295** |

**An independent cross-check.** These candidate-cell coverage ratios were computed by a
completely different method from the Phase 1B-LC2 *regional source* coverage (which
unioned map-sheet footprints against SIDO boundaries), yet they land within ~0.003 of
each other: Seoul 0.9504 vs 0.9503, Incheon 0.6137 vs 0.6108, Gyeonggi 0.8520 vs 0.8517,
combined 0.8370 vs 0.8361. Two independent measurements agreeing is corroboration — the
regional figures were **not** copied into any cell row.

#### Overlap, guard, and residual audit

| Metric | Value |
| --- | --- |
| Sum of per-feature intersection area (pre-union) | 9,982,832,659.648355 m² |
| Evaluated union area | 9,982,832,659.592215 m² |
| **Total source overlap** | **0.0562 m²** over all 47,893 cells |
| Cells with any recorded overlap | 17,906 |
| Maximum overlap in one cell | **0.00348 m²** (ratio 2.9e-08) |
| Guard applications / maximum adjustment | 28,180 cells / **4.24e-06 m²** |
| Geometry-derived uncovered residual (sum) | 1,943,570,910.80 m² |
| Arithmetic uncovered (sum) | 1,943,570,910.81 m² |
| `ST_Covers` predicate true | **314** of 40,506 covered cells |

The source behaves as a **partition**: total overlap across ~10,000 km² of evaluated area
is 0.056 m², and the largest single-cell overlap is 3.5 mm². These magnitudes are
floating-point overlay noise rather than real source overlap — reported exactly rather
than normalized away, with no threshold invented for what counts as "acceptable".

The two independent uncovered measures — arithmetic `cell - evaluated` and the
geometry-derived `ST_Difference` residual — agree to **0.01 m² over 1,943.57 km²**.

`ST_Covers` was true for only **314** of the 40,506 cells with coverage, while 35,902 of
them have a provably **empty** polygonal residual. That is the §6.6 artifact confirmed at
full scale, and precisely why the residual — not `ST_Covers` — is the status rule.

### 9.3 Identical second write (idempotency)

The **exact same command** was run a second time under `caffeinate`, with no fast path:
the loader re-canonicalized the grid, re-resolved the release, and **recomputed every one
of the 47,893 cells** before touching the database, so this proves the *computation* is
stable — not merely that a unique index rejected duplicates.

**Result (real CLI exit code 0, status SUCCEEDED):**

| Metric | Value |
| --- | --- |
| Elapsed (wall) | **3:12:11** (11,530.6 s; 2026-07-29T17:30:39Z → 20:42:52Z) |
| Throughput | 4.154 cells/s (faster than the first write — every row hits `ON CONFLICT DO NOTHING` instead of inserting) |
| Peak RSS | 83.9 MB |
| `input_signature` | **identical** (`a2abd8217d4ee69c…`) |
| `candidate_grid_fingerprint` | **identical** |
| Source land-cover release | **identical** (212) |
| Statistics version | **1 reused** (`statistics_version_created = false`) |
| **Inserted cell rows** | **0** |
| **Inserted class rows** | **0** |
| **Materially changed rows** | **0** (max recomputation delta **0.0 m²**) |
| Reused cell / class rows | 47,893 / 1,142,780 |
| New ingestion run | **1244** (SUCCEEDED, `rows_inserted = 0`) |

**Database state after the second write:**

| Check | Result |
| --- | --- |
| Statistics versions total / active | **1 / 1** — no false second release, no false second active release |
| Cell rows / class rows | **47,893 / 1,142,780** (unchanged) |
| `status` / `is_active` | `SUCCEEDED` / `true` |
| `ingestion_run_id` | still **1243** — the run that *created* the release keeps ownership |
| Cell-content md5 | `fb1dfc548372289cec67f1ac23c97a41` |
| Class-content md5 | `30e5bda3d4ef4cbec2de056e3cca290f` |

Every reported aggregate is **byte-identical** between the two runs — status counts,
per-region counts, total cell/evaluated/uncovered area at full float precision, aggregate
coverage ratio, total and maximum overlap, guard-applied count, `ST_Covers`-true count,
matched-feature total, and the complete L1, L2, and L3 class-area totals and dominant-L1
distribution.

The attempt history reads honestly end to end:

| Run | Status | Rows inserted | Window |
| --- | --- | --- | --- |
| 1242 | **FAILED** (`INTERRUPTED_BY_USER`) | 0 | 2026-07-28 04:30:14Z → 04:56:43Z |
| 1243 | **SUCCEEDED** (first complete derivation) | 1,133,732 | 2026-07-29 13:22:06Z → 17:20:49Z |
| 1244 | **SUCCEEDED** (identical re-derivation) | **0** | 2026-07-29 17:30:41Z → 20:42:52Z |

Real-source idempotency is **confirmed**.

### 9.4 Storage impact

| Object | Total | Heap | Indexes |
| --- | --- | --- | --- |
| `environmental_land_cover_cell_class_areas` (1,142,780 rows) | **271 MB** | 154 MB | 117 MB |
| `environmental_land_cover_cell_statistics` (47,893 rows) | **31 MB** | 21 MB | 9,704 kB |
| `environmental_land_cover_cell_stat_versions` (1 row) | 128 kB | 8,192 B | 112 kB |
| **Total added** | **~302 MB** | | |

Database size grew from **17,254,846,947 B** to **17,571,992,035 B** — exactly
**+317,145,088 B (302 MB)**, i.e. the three new tables and nothing else. Both round to
"16 GB" at `pg_size_pretty` resolution.

Transient usage stayed bounded as designed: PostgreSQL temp files peaked around **21 MB**
(one batch of staging tables) and WAL cycled within its **1 GB** `max_wal_size`. Host
free space fluctuated between 16 and 20 GiB, driven by pre-existing macOS **swap**
(5.19 GB of 6.14 GB in use) rather than by this derivation.

---

## 10. Integrity verification

Read-only SQL over the completed release. Every violation check returned **0**.

### A. Version integrity

| Check | Result |
| --- | --- |
| Active versions for (active land-cover release + `capital-grid-500m-v1` + `land-cover-cell-stats-v1`) | **1** |
| `status` | **SUCCEEDED** |
| `is_active` | **true** |
| `expected_cell_count` = actual stored rows | **true** (47,893 = 47,893) |
| Source land-cover version = the active database-resolved release | **true** (212) |
| `candidate_grid_version` | `capital-grid-500m-v1` |
| `candidate_grid_fingerprint` | `dd327d5acb382fc725f916e63131c07ef9099d245a990f37431d85229c6c3e29` |
| `derivation_version` / `area_crs` | `land-cover-cell-stats-v1` / **EPSG:5186** |
| `failed_cell_count` | **0** |
| Completion timestamp present | **true** (see the note below) |

**One recorded defect, fixed.** For this release `completed_at` carries the *start*
instant of the derivation attempt that finalized it, because `_finalize_version` reused
the run-start timestamp that every written row shares as `created_at`. The authoritative
wall-clock timings are on `ingestion_runs` (run 1243: 13:22:06Z → 17:20:49Z). The module
now takes the completion instant at finalize time, with a regression test asserting
`completed_at >= started_at`; the stored value above predates that fix and is reported as
it is rather than edited in place.

### B. Row identity

| Check | Result |
| --- | --- |
| Stored statistics rows | **47,893** |
| Canonical candidate cells | **47,893** |
| Duplicate identity keys | **0** |
| Missing expected keys | **0** |
| Unexpected keys | **0** |
| Geometry-fingerprint mismatches vs the canonical geometry | **0** |

### C. Areas

`cell_area_m2 <= 0`, `evaluated_area_m2 < 0`, `uncovered_area_m2 < 0`,
`overlap_area_m2 < 0`, `uncovered_residual_area_m2 < 0`, `coverage_ratio` outside [0, 1],
NaN/Infinity, and reconciliation violations beyond the documented guard: **0 each**.
Maximum `|(evaluated + uncovered) - cell|` residual: **3.39e-08 m²**.

### D. Coverage status

| Status | Cells | min ratio | max ratio | dominant NULL | zero evaluated | `ST_Covers` true |
| --- | --- | --- | --- | --- | --- | --- |
| `COMPLETE_EXACT` | 35,902 | 1.000000000 | 1.000000000 | 0 | 0 | 314 |
| `PARTIAL` | 4,604 | 0.000000681 | 1.000000000 | 0 | 0 | 0 |
| `NO_COVERAGE` | 7,387 | 0.000000000 | 0.000000000 | **7,387** | **7,387** | 0 |

`NO_COVERAGE` with non-zero evaluated area, with a dominant class, or with any class
row: **0 / 0 / 0**. `COMPLETE_EXACT` with a non-empty residual: **0**. `PARTIAL` without
positive evaluated area: **0**. `FAILED` rows: **0**. Unknown status values: **0**.

The `PARTIAL` maximum ratio of exactly 1.000000000 is the picometre-residual case of
§6.6 — genuinely partial under the exact emptiness rule, and deliberately **not**
reclassified.

### E. Class integrity

Unknown class codes, negative class areas, out-of-bounds shares (either denominator),
NULL evaluated-share where evaluated area is positive, duplicate class identities,
code/name conflicts, level-sum mismatches against the stored per-level sums, dominant L1
or L3 disagreeing with the largest stored class area, and class levels outside {1,2,3}:
**0 each**.

Observed dictionaries — **L1 = 7, L2 = 22, L3 = 41** — match the source release exactly.

### L1 class-area totals

| Code | Official name | Cells present in | Total km² |
| --- | --- | --- | --- |
| 100 | 시가화건조지역 | 35,778 | 1,837.7359 |
| 200 | 농업지역 | 30,135 | 1,521.0495 |
| 300 | 산림지역 | 34,194 | **4,370.9409** |
| 400 | 초지 | 35,740 | 1,298.5683 |
| 500 | 습지 | 18,935 | 175.2973 |
| 600 | 나지 | 33,803 | 498.8570 |
| 700 | 수역 | 16,940 | 280.3838 |

Sum = 9,982.833 km² = the aggregate evaluated area, as expected for a partitioning
source. All 22 L2 and 41 L3 class totals are stored in full and reconcile the same way;
the largest L3 classes are 활엽수림 2,693.70 km², 도로 1,249.22 km², 침엽수림 1,156.30 km²,
기타초지 1,117.49 km².

### Dominant L1 distribution

| Code | Name | Cells |
| --- | --- | --- |
| 300 | 산림지역 | **21,361** |
| 100 | 시가화건조지역 | 7,939 |
| 200 | 농업지역 | 7,579 |
| 400 | 초지 | 1,564 |
| 700 | 수역 | 978 |
| 600 | 나지 | 689 |
| 500 | 습지 | 396 |
| — | (no coverage → NULL) | 7,387 |

### F. Provenance

Rows linked to the active land-cover release: **47,893**; linked anywhere else: **0**.
`reference_period` = **2025**, `reference_date` **IS NULL** (never fabricated). Licence
note unchanged (EGIS/KOGL vector terms — written re-confirmation pending). Distinct
`area_crs` = `EPSG:5186`, distinct `derivation_version` = `land-cover-cell-stats-v1`,
distinct `candidate_grid_version` = `capital-grid-500m-v1` — one value each.

### Attempt history (honest)

| Run | Status | Rows inserted | Window |
| --- | --- | --- | --- |
| 1242 | **FAILED** (`INTERRUPTED_BY_USER`) | 0 | 2026-07-28 04:30:14Z → 04:56:43Z |
| 1243 | **SUCCEEDED** | 1,133,732 | 2026-07-29 13:22:06Z → 17:20:49Z |

---

## 11. Analytical baseline regression

A pre-derivation baseline was captured **before** migration 0020 was applied, and a
post-derivation baseline was captured afterwards using a **byte-identical SQL script**
(`logs/lc-cell-stats/baseline.sql`, Git-ignored) so the comparison is exact rather than
re-typed. Diffing the two files yields exactly **one** differing line.

| Anchor | Pre | Post | Δ |
| --- | --- | --- | --- |
| `suitability_analysis_runs_count` | 2 | 2 | — |
| `suitability_candidates_count` | 95,786 | 95,786 | — |
| `runs_md5` (versions, signature, status, candidate tallies) | `060a6cc222282d0f16649efec3cd8e7a` | `060a6cc222282d0f16649efec3cd8e7a` | — |
| `candidates_md5` (key, region, status, rank, all 4 component scores + totals, stability, areas) | `35882c0bb2b720c7a801899d31cfe0e5` | `35882c0bb2b720c7a801899d31cfe0e5` | — |
| `candidate_geometry_md5` (geometry + centroid EWKB per row) | `c6ae27fb198f43761cb98a6b6bbf962c` | `c6ae27fb198f43761cb98a6b6bbf962c` | — |
| `policy_versions` | `suitability-policy-v1` | `suitability-policy-v1` | — |
| `derivation_versions` | `suitability-screening-v1,suitability-screening-v2` | same | — |
| `grid_versions` | `capital-grid-500m-v1` | `capital-grid-500m-v1` | — |
| `lc_features` / `lc_map_sheets` / `lc_active_versions` | 6,901,309 / 2,013 / 1 | same | — |
| `wetland_features` / `wetland_md5` | 2,704 / `2a0b572ad0b7107e06abf2927c202133` | same | — |
| `env_dataset_versions` | 2 | 2 | — |
| `structural_features` / `_line_` / `_protected_` / `_dataset_versions` | 88,252 / 2,971,494 / 20,895 / 6 | same | — |
| `facilities` / `regional_population` / `regional_waste_statistics` | 651 / 748 / 234 | same | — |
| `landfill_inbound_monthly` / `facility_standard_costs` / `regions` | 9,212 / 15 / 82 | same | — |
| **`db_size_bytes`** | **17,254,846,947** | **17,571,869,155** | **+316,022,208** |

The single change is the database size, accounted for exactly by the three new tables
(§9.4). The baseline was captured three times — before the derivation, after the first
full write, and after the identical second write — and **`db_size_bytes` is the only line
that ever differs**. Between the two post-write captures it even *decreases* slightly
(17,571,992,035 → 17,571,869,155 B, −122,880 B) from routine free-space-map/vacuum churn,
with every row count and content checksum identical; the second write added no data. **No** suitability score, rank, status, policy version, derivation version,
candidate-grid version, candidate geometry, centroid, analysis run, structural feature,
wetland release, land-cover feature or map sheet, facility, population, waste, landfill,
or cost-reference row changed.

The only permitted additions were made and nothing else: the three new schema objects,
one statistics version row, 47,893 cell rows, 1,142,780 class rows, and two
`ingestion_runs` provenance rows (1242 FAILED, 1243 SUCCEEDED). In particular,
**`suitability_candidates` was not updated with these values** — that is explicitly out
of scope for this phase.

---

## 12. Tests

| Check | Result |
| --- | --- |
| `ruff format --check` (ingestion / backend) | **pass** — 83 / 87 files already formatted |
| `ruff check` (ingestion / backend, `src` + `tests`) | **pass** — all checks passed |
| `mypy --strict` (ingestion / backend) | **pass** — 44 / 52 source files, no issues |
| Python compile check (every file this branch touches) | **pass** |
| Alembic single head | **`0020 (head)`** |
| **Ingestion suite** (`ingestion/tests`) | **481 passed, 1 failed, 4 skipped** |
| — candidate-cell statistics tests | **27 passed** |
| — land-cover contract + ingestion tests | pass (included above) |
| **Backend suite** (`backend/tests`) | **447 passed, 8 failed, 3 errors** |
| — migration 0020 round-trip (`test_migration_land_cover_cell_stats_integration.py`) | **4 passed** |
| — land-cover migration + environmental registry | **14 passed** |

### New tests added by this phase

`ingestion/tests/test_land_cover_cell_statistics.py` (27) and
`backend/tests/test_migration_land_cover_cell_stats_integration.py` (4). Every fixture is
synthetic and clearly test-only; the PostGIS tier runs against the isolated
`TEST_DATABASE_URL` database and cleans up after itself. Coverage includes canonical
deduplication across runs, same-key/same-geometry accepted once, same-key/conflicting
geometry hard failure, empty-geometry hard failure (plus proof that NULL geometry is
impossible under the existing NOT NULL constraint), the 4326 prefilter classifier,
EPSG:5186 area measurement, clipped-cell actual area, fully/partially/non-covered cells,
one-class and multi-class cells, L1/L2/L3 areas, both share denominators, NULL evaluated
shares, the deterministic exact-tie dominant-class rule executed against the module's own
`DOMINANT_ORDER_BY` clause, union-prevents-double-counting, the overlap audit,
uncovered-area separation, verbatim code/name preservation, stable grid and statistics
identities, batch-size invariance, dry-run writing nothing, filtered-write prohibition,
first synthetic write, identical second synthetic write inserting zero rows, a failed run
never activating, a failed *re-verification* leaving an already-proven release active,
completeness-gated activation, `completed_at` ordering, migration upgrade/downgrade/
upgrade with every preserved table's row count unchanged, and assertions that no
score/weight/rank/exclusion/policy column, no geometry column, no spatial index, and no
suitability foreign key exists on the new tables.

### Pre-existing failures (reproduced on clean `main`, not caused here)

All 12 were reproduced on a temporary worktree at `main` (199a41f) before any of this
phase's work was committed, so they are separated from this branch rather than hidden:

| Failure | Cause |
| --- | --- |
| `test_rcis_reporting_geography_integration::test_reporting_build_is_idempotent_and_preserves_native` | data-dependent: the isolated test DB has no SGIS child regions for 경기도 수원시 |
| `test_facility_mapping_transparency_integration::test_migration_head_is_0016` | stale head assertion (head has been ≥ 0017 since Phase 1A) |
| `test_suitability_scenario_routes_integration::test_migration_head_is_0016_and_no_new_migration` | same stale head assertion |
| `test_migration_population_monthly_integration` × 6 | data-dependent FK failures on the unseeded test DB |
| `test_reporting_routes_integration` × 3 (errors) | same — "a regions row is required by the FK" |

`backend/` and `ingestion/` production code outside this phase's own files is unchanged,
and none of these tests exercise the new module, CLI, or migration. Skipped tests are
reported as skipped and are never represented as passing.

**One stale assertion was updated, deliberately.**
`test_migration_land_cover_integration::test_head_is_single_and_includes_0019` pinned
`get_current_head() == "0019"`, which this phase's migration would have broken. It now
asserts that a **single** head exists and that 0019 remains a linear ancestor — the
invariant the test was written to guard — rather than pinning a revision that every later
phase must edit. No production code was changed to make any test pass.

---

## 13. Limitations

- **Licence.** `LOCAL_USE_ONLY_PENDING_CLARIFICATION` is unchanged. This phase is
  private local technical analysis; no public display, public API, redistribution, or
  confirmed KOGL type is claimed for the vector product.
- **Regional source coverage is incomplete** and unchanged by this phase: Seoul ≈ 0.9503,
  Incheon ≈ 0.6108, Gyeonggi ≈ 0.8517, combined ≈ 0.8361 against the official SIDO
  boundaries. Those are *regional source* figures and are deliberately **not** copied
  into any cell row — each cell carries its own measured `coverage_ratio`. A cell with
  `NO_COVERAGE` means the acquired land-cover extent does not reach it; it does **not**
  mean the ground there has no land cover.
- **The land-vs-sea decomposition** of the uncovered area remains UNRESOLVED (no
  coastline reference was intersected), as in Phase 1B-LC2.
- **`ST_Covers` disagrees with the residual rule** on high-vertex clipped unions (§6.6).
  Both results are stored; the discrepancy is a GEOS robustness property, not a data
  defect.
- **Picometre-scale `PARTIAL` cells** are a real projection artifact (§6.6), reported
  honestly rather than reclassified.

---

## 14. Rollback

- **Schema/data rollback:** `alembic downgrade 0019` drops the three tables introduced
  here and everything in them. It touches no land-cover feature, map sheet, wetland,
  structural, suitability, or reference row — the round-trip test asserts every
  preserved table's row count is identical before and after.
- **Release rollback without a schema change:** clear `is_active` on the statistics
  version. Nothing reads it, so there is no downstream effect.
- **Interruption:** a batch-committed partial release stays `RUNNING`/`FAILED` and
  inactive. Inspect `environmental_land_cover_cell_stat_versions`,
  `environmental_land_cover_cell_statistics`, and `ingestion_runs` before any re-run;
  mark a stuck `RUNNING` attempt `FAILED`; then re-run the identical command, which
  reuses the release and fills only what is missing.

---

## 15. Next phase boundary

This phase produced a *description* of each candidate cell's land cover. It grants
`land_cover` **no** scoring role. The next phases remain out of scope until separately
authorized:

- a read-only API over these statistics (blocked for **public** exposure by the licence
  status; a private/local read is within the current authorization);
- vector tiles or any frontend map/legend;
- production/OCI derivation;
- any scoring component, exclusion criterion, weight, rank, or candidate-status change,
  each of which would require its own `policy_version` / `derivation_version` bump and a
  new suitability run, leaving historical runs immutable.

## 16. Recommendation for the later read-only API phase

**CONDITIONAL_GO.**

The data foundation is in place and verified: one active, complete statistics release
covering all **47,893** canonical cells with **0** FAILED cells, **0** duplicate or
missing keys, **0** geometry-fingerprint mismatches, **0** area/share/class integrity
violations, proven real-data idempotency, and a storage cost of only ~302 MB. The
derivation changed no suitability score, rank, status, policy version, derivation
version, candidate geometry, or historical run — proven by an exact before/after baseline
in which the only differing value is the database size.

The remaining conditions are not defects in this data; they must be resolved first:

1. **Licence — blocking for public exposure.** Status remains
   `LOCAL_USE_ONLY_PENDING_CLARIFICATION`. The dataset-specific EGIS/KOGL **vector**-use
   terms are unconfirmed, so a public API, public map, or any redistribution of raw or
   derived geometry must not proceed until they are reconfirmed in writing. A
   private/local read-only view is within the current authorization. Note that these
   statistics are *areal summaries*, not feature geometry, which may ease the eventual
   assessment — but that is a licence judgement, not a technical one, and is not assumed
   here.
2. **Coverage honesty is mandatory in any UI or response.** 7,387 of 47,893 cells
   (15.4 %) have **no** land-cover coverage at all, and Incheon sits at 0.614. Any
   consumer must present `coverage_status` and `coverage_ratio` alongside every
   composition figure, and must never let a `NO_COVERAGE` cell read as "no land cover
   here" — it means the acquired extent does not reach that cell.
3. **Production / OCI is `NOT_RUN`**, a prerequisite for a production-served API.
4. **Scoring stays out of scope.** A read-only API grants `land_cover` no scoring role;
   that remains a separate, explicitly gated decision.
