# Land-cover candidate-cell map layer, dynamic legend, and filters (Phase 1B-LC5B)

Map-wide visualization of the derived candidate-cell land-cover statistics that Phase
1B-LC3 persisted and Phase 1B-LC4 exposed. The complete 500 m candidate grid can now be
coloured by **coverage status** or by **dominant land-cover class** at any of the three
official hierarchy levels, filtered on both axes, and read from a legend that always
matches what the map is actually drawing.

Everything here is **descriptive and local-only**. Nothing in this phase is a score,
weight, rank, exclusion, review reason, or legal determination; nothing was deployed;
and the source licence remains pending written clarification.

---

## 1. Objective and phase boundary

**In scope, and delivered:** a read-only version-pinned MVT endpoint over the existing
LC3 statistics joined to existing candidate geometry; a MapLibre vector source with fill
and per-status outline layers; layer on/off, visualization-mode, L1/L2/L3, coverage-status
and dominant-class controls; a dynamic legend; loading/error/unavailable states;
accessibility and responsive behaviour; backend and frontend tests; query-plan evidence;
real local browser verification.

**Out of scope, and deliberately not done:** any raw land-cover polygon map or
`environmental_land_cover_features` API; rendering the 6.9 M source polygons;
source-feature click or detail; any change to suitability scoring, candidate scores,
ranks, statuses, exclusions, review reasons, weights, policies, or derivation versions;
any change to the LC3 statistics; a new persisted table for tiles or a second copy of the
candidate geometry; licence interpretation; DEM/terrain/slope work; OCI migration;
production deployment; public activation.

---

## 2. Why vector tiles, and not the JSON cell list

The LC4 `GET /cells` endpoint cannot render this map, by construction:

* it caps at **500 rows** per page (`MAX_PAGE_SIZE`), against **47,893** cells; and
* it carries **no geometry at all** — LC3 deliberately stores none, because the cell
  geometry already exists on `suitability_candidates`.

Paging 96 requests to assemble a map would also be the wrong shape: the viewport needs
the cells it can see, not the whole grid. A PostGIS MVT endpoint gives exactly that, and
it reuses the pattern the repository already runs for the suitability grid
(`/api/v1/suitability/tiles/...`) and the wetland inventory
(`/api/v1/environment/wetlands/tiles/...`).

---

## 3. Route contract

```
GET /api/v1/environment/land-cover/cell-statistics/tiles/{statistics_version_id}/{z}/{x}/{y}.mvt
```

Registered alongside the five existing LC4 endpoints under the same router prefix. The
six paths now served are:

| Path | Purpose |
| --- | --- |
| `/release` | active statistics release + provenance |
| `/summary` | area-weighted aggregate |
| `/cells` | bounded cell page |
| `/cells/{candidate_key}` | one cell's statistics |
| `/cells/{candidate_key}/classes` | one cell's class distribution |
| `/tiles/{statistics_version_id}/{z}/{x}/{y}.mvt` | **new** — map-wide vector tile |

### 3.1 Version-pinned URL

The frontend resolves `GET /release` first and builds the tile template from the served
`statistics_version_id`. The version is in the **path**, never implied by "whichever
release happens to be active when the tile is requested". This is what makes the one-year
immutable cache contract honest: a cached tile keeps meaning exactly what it meant when
it was minted.

Consequently `is_active` is **not** required by the tile endpoint. A release that has
been superseded but is still `SUCCEEDED` and complete is still served by id — otherwise
every immutably-cached URL would start failing the moment a newer release was activated,
which is precisely what pinning exists to prevent. Completeness is still enforced.

### 3.2 Errors

| Condition | Response |
| --- | --- |
| Unknown `statistics_version_id` | `404 STATISTICS_VERSION_NOT_FOUND` |
| Version not `SUCCEEDED` | `409 INCOMPLETE_ACTIVE_STATISTICS_RELEASE` |
| Version incomplete (`processed ≠ expected`, or failed cells) | `409 INCOMPLETE_ACTIVE_STATISTICS_RELEASE` |
| No canonical suitability run for the grid version | `409 CANONICAL_RUN_NOT_FOUND` |
| Lowest run of the grid version is not `SUCCEEDED` | `409 CANONICAL_RUN_NOT_FOUND` |
| Run's candidate count ≠ release's expected cell count | `409 CANDIDATE_GEOMETRY_CARDINALITY_MISMATCH` |
| `x`/`y` outside `[0, 2^z − 1]` | `422 INVALID_TILE_COORDINATE` |
| `z` outside `[0, 22]`, or non-integer `z`/`x`/`y`/version | `422` (FastAPI path validation) |
| Tile overlaps no cell | **`200`, zero bytes** — a valid empty tile |

