# Land-Cover Vector-Tile Performance Optimization — Phase 1B-LC9 (implementation)

**Phase:** 1B-LC9 — public MVT performance optimization and final regression validation
**Branch:** `perf/land-cover-lc9-mvt-performance-and-regression`
**Starting commit:** `aaaae293dd9863a2ab1a57abbad4a2b5083bfdda` (local `main` == `origin/main`, verified)
**Scope:** serving and rendering only. No statistics recomputation, no migration, no
database write, no scoring change, no map redesign, no raw source polygons deployed.

This document records the LOCAL implementation and its evidence. The production
deployment and its public measurements are in
[LAND_COVER_LC9_PUBLIC_PERFORMANCE_REPORT.md](LAND_COVER_LC9_PUBLIC_PERFORMANCE_REPORT.md).

---

## 1. Measured baseline (before any change)

Re-measured on 2026-08-02 with `scripts/qa/land-cover-mvt-performance.sh`; the LC8
figures were **not** assumed. Ten fixed, version-pinned tiles, so before/after compares
identical URLs.

### Production (`https://waste-161-33-2-143.sslip.io`), statistics version 1

| Tile | Features | Content-Encoding | Transferred bytes | TTFB (s) | Cold total (s) | Warm total (s) | `If-None-Match` |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| z7/108/49 (default view) | 2,765 | **none** | 216,084 | 0.217 | 0.369 | 0.344 | 304 |
| z7/109/49 (worst case) | 45,180 | **none** | **3,711,118** | 1.442 | 7.402 | 2.778 | 304 |
| z8/218/99 | 31,431 | **none** | 2,609,329 | 1.254 | 5.477 | 1.871 | 304 |
| z9/436/198 | 14,547 | **none** | 1,197,621 | 0.410 | 1.085 | 1.072 | 304 |
| z10/873/396 (Seoul) | 3,960 | **none** | 344,227 | 0.268 | 0.466 | 0.408 | 304 |
| z10/872/396 (Incheon) | 3,746 | **none** | 318,600 | 0.251 | 0.460 | 0.712 | 304 |
| z10/873/397 (Gyeonggi) | 3,989 | **none** | 344,581 | 0.234 | 0.452 | 0.456 | 304 |
| z13/6985/3174 | 72 | **none** | 7,032 | 0.160 | 0.161 | 0.193 | 304 |
| z10/868/397 (Yellow Sea) | 0 | **none** | 0 | 0.161 | 0.162 | 0.154 | 304 |
| z10/879/404 (outside grid) | 0 | **none** | 0 | 0.203 | 0.204 | 0.363 | 304 |

Two LC8 findings confirmed still current, and one new one:

* MVT is transferred **uncompressed** at every zoom (no `content-encoding`, and
  `content-length` is byte-identical whether or not the client advertises gzip);
* the z7/109/49 worst case is genuinely 3.71 MB / 45,180 cells;
* **new:** z8/218/99 is a second pathological low-zoom tile — 2.61 MB / 31,431 cells —
  which LC8 did not measure.

HTML *is* gzipped on the same origin, so the gap is media-type specific, not a missing
`encode` directive.

### Local backend (uvicorn direct, no reverse proxy)

Identical byte counts and feature counts at every tile; TTFB 1.011 s (z7/108/49) and
5.031 s (z7/109/49).

---

## 2. Root-cause analysis

### 2.1 Bytes — Caddy's default `encode` matcher excludes the vector-tile media type

`deploy/Caddyfile` already carried `encode zstd gzip` at site level. Since Caddy 2.7 the
`encode` directive applies a **default response matcher** limited to a fixed content-type
list. Probing the production origin on 2026-08-02 shows exactly that behaviour:

| Response | Content-Type | `content-encoding` |
| --- | --- | --- |
| `/` | `text/html; charset=utf-8` | gzip |
| `/_next/static/chunks/…js` | `application/javascript; charset=UTF-8` | gzip |
| `/favicon.ico` | `image/x-icon` | gzip |
| `…/cell-statistics/release` | `application/json` | gzip |
| `/health` | `application/json` (≈100 B) | none — below `min_length` (512 B), correct |
| **`…/tiles/1/7/109/49.mvt`** | **`application/vnd.mapbox-vector-tile`** | **none** |

