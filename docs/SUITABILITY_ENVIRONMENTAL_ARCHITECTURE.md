# Suitability Environmental Layer Architecture (Phase 1A)

`phase: 1A (foundation)` · `implementation: DESIGN ONLY — no ingestion, no scoring`

This document designs the **future** environmental-layer architecture for the
후보지 분석 suitability screen. It is a design deliverable of Phase 1A. **Nothing in
this document is implemented as a running pipeline in Phase 1A**; the code added
in Phase 1A is inert scaffolding (interfaces, an empty ingestion framework, and a
metadata registry table). Actual ingestion, preprocessing, and scoring are Phase
1B and later.

It builds directly on the existing spatial platform documented in
[SUITABILITY_VECTOR_TILES.md](SUITABILITY_VECTOR_TILES.md),
[SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md), and the versioned structural
schema (`structural_dataset_versions`, `is_active` supersession,
`ingestion_runs`). The design principle is **reuse before invention**: the
environmental layers plug into the existing PostGIS + GeoAlchemy2 + FastAPI + MVT
stack and the existing provenance/versioning tables, adding only what is genuinely
new (raster handling and a layer catalogue).

## 1. Design goals and non-goals

**Goals**

- A single, scalable pattern for adding an arbitrary environmental layer
  (vector or raster) as a versioned, reproducible, provenance-complete dataset.
- Clean separation of *raw* → *normalized* → *derived-per-cell* data, matching
  the `AGENTS.md` separability rule.
- Every layer independently versioned and independently refreshable, so adding
  one layer never rebuilds another.
- Honest lifecycle: a layer is `IMPLEMENTED` / `PLANNED` / `FUTURE` /
  `EXPERIMENTAL`, and the catalogue is the single source of truth for that state.

**Non-goals (explicitly out of scope for this architecture in Phase 1A/1B-start)**

- No change to the existing four-component score (`zoning`, `road`, `equity`,
  `demand`), its weights, thresholds, ranking, or candidate statuses.
- No new scoring component until its data exists, is validated, and passes the
  analytical-methods review — a separate Phase 1B decision with its own
  `policy_version` / `derivation_version` bump.
- No real-time layer (weather/air quality) treated as permanent siting evidence.

## 2. Layer taxonomy and naming

Every environmental layer has a **stable machine name** (`snake_case`), a Korean
citizen label, a modality, and a lifecycle. Names are drawn from the audit
([SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md](SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md)):

| Layer name (machine) | Korean label | Modality | Lifecycle (Phase 1A) |
| --- | --- | --- | --- |
| `admin_boundary` | 행정구역 경계 | vector_polygon | IMPLEMENTED (reuse) |
| `zoning` | 용도지역 | vector_polygon | IMPLEMENTED (reuse) |
| `road_centerline` | 도로중심선 | vector_line | IMPLEMENTED (reuse) |
| `protected_area` | 보호·규제구역 | vector_polygon | IMPLEMENTED (reuse) |
| `dem_slope` | 수치표고·경사 | raster | PLANNED |
| `land_cover` | 토지피복 | vector_polygon | PLANNED |
| `river_network` | 하천망 | vector_line | PLANNED |
| `geology` | 지질 | vector_polygon | PLANNED |
| `wetland_inventory` | 내륙습지 목록 | vector_polygon | PLANNED |
| `building_footprint` | 건축물 | vector_polygon | FUTURE |
| `parcel` | 연속지적 | vector_polygon | FUTURE |
| `land_ownership` | 토지소유 | vector_polygon | FUTURE |
| `groundwater` | 지하수·수문지질 | point_and_polygon | FUTURE |
| `flood_hazard` | 홍수·침수 위험 | raster_or_polygon | EXPERIMENTAL |
| `fault` | 단층 | vector_line | EXPERIMENTAL |

The machine names, labels, modality, and lifecycle are stored authoritatively in
the backend registry (`waste_equity_backend.environment.layers`) and mirrored to
the `environmental_layer_registry` database table (Part 4). The two are kept
identical by a unit test, exactly like the facility standard-cost seed.