An unknown or unusable version **never** falls back to another release. An empty viewport
and a broken layer stay distinguishable. No error body carries SQL, a connection string,
a filesystem path, or a stack trace (asserted by test).

### 3.3 Cache behaviour

* `Cache-Control: public, max-age=31536000, immutable`
* `ETag: "lc-cells-{version}-{run}-{z}-{x}-{y}"` — content-independent and deterministic
* `If-None-Match` → `304` with the same cache headers

The **canonical run** is part of the ETag key, not just the version, so a tile can never
be revalidated against geometry it was not generated from.

*Only local behaviour was verified.* No claim is made about production caching, CDN
behaviour, or reverse-proxy interaction.

---

## 4. Canonical candidate geometry

LC3 canonicalized the grid by taking, per `(candidate_grid_version, candidate_key)`, the
occurrence with the lowest `(analysis_run_id, id)`. The geometry every stored measurement
was taken on is therefore the **lowest analysis run of the release's grid version**.

`_resolve_canonical_run` resolves exactly that run — not "the newest", not "any
succeeded" — and refuses two conditions rather than working around them:

* **no `SUCCEEDED` run** for the grid version → `CANONICAL_RUN_NOT_FOUND`;
* **a lower-id run exists but is not `SUCCEEDED`** → `CANONICAL_RUN_NOT_FOUND`, because
  LC3's canonical occurrence would come from that run, so serving the lowest *succeeded*
  run would silently draw different geometry than was measured.

### 4.1 Cardinality guard

`suitability_candidates` has `UNIQUE (analysis_run_id, candidate_key)`, so pinning one run
already guarantees at most one geometry per key — no `DISTINCT ON` over every occurrence
is needed, and no candidate key can appear twice in a tile.

"At least one" is checked by comparing the run's recorded `candidate_count_total` against
the release's `expected_cell_count`. This is an **O(1) check on two stored scalars**, not
a per-request count of 47,893 rows.

*What it proves, precisely:* combined with the UNIQUE constraint, that the run holds
exactly as many candidate rows as the release expects cells. *What it does not prove:*
that the two key sets are identical. That stronger property was verified directly against
the live database, read-only, at implementation time:

```
run 1: 47,893 rows, 47,893 distinct candidate_key
statistics version 1: 47,893 cells
statistics cells with no matching geometry in run 1: 0
```

`candidate_count_total` is `NOT NULL DEFAULT 0`, so a run that never recorded a count
carries `0`, which cannot equal a non-zero expected count — the unverifiable case is
therefore refused rather than assumed correct.

### 4.2 Live canonical resolution

| Property | Value |
| --- | --- |
| Grid version | `capital-grid-500m-v1` |
| Runs on that grid | 2 (`id` 1 and 47, both `SUCCEEDED`) |
| Canonical run | **1** |
| Candidate rows in run 1 | 47,893 |
| Expected statistics cells | 47,893 |

---

## 5. Tile SQL

```sql
WITH bounds AS (
    SELECT ST_TileEnvelope(:z, :x, :y)                     AS geom_3857,
           ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
),
tile AS (
    SELECT ST_AsMVTGeom(ST_Transform(c.geometry, 3857), bounds.geom_3857, 4096, 64, true) AS geom,
           s.candidate_key, s.statistics_version_id, s.coverage_status, s.coverage_ratio,
           s.dominant_l1_code, s.dominant_l1_name,
           s.dominant_l2_code, s.dominant_l2_name,
           s.dominant_l3_code, s.dominant_l3_name,
           s.sido_region_code, s.sigungu_region_code
    FROM bounds
    JOIN suitability_candidates c
      ON c.analysis_run_id = :run_id
     AND c.geometry && bounds.geom_4326
    JOIN environmental_land_cover_cell_statistics s
      ON s.statistics_version_id  = :version_id
     AND s.candidate_grid_version = :grid_version
     AND s.candidate_key          = c.candidate_key
)
SELECT ST_AsMVT(tile.*, 'land_cover_cells', 4096, 'geom' ORDER BY tile.candidate_key)
FROM tile
WHERE tile.geom IS NOT NULL
```

Properties that matter:

* **Filter before transform.** The envelope is transformed to EPSG:4326 for the
  predicate, so `geometry && bounds` hits the existing
  `idx_suitability_candidates_geometry` GiST index; only *matched* geometries are
  transformed to 3857. The full candidate table is never transformed inside the predicate.
