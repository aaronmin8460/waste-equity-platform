# Land-cover integrated local QA — Phase 1B-LC6

> ## ⚠️ Superseding operational note — 2026-08-02 (Phase 1B-LC8)
>
> **The LC7 findings in this document are historical evidence review and are NOT
> withdrawn.** They record, accurately, what the official public sources showed on
> 2026-08-02: LC7 **could not establish a dataset-specific EGIS licence** for the vector
> 「세분류 [2025] 전국 토지피복지도」 download from public evidence, and the 공공누리 (KOGL)
> Type 1 mark it found belongs to the separate WMS map service, not to the SHP download.
>
> What changed is the **operational basis for publication**, not that finding. On
> 2026-08-02 the project owner confirmed **project-level authorization from the
> cooperating government institution** with which this project is conducted. The project
> therefore proceeds with **full public deployment under that project authorization**:
>
> * authorization basis — `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`
> * public deployment status — `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER`
> * **no EGIS-specific KOGL type is asserted**, and this is **not** an EGIS written reply
> * **original SHP files and raw source geometry remain unavailable for redistribution**
> * derived APIs, derived MVT tiles, browser display, screenshots, and public
>   presentation **are enabled** for this project
> * **LC7A is no longer the blocking next phase**; **LC8** is the current implementation
>   and deployment phase
>
> The two facts stay distinct and must not be merged: (1) *dataset-specific public
> evidence* remains `UNRESOLVED_PENDING_WRITTEN_RESPONSE`; (2) *project-level
> government-partner authorization* is `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`.
> See [PUBLIC_DATA_PROJECT_AUTHORIZATION.md](PUBLIC_DATA_PROJECT_AUTHORIZATION.md) and
> [LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md](LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md).



End-to-end local verification of the complete land-cover subsystem built across
LC3 → LC5B: persisted candidate-cell statistics (LC3), the read-only JSON API (LC4),
the candidate-detail frontend section (LC5A), and the map-wide candidate-cell vector
tile layer with its dynamic legend and filters (LC5B).

This phase is **QA, performance analysis, regression verification and operational
validation**. It added no feature. Two small, evidence-backed production fixes were
made (§9), each reproduced first and covered by a test.

Everything here was measured on a **local development environment only**. Nothing was
deployed. The licence position is unchanged and still pending clarification, and the
statistics remain outside suitability scoring.

> **Follow-up (Phase 1B-LC7, 2026-08-02).** The licence question LC6 left open was
> investigated and returned **`UNRESOLVED_PENDING_WRITTEN_RESPONSE`** — deployment
> eligibility is **BLOCKED**, so the subsystem QA'd here stays local-only pending
> **LC7A**. See
> [LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md).

---

## 1. Verified starting point

| Item | Value |
| --- | --- |
| Branch | `chore/land-cover-lc6-integrated-local-qa` |
| Created from | `main` |
| Starting commit (full) | `9e1a40f3329e7498e57b70b40da10bce79f1690e` |
| Starting commit subject | `feat: add candidate-cell land-cover map layer and filters` |
| `origin/main` at start | `9e1a40f3329e7498e57b70b40da10bce79f1690e` (identical) |
| Working tree at start | clean except one untracked file (below) |
| Alembic revision / heads | `0020` / exactly 1 head |

`docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` was present as an **untracked** file at the
start of the phase and was not read, modified, moved, staged, or committed. It remains
untracked and byte-identical.

No pre-existing LC6 branch existed; the branch was created fresh from the verified
`main`.

### Environment

| Component | Version |
| --- | --- |
| macOS / arch | 15.7.8 / x86_64 |
| Docker / Compose | 28.4.0 / v2.39.4-desktop.1 |
| Database container | `postgis/postgis:16-3.4` — PostgreSQL 16.4, PostGIS 3.4 (GEOS, PROJ, STATS) |
| Backend container | `waste-equity-platform-backend` (image bakes backend source) |
| Test database | `wep-testdb` on port 5433 (`postgresql+psycopg://test:test@localhost:5433/test`) |
| Python | 3.12.13 (`backend/.venv`) |
| Node / npm | v22.22.0 / 11.8.0 |
| Browser | Google Chrome 150.0.7871.187 (bundled Playwright Chromium is **not** installed) |
| Frontend port | 3000 (required by the backend CORS allowlist) |

The local Docker database volume `waste-equity-platform_pgdata` was preserved
throughout. No `docker compose down -v`, `docker volume rm`, or `docker system prune`
was run. The only container lifecycle action was a single `docker compose restart
backend` as a deliberate failure-injection step (§8.9); the database container was never
restarted or recreated.

`/ready` returns **HTTP 404**. This is existing repository behaviour — the route does not
exist — and LC6 deliberately did **not** add one, as that would be unrelated scope.
`/health` returns 200 with `{"status":"ok","database":"ok"}`.

---

## 2. Architecture under test

| Phase | Surface | State |
| --- | --- | --- |
| LC2 | `environmental_land_cover_features` (6,901,309 rows), `environmental_land_cover_map_sheets` (2,013) | raw source, never served |
| LC3 | `environmental_land_cover_cell_stat_versions`, `…_cell_statistics`, `…_cell_class_areas` | persisted derived statistics |
| LC4 | 5 read-only JSON endpoints under `/api/v1/environment/land-cover/cell-statistics` | verified |
| LC5A | `LandCoverCellPanel` in the suitability candidate detail | verified |
| LC5B | MVT endpoint + `land_cover_cells` map layer, legend, filters | verified |

All six routes were confirmed registered in the live OpenAPI document:

```
/api/v1/environment/land-cover/cell-statistics/release
/api/v1/environment/land-cover/cell-statistics/summary
/api/v1/environment/land-cover/cell-statistics/cells
/api/v1/environment/land-cover/cell-statistics/cells/{candidate_key}
/api/v1/environment/land-cover/cell-statistics/cells/{candidate_key}/classes
/api/v1/environment/land-cover/cell-statistics/tiles/{statistics_version_id}/{z}/{x}/{y}.mvt
```