## 3. Vector vs raster: the one genuinely new capability

The platform today is **vector-only** (PostGIS polygons/lines, GeoAlchemy2,
`ST_AsMVT`). Three planned layers — `dem_slope`, `land_cover` (raster variant),
`flood_hazard` — are **raster**. This is the largest new engineering surface.

Design decision: **rasters are never stored as live raster tiles for scoring.**
Instead, each raster is reduced, at ingestion time, to a **per-candidate-cell
derived statistic** in a normal vector/numeric table. Concretely:

- `dem_slope` → per 500 m cell: `mean_slope_deg`, `max_slope_deg`,
  `share_slope_gt_threshold`. The raster is processed offline (mosaic →
  reproject → `slope` → zonal statistics against the 500 m grid) and only the
  numeric summary is persisted.
- `land_cover` → per cell: dominant class code + area share per class.
- `flood_hazard` → per cell: exposed / return-period flag.

Consequences:

- **No PostGIS `raster` extension dependency is required for scoring.** The
  raster→statistic reduction can run in the ingestion job (GDAL/rasterio or
  PostGIS raster used only inside ingestion), and the analysis reads plain
  numeric columns. This keeps the query path and MVT tiling unchanged.
- The raw raster files stay in the Git-ignored data root (never committed),
  consistent with the structural-bulk rule.

Vector layers follow the **existing** structural pattern exactly: reproject to
EPSG:4326, normalize attributes, fingerprint for idempotency, store as
`MULTIPOLYGON`/`MULTILINESTRING` features under a dataset version.

## 4. Storage model