* **One release, one grid, one run.** A tile can never straddle two releases or two runs.
* **Every user-controlled value is a bound parameter** (version, z, x, y).
* **The aggregate is explicitly ordered by `candidate_key`.** See §5.1.
* `environmental_land_cover_features` and `environmental_land_cover_map_sheets` are
  **absent from the SQL** — asserted structurally by a test that greps the statement, and
  behaviourally by a test that watches `pg_stat_all_tables.seq_scan` on the 6.9 M-row
  feature table across repeated tile requests.

### 5.1 Why the aggregate is ordered — a real defect found and fixed

Without `ORDER BY`, the planner is free to feed `ST_AsMVT` in whatever order the join
produces, and at low zoom it chooses a **parallel** hash join whose row order varies
between executions. Because MVT delta-encodes each feature's geometry against the
previous one, the *bytes* of a z8 tile differed between regenerations of identical
content — measured across three runs at **2,889,942 / 2,905,651 / 2,919,241 bytes**.

That would quietly contradict the content-independent ETag: two byte-different responses
sharing one validator. Ordering the aggregate by `candidate_key` makes the tile
byte-deterministic (three consecutive generations: **2,609,329 bytes each**) and, as a
side effect, ~11 % smaller, because ordering by key groups spatially adjacent cells so
delta encoding compresses better.

The cost is a sort over the already tile-filtered rows — 25 kB–3.2 MB quicksort at z8,
25–103 kB at z12. It also changed the z8 plan from a parallel sequential scan of the
statistics table to an index scan, so **no representative tile plan contains a sequential
scan any more**.

---

## 6. Source layer and tile attributes

**Source-layer name:** `land_cover_cells` — deliberately distinct from the suitability
`candidates` and the wetland `wetlands` source-layers, so the three optional map layers
can never be confused for one another.

| Attribute | Notes |
| --- | --- |
| `candidate_key` | canonical `<grid version>:<i>_<j>` identity |
| `statistics_version_id` | the pinned release |
| `coverage_status` | `COMPLETE_EXACT` / `PARTIAL` / `NO_COVERAGE` |
| `coverage_ratio` | 0–1 |
| `dominant_l1_code` / `dominant_l1_name` | official code + Korean name, verbatim |
| `dominant_l2_code` / `dominant_l2_name` | official code + Korean name, verbatim |
| `dominant_l3_code` / `dominant_l3_name` | official code + Korean name, verbatim |
| `sido_region_code` | normalized SIDO code |
| `sigungu_region_code` | normalized SIGUNGU code |

**Never in the tile:** source feature ids or FIDs, raw land-cover attributes, land-cover
geometry, map-sheet codes, class-distribution arrays, per-feature disclosure text,
provenance/audit fields, or any suitability score/rank/status. Asserted by a test that
checks the decoded property set is a subset of the allowed set and that a list of banned
keys is absent.

**A `NO_COVERAGE` cell carries no dominant class at any level.** Those columns are NULL
in LC3 and `ST_AsMVT` omits NULL properties, so the keys are genuinely absent (MapLibre
reads that as null) rather than filled with a fabricated "unknown" value. Verified on the
live Seoul tile: 34 of 267 features are `NO_COVERAGE`, and none carries a
`dominant_l*` key.

---

## 7. Query-plan evidence and measured performance

`EXPLAIN (ANALYZE, BUFFERS)` against the live local database, warm, with the ordered
aggregate in place. Six representative viewports:

| Viewport | z/x/y | Rows emitted | Execution | Tile bytes | Index usage |
| --- | --- | ---: | ---: | ---: | --- |
| Broad capital region | 8/218/99 | 31,432 | 1,387.0 ms | 2,609,329 | GiST + run index (BitmapAnd); statistics via `ix_land_cover_cell_statistics_candidate_key` |
| Seoul urban | 12/3492/1586 | 267 | 13.7 ms | 24,402 | GiST + run index; statistics index scan |
| Incheon coastal/island | 12/3485/1585 | 23 | 1.8 ms | 2,680 | GiST index scan; statistics index scan |
| Gyeonggi (Suwon) | 12/3493/1590 | 272 | 39.4 ms | 25,098 | GiST + run index; statistics index scan |
| High zoom, few cells | 14/13970/6344 | 20 | 3.0 ms | 2,212 | GiST index scan; statistics index scan |
| Empty viewport (ocean) | 12/3464/1622 | 0 | 0.3 ms | 0 | GiST index scan; statistics never executed |