Caddy's default list contains `application/x-protobuf*` but **not**
`application/vnd.mapbox-vector-tile`. The backend serves the IANA-registered vector-tile
type (`MVT_CONTENT_TYPE` in `backend/src/waste_equity_backend/api/routes/land_cover_cells.py`),
so tiles fell outside the matcher and shipped raw.

### 2.2 Latency — PostgreSQL JIT compiles a tree of PostGIS C calls, once per tile

`EXPLAIN (ANALYZE, COSTS ON)` of the shipping tile query on the **production** database,
z7/109/49:

```
Aggregate (actual time=...)  Execution Time: 1281.9 ms
JIT:
  Functions: 27
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 11.7 ms, Inlining 357.4 ms, Optimization 1105.6 ms,
          Emission 914.6 ms, Total 2389.4 ms      <- summed across parallel workers
```

The low-zoom plan's estimated cost crosses both `jit_above_cost` (100,000) and
`jit_inline_above_cost` (500,000), so PostgreSQL LLVM-compiles the expression tree —
with inlining and optimisation — **in every parallel worker**, for a query that then
runs once. The compiled expressions are almost entirely calls into PostGIS C functions
(`ST_Transform`, `ST_AsMVTGeom`, `ST_AsMVT`), which JIT cannot meaningfully accelerate.
The compilation is close to pure overhead.

### 2.3 Latency — the tile geometry was computed twice per candidate

The `tile` CTE is referenced once, so PostgreSQL inlines it and pushes
`WHERE tile.geom IS NOT NULL` down into the candidate scan as a filter. The pre-change
plan shows it explicitly:

```
Parallel Bitmap Heap Scan on suitability_candidates c  (actual time=501..1309)
  Filter: (st_asmvtgeom(st_transform(geometry, 3857), 'BOX(...)'::box2d, 4096, 64, true)
           IS NOT NULL)
```

`ST_AsMVTGeom(ST_Transform(...))` is evaluated once for the filter and again for the
output column — twice per candidate row, 45,180 rows.

### 2.4 Query-plan comparison (production database, 5 runs each, Execution Time in ms)

| Variant | Runs | Median | JIT time |
| --- | --- | ---: | ---: |
| A — shipping SQL, JIT on | 1277.8 · 1278.4 · 1286.7 · 1279.6 · 1281.9 | **1281.9** | 1.39–1.57 s |
| B — `tile AS MATERIALIZED`, JIT on | 627.1 · 634.5 · 633.9 · 627.2 · 630.0 | **630.0** | ~43 ms |
| C — `MATERIALIZED` + `SET LOCAL jit = off` | 610.4 · 584.1 · 574.6 · 574.9 · 579.6 | **579.6** | 0 |
| D — `SET LOCAL jit = off` only | 767.3 · 761.9 · 763.4 · 759.2 · 761.9 | **761.9** | 0 |

Variant **C** is the chosen one: **1281.9 ms → 579.6 ms, a 2.21× reduction**. Each fix
contributes independently (B and D each beat A on their own), and they compose.

---

## 3. Alternatives considered, and why they were rejected

All four were measured, not dismissed.

### Option A — drop tile properties at low zoom · **REJECTED**

Byte cost of each property group at z7/109/49 (45,180 features), measured directly:

| Variant | Uncompressed | Saved |
| --- | ---: | ---: |
| all 12 properties (current) | 3,711,160 | — |
| drop `statistics_version_id` | 3,620,771 | 90,389 (2.4 %) |
| drop `coverage_ratio` | 3,569,327 | 141,833 (3.8 %) |
| drop `sido_region_code` + `sigungu_region_code` | 3,458,773 | 252,387 (6.8 %) |
| drop the three dominant-class *names* | 3,467,060 | 244,100 (6.6 %) |
| drop `candidate_key` | 1,980,417 | 1,730,743 (46.6 %) |
| only the 7 the map styles with | 1,515,704 | 59.2 % |
| geometry only | 859,327 | 76.8 % |

