# Candidate-Cell Land-Cover Statistics API — Phase 1B-LC4

Read-only HTTP exposure of the derived statistics that
[Phase 1B-LC3](LAND_COVER_CANDIDATE_CELL_STATISTICS.md) persisted: for every canonical
500 m candidate-grid cell, the land-cover composition of the acquired 환경부 EGIS
세분류 [2025] 토지피복지도 release.

**Status: implemented and verified against a local development database only.**
No vector tiles, no OCI migration, no production deployment, no scoring integration, and
no new database migration.

When LC4 shipped there was also no frontend. That is no longer true:
[Phase 1B-LC5A](LAND_COVER_CANDIDATE_DETAIL_FRONTEND.md) reads
`/cells/{candidate_key}` and `/cells/{candidate_key}/classes` from the suitability
candidate-detail panel. There is still no map-wide land-cover layer, legend, or filter
(Phase 1B-LC5B), and the API contract itself is unchanged by that phase.

---

## 1. Purpose

LC3 derived and stored the statistics but exposed nothing over HTTP. LC4 adds the
smallest coherent, production-quality read-only API surface that the next frontend
phase (LC5A, candidate-detail integration) needs, and nothing more.

The API is **descriptive**. It answers "what does the acquired land-cover release say
about this candidate cell?" It never answers "is this cell suitable?"

## 2. Scope boundary

| In scope | Out of scope |
| --- | --- |
| Read-only FastAPI endpoints | Frontend / Next.js / map UI |
| Pydantic response schemas | Vector tiles (MVT) |
| Query/service logic, pagination, bbox, filters | OCI migration, production deployment |
| Provenance, lifecycle, licence disclosures | Raw land-cover geometry or per-feature records |
| API + PostGIS integration tests, query plans | Any change to suitability scoring |
| Documentation, local validation, regression proof | Any change to LC3 derivation results |

**No migration was added.** Live inspection confirmed LC3's migration `0020` already
carries every table and index the API needs; §8 records the query-plan evidence. The
Alembic head is unchanged at `0020` with a single head.

## 3. What was observed live before implementing

Read from the local development database (`waste_equity`) before any code was written:

| Fact | Observed value |
| --- | --- |
| Alembic head | `0020` (single head) |
| Active `land_cover` dataset version | `212`, `reference_period` `2025` |
| `environmental_land_cover_features` | 6,901,309 |
| `environmental_land_cover_map_sheets` | 2,013 |
| `environmental_land_cover_cell_stat_versions` | 1 row, 1 active |
| Active statistics version | id `1`, `SUCCEEDED`, `land-cover-cell-stats-v1`, `EPSG:5186` |
| Candidate grid version | `capital-grid-500m-v1` |
| Expected / processed cells | 47,893 / 47,893 (0 failed) |
| Coverage status counts | 35,902 `COMPLETE_EXACT`, 4,604 `PARTIAL`, 7,387 `NO_COVERAGE` |
| `environmental_land_cover_cell_statistics` | 47,893 |
| `environmental_land_cover_cell_class_areas` | 1,142,780 (L1 7 codes, L2 22, L3 41) |
| `NO_COVERAGE` cells carrying class rows | 0 |
| SIDO split | 서울 2,470 / 인천 4,104 / 경기 41,319 |
| `suitability_analysis_runs` | 2 (ids 1, 47), both `capital-grid-500m-v1` |
| `suitability_candidates` | 95,786 rows → 47,893 distinct keys |

35,902 + 4,604 + 7,387 = 47,893 and the stored `class_row_count` equals the actual class
row count, so the active release is complete and internally consistent. No raw source
file, external drive, or source root was accessed at any point in this phase.

### 3.1 One observed inconsistency in LC3's stored metadata (not repaired)

`environmental_land_cover_cell_stat_versions.derivation_metadata` contains two
statements about the coverage rule that disagree:

* `coverage_semantics` says `COMPLETE_EXACT` is decided by the **polygonal residual
  being empty**.
* the trailing clause of `numerical_guard` says "COMPLETE_EXACT is decided by
  `ST_Covers` alone".

The data proves the first is what actually ran: all 35,902 `COMPLETE_EXACT` rows have
`uncovered_residual_area_m2 = 0`, while only **314** of them have
`topological_cover_predicate = true`. Had `ST_Covers` alone decided the status, the two
counts would be equal.

The API therefore states the **residual-emptiness rule** as authoritative (it matches the
data, the LC3 model docstring, and the LC3 commit message) and additionally returns the
stored `derivation_metadata` verbatim so nothing is hidden. Modifying LC3's persisted
results is out of scope for this phase, so the stale sentence was left untouched.

## 4. Endpoints

Base path: `/api/v1/environment/land-cover/cell-statistics`
OpenAPI tag: `environment-land-cover`. All five are `GET`; there is no write verb.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/release` | The active statistics release: identity, provenance, audits |
| GET | `/summary` | Aggregate over all cells, optionally scoped by region/status |
| GET | `/cells` | Bounded, deterministically-ordered page of cells |
| GET | `/cells/{candidate_key}` | One cell's complete statistics |
| GET | `/cells/{candidate_key}/classes` | One cell's complete L1/L2/L3 class distribution |

`candidate_key` is the canonical grid identity `<grid version>:<i>_<j>`, e.g.
`capital-grid-500m-v1:1873_3903`. The colon is a legal path character and needs no
escaping; the parameter is bounded to 1–50 characters.

### 4.1 `GET /release`

No parameters. Returns the statistics version id, status, active flag, derivation
version, area CRS, input signature, candidate grid version and fingerprint, expected /
processed / failed cell counts, coverage-status counts, class row count, the three area
totals, the aggregate coverage ratio, the overlap audit, the numerical-guard audit, the
canonicalization audit, start/completion timestamps, the full source-release provenance
(including `reference_period` and `source_checksum`), LC3's verbatim
`derivation_metadata`, and the `disclosures` block.

### 4.2 `GET /summary`

| Parameter | Type | Notes |
| --- | --- | --- |
| `sido_code` | string, optional | Normalized SIDO code, e.g. `KR-SGIS-11` |
| `sigungu_code` | string, optional | Normalized SIGUNGU code |
| `coverage_status` | enum, optional | `COMPLETE_EXACT` \| `PARTIAL` \| `NO_COVERAGE` |

Returns `cell_count`, `coverage_status_counts` (all three keys always present, `0` when
absent), the three area totals, `aggregate_coverage_ratio`,
`cells_without_dominant_class`, `dominant_l1_distribution`, `l1_area_distribution`,
`total_l1_class_area_m2`, the release reference, and disclosures.

### 4.3 `GET /cells`

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `coverage_status` | enum | — | `COMPLETE_EXACT` \| `PARTIAL` \| `NO_COVERAGE` |
| `sido_code` | string | — | Indexed (`ix_land_cover_cell_statistics_sido`) |
| `sigungu_code` | string | — | |
| `dominant_l1_code` | string | — | Official L1 code, e.g. `300` |
| `min_coverage_ratio` | float | — | `0.0`–`1.0` |
| `max_coverage_ratio` | float | — | `0.0`–`1.0` |
| `bbox` | string | — | `minLon,minLat,maxLon,maxLat`, EPSG:4326 |
| `limit` | int | **50** | Hard maximum **500** |
| `offset` | int | 0 | |
| `sort` | enum | `candidate_key` | See below |

Filters compose with AND. Sort keys: `candidate_key`, `coverage_ratio`, `cell_area_m2`,
`evaluated_area_m2`, `uncovered_area_m2`, each with a `-` prefix for descending. Any
non-`candidate_key` sort gets `candidate_key ASC` appended, which makes the ordering
total (the key is unique within a statistics version) and therefore paging stable.

`total` is an exact indexed count. Rows are lean and carry no per-row provenance; the
release reference and disclosures sit once on the envelope. Class rows are never fetched
per row — the per-level counts already live on the cell — so there is no N+1.

### 4.4 `GET /cells/{candidate_key}`

Returns the grid version, key, geometry fingerprint, region codes/names, cell area,
evaluated area, both uncovered measures (arithmetic and geometric residual), coverage
ratio, coverage status **and its meaning**, the `ST_Covers` evidence predicate, the
pre-union intersection sum and overlap, matched feature count, dominant L1/L2/L3 class,
per-level class counts and area sums, the candidate occurrence /
representation-variant audit, the guard flag, derivation version, area CRS,
`used_in_suitability_scoring: false`, the release reference, and disclosures.

### 4.5 `GET /cells/{candidate_key}/classes`

| Parameter | Type | Notes |
| --- | --- | --- |
| `class_level` | int, optional | `1` = 대분류, `2` = 중분류, `3` = 세분류 |

Each record carries `class_level`, `class_code`, `class_name`, `class_area_m2`,
`share_of_evaluated_area`, `share_of_cell_area`. Ordering is deterministic:
`class_level ASC, class_area_m2 DESC, class_code ASC`.

Not paginated, deliberately: a cell's distribution is bounded by the source class
vocabulary (7 + 22 + 41 = at most 70 codes), so the response is inherently small.

`class_level` is typed as a bounded `int` (`ge=1, le=3`), not `Literal[1, 2, 3]` —
query values always arrive as strings and Pydantic v2 does not coerce `"1"` into an
integer literal, so a `Literal` would have rejected every valid request. The validation
outcome is identical (`0`, `4`, `L1` → 422).

## 5. Coverage semantics (preserved verbatim from LC3)

| Status | Meaning |
| --- | --- |
| `COMPLETE_EXACT` | The polygonal residual of (candidate cell − evaluated land-cover union) is **empty** under the LC3 exact topology rule. Exact set-theoretic emptiness, not an area threshold: a cell is never promoted for being close to 100 % covered. |
| `PARTIAL` | Some polygonal land-cover intersection exists, but the cell has a non-empty uncovered residual. The class distribution describes only the evaluated part. |
| `NO_COVERAGE` | No polygonal land-cover feature from the acquired release intersects the cell. |

**`NO_COVERAGE` means only that the acquired land-cover extent does not evaluate that
candidate cell.** It does **not** mean that no land cover exists, that the land is
empty, unused, or vacant, or that the cell is safe or suitable. The API enforces this
structurally, not just in prose:

* every response carrying composition also carries `coverage_status` and
  `coverage_ratio`, so partial data cannot be rendered as complete;
* `coverage_status_meaning` is returned inline on both per-cell endpoints;
* the `disclosures.coverage_status_semantics` map and a Korean
  `no_coverage_warning_ko` string ship on every envelope.

`uncovered_area_m2` is a **coverage measurement on the cell**, never a land-cover class.
No `UNKNOWN` or `UNCLASSIFIED` pseudo-class is synthesized, and a `NO_COVERAGE` cell
returns an empty class list. Verified live: 0 of the 7,387 `NO_COVERAGE` cells have a
class row.

### 5.1 Class-distribution semantics

Official source class codes and Korean names are returned **verbatim** as LC3 stored
them — never translated, normalized, renamed, re-grouped, or merged.

Two share denominators are exposed and never conflated:

* `share_of_evaluated_area` = `class_area_m2 / evaluated_area_m2` (the covered part).
  **`null`, never `0`**, when the cell has no evaluated area, because the ratio is
  undefined rather than zero.
* `share_of_cell_area` = `class_area_m2 / cell_area_m2` (the whole cell).

`l1/l2/l3_class_area_sum_m2` on the cell is LC3's documented reconciliation denominator:
it equals `evaluated_area_m2` when the source partitions the evaluated part of the cell.

### 5.2 Aggregation semantics

`aggregate_coverage_ratio` is **area-weighted**:
`total_evaluated_area_m2 / total_cell_area_m2`. It is never a mean of per-cell ratios,
which would weight a boundary-clipped edge cell the same as a full 250,000 m² one. This
matches LC3's own stored `aggregate_coverage_ratio` definition (verified: 9,982,832,659.59
/ 11,926,403,570.40 = 0.8370362951971573, the stored value). It is `null`, not `0`, when
the denominator is zero.

Cells with no dominant class (the `NO_COVERAGE` ones) are reported as their own
`cells_without_dominant_class` count, never as a `null`-coded row in the class
distribution, so no pseudo-class is invented by aggregation either.

## 6. Active-release resolution

Resolution is deliberately strict and never guesses:

| Condition | Response |
| --- | --- |
| Exactly one active release, `SUCCEEDED`, processed == expected, 0 failed | served |
| No active release | `404 NO_ACTIVE_STATISTICS_RELEASE` |
| More than one active release | `409 MULTIPLE_ACTIVE_STATISTICS_RELEASES` (lists the ids) |
| Active but `RUNNING`/`FAILED` | `409 INCOMPLETE_ACTIVE_STATISTICS_RELEASE` |
| Active but processed ≠ expected, or failed cells > 0 | `409 INCOMPLETE_ACTIVE_STATISTICS_RELEASE` |

LC3's partial unique index already permits at most one active release per (source
release, grid version, derivation version), and the PostGIS tier asserts that. Two
releases derived from *different* source versions could still both be active, which is
the ambiguity the `409` surfaces rather than resolving arbitrarily.

Every endpoint — including `/cells` — fails this way. None degrades an unavailable
release into a `200` with an empty page.

## 7. bbox and the canonical candidate join

The LC3 statistics table intentionally stores **no geometry** (the cell geometry already
lives on `suitability_candidates`). A spatial filter therefore has to reach that
geometry through the stable `(grid version, candidate key)` identity:

```sql
candidate_key IN (
    SELECT DISTINCT c.candidate_key
    FROM suitability_candidates c
    JOIN suitability_analysis_runs r ON r.id = c.analysis_run_id
    WHERE r.candidate_grid_version = :grid
      AND c.geometry && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
)
```

Design points:

* The `&&` predicate is expressed in **EPSG:4326**, the storage CRS, so PostGIS uses the
  existing `idx_suitability_candidates_geometry` GiST index directly. No candidate row
  is transformed inside the predicate.
* **No second copy of candidate geometry is persisted** and no new geometry table was
  created. The API does not return candidate geometry either — the existing suitability
  candidate endpoints remain the single source for it.
* `DISTINCT candidate_key` over every occurrence of the grid version is **equivalent to
  testing the canonical occurrence alone**. LC3's canonical rule is the lowest
  `(analysis_run_id, id)` per key, and it proved every other occurrence
  `ST_Equals` the canonical one (0 conflicts, 23 audited representation variants).
  Topologically equal geometries have identical bounding boxes, so `&&` cannot disagree
  between occurrences. Restricting to the canonical occurrence instead would force a
  `DISTINCT ON` over all 95,786 rows *before* any spatial filter could apply, defeating
  the GiST index. `test_bbox_matches_the_canonical_occurrence_key_set` asserts the
  equivalence directly against the canonical `DISTINCT ON` rule on real PostGIS.
* Each cell appears **once** even though every key has two candidate occurrences in this
  grid; the occurrence count is reported on the cell rather than collapsed away.
* Candidates belonging to a different grid version never leak in, even when they overlap
  geometrically and share a key string
  (`test_bbox_ignores_candidates_of_another_grid_version`).

`environmental_land_cover_features` is **never joined** by any handler.

## 8. Performance evidence

`EXPLAIN (ANALYZE, BUFFERS)` on the real local development database (47,893 cells,
1,142,780 class rows, 6.9 M raw features present but untouched). Bounded queries only —
no unbounded `EXPLAIN ANALYZE` was run over the feature table.

| # | Query | Execution time | Index used |
| --- | --- | --- | --- |
| 1 | bbox page (limit 50) | **1.53 ms** | `idx_suitability_candidates_geometry` (GiST bitmap) → `ix_land_cover_cell_statistics_candidate_key` |
| 2 | bbox total count | **1.41 ms** | GiST → `uq_land_cover_cell_statistics_version_key` (index-only, 0 heap fetches) |
| 3 | candidate detail | **0.06 ms** | `ix_land_cover_cell_statistics_candidate_key` |
| 4 | one cell's class distribution | **0.12 ms** | `ix_environmental_land_cover_cell_class_areas_cell_statistics_id` |
| 5 | coverage-status page | **0.87 ms** | `ix_land_cover_cell_statistics_candidate_key` (ordered, no sort) |
| 6 | dominant-L1 page | **0.22 ms** | same |
| 7 | SIDO page | **3.97 ms** | same |
| 8 | summary dominant-L1, whole release | **40.87 ms** | seq scan + HashAggregate |
| 9 | summary L1 class area, whole release | **114.62 ms** | `ix_land_cover_cell_class_areas_version_level_code` (bitmap, 205,525 rows) |
| 10 | summary L1 class area, Seoul only | **35.55 ms** | `ix_land_cover_cell_statistics_sido` → per-cell index scan |
| 11 | active-release resolution | **0.07 ms** | seq scan of a 1-row table |

Two sequential scans appear and both are **harmless**: #8 is a whole-release aggregate
that genuinely must read every one of the 47,893 rows (3,410 pages), and #11 scans a
one-row table. No plan sequentially scans `environmental_land_cover_features`, and no
plan transforms geometry inside a predicate.

Warm end-to-end handler latency, median of 5 runs against the dev database:

| Endpoint | Warm median |
| --- | --- |
| `/release` | 6.5 ms |
| `/summary` (overall) | 257.7 ms |
| `/summary?sido_code=KR-SGIS-11` | 39.5 ms |
| `/cells` (default page 50) | 22.5 ms |
| `/cells?bbox=…` | 14.3 ms |
| `/cells?limit=500` (max page) | 45.1 ms |
| `/cells/{key}` | 4.9 ms |
| `/cells/{key}/classes` | 6.3 ms |

**No index was added and no migration was created.** Every bounded query is
sub-4 ms; the only slow endpoint is the unfiltered whole-region `/summary` (~258 ms),
which aggregates the entire release by definition and which no index can shortcut. It is
documented as a known characteristic rather than optimized speculatively.

Independent confirmation that the raw feature table is untouched: across every captured
handler statement (51 statements over all 10 endpoint variants) there are **0**
references to `environmental_land_cover_features` or
`environmental_land_cover_map_sheets`, and the PostGIS test
`test_no_handler_queries_raw_land_cover_features` asserts the feature table's
`pg_stat_all_tables.seq_scan` counter does not advance across a full endpoint sweep.

## 9. Error behaviour

Errors are structured `{"error": "<CODE>", "detail": "<text>"}` under FastAPI's `detail`
key. No response carries SQL, a connection string, a local path, or a stack trace, and
no internal error is turned into a `200`.

| Condition | Status | Code |
| --- | --- | --- |
| No active statistics release | 404 | `NO_ACTIVE_STATISTICS_RELEASE` |
| More than one active release | 409 | `MULTIPLE_ACTIVE_STATISTICS_RELEASES` |
| Active release incomplete / not `SUCCEEDED` | 409 | `INCOMPLETE_ACTIVE_STATISTICS_RELEASE` |
| Unknown candidate key | 404 | `CANDIDATE_CELL_NOT_FOUND` |
| Key exists only in another grid version / superseded release | 404 | `CANDIDATE_KEY_NOT_IN_ACTIVE_RELEASE` |
| Malformed / reversed / out-of-range / non-finite bbox | 422 | `INVALID_BBOX` |
| `min_coverage_ratio > max_coverage_ratio` | 422 | `INVALID_COVERAGE_RATIO_RANGE` |
| Source dataset version missing (FK-impossible) | 500 | `MISSING_SOURCE_RELEASE` |
| Invalid coverage status, class level, sort key, page size, offset, ratio bound | 422 | FastAPI validation |

bbox validation covers: wrong part count, non-numeric, `NaN`/`±inf`, reversed or
degenerate longitude/latitude, longitude outside `[-180, 180]`, latitude outside
`[-90, 90]`. It runs **before** any query is issued.

## 10. Test results

| Tier | Command | Result |
| --- | --- | --- |
| API / schema / serialization (SQLite) | `pytest tests/test_land_cover_cell_routes.py` | **79 passed** |
| PostGIS integration | `TEST_DATABASE_URL=… pytest tests/test_land_cover_cell_routes_integration.py` | **21 passed** |

The four LC3 statistics tables are genuinely non-spatial (LC3 stores no geometry), so
they were added to the shared SQLite fixture and the full API is exercisable there. Only
the bbox filter needs candidate geometry, so the PostGIS tier covers it.

PostGIS-tier coverage includes: active-release resolution against real PostGIS, LC3's
partial unique index blocking a second active release, bbox inclusion/exclusion and
progressive widening, the canonical-occurrence equivalence, no duplicate rows across
analysis runs, grid-version isolation, `COMPLETE_EXACT`/`PARTIAL`/`NO_COVERAGE`
serialization from real columns, a `NULL` share serializing as `null`, no class rows for
`NO_COVERAGE`, no raw-feature access, and read-only behaviour.

All PostGIS-tier fixtures are synthetic (`lc4-test-*`, remote-ocean geometry at
lon/lat ≈ 40°) inside a rolled-back outer transaction, including their own
`DataSource` and `environmental_dataset_versions` row, so no real row is created,
changed, or read as a dependency.

The isolated test database `waste_equity_test` was at `0019` and was upgraded to `0020`
(additive, LC3's own migration). The loaded development database was never migrated,
truncated, reset, or recreated.

## 11. Lifecycle labels

Served on every response under `disclosures.lifecycle`:

| Aspect | State |
| --- | --- |
| `source_contract_validation` | `LIVE_VERIFIED` |
| `database_ingestion` | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| `cell_statistics_derivation` | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| `api_exposure` | `IMPLEMENTED` |
| `frontend_exposure` | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| `vector_tiles` | `IMPLEMENTED_AND_LOCALLY_VERIFIED` |
| `scoring_integration` | `NOT_IMPLEMENTED` |
| `production_deployment` | `NOT_RUN` |

`frontend_exposure` was `NOT_IMPLEMENTED` when LC4 shipped, then `CANDIDATE_DETAIL_ONLY`
after Phase 1B-LC5A read `/cells/{candidate_key}` and `/cells/{candidate_key}/classes`
into the suitability candidate-detail panel. Phase 1B-LC5B added the map-wide layer,
dynamic legend and filters, together with the version-pinned tile endpoint they consume,
so both `frontend_exposure` and `vector_tiles` are now
`IMPLEMENTED_AND_LOCALLY_VERIFIED` — "locally", because every phase so far was verified
against a local development database only and `production_deployment` stays `NOT_RUN`.
See `docs/LAND_COVER_CANDIDATE_DETAIL_FRONTEND.md` and
`docs/LAND_COVER_MAP_LAYER_LEGEND_FILTERS.md`.

A sixth, read-only endpoint was added in LC5B under this same router prefix:
`GET /tiles/{statistics_version_id}/{z}/{x}/{y}.mvt`, serving the complete candidate-cell
layer as Mapbox Vector Tiles pinned to an immutable statistics version. It reads the same
three LC3 tables plus the existing candidate geometry, adds no migration, and — like every
handler here — never touches `environmental_land_cover_features`.

## 12. Licence and public-use status

`license_status` is **`LOCAL_USE_ONLY_PENDING_CLARIFICATION`**, unchanged from LC2.

Public-use/licence clarification for the acquired 토지피복지도 release is still pending
written confirmation from the provider. **KOGL Type 1 is not claimed. Commercial-use
permission is not claimed.** The verbatim stored `license_note` is returned alongside
the status. This phase interprets nothing further and upgrades nothing.

## 13. Scoring integration

`used_in_suitability_scoring` is `false` on every per-cell response and in every
`disclosures` block. No score, rank, status, exclusion, review reason, weight, policy
version, or suitability derivation version reads these statistics, and this phase
changed none of them. The router imports no scoring module and writes no table.

## 14. Raw geometry and feature exposure

The API exposes only aggregated per-cell statistics.

* No land-cover feature geometry, and no per-feature record, is ever returned.
* `environmental_land_cover_features` is never queried (§8).
* `candidate_geometry_fingerprint` is a sha-256 digest, not geometry: it ties a row to
  the exact geometry the areas were measured on without reproducing any coordinate.
* Candidate geometry is **not** duplicated here. The existing suitability candidate
  endpoints remain its single source, which is why LC5A should read geometry from there
  rather than from this API.

## 15. Regression result

A read-only baseline was captured before and after implementation over
`suitability_analysis_runs`, `suitability_candidates`, the candidate
score/rank/status checksum, the candidate geometry checksum, policy and derivation
versions, the land-cover dataset version, feature and map-sheet counts, the LC3
statistics version / statistics / class rows, the coverage-status counts, and the LC3
cell- and class-content checksums.

**Every checksum and count is byte-identical before and after.** See §16 of the phase
report in the commit message and the final report for the recorded values.

## 16. Known limitations

1. The unfiltered whole-region `/summary` takes ~258 ms warm because it aggregates all
   47,893 cells and 205,525 L1 class rows. No index can shortcut a full aggregate; if
   this becomes a UI problem, the answer is a cached or pre-aggregated summary, not a
   new index.
2. `/summary` exposes an L1 distribution only. L2/L3 aggregate distributions were not
   added because no consumer needs them yet; per-cell L2/L3 is fully available.
3. The bbox filter's efficiency relies on LC3's proven `ST_Equals` identity across
   candidate occurrences (§7). That property is asserted by an integration test but is a
   property of the *current* grid; a future grid version admitting genuine geometry
   conflicts would need the canonical occurrence resolved explicitly.
4. Capital-region land-cover coverage is `INCOMPLETE` (aggregate ratio 0.837, 7,387
   `NO_COVERAGE` cells). That is a property of the acquired source extent, faithfully
   reported, not an API defect.
5. `total` is an exact count on every page. At 47,893 cells this is cheap; it would need
   revisiting at a much larger grid.
6. LC3's stored `derivation_metadata` contains one stale sentence (§3.1), left unmodified
   because changing LC3 results is out of scope.
7. Verified against a local development database only. Production/OCI availability is
   **not** established by this phase.

## 17. Next phase

**LC5A — candidate-detail frontend integration.** Surface this API in the existing
candidate detail panel: land-cover composition with its coverage status and ratio
displayed inseparably, the Korean `NO_COVERAGE` disclosure rendered whenever coverage is
absent or partial, official Korean class labels shown verbatim, and the pending-licence
and not-used-in-scoring statements visible in the UI. Candidate geometry must come from
the existing suitability endpoints, not from this API.

Production/OCI deployment of LC4 has **not** been run and remains a separate,
explicitly-gated decision.