Observations, stated honestly:

* **No sequential scan** appears in any representative plan.
* The **GiST index on candidate geometry drives every plan**, as intended by
  filter-before-transform.
* Typical interaction zooms (z12–z14) are **single-digit to low-tens of milliseconds** and
  a few kilobytes to ~25 kB per tile.
* The **broad z8 tile is genuinely heavy**: ~1.4 s and ~2.6 MB, because nearly the whole
  47,893-cell grid falls inside one z8 tile. This is the same cost class as the
  already-shipped suitability tile at the same coordinate, which measured **6.8 s** in the
  same environment — so LC5B is not introducing a new performance class, and is in fact
  cheaper. It is nonetheless the layer's weakest point and is carried forward to LC6.
* A practical consequence, observed in the browser: at the default capital-region view the
  legend's class vocabulary can take longer than a few seconds to populate, because it is
  read from tiles that are still arriving. The live spec therefore waits on the legend
  rather than on a fixed timeout.

### 7.1 No migration was added

No migration was written. The plans show every filter served by an existing index:

* `idx_suitability_candidates_geometry` (GiST, EPSG:4326) — the spatial predicate;
* `ix_suitability_candidates_analysis_run_id` — the canonical-run pin;
* `ix_land_cover_cell_statistics_candidate_key` — the statistics join.

The only sequential scan ever observed was on `environmental_land_cover_cell_statistics`
in the pre-ordering z8 plan, contributing ~20 ms of ~1,200 ms — not harmful, and it no
longer occurs. **Alembic remains at a single head, `0020`**, before and after.

---

## 8. Frontend

### 8.1 Source and layer IDs

| ID | Type | Purpose |
| --- | --- | --- |
| `land-cover-cells` | vector source | version-pinned MVT template, `minzoom 0`, `maxzoom 14` |
| `land-cover-cells-fill` | fill | coverage or dominant-class colour |
| `land-cover-cells-complete-outline` | line | solid hairline, `COMPLETE_EXACT` only |
| `land-cover-cells-partial-outline` | line | **dashed**, `PARTIAL` only |
| `land-cover-cells-nocoverage-outline` | line | **dotted**, `NO_COVERAGE` only |

`maxzoom 14` matches the suitability candidate source: the same 500 m grid, so MapLibre
overzooms above it rather than requesting a swarm of sub-cell tiles.

### 8.2 Layer ordering

Bottom to top:

```
osm basemap
  → regions-fill / regions-outline        (equity choropleth)
  → wetlands-fill / wetlands-outline      (optional layer)
  → candidates-fill / -review-outline / -stable-outline
  → land-cover-cells-fill / three outlines      ← LC5B
  → facilities-points
  → selected-candidate-fill / selected-candidate-outline
```

The land-cover layers are inserted with `addLayer(spec, "facilities-points")`, so they sit
**above** the candidate fill (otherwise the layer they exist to show would be invisible
beneath it) and **below** the facility symbols and the selected-candidate highlight, which
must never be obscured. The `beforeId` insertion makes this hold in both orders — enabling
the layer before or after selecting a candidate — which is asserted by two separate tests.

Fill opacity stays below 1 (0.72 / 0.60 / 0.34 by coverage status) so the suitability grid
underneath remains perceptible.

### 8.3 Candidate clicks are preserved

No click handler is registered on any land-cover layer. Candidate selection remains the
single model: `map.on("click", "candidates-fill", …)`, which MapLibre delivers per-layer
regardless of what is painted above. Verified in a real browser — with the land-cover fill
enabled and covering the cell, clicking the map still opens the candidate popup and the
existing candidate-detail panel, including the LC5A land-cover section.

### 8.4 Tile URL helper

`landCoverCellTileUrl(statisticsVersionId)` builds
`{base}/api/v1/environment/land-cover/cell-statistics/tiles/{id}/{z}/{x}/{y}.mvt`.

It uses the existing `apiBaseUrl()` convention and resolves an empty production base to
`window.location.origin`, because MapLibre fetches tiles from a Web Worker whose base URL
is a `blob:` URL and a bare relative path would not resolve there. No host, IP, or domain
is ever hardcoded — asserted by test, including that the production form contains no
`localhost`, no port, no dotted-quad IP, and no `sslip.io`.

---

## 9. Visualization modes

### 9.1 Coverage-status mode (default)