Frontend audit (`src/lib/landCoverLayer.ts`, `src/components/MapView.tsx`): the map
consumes exactly seven tile properties — `coverage_status` and the six
`dominant_l{1,2,3}_{code,name}`. `candidate_key`, `coverage_ratio`,
`statistics_version_id`, `sido_region_code` and `sigungu_region_code` are read only from
**JSON** responses (`src/lib/landCover.ts`), never from a tile feature. Candidate
clicking is bound to the `candidates-fill` layer of the suitability source and fetches
detail through a separate API call, so it does not depend on tile feature identity.

Dropping the five map-unused properties measures as:

| | Uncompressed | gzip-6 | zstd-3 |
| --- | ---: | ---: | ---: |
| current 12 properties | 3,711,160 | 568,267 | 533,982 |
| minus the 5 map-unused | 3,227,744 | 421,279 | 351,746 |

Rejected because:

1. compression alone already meets both size targets with a **2.6–2.8× margin**, so this
   is not needed to reach any target;
2. it would change a **publicly documented contract** — the LC8 deployment report states
   the tile carries exactly twelve named property keys;
3. `candidate_key` is 46.6 % of the raw tile and is the single largest saving, but
   §2 of this phase requires candidate identity to be preserved, so the large win is
   off the table by construction and only the small one remains;
4. the phase directs the *smallest* correct optimization. A 147 KB compressed saving does
   not justify a semantic change to a published contract.

### Option B — geometry simplification · **REJECTED, no benefit exists**

Measured vertex counts on the worst tile:

```
tile geometry after ST_AsMVTGeom: min 4, max 13, avg 5.015 points  (45,180 rows, 0 NULL)
source candidate geometry:        min 4, max 29, avg 5.038 points
```

A closed axis-aligned square is five positions. The geometry is already at its floor;
`ST_Simplify` / `ST_SimplifyPreserveTopology` have nothing to remove, and `ST_SnapToGrid`
is already implicit in `ST_AsMVTGeom`'s integer extent grid. Geometry is 859,327 of
3,711,160 bytes (23 %) and cannot usefully shrink.

### Option C — reduce the MVT buffer or extent · **REJECTED, no benefit exists**

Features surviving `ST_AsMVTGeom` at three buffers:

| Tile | buffer 64 (current) | buffer 16 | buffer 0 |
| --- | ---: | ---: | ---: |
| z7/109/49 | 45,180 | 45,180 | 45,180 |
| z10/873/396 | 3,960 | 3,960 | 3,958 |
| z13/6985/3174 | 72 | 72 | 72 |

Shrinking the buffer to zero removes **no** features at z7 or z13 and two of 3,960 at
z10. It would trade a visible seam risk for nothing measurable. Extent 4096 is retained.

### Option E — a dedicated low-zoom representation · **NOT NEEDED**

Reserved by the phase for the case where A–D are insufficient. They are not: compression
plus the query fix meets every target without touching tile content. A display-only
aggregate would also risk exactly the semantics §2 protects (candidate identity, coverage
status, dominant class), so it was not built.

---

## 4. Chosen optimization

Two changes, both semantics-preserving, neither touching stored data.

### 4.1 Caddy — compress the vector-tile media type (`deploy/Caddyfile`)

The site-level `encode zstd gzip` is left **exactly as it was**, so every content type
Caddy already compresses keeps its stock behaviour. A second, narrowly-scoped `encode`
inside the backend `handle` block adds the one missing media type:

```caddyfile
@backend path /api/* /health
handle @backend {
	encode {
		zstd
		gzip
		match {
			header Content-Type application/vnd.mapbox-vector-tile*
		}
	}
	reverse_proxy backend:8000
}
```

Specifying `match` **replaces** Caddy's default matcher, so restating the default list at
site level would risk silently losing compression for whatever the restatement missed.
Adding one scoped directive avoids that entirely.

### 4.2 Backend — one evaluation, no JIT (`backend/src/waste_equity_backend/api/routes/land_cover_cells.py`)

* `tile AS (` → `tile AS MATERIALIZED (` — the CTE fence makes
  `ST_AsMVTGeom(ST_Transform(...))` evaluate once per candidate instead of twice.
* `session.execute(text("SET LOCAL jit = off"))` immediately before the tile query.
  `SET LOCAL` is scoped to the request's own transaction (already open, because release
  and canonical-run resolution ran first) and is discarded when the session closes, so a
  pooled connection never carries it into an unrelated request. No server-wide, database-wide
  or role-wide setting is changed.