---

## 3. Database baseline — pre and post

A reusable, strictly read-only baseline script was added at
`scripts/qa/land-cover-db-baseline.sh`. It opens a `default_transaction_read_only`
session and emits 53 deterministic `key|value` lines (ordered aggregates, `md5()`
checksums) covering Alembic state, the suitability run/candidate/score/rank/status/
exclusion/geometry/policy/derivation checksums, and the LC2/LC3 identity, counts and
checksums.

It was captured **before** any QA work and again **after** all tests, the backend
restart, all browser sessions, every API and tile request, and both code fixes.

**Result: the two captures are byte-identical.**

```
md5(baseline-pre.txt)  = 2620733a918c28ffdb982033d8b23b40
md5(baseline-post.txt) = 2620733a918c28ffdb982033d8b23b40
diff -u pre post       → no differences
```

Selected verified values (identical in both captures):

| Key | Value |
| --- | --- |
| `alembic.revision` / `alembic.head_count` | `0020` / `1` |
| `suitability.run_count` | 2 |
| `suitability.candidate_count` | 95,786 |
| `suitability.score_checksum` | `718262f905b5b506979f99d4be03a737` |
| `suitability.rank_checksum` | `26809213c34b11af2629ad6781b63b21` |
| `suitability.status_checksum` | `4cf8c0736ffbdcacc3e9c4852dc133df` |
| `suitability.exclusion_review_checksum` | `72c0faccacdee3902bdf973772b5409f` |
| `suitability.geometry_checksum` | `2edb2f83387ff0e6418b8ff285abc55c` |
| `suitability.policy_version_checksum` | `9bc79beb87845680e82fea3ac2cd8686` |
| `suitability.derivation_version_checksum` | `d26c305d234d68b4548484affd9fdac6` |
| `lc3.active_version_id` / `status` | `1` / `SUCCEEDED` |
| `lc3.version_checksum` | `fd4e0bbc46d1ae2ab352f974905f550b` |
| `lc3.cell_count` / `cell_checksum` | 47,893 / `421be51cad458841001c001f62c74ad5` |
| `lc3.class_row_count` / `class_checksum` | 1,142,780 / `d3085c8af393f744bd9f7171a7e664f7` |
| `lc3.cells_complete_exact` | 35,902 |
| `lc3.cells_partial` | 4,604 |
| `lc3.cells_no_coverage` | 7,387 |
| `lc3.active_candidate_row_count` | 95,786 |
| `lc3.active_candidate_grid_version` | `capital-grid-500m-v1` |
| `lc3.active_derivation_version` | `land-cover-cell-stats-v1` |
| `lc3.active_area_crs` | `EPSG:5186` |
| `lc2.feature_count` | 6,901,309 |
| `lc2.map_sheet_count` | 2,013 |
| `lc2.dataset_version_id` / `reference_period` | `212` / `2025` |

Every one of the historical values this phase was asked to re-verify matched exactly:
1 active release, 47,893 canonical cells, 35,902 / 4,604 / 7,387 coverage split,
1,142,780 class rows, 6,901,309 raw features, 95,786 candidate occurrences,
`capital-grid-500m-v1`, reference period `2025`, `land-cover-cell-stats-v1`.

### Proof of read-only behaviour

`pg_stat_user_tables` was sampled before and after a burst of six representative tile
requests:

| Table | seq_scan | idx_scan | seq_tup_read | writes |
| --- | --- | --- | --- | --- |
| `environmental_land_cover_features` | 0 → **0** | 15 → **15** | 0 → **0** | **0** |
| `environmental_land_cover_map_sheets` | 0 → **0** | 3 → **3** | 0 → **0** | **0** |
| `environmental_land_cover_cell_class_areas` | 15 → **15** | 80 → **80** | 5,713,900 → **5,713,900** | **0** |
| `environmental_land_cover_cell_statistics` | 225 → 227 | 16,003 → 16,772 | — | **0** |
| `suitability_candidates` | 1,623 → **1,623** | 2,937 → 2,946 | 52,490,728 → **52,490,728** | **0** |

The raw 6.9-million-row feature table, the map-sheet table and the 1.14-million-row
class-area table registered **no additional scan of any kind**, confirming the normal
tile path never reaches them. Cumulative write counters were zero on every table.

Both raw endpoints are absent from the API entirely
(`/api/v1/environment/land-cover/features` → 404,
`…/map-sheets` → 404), and the LC5B spec asserts the browser never requests them.

---

## 4. Live API contract results

All checks against the running local backend.

### `/release`
200, 7,157 B. `statistics_version_id=1`, `status=SUCCEEDED`, `is_active=true`,
`derivation_version=land-cover-cell-stats-v1`, `area_crs=EPSG:5186`,
`candidate_grid_version=capital-grid-500m-v1`, `expected=processed=47,893`,
`failed_cell_count=0`, `class_row_count=1,142,780`,
`aggregate_coverage_ratio=0.8370362951971573`,
`coverage_status_counts={COMPLETE_EXACT:35902, PARTIAL:4604, NO_COVERAGE:7387}`.
`source_release.reference_period=2025`, provider `환경부 환경공간정보서비스 EGIS`.

### `/summary`
200. `cell_count=47,893`; totals `cell=11,926,403,570.4 m²`,
`evaluated=9,982,832,659.6 m²`, `uncovered=1,943,570,910.8 m²`;
`aggregate_coverage_ratio=0.8370362951971573`;
`cells_without_dominant_class=7,387` — exactly the `NO_COVERAGE` count, so no
pseudo-class is invented. The `dominant_l1_distribution` has exactly the 7 official L1
classes summing to 40,506 = 47,893 − 7,387.

### `/cells`
200. `total=47,893`, default `limit=50`, deterministic `sort=candidate_key`,
`applied_filters` echoed. Row shape carries coverage status/ratio beside the dominant
class, so composition can never be shown without its coverage qualification.