Three tiers, matching `AGENTS.md` ("raw, intermediate normalized, and derived
analytical tables must be separable"):

```
raw  ──────────────►  normalized  ──────────────►  derived-per-cell
(files, Git-ignored)  (versioned features/rows)     (numeric per 500m cell)
```

1. **Raw** — official source files (DEM tiles, land-cover SHP, geology SHP,
   flood grids) under a Git-ignored data root resolved from the
   `ENVIRONMENTAL_DATA_ROOT` environment variable (no hardcoded absolute path).
   Only checksums + provenance are persisted, never the bytes — identical to the
   `data/raw/vworld/...` and `data/raw/mois_population/` rule.

2. **Normalized** — the reproject/clean/attribute-normalize output.
   - Vector layers **reuse the existing `structural_*` tables** where the
     semantics fit (polygon → `structural_protected_features`-style generic
     `layer_*` columns; line → `structural_line_features`), OR get a dedicated
     `environmental_*_features` table when the attribute set genuinely differs.
     The choice is per-layer and recorded in the registry; Phase 1A does not
     create feature tables (no ingestion yet).
   - Every normalized load is one `structural_dataset_versions`-style version
     row: provider, `reference_date`, `source_checksum`, `source_crs`,
     `target_crs`, `coverage_status`, `coverage_matrix`, `is_active`. **The
     existing `structural_dataset_versions` table and its `is_active`
     supersession flag are reused** rather than duplicated.

3. **Derived-per-cell** — the numeric summary each layer contributes to a
   candidate cell (slope stats, land-cover shares, distance-to-water, flood
   flag). This is where a future scoring component would read from. In Phase
   1B this is materialized per suitability run; it is **not** created in Phase
   1A and adds **no** column to `suitability_candidates` until a component is
   actually adopted.

The only new table in Phase 1A is the **catalogue**:
`environmental_layer_registry` (Part 4) — one row per layer describing its
identity, modality, lifecycle, provider, licence, update cycle, CRS, geometry/
raster type, suitability role, target phase, and readiness recommendation. It
holds **no** scores and **no** geometry.

## 5. Versioning

The layered versioning already used by the platform (see the audit's §7 findings)
is reused wholesale — no new versioning scheme is invented:

| Version kind | Where | Reused / new |
| --- | --- | --- |
| Dataset release version | `structural_dataset_versions` (`reference_date` + `source_checksum` + `transformation_version`, `is_active`) | **reuse** |
| Ingestion transformation version | `TRANSFORMATION_VERSION` constant per contract module, on `ingestion_runs` | **reuse pattern** (new constant per env layer, e.g. `env-dem-slope-v1`) |
| Analysis run signature | `suitability_analysis_runs.analysis_signature` (SHA-256 over versions + inputs) | **reuse**; when a layer is adopted, its active dataset-version ids join `input_dataset_version_ids` and a new run is produced, old runs preserved |
| Layer catalogue lifecycle | `environmental_layer_registry` (new table) + `waste_equity_backend.environment.layers` constants | **new (catalogue only)** |

Supersession rule (unchanged): a new dataset load is a **new version**; the old
version is never overwritten and is deactivated only by an explicit operator
`is_active` flip. Adding a layer to scoring bumps `policy_version` /
`derivation_version` and produces a **new** `suitability_analysis_runs` row —
historical runs stay reproducible.

## 6. Refresh strategy

Each environmental layer gets a row in the refresh matrix of
[DATA_REFRESH_STRATEGY.md](DATA_REFRESH_STRATEGY.md) when it is scheduled (Phase
1B), following the existing rules verbatim: idempotent, sanitized-raw preserved,
fail-visibly, never substitute sample data, per-run provenance
(`source, endpoint/file id, retrieval time, reference period, transformation
version`).

Cadence follows the source's real publication frequency (from the audit):

| Layer | Source cadence | Refresh check |
| --- | --- | --- |
| `dem_slope` | 부정기 (multi-year) | on new NGII DEM release |
| `land_cover` | 부정기 (권역별) | quarterly metadata check |
| `river_network` | 연간 (NGII) | annual |
| `geology` | 부정기 | on map-sheet revision |
| `wetland_inventory` | 부정기 | on new 조사 목록 |
| `building_footprint` | 월전체/월변동 | monthly metadata check |
| `flood_hazard` | 부정기 | blocked until licence resolved |

Refresh is one-shot CLI (the existing model), never an in-app scheduler in this
phase. A failed refresh is visible in `ingestion_runs` and never updates
`last_success_at` — identical to every existing job.

## 7. Cache and tiling

The suitability map is already served as **PostGIS MVT** with immutable, ETagged,
one-year-cacheable tiles keyed by `(run_id, profile, z, x, y)`
([SUITABILITY_VECTOR_TILES.md](SUITABILITY_VECTOR_TILES.md)). The environmental
architecture **does not add a second tile server or change the tile contract**:

- Because environmental factors are reduced to per-cell numeric attributes, a
  future component simply adds attributes to the *existing* candidate tile
  source-layer (`candidates`) — the same immutable-cache/ETag behaviour applies,
  since a run is never mutated in place.
- Optional **context overlays** (e.g. a slope or flood outline for display) would
  be served as their own read-only MVT endpoint following the identical
  `ST_TileEnvelope` → filter-in-4326 → `ST_AsMVTGeom` → `ST_AsMVT` pattern, with
  the same immutable cache headers. These are display-only and never analytical
  evidence.
- No client-side raster fetching; no external tile/CDN host; same-origin by
  construction, reverse-proxied by the existing Caddy.

Derived per-cell statistics are computed **once at ingestion/build time** and
cached in the database (not recomputed per request) — the same "filter-before-
transform, precompute-not-per-request" discipline the tile layer already uses.

## 8. Expected preprocessing (per modality)

**Vector layers** (existing pipeline, reused):

1. Read source CRS from `.prj`/metadata; reject if missing/unsupported.
2. Reproject source CRS → EPSG:4326 (`pyproj` + `shapely`, vectorized).
3. Normalize geometry (`MakeValid`, promote to Multi\*), reject invalid — never
   silently repair.
4. Normalize attributes to a documented code set.
5. Clip nationwide sources to the Seoul/Incheon/Gyeonggi SIDO boundaries.
6. Fingerprint (sha-256 over normalized geometry + identity) for idempotency.
7. Batched `ON CONFLICT DO NOTHING` insert under a dataset version.

**Raster layers** (new, ingestion-only):

1. Mosaic source tiles; reproject to a metric CRS (EPSG:5179/5186).
2. Derive the analytical surface (e.g. `slope` from DEM; class raster for land
   cover).
3. **Zonal statistics** against the EPSG:5179 500 m grid (the same grid the
   suitability engine builds via `ST_SquareGrid`).
4. Persist only the per-cell numeric summary + provenance. Raw rasters stay in
   the Git-ignored data root.

All distance/area operations use the platform standard (geodesic `geography` or a
validated projected CRS); never decimal degrees.

## 9. Dependency graph

```
                         ┌───────────────────────────────────────────────┐
                         │  admin_boundary (regions, EPSG:5179 grid base) │
                         └───────────────┬───────────────────────────────┘
                                         │ (500 m ST_SquareGrid — capital-grid-500m-v1)
                                         ▼
   raw sources (Git-ignored)     ┌──────────────────┐
   DEM/landcover/geology/… ────► │  normalization   │ ──► structural_dataset_versions (is_active)
                                 │  (reproject/clip/ │       │
                                 │   fingerprint or  │       ├─► vector: structural_*/environmental_*_features
                                 │   raster→zonal)   │       └─► raster: derived-per-cell numeric summary
                                 └──────────────────┘               │
                                                                    ▼
                                            ┌──────────────────────────────────────┐
                                            │  suitability_analysis_runs (Phase 1B) │
                                            │  signature ⊇ active env version ids   │
                                            └───────────────┬──────────────────────┘
                                                            ▼
                                            per-candidate derived facts ──► (future) new component
                                                            ▼
                                            MVT tiles / read API (unchanged contract)

   environmental_layer_registry (catalogue) ── describes every layer's lifecycle; read by future API
```

Key edges:

- **Everything depends on `admin_boundary`** for the grid and clipping — already
  implemented and boundary-versioned.
- **Raster layers depend on the 500 m grid** for zonal statistics; vector layers
  do not.
- **A scoring component depends on its layer being `IMPLEMENTED` and adopted**,
  which is gated by the review workflow — no automatic promotion.
- **`environmental_layer_registry` depends on nothing** and blocks nothing; it is
  a pure catalogue that the future API and the docs read.

## 10. Future API

Additive, read-only, `/api/v1` prefixed, following the existing router style.
**None of these is implemented in Phase 1A** — they are the design target:

| Method + path | Purpose | Phase |
| --- | --- | --- |
| `GET /api/v1/environment/layers` | List the layer catalogue with lifecycle, provider, licence, CRS, recommendation (reads `environmental_layer_registry`). | 1A-serveable (catalogue only) → 1B |
| `GET /api/v1/environment/layers/{name}` | One layer's full catalogue record + active dataset versions. | 1B |
| `GET /api/v1/environment/coverage` | Per-layer per-시도 coverage status (from dataset versions). | 1B |
| `GET /api/v1/environment/context/tiles/{layer}/{z}/{x}/{y}.mvt` | Display-only context overlay (slope/flood/land-cover outline), immutable cache. | 1B+ |

Contract discipline (unchanged): production hides `/docs`; CORS is `GET`+`POST`
only; every served metric carries source + reference period; missing data is
served as an explicit `null` + reason, never zero-filled.

The **existing** suitability API contract (`/api/v1/suitability/*`) is **not
changed** by this architecture. A future component would appear as additional
per-candidate attributes and an additional `policy_version`/run — additively,
never by breaking the current response shape.

## 11. What Phase 1A actually builds (recap)

- Documentation: this file + the audit + the roadmap.
- Backend: an `environment` package with the layer **registry/specs** and inert
  **interfaces/abstractions** (no ingestion, no scoring). See Part 3.
- Ingestion: an **empty ingestion framework** (env-backed config + abstract
  base + report dataclass) that raises `NotImplementedError` for Phase 1B work
  and is **not** wired into the runnable CLI.
- Database: one **catalogue** table, `environmental_layer_registry`, seeded from
  the same registry constants. No score column, no geometry, no change to any
  existing table.

Everything else in this document is design for Phase 1B and beyond.