Nothing else in the route changed: same SQL shape, same joins, same pins, same
`ORDER BY candidate_key`, same properties, same extent 4096, same buffer 64, same
`ST_AsMVTGeom` clip flag, same media type, same ETag construction, same cache header.

---

## 5. MVT property contract — unchanged

Exactly twelve keys, as published by LC8. `ST_AsMVT` omits NULL properties, so a
`NO_COVERAGE` cell genuinely carries no dominant class rather than a fabricated one.

| Property | Consumed by |
| --- | --- |
| `candidate_key` | feature identity / auditability (not a map style input) |
| `statistics_version_id` | release provenance carried in-band |
| `coverage_status` | fill colour, fill opacity, layer filter, three per-status outline layers |
| `coverage_ratio` | published context (map styles do not read it) |
| `dominant_l1_code` / `_name` | dominant-class fill + filter + legend at L1 |
| `dominant_l2_code` / `_name` | dominant-class fill + filter + legend at L2 |
| `dominant_l3_code` / `_name` | dominant-class fill + filter + legend at L3 |
| `sido_region_code` | published region context |
| `sigungu_region_code` | published region context |

Source layer `land_cover_cells`, extent 4096 — both unchanged and asserted by test.

---

## 6. Proof the optimization is byte-neutral

### 6.1 SQL level, on the production database

The shipping query and the pre-change query were both executed and their outputs
SHA-256'd:

| Tile | SHA-256 (current) | SHA-256 (optimized) | Bytes | Verdict |
| --- | --- | --- | ---: | --- |
| z7/108/49 | `d0d2671d…55e4` | `d0d2671d…55e4` | 216,084 | IDENTICAL |
| z7/109/49 | `bb1c677f…c6c7` | `bb1c677f…c6c7` | 3,711,118 | IDENTICAL |
| z8/218/99 | `8bfbad10…a24c` | `8bfbad10…a24c` | 2,609,329 | IDENTICAL |
| z9/436/198 | `3eaa613e…4864` | `3eaa613e…4864` | 1,197,621 | IDENTICAL |
| z10/873/396 | `a56cd4c2…ebbc` | `a56cd4c2…ebbc` | 344,227 | IDENTICAL |
| z13/6985/3174 | `900eaa35…a8f0` | `900eaa35…a8f0` | 7,032 | IDENTICAL |
| z10/868/397 (empty) | `e3b0c442…b855` | `e3b0c442…b855` | 0 | IDENTICAL |

### 6.2 HTTP level, before vs after, local and production

All ten representative tiles: identical SHA-256, identical byte count, identical decoded
feature count, identical property-key set, and identical ETag across *local before*,
*local after*, and *production before*.

### 6.3 Automated

`backend/tests/test_land_cover_cell_tiles_lc9_integration.py::test_materialized_cte_is_byte_identical_to_the_inlined_reference`
derives the reference query from the shipping SQL by removing only the `MATERIALIZED`
keyword and asserts the two encoded tiles are equal, so the guard cannot drift away from
the code it guards.

---

## 7. Cache and ETag behaviour

Verified against a real Caddy running this repository's own Caddyfile
(`scripts/qa/verify-mvt-compression.sh`, **52 checks, 0 failures**).

| Request | Status | `content-encoding` | ETag | `Vary` |
| --- | --- | --- | --- | --- |
| `Accept-Encoding: identity` | 200 | *(none)* | `"lc-cells-1-1-7-109-49"` | *(none)* |
| `Accept-Encoding: gzip` | 200 | gzip | `"lc-cells-1-1-7-109-49-gzip"` | `Accept-Encoding` |
| `Accept-Encoding: zstd` | 200 | zstd | `"lc-cells-1-1-7-109-49-zstd"` | `Accept-Encoding` |
| `gzip, deflate, br, zstd` (browser) | 200 | zstd | `…-zstd` | `Accept-Encoding` |
| no `Accept-Encoding` header at all | 200 | *(none)* | stem | *(none)* |
| `If-None-Match:` stem, gzip client | **304** | — | stem | `Accept-Encoding` |
| `If-None-Match:` `…-gzip`, gzip client | **304** | — | stem | `Accept-Encoding` |
| `If-None-Match:` `…-zstd`, zstd client | **304** | — | stem | `Accept-Encoding` |
| `If-None-Match:` stem, identity client | **304** | — | stem | — |
| `If-None-Match:` a wrong tag | 200 | — | stem | — |