### `/cells/{key}` and `/cells/{key}/classes`
Verified on four real cells drawn from live data:

| Cell | Status | ratio | Notes |
| --- | --- | --- | --- |
| `…:1750_3830` | COMPLETE_EXACT | 0.9999999999999931 | ratio < 1 yet status is exact — set-theoretic, not a threshold |
| `…:1807_3923` | PARTIAL | 0.5336496085600222 | evaluated 86,946 m² / uncovered 75,981 m² |
| `…:1752_3840` | PARTIAL | **1.0** | ratio is exactly 1.0 yet the status is PARTIAL |
| `…:1492_4000` | NO_COVERAGE | 0.0 | all six dominant fields `null`, all class counts 0 |

The classes endpoint returns `total=0, items=[]` for the `NO_COVERAGE` cell — an empty
list, never a synthetic "uncovered"/"unknown" class. On the richest cell it returned 9
L3 rows with both denominators (`share_of_evaluated_area`, `share_of_cell_area`) and
official Korean names verbatim.

### Error contracts

| Case | Result |
| --- | --- |
| unknown candidate key | 404 `{"error":"CANDIDATE_CELL_NOT_FOUND", …}` |
| `bbox=1,2,3` | 422 `{"error":"INVALID_BBOX","detail":"bbox must be minLon,minLat,maxLon,maxLat"}` |
| `min_coverage_ratio > max_coverage_ratio` | 422 `{"error":"INVALID_COVERAGE_RATIO_RANGE", …}` |
| `limit=501` | 422 (FastAPI bound, `le=500`) |
| `class_level=4` | 422 (FastAPI bound, `le=3`) |
| unknown tile version `999` | 404 `{"error":"STATISTICS_VERSION_NOT_FOUND", …}` |
| tile `x`/`y` out of pyramid | 422 `{"error":"INVALID_TILE_COORDINATE","detail":"x and y must be in [0, 3] at zoom 2"}` |
| tile `z=23` | 422 (FastAPI bound, `le=22`) |

No SQL, stack trace, local path, or connection string appears in any error body.

The **409** paths (`MULTIPLE_ACTIVE_STATISTICS_RELEASES`,
`INCOMPLETE_ACTIVE_STATISTICS_RELEASE`, `CANONICAL_RUN_NOT_FOUND`,
`CANDIDATE_GEOMETRY_CARDINALITY_MISMATCH`) could not be triggered against live data
without mutating official rows, which this phase forbids. They are covered by the
backend integration tests instead (all 146 land-cover tests pass, §7).

### Cache, ETag and 304

| Check | Result |
| --- | --- |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| `ETag` | `"lc-cells-1-1-12-3492-1586"` — `(version, canonical run, z, x, y)` |
| conditional request with matching ETag | **304**, 0 bytes, 26 ms, keeps `Cache-Control` + `ETag` |
| conditional request with a wrong ETag | 200, full 24,402 B body |
| empty tile | **200**, `content-length: 0`, correct MVT content type, still ETagged |

An empty viewport and a broken layer therefore stay distinguishable.

---

## 5. MVT decode results

No MVT library is installed in this environment, so a dependency-free protobuf decoder
was written for the review. Decoded tiles at z7, z8, z12 (Seoul, Incheon, Gyeonggi) and
z14:

* source layer name is exactly **`land_cover_cells`** in every tile — distinct from the
  suitability `candidates` and the `wetlands` layers;
* extent 4096, PBF version 2;
* geometry type is **POLYGON only** — vector-tile candidate geometry, nothing else;
* **candidate keys are unique in every tile** (e.g. 31,431 of 31,431 at z8);
* exactly **12 property keys, all unique**:
  `candidate_key, statistics_version_id, coverage_status, coverage_ratio,
  dominant_l1_code/name, dominant_l2_code/name, dominant_l3_code/name,
  sido_region_code, sigungu_region_code`;
* **every `NO_COVERAGE` feature carries no dominant property at all** — 993 of them at
  z8, 0 leaks. `ST_AsMVT` omits NULL properties, so such a cell genuinely has no
  dominant class rather than a fabricated one;
* **no suitability score, rank, status, stability or candidate id**; no raw feature id,
  no land-cover attribute, no class-distribution array;
* official Korean names preserved verbatim (`시가화건조지역`, `침엽수림`, `기타초지`, …).

Incidental comparison: the existing **suitability** z8 tile repeats its property-key
dictionary three times (42 keys, 14 unique) because its `ST_AsMVT` runs as a parallel
aggregate. The land-cover tile does not, because LC5B's explicit `ORDER BY` forces a
serial ordered aggregate. This is a pre-existing suitability characteristic, not a
land-cover defect, and it is not addressed here.

### On `기타…` class names

`기타재배지 (250/252)`, `기타 교통·통신시설 (155)`, `기타 공공시설 (163)`,
`기타초지 (423)` and `기타나지 (623)` appear in the data. These are **official EGIS
source class names**, not synthetic "Other"/"Unknown" buckets. The class vocabulary was
confirmed at L1=7 / L2=22 / L3=41 distinct codes, matching the LC contract validation.
No `미분류`, `Unknown`, `Unclassified` or invented `기타` bucket exists anywhere in the
served data or the UI.

---

## 6. Performance

### 6.1 Tile matrix (measured live; first request then three warm requests)