| Status | Fill | Outline | Legend label |
| --- | --- | --- | --- |
| `COMPLETE_EXACT` | `#2a7f62` teal-green, 0.72 opacity | solid `#1d5a46` hairline | 격자 전체 평가 |
| `PARTIAL` | `#a4552b` dark brown-orange, 0.60 | **dashed** `#7a3d1f` | 격자 일부만 평가 |
| `NO_COVERAGE` | `#8d93a0` neutral grey, 0.34 | **dotted** `#6b7280` | 격자 미평가 |

Colour is never the only distinction. Each state additionally carries its own opacity, its
own line treatment, an explicit Korean legend label, the machine status in secondary text,
and a one-line meaning. `PARTIAL`'s tone is deliberately far from the suitability review
amber (`#e8a33d`) so the two never blur.

`NO_COVERAGE` uses a neutral desaturated grey — not green, not white, not a "clear"
treatment — and its legend row carries the required warning verbatim:

> 확보된 자료의 범위가 이 격자를 평가하지 않았습니다. 토지피복이 없거나, 비어 있거나,
> 이용되지 않는 땅이라는 뜻이 아니며, 적합하거나 안전하다는 뜻도 아닙니다.

### 9.2 Dominant-class mode

L1 대분류 / L2 중분류 / L3 세분류, read from the matching tile attributes. Official Korean
names and codes are shown exactly as served — never translated, renamed, regrouped, or
merged. A cell with no dominant class at the active level keeps the unevaluated grey
treatment via an explicit `["!", ["has", "dominant_lN_code"]]` branch; it is never assigned
to an invented "기타"/"Unknown"/"Other" bucket.

Live class counts observed in the active release (dominant classes actually present):
**7** at L1, **21** at L2, **34** at L3.

### 9.3 Deterministic colour strategy

`landCoverClassColor(code)` is a **pure function of the official code string**:

* the leading character selects a hue from a fixed 10-entry table;
* the second digit indexes a lightness lattice, the third a saturation lattice;
* an unexpected code shape falls back to a stable FNV-1a hash of the whole string.

Properties, all unit-tested:

* the same code always yields the same colour — independent of load order, of which tiles
  are loaded, and of how many classes are visible, so panning can add legend rows but can
  never recolour one;
* distinct codes of the standard three-digit shape can never collide (7/21/34 distinct
  colours asserted for the three levels);
* the output is a plain `#rrggbb` string;
* a reversed input list yields identical colours.

Because the lattices are indexed by the trailing digits and every 대분류 code ends in `00`,
the seven L1 classes land on the most legible point of the lattice. Codes sharing a
leading digit receive related hues, which is what keeps a 34-row 세분류 legend readable.
**This is a deterministic rendering of the code space, not a claim about the official
hierarchy, and no hue asserts suitability, risk, legality, or availability.**

---

## 10. Filters

### 10.1 Semantics

* **Within the coverage group: OR** — a cell is kept when its status is any enabled status.
* **Within the dominant-class group: OR** — a cell is kept when its dominant class at the
  **active level** is any not-hidden class.
* **Between the two groups: AND.**
* **A cell with no dominant class is governed by the coverage group alone.** Every
  `NO_COVERAGE` cell has no dominant class at any level; making the class group exclude it
  would delete it from the map the moment any class was unchecked, which would hide a real
  state under the guise of filtering a class.
* **Class filtering applies only in dominant-class mode**, the only mode that offers the
  class list — so the legend always describes what the map is doing.

Class visibility is stored as **hidden** codes per level, not as visible ones, so a class
first seen after a pan defaults to visible: the map never silently drops a class the
reader has not decided about.

### 10.2 Empty selection

`landCoverSelectionEmpty` reports an explicit "현재 필터로 선택된 격자가 없습니다" state —
the map is never silently reverted to "show everything". It is true when no coverage status
is enabled, or (in dominant mode) when every class observed so far is hidden **and**
`NO_COVERAGE` is disabled. The basis is "observed so far", because the vocabulary comes
from loaded tiles; that is stated in the UI rather than presented as a full vocabulary.

### 10.3 No source reloads for filter changes

Mode, level, coverage and class changes are `setPaintProperty` / `setFilter` calls only.
The vector source is removed and re-added **only** when the version-pinned tile URL itself
changes. Verified in a real browser: switching L1→L2→L3 issues **zero** additional tile
requests.

Turning the land-cover layer off does not touch the user's suitability status filters, and
vice versa — asserted both in unit tests and in the live browser spec.

---

## 11. Dynamic legend