Notes that matter for correctness:

* **Caddy gives each encoding its own entity tag** by appending the encoder name inside
  the quotes. That is required by RFC 9110 — two different representations must not share
  an entity tag — and Caddy strips its own suffix from an inbound `If-None-Match`, so
  revalidating a *compressed* variant still returns 304. Both directions are asserted.
* **The version-pinned stem is preserved** in every variant, so a statistics-version
  change still mints a different URL and a different ETag.
* **`Cache-Control: public, max-age=31536000, immutable`** is unchanged on both the
  compressed and uncompressed responses.
* **Compressed responses carry `Vary: Accept-Encoding`**; the identity response does not,
  which is Caddy's behaviour and is safe in the only direction that matters — an
  uncompressed MVT is valid for every client. The unsafe direction (a cache handing gzip
  bytes to a client that never advertised gzip) is prevented by that `Vary` and is
  additionally checked directly: a request with no `Accept-Encoding` header receives an
  unencoded body whose SHA-256 equals the identity body.
* **No double compression**: `content-encoding` is always a single token. Caddy skips a
  response that already carries one, so the scoped `encode` and the site-level `encode`
  do not stack.
* **Determinism**: repeating an identical request returns the same ETag and byte-identical
  content.

---

## 8. Local measurements, before and after

### 8.1 Backend TTFB (uvicorn direct, no proxy) — byte counts unchanged throughout

| Tile | TTFB before (s) | TTFB after (s) | Change |
| --- | ---: | ---: | --- |
| z7/108/49 | 1.011 | 0.230 | −77 % |
| z7/109/49 (worst) | 5.031 | 1.602 | −68 % |
| z8/218/99 | 1.583 | 0.931 | −41 % |
| z9/436/198 | 0.446 | 0.404 | −9 % |
| z10/873/396 | 0.321 | 0.147 | −54 % |
| z10/872/396 | 0.169 | 0.117 | −31 % |
| z13/6985/3174 | 0.017 | 0.014 | −18 % |

Local timings are noisy — Docker Desktop on macOS is not a stable timing environment —
so the production query-plan comparison in §2.4 is the load-bearing latency evidence.

### 8.2 Achievable compression, measured on the actual tile bodies

| Tile | Raw | gzip-6 | ratio | zstd-3 | ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| z7/108/49 | 216,084 | 35,800 | 0.166 | 33,252 | 0.154 |
| z7/109/49 | 3,711,118 | 568,164 | 0.153 | 533,747 | 0.144 |
| z8/218/99 | 2,609,329 | 423,646 | 0.162 | 409,436 | 0.157 |
| z9/436/198 | 1,197,621 | 201,658 | 0.168 | 197,108 | 0.165 |
| z10/873/396 | 344,227 | 61,039 | 0.177 | 61,378 | 0.178 |
| z13/6985/3174 | 7,032 | 2,103 | 0.299 | 2,001 | 0.285 |

Through the real Caddy the worst tile transferred **600,123 B (gzip)** and
**552,276 B (zstd)** against 3,711,118 B identity — the small difference from the table
above is Caddy's streaming compression level, not a content difference (all three decode
to the same SHA-256).

### 8.3 Browser (local, dev-mode Next.js, through the repository Caddyfile)

From `frontend/e2e/landCoverPerformance.spec.ts` (Chrome channel, 1 worker):

| Scenario | Tile requests | From cache | Transferred | Largest tile | Encoding | Enable→legend rows | Enable→settled | Console / page errors | Failed requests |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| default-view enable | 2 | 0 | 587,661 B | 552,519 B | zstd ×2 | 853–910 ms | 14.4–21.0 s | 0 / 0 | 0 |
| re-enable (immutable cache) | 2 | **2** | **0 B** | 0 B | zstd ×2 | — | 4.9 s | 0 / 0 | 0 |
| mode switch → dominant class | **0** | 0 | 0 B | 0 B | — | 2,842–2,979 ms | — | 0 / 0 | 0 |

Read honestly:

* the default view issues **two** tiles (z7/108/49 and z7/109/49 — the worst-case tile is
  inside the default fitted viewport at this window size), together **587 KB transferred**
  against ~3.93 MB uncompressed;