| Tile | z/x/y | Features | Bytes | First | Warm ×3 |
| --- | --- | --- | ---: | ---: | --- |
| Capital region (default view) | 7/109/49 | 45,180 | 3,711,118 | 9.05 s | 13.86 / 4.61 / 7.09 s |
| Capital region (west) | 7/108/49 | 2,765 | 216,084 | 0.24 s | 0.21 / 0.17 / 0.16 s |
| Capital broad | 8/218/99 | 31,431 | 2,609,329 | 3.60 s | 2.83 / 2.87 / 2.44 s |
| Capital | 9/436/198 | 14,547 | 1,197,621 | 1.30 s | 1.36 / 0.89 / 1.69 s |
| Capital | 10/873/396 | 3,960 | 344,227 | 0.35 s | 0.27 / 0.21 / 0.23 s |
| Seoul urban | 12/3492/1586 | 267 | 24,402 | 0.042 s | 0.045 / 0.042 / 0.050 s |
| Incheon coastal | 12/3486/1587 | 200 | 18,698 | 0.090 s | 0.038 / 0.031 / 0.050 s |
| Gyeonggi urban | 12/3493/1590 | 272 | 25,098 | 0.036 s | 0.035 / 0.038 / 0.035 s |
| Ganghwa island | 12/3487/1583 | 224 | 16,211 | 0.060 s | 0.032 / 0.037 / 0.037 s |
| High zoom | 14/13970/6344 | 20 | 2,212 | 0.028 s | 0.011 / 0.013 / 0.017 s |
| Empty viewport | 12/3400/1500 | 0 | **0** | 0.011 s | 0.010 / 0.010 / 0.012 s |
| Repeated cached (304) | 12/3492/1586 | — | 0 | — | 0.027 s |

City-level and high-zoom behaviour matches the prior measurements well (tens of
milliseconds at z12, a few milliseconds at z14, a zero-byte 200 for an empty tile).

The prior note of "≈2.9 MB / ≈1.2 s warm at z8" did **not** reproduce as stated: the z8
tile measured 2.61 MB and 2.4–2.9 s warm on this machine, and the tile the map actually
requests at the default view is **z7**, not z8 — 3.71 MB and 4.6–13.9 s. The z7 tile is
the real low-zoom case and had not been measured before.

### 6.2 Baseline comparison — the same tiles from the existing suitability layer

| Tile | Land-cover bytes | Suitability bytes | Land-cover time | Suitability time |
| --- | ---: | ---: | ---: | ---: |
| 7/109/49 | 3,711,118 | **4,378,502** | 4.6–13.9 s | 2.0–5.6 s |
| 8/218/99 | 2,609,329 | **2,950,741** | 2.4–2.9 s | 0.38–0.67 s |
| 9/436/198 | 1,197,621 | **1,260,875** | 0.89–1.69 s | 0.20–0.24 s |
| 12/3492/1586 | 24,402 | 23,335 | 0.034–0.050 s | 0.014–0.015 s |

Both layers draw the identical 500 m grid and emit identical feature counts. The
**land-cover tile is smaller than the suitability tile at every low zoom** — and the
suitability layer is **on by default on every page load**, whereas land-cover is opt-in
and off by default. Payload volume at low zoom is therefore the map's established
baseline behaviour, not something LC5B introduced.

The land-cover-specific delta is **latency** (2–6× at low zoom). Its cause is
identified below.

### 6.3 Query plans (`EXPLAIN (ANALYZE, BUFFERS)`)

**z12 Seoul tile** — the normal case:

```
Aggregate (actual time=23.261..23.264)  Buffers: shared hit=1324
  Sort  Sort Key: s.candidate_key   quicksort 100kB
    Nested Loop  (rows=267)
      Bitmap Heap Scan on suitability_candidates c
        BitmapAnd
          Bitmap Index Scan on idx_suitability_candidates_geometry     (rows=534)
          Bitmap Index Scan on ix_suitability_candidates_analysis_run_id
        Filter: st_asmvtgeom(st_transform(geometry,3857), …) IS NOT NULL
      Index Scan using ix_land_cover_cell_statistics_candidate_key     (loops=267)
Execution Time: 23.472 ms
```

Verified against the §11 checklist:

* candidate geometry **GiST index used** (`idx_suitability_candidates_geometry`);
* candidate **analysis-run index used** (`ix_suitability_candidates_analysis_run_id`);
* candidate-key **statistics index used** (`ix_land_cover_cell_statistics_candidate_key`);
* **spatial bounding happens before transformation** — the `&&` predicate is the index
  condition in EPSG:4326 (the storage CRS), and `ST_AsMVTGeom(ST_Transform(…))` appears
  only as a filter over already-matched rows, so only matched geometry is transformed
  to EPSG:3857;
* the plan references **neither** `environmental_land_cover_features`,
  `environmental_land_cover_map_sheets`, **nor** the class-area rows;
* **no 6.9-million-row scan** occurs;
* candidate keys are unique per tile (verified by decoding, §5) — the pinned canonical
  run plus the `(analysis_run_id, candidate_key)` unique constraint make duplicates
  impossible without a `DISTINCT ON`.

**z7/z8 broad tile** — where the latency lives:

```
Aggregate  (cost=637237.82…)  (actual time=2363.187..2363.844)
  Merge Join  (rows=31431)
    Gather Merge  ← Workers Planned 2, Launched 2
      Sort  Sort Key: c.candidate_key
        Parallel Bitmap Heap Scan on suitability_candidates
          BitmapAnd  (analysis_run_id) AND (geometry && …)
    Index Scan using ix_land_cover_cell_statistics_candidate_key  (rows=47893)
JIT: Functions 27, Inlining 1254.103 ms, Optimization 1089.109 ms,
     Emission 845.329 ms, Total 3213.261 ms
Execution Time: 2391.819 ms
```

The same query with `SET jit = off`:

```
Execution Time: 891.916 ms
```

**Root cause of the low-zoom latency, in two steps:**

1. LC5B added `ORDER BY tile.candidate_key` inside `ST_AsMVT` to make a tile
   byte-deterministic (without it the parallel hash join varied row order, and MVT
   delta-encodes geometry, so identical content produced different bytes — which would
   have contradicted the content-independent ETag). That ordering forces a **serial
   ordered aggregate** plus a full sort, instead of the parallel partial/finalize
   aggregate the suitability tile gets.
2. The resulting plan cost (**637,237**) crosses PostgreSQL's `jit_inline_above_cost`
   and `jit_optimize_above_cost`, both **500,000** on this server. LLVM inlining and
   optimization then run and cost **~1.5 s of pure compile time** — more than the query
   itself.