The legend and the filters are **one list**, produced by `landCoverLegendEntries` from the
same values the paint and filter expressions are built from, so a legend row can never
describe styling the map is not applying.

* **Coverage mode:** three rows — swatch, Korean label, machine status, one-line meaning,
  and the visibility state written out in text (`표시 중` / `숨김`). The canonical
  checkboxes for these three states are the 평가 범위 필터 group, so the rows are read-only
  and there is exactly one control per filter.
* **Dominant-class mode:** one row per class actually served into the loaded tiles —
  checkbox, deterministic swatch, official Korean name, official code — plus a row count
  and a note stating where the vocabulary comes from.

### 11.1 Keeping L2/L3 usable

* a bounded scroll region (`max-h-40`, `overflow-y-auto`) so dozens of rows never push the
  card off-screen;
* a **search box** filtering by code or official Korean name (filtering the *list* never
  filters the *map*: a row hidden by search keeps whatever visibility its checkbox has);
* **모두 표시 / 모두 숨김** bulk actions for the active level;
* a live row count;
* `break-words` on names and `min-w-0` throughout, so long Korean names wrap instead of
  forcing horizontal overflow.

---

## 12. Accessibility

* Layer on/off is a labelled native checkbox.
* Visualization mode is a `role="radiogroup"` with an accessible name (표시 방식) of native
  radios; the L1/L2/L3 control is a second labelled radio group (분류 단계).
* Coverage filters are labelled native checkboxes carrying both the Korean label and the
  machine status in text.
* Class filters are labelled native checkboxes; the search box has an `sr-only` label.
* Every control is focusable and keyboard-operable without a custom widget; focus
  treatment is the platform default the rest of the app uses.
* Status and class are **never conveyed by colour alone** — every swatch is `aria-hidden`
  decoration beside required text.