* re-enabling the layer costs **zero network bytes** — the one-year immutable cache works;
* switching visualization mode issues **no** tile request at all, confirming mode is a
  paint/filter change on the same version-pinned source;
* enable→settled of 14–21 s is a **local dev-mode** number on a machine also running
  Docker Desktop, PostGIS and a Playwright browser. It is recorded, not presented as a
  production figure. Production is measured separately after deployment.
* the coverage-mode legend is a static three-row vocabulary, so it is readable without
  waiting for a tile; the genuinely data-driven legend is the dominant-class one, which
  populates from already-loaded tiles.

---

## 9. Files changed

| File | Change |
| --- | --- |
| `deploy/Caddyfile` | scoped `encode zstd gzip` matching `application/vnd.mapbox-vector-tile*` inside the backend handler; site-level `encode` untouched |
| `backend/src/waste_equity_backend/api/routes/land_cover_cells.py` | `tile AS MATERIALIZED`; `_TILE_DISABLE_JIT` (`SET LOCAL jit = off`) issued before the tile query |
| `backend/tests/test_land_cover_cell_tiles_lc9_integration.py` | **new** — 18 LC9 guards |
| `frontend/e2e/landCoverPerformance.spec.ts` | **new** — browser measurement + correctness ceilings |
| `scripts/qa/land-cover-mvt-performance.sh` | **new** — read-only, production-safe tile performance probe |
| `scripts/qa/verify-mvt-compression.sh` | **new** — reverse-proxy compression/cache verification against a real Caddy |
| `docs/LAND_COVER_MVT_PERFORMANCE_OPTIMIZATION.md` | **new** — this document |

No migration. No model change. No schema change. No SQL that writes.

---

## 10. Test results (local)

| Gate | Command | Result |
| --- | --- | --- |
| Ruff format | `ruff format --check .` | 113 files formatted; **1 pre-existing** (`alembic/versions/20260719_0016_…py`, unmodified by LC9) |
| Ruff lint | `ruff check .` | **All checks passed** |
| mypy (strict) | `mypy` | **Success: no issues found in 54 source files** |
| Backend, non-PostGIS | `pytest` (no `TEST_DATABASE_URL`) | **passed**, PostGIS tier skipped as designed |
| Backend, full PostGIS | `TEST_DATABASE_URL=… pytest` | **601 passed**, 8 failed, 3 errors |
| Backend, LC9 only | `pytest tests/test_land_cover_cell_tiles_lc9_integration.py` | **18 passed** |
| Reverse-proxy compression | `scripts/qa/verify-mvt-compression.sh` | **52 checks, 0 failures**, exit 0 |
| Frontend ESLint | `npm run lint` | clean |
| Frontend typecheck | `npm run typecheck` | clean |
| Frontend Vitest | `npm run test` | **949 passed**, 7 skipped, 0 failed |
| Frontend production build | `npm run build` | compiled, 4/4 static pages |
| Playwright — LC5B layer | `landCoverLayer.spec.ts` | **10 passed**, exit **0** |
| Playwright — LC6 integrated QA | `landCoverIntegratedQa.spec.ts` | **13 passed**, exit **0** |
| Playwright — LC9 performance | `landCoverPerformance.spec.ts` | **3 passed**, exit **0** |

### 10.1 Pre-existing backend failures — reproduced on clean `main`

The full PostGIS suite was run on a **clean `main` worktree** at
`aaaae293dd9863a2ab1a57abbad4a2b5083bfdda` using the same test database and interpreter.
The failure sets are **identical** — `diff` of the sorted `FAILED`/`ERROR` lines is empty:

| | clean `main` | LC9 branch |
| --- | ---: | ---: |
| passed | 583 | **601** (+18 LC9 tests) |
| failed | 8 | 8 |
| errors | 3 | 3 |