For comparison the suitability tile plans at cost **373,341**, stays under both
thresholds, does only cheap JIT emission (58.8 ms) and uses a parallel aggregate:
`Execution Time: 359.869 ms`.

No index is missing. Every index the tile could use is already used.

### 6.4 Browser measurement at the default view

Instrumented in `e2e/landCoverIntegratedQa.spec.ts`, reported via `console.log`
(never asserted as a machine-dependent threshold). Reproducible over repeated runs:

```
[LC6 low-zoom] tiles=2 zooms=[7] totalBytes=3927202 largestTile=3711118
               enable→legend=118–1436 ms  enable→settled=8125–9450 ms
```

* The default view (`fitBounds` over the Seoul + Incheon + Gyeonggi extent) resolves to
  **zoom 7**, and the layer requests **2 tiles**.
* One tile carries 45,180 of the 47,893 cells (94%) and dominates: 3.71 MB of 3.93 MB.
* The legend appears almost immediately (118–1,436 ms); the tiles finish settling at
  ~8.1–9.5 s.
* A run in a differently-sized headless window landed on the sparse western tile only
  (1 tile, 216 KB) — the cost depends on where the viewport lands, and the two-tile
  case above is the worst case.
* After the load the map canvas, the suitability summary and the layer control all
  remain responsive: the spec switches visualization mode after the settle and the
  control reacts, so the main thread is not wedged.
* Repeated enable/disable reuses cached tiles (immutable one-year `Cache-Control`,
  and a matching conditional request answers 304 in 26 ms).

---

## 7. Low-zoom decision

**Decision: no mitigation implemented in LC6.**

The §12 options were each evaluated against the measurements:

| Option | Assessment |
| --- | --- |
| 1. Evidence-based minimum zoom | **Rejected.** The land-cover tile is *smaller* than the suitability tile already loaded by default at the same zoom. A minimum zoom would make the opt-in layer less capable than the default layer, defeat the layer's stated purpose (seeing the whole grid's coverage), and contradict "permit normal city-level use" only by accident of where the threshold fell. |
| 2. Hide below that zoom with a message | Same objection; also a UX change nobody's evidence asks for. |
| 3. Geometry simplification | **Useless here.** Decoding shows each cell is already a 1-ring, 4-vertex polygon. There is nothing to simplify. |
| 4. Fewer low-zoom attributes | **Not available.** All 12 properties are consumed by the paint expression, the filter, or the legend vocabulary. |
| 5. Tile buffer/extent change | **Unjustified.** No visual or plan evidence of a problem at 4096/64. |
| 6. Add an index | **Unjustified.** The plans prove the GiST, analysis-run and candidate-key indexes are all already used. Nothing is missing. |

None of the listed mitigations is supported by the evidence, and each would degrade the
layer. The payload is the map's established baseline; the latency delta traces to a
deliberate correctness decision (byte-deterministic tiles backing the ETag contract)
interacting with a **server JIT cost threshold**.

Two follow-ups are therefore **recorded but deliberately not applied**, because each
carries a risk that deserves its own phase and its own tests rather than a QA-phase
drive-by:

* **Scope JIT off for the tile query.** Measured to cut z8 execution from 2,392 ms to
  892 ms (−63%) with no behavioural change. Requires care: `SET LOCAL` is a no-op
  outside an explicit transaction, and a plain `SET` would leak session state onto a
  pooled connection and affect unrelated queries. That correctness risk is why it is not
  applied here.
* **Product decision on a minimum zoom**, if the product owner decides a whole-region
  view is not worth ~4 MB — a product call, not a QA finding.

Neither a generalized geometry table nor a migration was created. LC6 introduced **no
migration**; Alembic stayed at `0020` with one head.

---

## 8. Functional QA matrix

Driven in real Chrome against the real local backend and the real local database, on
frontend port 3000.

### 8.1 Existing platform regression

Equity mode, region interaction, facility markers, wetland layer, suitability mode, the
existing candidate layer and its score/status styling, the existing candidate click,
cost view, landfill view, data/source view, singular top navigation, absence of new
global horizontal overflow and mobile navigation were exercised by the existing e2e
suites (`map.spec`, `regressions.spec`, `accessibility.spec`, `responsive.spec`,
`landCoverLayer.spec`) — **45 passed, 4 failed**, with all four failures reproduced on
clean `main` and unrelated to land cover (§10).

The LC5B spec additionally asserts that the suitability status filters the user set are
preserved across land-cover layer toggling, and that turning the layer off restores the
normal suitability view.

### 8.2 LC5B map layer (items 1–18)

Covered by the pre-existing `e2e/landCoverLayer.spec.ts` — **10/10 passing** against
live data: layer off by default, enabling creates the version-pinned MVT source, tile
URLs carry the active statistics version, source layer `land_cover_cells`, coverage mode
with all three states visible and visually/textually distinct, per-status filtering,
turning the layer off and back on, leaving and re-entering suitability mode.

LC6 added the lifecycle checks that spec did not make
(`e2e/landCoverIntegratedQa.spec.ts`):

* three enable/disable rounds plus mode/level/filter churn leave **exactly one** control,
  one legend and one legend-row list — no duplicated control or stacked legend;
* ordinary control changes issue **zero** additional release-metadata requests;
* leaving suitability removes the control entirely and returning rebuilds exactly one;
* **turning all three coverage statuses off shows the explicit
  `land-cover-selection-empty` message** ("현재 필터로 선택된 격자가 없습니다") rather
  than silently reverting to showing everything; re-enabling one status clears it.

### 8.3 Dominant-class mode (items 1–16)

Covered by the existing spec: dominant mode, L1/L2/L3 switching that repaints **without
refetching tiles**, official Korean names and codes displayed, class filters, class
search by code and by Korean name, hide-all/show-all, a bounded scrollable 세분류 legend,
and a legend whose visibility state matches the applied filters.