* The `NO_COVERAGE` row carries its full semantic warning as readable text.
* **No new `<fieldset>`** is introduced, so the page's existing "exactly three fieldsets"
  accessibility assertions still hold (asserted directly in the control's own test).

---

## 13. Responsive behaviour

The optional-layer controls (wetlands, land cover) are now stacked in one top-left column
inside the map pane, `w-[min(86vw,272px)]`, with `pointer-events-none` on the wrapper and
`pointer-events-auto` on each card so the gap between them stays click-through to the map.
The wetland control lost its own absolute positioning and now fills that column; its
behaviour is otherwise unchanged.

Verified in a real browser at 1440×900 and 375×720: the card stays within the viewport, the
page never scrolls horizontally, and the legend's scroll region stays bounded (< 300 px).
The pre-existing responsive suite (34 tests across mobile/tablet/narrow-desktop/desktop)
passes unchanged.

---

## 14. Error handling and isolation

The layer resolves `GET /release` once per entry into suitability mode, validates the
response with `validateActiveRelease`, and disables itself with a bounded message on any
failure. Failure kinds are bounded (`NOT_FOUND` / `UNAVAILABLE` / `MALFORMED`) and their
messages never imply that land cover is absent, and never carry SQL, a path, a connection
string, or a stack trace.

A land-cover failure **never** breaks the base map, the suitability candidate layer,
facility markers, candidate selection, the LC5A detail panel, or Equity mode. Verified in a
real browser by forcing (a) every tile request to 500 and (b) the release endpoint to 500,
then confirming the rest of the map still works.

Other states handled: no active release; malformed release response; empty viewport; all
filters disabled; layer disabled; leaving suitability mode; missing dominant class;
`NO_COVERAGE`; map style reload (a fresh map instance rebuilds source and layers with the
same ids); source/layer already present or temporarily absent.

---

## 15. Test results

### Backend

| Gate | Result |
| --- | --- |
| `ruff format --check` (changed files) | clean |
| `ruff check .` | **All checks passed** |
| `mypy` (configured strict scope, `src/waste_equity_backend`) | **no issues, 54 source files** |
| New tile integration tests (`test_land_cover_cell_tiles_integration.py`, PostGIS) | **36 passed** |
| LC4 focused + integration + new tile tests | **136 passed** |
| Existing suitability + wetland tile tests | **69 passed** |
| Full backend suite | **583 passed, 8 failed, 3 errors** |

The 8 failures and 3 errors are **pre-existing and unrelated**: migration-head assertions
pinned to `0016` (the database is at `0020`) and data-dependent reporting fixtures. The
identical 11-item failure list was reproduced on the pre-change tree by stashing this
phase's work, so none of them is an LC5B regression. They were not "fixed" by touching
unrelated production code.

One pre-existing `ruff format --check` drift exists in
`alembic/versions/20260719_0016_suitability_critic_stability.py`, a file this phase does not
touch.

### Frontend

| Gate | Result |
| --- | --- |
| `npm run lint` (ESLint) | clean |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| Focused land-cover/map tests (6 files) | **248 passed** |
| Complete Vitest suite | **933 passed, 7 skipped** |
| `npm run build` (production Next.js) | **compiled successfully** |

Baseline before this phase was **806 passed, 7 skipped**; LC5B adds **127** tests. The 7
skipped are the LC5A live tests that require `LC_LIVE_BACKEND_URL`; they are reported as
skipped, not passed.

The complete suite is run with `--testTimeout=30000`. At the default 5 s per-test timeout
the suite exhibits pre-existing flaky timeouts under full parallel load — reproduced on the
pre-change tree (16 failed / 790 passed there), and every affected file passes in isolation
on both trees.

### Browser (real Chrome, live local backend)

Playwright-managed Chromium is absent in this environment, so specs run on the installed
Chrome channel.

| Spec | Result |
| --- | --- |
| `e2e/landCoverLayer.spec.ts` (live, `E2E_BACKEND_URL`) | **10 passed** |
| `e2e/responsive.spec.ts` (self-mocked) | **34 passed** |
| `e2e/map.spec.ts` + `phase4EquityMap.spec.ts` (live) | 31 passed, **3 pre-existing failures** |

The three `map.spec.ts` failures were reproduced on the pre-change tree and are unrelated
to land cover: an outdated metric-metadata expectation (the UI now shows the Korean gloss),
a facility-burden lower-bound `NaN` parse, and an expectation of `suitability-policy-v1`
where the live database carries `suitability-policy-v2`.

`responsive.spec.ts` was run through a temporary Chrome-channel Playwright config, which
was deleted immediately afterwards and never staged; the repository's
`frontend/playwright.config.ts` is unchanged.

---

## 16. Browser verification performed

All against the real local backend and the real LC3 release, in real Chrome:

1. Equity mode works and mounts no land-cover control.
2. Suitability mode works.
3. The layer is **OFF by default**.
4. Enabling it requests version-pinned `…/tiles/{version}/{z}/{x}/{y}.mvt` tiles, and the
   version shown in the control matches the version in the URL.
5–8. Coverage mode renders all three statuses with three distinct swatch colours, Korean
   labels, machine statuses, and the `NO_COVERAGE` warning.
9. Coverage filters show/hide correctly and round-trip; disabling all three produces the
   explicit empty-selection state.
10–13. Dominant-class mode and all three level selectors work, each with **zero** tile
   refetches.
14. Class filters mark a class hidden without removing its row.
15. The legend tracks the active level and shows official three-digit codes with no
   invented category.
16. The long 세분류 legend stays usable: bounded scroll (< 300 px) and working search.
17. Clicking the map with the land-cover fill painted above still opens the candidate popup
   and the candidate detail.
18. The LC5A land-cover detail panel still loads after a map click.
19. Rapid mode/level changes leave no stale styling.
20. Turning the layer off restores the normal suitability map with its status filters
   intact.
21. Leaving suitability mode removes the control.
22. Returning behaves predictably, with filters preserved.
23–24. Desktop (1440×900) and mobile (375×720) layouts work with no horizontal overflow.
25. No raw land-cover feature/geometry/map-sheet endpoint is ever requested.
26. Tile URLs contain the statistics version.
27. Forced tile failures do not break the rest of the map; a forced release failure
   disables only this layer.

---

## 17. Database baseline comparison

A read-only baseline was captured before implementation and again after implementation,
tests, the backend image rebuild, and browser verification. **All fifteen metrics are
byte-identical:**

| Metric | Before | After |
| --- | --- | --- |
| `alembic_revision` | `0020` | `0020` |
| `suitability_run_count` | 2 | 2 |
| `suitability_candidate_count` | 95,786 | 95,786 |
| `suitability_score_rank_status_checksum` | `4434b4f4…da36` | identical |
| `suitability_candidate_geometry_checksum` | `894db074…8b34` | identical |
| `suitability_policy_derivation_versions` | runs 1 & 47, policy-v1, screening-v1/v2 | identical |
| `lc3_active_statistics_version` | 1 | 1 |
| `lc3_version_checksum` | `dcbf2033…4f03` | identical |
| `lc3_cell_count` | 47,893 | 47,893 |
| `lc3_class_row_count` | 1,142,780 | 1,142,780 |
| `lc3_cell_checksum` | `7ebf2844…3d0` | identical |
| `lc3_class_checksum` | `a8ffb1a9…451f` | identical |
| `land_cover_feature_count` | 6,901,309 | 6,901,309 |
| `environmental_dataset_version_count` | 2 | 2 |

No MVT request caused a write. Suitability runs, candidates, scores, ranks, statuses,
geometries, policy versions and derivation versions are unchanged; LC3 statistics versions,
cells and class rows are unchanged; normalized land-cover features are unchanged.

The live release was verified read-only and matches every historical value: one active
`SUCCEEDED` release (`statistics_version_id` 1), grid `capital-grid-500m-v1`, 47,893
expected = 47,893 processed, 0 failed, `COMPLETE_EXACT` 35,902 / `PARTIAL` 4,604 /
`NO_COVERAGE` 7,387, 1,142,780 class rows, source reference period 2025.

---

## 18. Lifecycle after this phase

| Aspect | State |
| --- | --- |
| Source contract validation | `LIVE_VERIFIED` |
| Source ingestion | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| Candidate-cell statistics | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| API exposure | `IMPLEMENTED` |
| Vector tiles | `IMPLEMENTED_AND_LOCALLY_VERIFIED` ← this phase |
| Frontend map exposure | `IMPLEMENTED_AND_LOCALLY_VERIFIED` ← this phase |
| Scoring integration | **`NOT_IMPLEMENTED`** |
| Production deployment | **`NOT_RUN`** |
| Licence / public-use status | **`LOCAL_USE_ONLY_PENDING_CLARIFICATION`** |

---

## 19. Standing constraints this phase did not change

* **Licence.** The acquired 토지피복지도 release's public-use terms remain pending written
  confirmation from the provider. KOGL Type 1 is not claimed; commercial use is not
  claimed. Local analytical use only. This is why the layer defaults to **OFF**, alongside
  the fact that it is locally verified only and must not obscure the suitability
  visualization unrequested. **Update (LC7, 2026-08-02):** the licence review returned
  **`UNRESOLVED_PENDING_WRITTEN_RESPONSE`** — no 공공누리 mark is published for the
  downloaded vector product, so this layer and its tiles **must not be deployed publicly**
  until LC7A returns a written answer. See
  [LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md).
* **Scoring.** Nothing here is read by any suitability code path. No score, rank, status,
  exclusion, review reason, weight, policy version, or derivation version changed, and
  every response still states `used_in_suitability_scoring: false`.
* **No raw feature exposure.** No raw land-cover geometry, per-feature record, source
  attribute, or map-sheet identifier is exposed by any endpoint or reaches the browser.
* **Local only.** Everything was verified against a local development database and a
  locally-running frontend. No OCI migration, no production deployment, no public
  activation, and no claim about production behaviour.
* **No raw source access.** The external USB, the raw EGIS shapefiles, and the local EGIS
  evidence PDFs were not accessed by this phase.

---

## 20. Known limitations

1. **Low-zoom tiles are heavy.** The z8 tile covering the capital region is ~2.6 MB and
   ~1.4 s of database time, because nearly the whole grid falls inside it. It is cheaper
   than the already-shipped suitability tile at the same coordinate (6.8 s), but it is the
   layer's weakest point. No `minzoom` floor was imposed, because that would make the layer
   invisible at the default view.
2. **The class vocabulary is viewport-derived.** Filter and legend entries come from the
   classes present in the tiles loaded so far, merged as more tiles arrive. This is stated
   in the UI. It means the list can grow while panning, and at first paint it may briefly
   be empty. A release-wide dominant-class endpoint would remove that, but adding one was
   outside this phase's scope.
3. **The cardinality guard is O(1), not exhaustive.** It compares stored scalars (see
   §4.1). The exhaustive key-set equality was verified once, read-only, against live data
   rather than on every request.
4. **Caching is verified locally only.** The immutable/ETag/304 contract was exercised
   against the local backend; no CDN or reverse-proxy behaviour was tested.
5. **The full frontend suite needs a raised per-test timeout** on this machine because of
   pre-existing flakes under parallel load.
6. **Playwright-managed Chromium is absent**, so browser verification used the installed
   Chrome channel.

---

## 21. Next phase

**LC6 — integrated local QA, performance, and regression review.** In particular: the
low-zoom tile cost in §20.1, an end-to-end pass over the LC2→LC5B chain, and a consolidated
regression review before any licence resolution, scoring integration, or deployment is
considered.