| Test | Classification | Root cause |
| --- | --- | --- |
| `test_facility_mapping_transparency_integration.py::test_migration_head_is_0016` | **2 — pre-existing on main** | asserts the Alembic head is `0016`; it is `0020` since migrations 0017–0020 landed in later phases |
| `test_suitability_scenario_routes_integration.py::test_migration_head_is_0016_and_no_new_migration` | **2 — pre-existing on main** | same stale assertion |
| `test_migration_population_monthly_integration.py` (6 tests) | **3 — test-database state** | the tests need seeded `regions` / `ingestion_runs` rows; the test database is empty, so they fail with `AssertionError: a regions row is required by the FK` and `ForeignKeyViolation` |
| `test_reporting_routes_integration.py` (3 errors) | **3 — test-database state** | same missing `regions` / `ingestion_runs` rows, surfaced as fixture errors |

**None is introduced by LC9, and none is a product regression.** No unrelated test was
modified to obtain a green result. Follow-up recommendations are in §12.

### 10.2 Failures observed during the run that were NOT defects

Recorded rather than hidden:

* **Vitest, 2 failures in `src/app/page.phase7.test.tsx`** on one run —
  `waitFor` timeouts while the machine was simultaneously running the full PostGIS suite
  and Docker. Classification **4 — flaky under contention**: the file passes in isolation
  on both `main` and the LC9 branch, and the full suite passes 949/949 on a quiet machine.
* **Playwright, 2 failures** (`landCoverIntegratedQa.spec.ts:192`,
  `landCoverLayer.spec.ts:359`) during one 26-test run. Classification **3 — environment**:
  the local development PostgreSQL container hit an out-of-memory crash mid-run
  (`server process exited with exit code 2` → automatic recovery → `database system is
  ready to accept connections`) while serving concurrent multi-megabyte low-zoom tiles.
  Both specs pass with **exit code 0** when re-run on the recovered database. The database
  recovered cleanly and its contents are byte-identical to the pre-LC9 baseline (§11).
  Production was never involved.

---

## 11. No data changed

`scripts/qa/land-cover-db-baseline.sh` was captured before any LC9 work and again after
all local implementation, testing and browser QA. **`diff` is empty.**

| Key | Value (before == after) |
| --- | --- |
| `alembic.revision` | `0020` (single head) |
| `suitability.candidate_count` | 95,786 |
| `suitability.score_checksum` | `718262f905b5b506979f99d4be03a737` |
| `suitability.rank_checksum` | `26809213c34b11af2629ad6781b63b21` |
| `suitability.status_checksum` | `4cf8c0736ffbdcacc3e9c4852dc133df` |
| `suitability.exclusion_review_checksum` | `72c0faccacdee3902bdf973772b5409f` |
| `suitability.geometry_checksum` | `2edb2f83387ff0e6418b8ff285abc55c` |
| `suitability.stability_checksum` | `f47678651916b878401b67ccf2edd4f6` |
| `lc3.active_version_id` / `status` | 1 / `SUCCEEDED` |
| `lc3.active_candidate_grid_version` | `capital-grid-500m-v1` |
| `lc3.cell_count` | **47,893** |
| `lc3.cell_checksum` | `421be51cad458841001c001f62c74ad5` |
| `lc3.cells_complete_exact` / `partial` / `no_coverage` | **35,902 / 4,604 / 7,387** |
| `lc3.active_failed_cell_count` | **0** |
| `lc3.class_row_count` | **1,142,780** |
| `lc3.class_checksum` | `d3085c8af393f744bd9f7171a7e664f7` |
| `lc2.feature_count` / `map_sheet_count` | 6,901,309 / 2,013 (local only; never deployed) |

The historical values quoted in the phase brief (47,893 cells, 1,142,780 class rows,
35,902 / 4,604 / 7,387, 0 failed) are the values actually read — they were not forced.

`used_in_suitability_scoring` is `false` on the release endpoint, and
`lifecycle.scoring_integration` remains `NOT_IMPLEMENTED`. No suitability code path reads
the land-cover statistics; LC9 changed no scoring input, weight, policy version or
derivation version.

`environmental_land_cover_features` and `environmental_land_cover_map_sheets` are read by
**no** endpoint. The tile route's complete SQL dependency graph is:

```
GET …/tiles/{statistics_version_id}/{z}/{x}/{y}.mvt
  ├─ environmental_land_cover_cell_stat_versions   (pinned release, servability gates)
  ├─ suitability_analysis_runs                     (canonical run = lowest run of the grid version)
  ├─ suitability_candidates                        (candidate geometry, read in place)
  └─ environmental_land_cover_cell_statistics      (the 12 tile properties)
```