Colour determinism is proven by unit tests: `landCoverClassColor` is a pure function of
the official code string, so the same code always renders in the same colour regardless
of load order or which tiles are loaded, and two distinct three-digit codes cannot
collide.

No synthetic `Unknown` / `Other` / `기타` / `미분류` / `Unclassified` category exists;
verified in the served tiles (§5), in the class vocabulary (§5) and in the UI (§8.4).

### 8.4 Candidate-detail integration

| Check | Result |
| --- | --- |
| Land-cover-coloured candidate click still uses the existing suitability selection | pass (existing spec) |
| Candidate detail opens with the LC5A section | pass |
| Real `COMPLETE_EXACT` candidate | pass |
| Real mid-range `PARTIAL` (ratio 0.534) shows evaluated area, uncovered area, both percentages, partial warning | pass |
| **Near-100% `PARTIAL` does not display as a flat `100%`** | pass — renders **`100% 미만`** |
| `NO_COVERAGE`: warning shown, no dominant class, no synthetic class rows | pass |
| Rapid candidate switching leaves no stuck loading state and no stale response | pass |
| Closing/reopening candidate detail | pass |
| LC4 failure affects only the land-cover section | pass |
| Tile failure does not break candidate detail | pass |
| Candidate-detail failure does not break the map | pass |

The near-100% case is real and not hypothetical: **1,479 `PARTIAL` cells in the active
release have `coverage_ratio` exactly `1.0`**, and 3,612 exceed 0.9999. The LC5A
formatter refuses to contradict the status — a `PARTIAL` cell that rounds to 100% renders
`100% 미만`, and a `COMPLETE_EXACT` cell renders `100%` even though its stored ratio is
0.9999999999999931. The LC6 e2e test discovers such a cell from live data rather than
hardcoding a key.

### 8.5 Responsive and accessibility

Desktop and a narrow mobile viewport are asserted by the existing LC5B spec with **no
horizontal page overflow**. The repository's `accessibility.spec` and `responsive.spec`
pass. The component test suites assert:

* the layer toggle, visualization-mode group and hierarchy-level group are all labelled;
* filters are real `<input type="checkbox">` / radio controls, so they are
  keyboard-operable and expose focus;
* every legend swatch carries a text label **and** a secondary line with the machine
  status or the official class code, so state is never communicated by colour alone;
* coverage status is additionally carried by opacity and by per-status outline treatment
  (solid / dashed / dotted) — a second and third non-colour channel;
* the legend region is height-bounded and scrollable;
* the `NO_COVERAGE` meaning is present as screen-reader-visible text, not only as a
  grey fill.

No fieldset-count regression was observed (the layer control deliberately uses labelled
groups rather than `<fieldset>`, matching the wetland control convention).

---

## 9. Failure injection

Performed with Playwright route interception and one real container restart. No official
data was mutated.

| Injected failure | Observed behaviour |
| --- | --- |
| Release endpoint unavailable | Layer disabled with a bounded Korean message; map and suitability intact (existing spec) |
| **Release response malformed** | `land-cover-layer-unavailable` shown, toggle disabled, map + suitability intact — **see fix (a)** |
| Tile endpoint 404 | Map, legend and suitability intact (existing spec) |
| Tile endpoint 500 | Legend still shown, map + suitability intact, no fabricated values |
| Empty but valid tile (0 bytes, 200) | Layer stays ON, legend still explains the coverage states, **no** error state raised |
| Candidate detail 404 | Only the land-cover section affected; the suitability candidate detail still opens; no fabricated zero areas |
| Class endpoint 503 | Rest of the candidate detail unaffected |
| Frontend loaded before backend available | Covered by the release-unavailable and tile-failure paths |
| **Backend restarted while frontend open** | `docker compose restart backend`; healthy after 10 s; all five JSON endpoints and the MVT endpoint returned 200 afterwards; the browser flow passed again. The database container was untouched (`Up 2 hours (healthy)`) and the volume preserved |
| Request aborted during rapid candidate switching | No stuck loading state; the panel resolves |

In every case: the base map survived, the suitability candidate detail survived, no zero
value was fabricated, and a scan for `Traceback`, `psycopg`, `sqlalchemy`, `SELECT `,
`FROM environmental_`, `postgresql://`, `/Users/`, `/app/src` and `ST_AsMVT` found
**nothing** in the rendered page.

---

## 10. Fixes made

Two production changes, each reproduced first and covered by a new test. Both are
frontend-only; **no backend source, no schema, no migration, no scoring code was
touched**, so the backend image did not need rebuilding.

### (a) Every layer-failure message must say the failure is not absent land cover

* **Reproduction.** An LC6 failure-injection test served a malformed
  `/release` response. The layer correctly refused to draw, but the message read:
  *"토지피복 통계 릴리스 응답을 해석할 수 없어 레이어를 표시하지 않습니다. 불완전한 값을
  대신 표시하지 않습니다."* — with no statement that land cover still exists there.
  `NOT_FOUND` and `UNAVAILABLE` both carried that clause; `MALFORMED` did not.
* **Root cause.** The existing unit test asserted the clause on `NOT_FOUND` and
  `UNAVAILABLE` **individually**, so the third message was never covered.
* **Why it matters.** §8 of this phase and the layer's own stated contract require that
  no failure be readable as "this area has no land cover".
* **Changed files.** `frontend/src/lib/landCoverLayer.ts` (one message string + a
  comment recording the requirement), `frontend/src/lib/landCoverLayer.test.ts`.
* **Minimality.** One user-facing string; no logic, no styling, no API change.
* **Tests added.** A test asserting the clause over **every** entry of
  `LAND_COVER_LAYER_ERRORS` (so a future message cannot be added without it), plus the
  LC6 e2e assertion on the rendered malformed-release state.
* **Before → after.** The e2e assertion failed on the clause → passes.
  `landCoverLayer.test.ts` 52 → 53 tests; LC5B focused pair 87 → 88.

### (b) The three dominant classes are computed per level and need not nest

* **Reproduction.** Decoding the z8 tile surfaced a cell with `dominant_l1_code=100`
  (시가화건조지역) but `dominant_l2_code=320` (침엽수림) — a 중분류 belonging to L1 300.
  Querying the class rows for cell `…:1834_3923` confirms this is arithmetically correct:
  L1 100 totals 42.98% spread over four 중분류 (150: 22.52%, 120: 18.98%, 110: 1.39%,
  130: 0.08%), while L1 300 totals 38.12% but concentrates 25.23% in the single 중분류
  320. The largest **sum** need not contain the largest single **member**.
* **Scale.** **3,518 of 47,893 cells (7.3%)** have a dominant 중분류 outside their
  dominant 대분류.
* **Root cause.** Correct by construction (each level's dominant class is the argmax at
  that level), but the LC5A panel stacked 대분류 / 중분류 / 세분류 with no note, so a
  reader would reasonably read a correct triple as a data error.
* **Changed files.** `frontend/src/components/LandCoverCellPanel.tsx` (a
  `land-cover-dominant-note` line, rendered only when a dominant class exists),
  `frontend/src/components/LandCoverCellPanel.test.tsx`.
* **Minimality.** One explanatory sentence; no number, no computation, no API change,
  and it is omitted for `NO_COVERAGE` cells, which have no dominant class at any level.
* **Tests added.** Two: the note is present and worded correctly on a `COMPLETE_EXACT`
  cell; it is absent on a `NO_COVERAGE` cell.
* **Before → after.** `LandCoverCellPanel.test.tsx` 35 → 37 tests; LC5A focused pair
  80 → 82; full frontend suite 933 → 936.

### Considered and deliberately not changed

* The low-zoom latency (§7) — documented with root cause and two recorded follow-ups.
* The duplicated MVT key dictionary in the **suitability** tile (§5) — pre-existing and
  out of land-cover scope.
* The pre-existing `ruff format` drift and the pre-existing test failures (§11) —
  §14 forbids editing unrelated code to hide old failures.

---

## 11. Test results and failure classification

### Backend

| Check | Result |
| --- | --- |
| `ruff format --check` | **1 pre-existing failure**, 112 files clean |
| `ruff check` (lint) | **All checks passed** |
| `mypy` (strict) | **Success: no issues found in 54 source files** |
| Focused land-cover tests (5 files) | **146 passed** |
| Full suite with PostGIS tier | **583 passed, 8 failed, 3 errors** |

The `ruff format` failure is `backend/alembic/versions/20260719_0016_suitability_critic_stability.py`
— a one-line re-wrap in a suitability-stability migration last touched by commit
`111a8e0`, entirely unrelated to land cover. It is pre-existing formatting drift from a
ruff version change and was **not** edited (§14).

All 8 failures and 3 errors were **re-run on a clean `main` worktree at `9e1a40f`** and
reproduced identically:

| Test | Classification |
| --- | --- |
| `test_facility_mapping_transparency_integration.py::test_migration_head_is_0016` | pre-existing deterministic — asserts head `0016`, head is `0020` since LC1–LC3 |
| `test_suitability_scenario_routes_integration.py::test_migration_head_is_0016_and_no_new_migration` | pre-existing deterministic — same reason |
| `test_migration_population_monthly_integration.py` (6 tests) | pre-existing, test-database data-dependent (missing `regions` / `ingestion_runs` rows → FK violations) |
| `test_reporting_routes_integration.py` (3 errors) | pre-existing, test-database data-dependent fixture errors |

**No new backend regression.** No backend source file was modified in this phase, which
`git status` confirms independently.

### Frontend

| Check | Result |
| --- | --- |
| ESLint | **clean** |
| `tsc --noEmit` | **clean** |
| LC5A focused (`landCover.test.ts`, `LandCoverCellPanel.test.tsx`) | **82 passed** (80 before the LC6 fix) |
| LC5B focused (`landCoverLayer.test.ts`, `LandCoverLayerControl.test.tsx`) | **88 passed** (87 before the LC6 fix) |
| MapView + api client + accessibility + responsive | **105 passed** |
| LC5A live tests (`LC_LIVE_BACKEND_URL=http://localhost:8000`) | **7 passed** |
| Full Vitest suite | **936 passed, 7 skipped (43 files passed, 1 skipped)** |
| Next.js production build | **success** |

**On the previously-reported timeout flakiness:** the full suite was run **four times at
the default 5-second timeout before any change** and passed every time
(933 passed / 7 skipped, 27.0 s / 44.5 s / 35.2 s / 28.5 s), and again after the fixes
(936 passed). The reported intermittent-timeout pattern **did not reproduce**. No test
timeout was raised in committed configuration, and none was needed.

The 7 skipped tests are `src/lib/landCover.live.test.ts`, which skips itself unless
`LC_LIVE_BACKEND_URL` is set — the repository's live-test convention. Run explicitly
against the local backend, all 7 pass.

### Playwright

Bundled Playwright Chromium is not installed on this machine, so all runs used the
installed **Chrome channel** via a temporary QA config (created in `frontend/`, used,
then deleted — it is not committed). The dev server ran on port 3000 with
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.

| Spec | Result |
| --- | --- |
| `landCoverLayer.spec.ts` (LC5B, live) | **10/10 passed** |
| `landCoverIntegratedQa.spec.ts` (new, LC6) | **11/11 passed**, stable over repeated full runs |
| `map.spec.ts`, `regressions.spec.ts`, `accessibility.spec.ts`, `responsive.spec.ts` | **45 passed, 4 failed** |

The four e2e failures are pre-existing and unrelated to land cover. No tracked frontend
file was modified when they were first observed, so the code under test was `main`:

| Test | Classification |
| --- | --- |
| `map.spec.ts:17` — expects `ORIGIN_BASED_TREATMENT_OUTCOME` in the source panel | pre-existing deterministic; the panel now shows the Korean label `발생지 기준(지역에서 배출된 양)` since the RCIS reporting-geography phase |
| `map.spec.ts:89` — choropleth scale assertion yields `NaN` | pre-existing, data-dependent |
| `map.spec.ts:135` — expects `suitability-policy-v1` | pre-existing deterministic; live run 47 is `suitability-policy-v2` / `suitability-screening-v3` since the CRITIC phase |
| `regressions.spec.ts:88` — waits for `top-candidate-cell` | pre-existing deterministic; that `data-testid` was **removed** by commit `0297652` (a UX phase predating land cover) and exists nowhere in `src/` |

These were **not** updated: each belongs to the suitability/equity UI, not to land cover,
and §19 forbids refactoring unrelated code. Their intended contracts should be settled by
whichever phase owns those surfaces.

---

## 12. Memory and source-lifecycle observations

Reported as observed; no precise leak-free guarantee is claimed.

The application exposes no debug handle on the MapLibre instance, so lifecycle was
asserted on what is genuinely observable from outside — the network requests the vector
source issues and the DOM the control owns.

Over three enable/disable rounds plus visualization-mode, hierarchy-level and filter
churn, then leaving suitability mode and returning:

* exactly **one** `land-cover-layer-control`, **one** `land-cover-legend` and **one**
  `land-cover-legend-rows` remained — no duplicated control or stacked legend;
* leaving suitability removed the control entirely; returning rebuilt exactly one;
* **zero** additional release-metadata requests were issued by ordinary control changes
  (mode, level and filter changes repaint from already-loaded tiles);
* L1/L2/L3 switching triggers **no tile-source reload** (asserted by the existing LC5B
  spec, which compares tile requests across the change);
* **no raw-feature request** was ever observed, and both raw endpoints return 404;
* the class list merges rather than replaces, which is the intended behaviour (panning
  can only ever add classes, so a class does not vanish when it scrolls out of view);
  the merge is order-independent and returns the previous identity when nothing was
  added, so it does not force a re-render;
* the control stayed responsive after the ~3.9 MB low-zoom load — the spec switches
  visualization mode after the tiles settle and the control reacts, so the main thread
  was not wedged;
* no unbounded React state growth was observed across repeated toggling.

Precise heap measurement was **not** performed, so no leak-free claim is made beyond
these observations.

---

## 13. Lifecycle status

| Stage | State |
| --- | --- |
| Source contract validation | **verified** |
| Source ingestion (LC2) | **implemented and locally verified** |
| Candidate-cell statistics (LC3) | **implemented and locally verified** |
| Read-only JSON API (LC4) | **implemented and locally verified** |
| Candidate-detail frontend (LC5A) | **implemented and locally verified** |
| Vector-tile API (LC5B) | **implemented and locally verified** |
| Map layer, legend and filters (LC5B) | **implemented and locally verified** |
| Integrated local QA (LC6) | **complete** |
| Scoring integration | **not implemented** |
| Licence / public-use scope | **pending clarification** |
| OCI migration | **not run** |
| Production deployment | **not run** |

Explicitly **not** claimed by this phase: licence clarification is *not* complete,
KOGL Type 1 is *not* confirmed, commercial use is *not* approved, OCI migration is *not*
complete, production deployment is *not* complete, and scoring integration is *not*
complete.

The API's served `disclosures.lifecycle` block still reports
`api_exposure: "IMPLEMENTED"` while the frontend and vector-tile stages report
`IMPLEMENTED_AND_LOCALLY_VERIFIED`. That is a backend string, and changing it would mean
editing backend source and rebuilding the image for a documentation-only benefit; it was
left alone in this QA phase and is noted here as a known cosmetic inconsistency.

The served licence note is unchanged:
`EGIS/KOGL 벡터 토지피복지도 다운로드 약관 — 서면 재확인 필요 (적재 전 조건, WMS 표시전용 제품 아님)`,
and `used_in_suitability_scoring` remains **false** on every response.

---

## 14. Known limitations

1. **Low-zoom latency is unmitigated.** The default view costs ~3.9 MB across 2 tiles
   and ~8–9 s to settle, dominated by one 3.71 MB tile carrying 94% of the grid. The
   payload is smaller than the suitability layer already loaded by default, and the
   latency root cause is documented (§6.3), but neither was changed.
2. **The 409 API paths were not exercised against live data**, because triggering them
   would require mutating official rows. They are covered by backend integration tests
   only.
3. **No precise heap/leak measurement** was taken; §12 reports observations only.
4. **Four pre-existing e2e failures and 8 backend failures + 3 errors remain**, all
   verified against clean `main` and all outside land-cover scope.
5. **One pre-existing `ruff format` drift** remains in an unrelated suitability
   migration.
6. **`/ready` returns 404** — existing repository behaviour, deliberately not changed.
7. **Browser-side tile cost varies with viewport size**: a smaller window can land on a
   sparse tile and pay 216 KB instead of 3.9 MB.
8. **The served `api_exposure` lifecycle string is stale** (§13).
9. Everything verified here is **local only**. No claim is made about production.

---

## 15. Exact next phase

**LC7 — EGIS licence, public-use scope, and deployment eligibility decision**

The land-cover subsystem is locally stable and integrated. The blocking question is no
longer technical: it is whether the acquired 세분류 [2025] 토지피복지도 release may be
served publicly, and under what terms. The licence state remains
`LOCAL_USE_ONLY_PENDING_CLARIFICATION`, and no deployment may be considered until LC7
resolves it.

> **LC7 outcome (2026-08-02).** LC7 ran and did **not** resolve it: the decision is
> **`UNRESOLVED_PENDING_WRITTEN_RESPONSE`** and deployment eligibility is **BLOCKED**. The
> EGIS copyright policy grants free use only where a 공공누리 (KOGL) mark is attached, and
> none is published for the downloaded vector product. **The actual next phase is
> LC7A — submit the written inquiry and record the official response.** See
> [LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md).