Never `environmental_land_cover_features`, never `environmental_land_cover_map_sheets`,
never a raw SHP file, never a raw source polygon.

### 11.1 One unintended production side effect, made good

While benchmarking, `CREATE EXTENSION IF NOT EXISTS pgcrypto` was run on the **production**
database to obtain a `digest()` function for hashing tile bytes. That extension had not
been installed. It changed no data, no table, no row, no checksum and no application
behaviour, and nothing depended on it (verified: 0 dependent objects). It was dropped
with the project owner's approval, and the production extension set was confirmed
restored to exactly its prior contents — `fuzzystrmatch`, `plpgsql`, `postgis`,
`postgis_tiger_geocoder`, `postgis_topology` — identical to the local development
database. Subsequent hashing used PostgreSQL's built-in `md5()` and client-side
`sha256`, which need no extension.

---

## 12. Remaining risks and limitations

1. **The worst low-zoom tile is still ~45,180 features of real content.** Compression
   makes it cheap to transfer and the query fix makes it ~2.2× cheaper to build, but it is
   still the single largest object the public API serves. It is version-pinned, cached one
   year immutable, and the layer is off by default, so the cost is paid at most once per
   tile per client.
2. **`Vary` is absent on the identity (uncompressed) response.** This is Caddy's
   behaviour. It is safe in the only direction that matters and is verified explicitly, but
   a shared intermediary cache could store the uncompressed representation and serve it to
   a compression-capable client. The consequence is a larger transfer, never wrong content.
3. **The suitability and wetland tile endpoints were not changed.** They share the same
   query shape and would benefit from the same JIT and CTE fixes, and they additionally
   lack the deterministic `ORDER BY` the land-cover tile has. Changing them would alter
   their served bytes and is out of LC9's scope — recorded as a follow-up.
4. **Two stale `test_migration_head_is_0016*` assertions** should be updated to track the
   real head (or assert "no NEW migration relative to a recorded baseline") in a separate
   change. LC9 deliberately did not touch unrelated tests.
5. **Six population-migration tests and three reporting-route tests require a seeded test
   database.** They should either seed their own `regions` / `ingestion_runs` rows or skip
   explicitly when the database is empty, instead of failing. Separate follow-up.
6. **Local timing figures are noisy** and one local database OOM crash occurred under
   concurrent load. Production numbers are measured separately and are the ones to quote.

---

## 13. Rollback

No database restore is needed — LC9 writes nothing and adds no migration.

1. **Caddy only** (restores uncompressed MVT, keeps the query fix): restore the backed-up
   `deploy/Caddyfile`, validate with `caddy validate`, reload Caddy.
2. **Application commit**: `git checkout aaaae293dd9863a2ab1a57abbad4a2b5083bfdda`,
   rebuild and recreate `backend` (and `caddy` if its config moved with the commit).
3. **Feature-level** (unchanged from LC8): deactivate the statistics release to disable the
   whole land-cover feature without touching anything else.

Exact commands, image ids and checksums are recorded in the deployment report.

---

## 14. Confirmations

* ✅ Land-cover statistics values, cell counts, class rows, coverage states, coverage
  ratios, evaluated/uncovered areas, dominant classes, source class codes and Korean names
  are **unchanged** (§11, `diff` empty).
* ✅ Candidate keys, candidate geometry identity, candidate-grid version and candidate-grid
  fingerprint are **unchanged**.
* ✅ Statistics-version identity is **unchanged** (version 1, `SUCCEEDED`, active).
* ✅ Suitability total score, rank, status, exclusions, review reasons, policy version and
  derivation version are **unchanged** (§11 checksums).
* ✅ `used_in_suitability_scoring = false`; land cover remains excluded from scoring.
* ✅ Project authorization status, source attribution and the raw-data non-redistribution
  statement are untouched — LC9 changed no disclosure text.
* ✅ Tiles are byte-identical before and after, proven by SHA-256 at both the SQL and HTTP
  layers across ten representative tiles in two environments.
* ✅ No Alembic migration, no schema change, no data migration, no database write.
* ✅ Raw source tables remain unread by every public path and undeployed to production.
* ✅ `docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` was not modified, deleted, moved, staged, or
  committed.
