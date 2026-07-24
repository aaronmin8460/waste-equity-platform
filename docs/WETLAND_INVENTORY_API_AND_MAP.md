# 내륙습지 목록 (Inland Wetland Inventory) — Read-only API & Map Layer

**Phase:** Suitability 1B-2 (read-only API exposure + frontend map layer)
**Layer name:** `wetland_inventory`
**Branch:** `feature/phase1b2-wetland-api-map`

## Lifecycle

| Aspect | Status |
| --- | --- |
| Contract verification | `LIVE_VERIFIED` (Phase 1B-0) |
| PostGIS ingestion | `IMPLEMENTED_AND_LOCALLY_VERIFIED` (Phase 1B-1) |
| **Read-only API exposure** | **`IMPLEMENTED_AND_LOCALLY_VERIFIED`** (Phase 1B-2) |
| **Frontend map exposure** | **`IMPLEMENTED_AND_LOCALLY_VERIFIED`** (Phase 1B-2) |
| Scoring / weight / exclusion integration | `NOT_IMPLEMENTED` |
| Production deployment (OCI/AWS) | `NOT_RUN` |

The `GET /metadata` endpoint emits the canonical machine values
(`api_exposure: IMPLEMENTED`, `frontend_map_exposure: IMPLEMENTED`,
`scoring_integration: NOT_IMPLEMENTED`, `production_deployment: NOT_RUN`); this
table is the prose lifecycle, and "locally verified" means the endpoints and map
layer were exercised against the local PostGIS load, **not deployed**.

## 1. Purpose and scope

Expose the surveyed 국립생태원 전국 내륙습지 inventory that Phase 1B-1 loaded into
PostGIS as **read-only** API endpoints and a **separate, optional** MapLibre map
layer, with full provenance and an explicit statutory-status disclosure.

**In scope:** four read-only endpoints (metadata, list/query, feature detail,
vector tiles); a distinct frontend layer with a toggle, per-type filter/legend,
designation filter, click popup, and source disclosure; a data-sources page
disclosure; tests; documentation.

**Out of scope (hard boundaries):** no suitability score, weight, or exclusion; no
candidate rank/status change; no hard exclusion; no merge with UM901; no policy or
weight-profile change; no production data change; no OCI deployment; no new
ingestion migration; no raw-file upload; no write endpoint.

## 2. This inventory is NOT a statutory protection area

`UM901` is the **statutory** 습지보호지역 layer (legal effect, includes coastal
연안습지) in `structural_protected_features`. This inventory is a **surveyed**
set of inland wetlands and confers **no** legal status. They are kept separate at
every layer (database, API, frontend). See
[WETLAND_INVENTORY_DATA_CONTRACT.md](WETLAND_INVENTORY_DATA_CONTRACT.md) §9 and
[WETLAND_INVENTORY_INGESTION.md](WETLAND_INVENTORY_INGESTION.md) §10.

The three canonical Korean disclosures (identical text in the backend schema, the
frontend layer, and the tests):

- 내륙습지 목록은 국립생태원의 조사·목록 데이터이며, 모든 습지가 법정 습지보호지역을 의미하지 않습니다.
- 법정 습지보호지역은 기존 UM901 보호구역 레이어에서 별도로 확인할 수 있습니다.
- (feature detail) 이 레이어는 조사된 내륙습지 목록입니다. 모든 항목이 법정 습지보호지역을 뜻하지 않습니다.

The inventory is **never** labelled 보호구역 / 법정 보호지역 / 제외지역 / 입지 불가 /
규제지역. `designation_note` (source column `EXP`) is surfaced only as labelled
source text (`원자료 지정 메모`) and is never presented as legal status.

## 3. API endpoints

Router: `backend/src/waste_equity_backend/api/routes/wetlands.py`, namespace
`/api/v1/environment/wetlands`, tag `environment-wetlands`. Every route is `GET`
(read-only); no route mutates any table.

### 3.1 `GET /api/v1/environment/wetlands/metadata`

Layer identity, provenance, lifecycle, and disclosures. Resolves the most recent
**active** `environmental_dataset_versions` row for `wetland_inventory`.

Selected fields: `layer_name`, `korean_label`, `provider`,
`official_dataset_name`, `provider_dataset_identifier`, `official_source_url`,
`reference_date`, `source_crs` (EPSG:5186), `storage_crs` (EPSG:4326),
`source_encoding`, `transformation_version`, `declared_feature_count` (2,704),
`served_feature_count` (live indexed count), `geometry_type` (MultiPolygon),
`lifecycle` (object), `statutory_status_statement`, `um901_distinction_statement`,
`license_note`, `provenance` (object), `last_ingestion` (the SUCCEEDED run that
produced the active release, or null). Returns `404 WETLAND_DATASET_NOT_AVAILABLE`
when no active release is loaded.

### 3.2 `GET /api/v1/environment/wetlands`

Bounded, deterministically-ordered list over the active release. Query parameters:

| Param | Type | Notes |
| --- | --- | --- |
| `sido_code` | str | normalized SIDO region code |
| `sigungu_code` | str | normalized SIGUNGU region code |
| `source_sido_name` | str | source 시도 name (verbatim) |
| `source_sigungu_name` | str | source 시군구 name (verbatim) |
| `wetland_type` | str | 하천습지 / 호수습지 / 산지습지 / 인공습지 |
| `designation_only` | bool | only features with a source `EXP` note |
| `q` | str | case-insensitive name/code search (LIKE wildcards escaped) |
| `bbox` | str | `minLon,minLat,maxLon,maxLat`; validated to WGS84 range |
| `limit` | int | default 50, max 200 |
| `offset` | int | ≥ 0 |
| `sort` | enum | whitelist: `id`, `wetland_name`, `wetland_code`, `reported_area_m2`, `geometry_area_m2`, each `-` prefixed for descending; default `id` |

Filters compose with **AND**. Response: `{ items, total, limit, offset, has_more }`.
`total` is an indexed `COUNT(*)` (never a geometry transform). Geometry and
`raw_attributes` are **deferred** — never selected or returned in the list. Each
item is a `WetlandInventoryFeatureSummary` (normalized public-safe fields plus the
provider's reported representative point `source_longitude`/`source_latitude`,
which is reported metadata, never a computed centroid). Invalid bbox → `422
INVALID_BBOX`; invalid sort → `422` (FastAPI enum validation).

### 3.3 `GET /api/v1/environment/wetlands/{feature_id}`

One feature with bounded GeoJSON geometry (EPSG:4326, via `ST_AsGeoJSON`),
a `provenance` block, the statutory-status warning, and the UM901 distinction.
`source_attributes` (the sanitized verbatim source-attribute map) is returned
**only** when `include_raw_attributes=true` (default false). Missing feature →
`404 WETLAND_FEATURE_NOT_FOUND`. A row without geometry → `500 MISSING_GEOMETRY`.

### 3.4 `GET /api/v1/environment/wetlands/tiles/{z}/{x}/{y}.mvt`

Mapbox Vector Tiles, following the repository's existing PostGIS MVT pattern
(mirrors the suitability tile endpoint):

- tile envelope built in EPSG:3857 (`ST_TileEnvelope`), transformed to 4326 for the
  `geometry && <bounds>` predicate so it hits the existing 4326 GiST index
  (filter-before-transform);
- only matched geometries are transformed to 3857 for `ST_AsMVTGeom` (extent 4096,
  buffer 64);
- source-layer name `wetlands`;
- tile properties (light attribute set only): `id`, `wetland_code`,
  `wetland_name`, `wetland_type`, `reported_area_m2`, `designation_note`,
  `normalized_sido_code`, `normalized_sigungu_code`. Never `raw_attributes`, never
  full provenance;
- `z` validated to `[0, 22]`; `x`/`y` validated to `[0, 2^z-1]` (→ `422
  INVALID_TILE_COORDINATE`);
- a tile overlapping no feature is a valid **empty** tile (`200`, 0 bytes), never a
  5xx;
- no geometry is altered in storage — `ST_AsMVTGeom` clips/quantizes for transport
  only.

## 4. MVT / GeoJSON layer contract

- **Transport:** MVT vector tiles (the repository standard for map-scale layers;
  the suitability grid uses the same). No second map transport is introduced.
- **Feature detail** uses GeoJSON for a single feature only (bounded), consistent
  with the suitability candidate-detail endpoint.
- **Source layer:** `wetlands` (frontend const `WETLAND_TILE_SOURCE_LAYER`).
- **Simplification:** none beyond `ST_AsMVTGeom`'s clip/quantize — the suitability
  MVT pattern documents no separate simplification step, so none is added.

## 5. Backend schemas

`backend/src/waste_equity_backend/schemas/wetland.py`:
`WetlandInventoryLifecycle`, `WetlandInventoryIngestionInfo`,
`WetlandInventoryProvenance`, `WetlandInventoryMetadataResponse`,
`WetlandInventoryFeatureSummary`, `WetlandInventoryListResponse`,
`WetlandInventoryFeatureDetail`, `WetlandInventoryError`. Strict typing, explicit
optionals, ORM-safe (`from_attributes` on the summary), Korean strings preserved.
The three disclosures and the layer identity are module constants so the API and
frontend never drift.

## 6. Frontend layer behavior

`frontend/src/components/MapView.tsx` adds a `wetlands` **vector** source
(`maxzoom` 12, overzoomed above) and two layers — `wetlands-fill` (categorical by
type) and `wetlands-outline` — inserted **before** the candidate block so the layer
sits **below** the candidate/selection layers and **above** the OSM basemap,
**separate** from any UM901/protected layer.

- **Toggle:** `내륙습지 목록` — **off by default** (mirrors the `showFacilities`
  precedent; not URL-serialized, so existing shared links are unaffected).
- **Click:** opens a popup built from the light tile attributes (습지명, 습지 유형,
  면적, 원자료 지정 메모 when present, 제공기관, 기준일, and both disclaimers), then
  best-effort enriches it with the fetched detail's 출처 시도/시군구 and 주소. No
  score, exclusion, candidate, or legal determination is ever shown.

## 7. Filters

`frontend/src/components/WetlandLayerControl.tsx` (floating top-left card):

- layer on/off;
- per-type filter (하천습지 / 호수습지 / 산지습지 / 인공습지) — the legend rows double
  as the filter (applied as a MapLibre `["in", ["get","wetland_type"], …]` filter);
- 원자료 지정 메모가 있는 항목만 (adds `["has","designation_note"]`).

Filters synchronize with map rendering via `setFilter`/`setLayoutProperty`, reset
cleanly, preserve unrelated map state, and never touch candidate/score/region
state. No unbounded 2,704-name dropdown is added. The map does not serialize the
wetland toggle/filter into the URL (backward-compatible with existing links).

## 8. Legend and source disclosure

The type filter doubles as a categorical legend using a neutral water/nature
palette (blue / teal / green / muted purple) — **not** a red danger/exclusion
treatment. Source disclosure shown in the control:

- 국립생태원 · 내륙습지 공간데이터 및 속성정보 · 기준일 2022-07-20
- 원자료 좌표계 EPSG:5186 · API/지도 저장 EPSG:4326
- 법정 보호지역과 별도

## 9. Data-sources page

`frontend/src/lib/dataSources.ts` adds an `environmental` (`환경·생태`) source area
and a `nie_wetland_inventory` registry rendering (국립생태원 / 내륙습지 공간데이터 및
속성정보). `frontend/src/components/WetlandSourceNote.tsx` adds a live disclosure to
the 데이터·출처 view: provider, official dataset name, reference date, **served
count**, API/map exposure lifecycle, `점수 반영: 미반영`, the legal-status caveat
(법정 습지보호지역(UM901)과 별개), the source URL, and `로컬 DB 적재 검증 완료 · 운영
배포 미실행`. Local verification is never presented as production deployment.

## 10. Performance

- Tiles filter spatially (GiST) **before** `ST_AsMVTGeom`; tile generation happens
  in SQL (no 2,704 geometries loaded into Python).
- List selects only the summary columns; geometry and `raw_attributes` are
  deferred; `total` is an indexed count. Indexed filters where available
  (`normalized_sido_code`, `normalized_sigungu_code`, `source_sido_name`,
  `source_sigungu_name`, `wetland_code`).
- No new heavy frontend dependency; the map uses the existing MapLibre stack.

## 11. Cache and HTTP semantics

Tiles are pinned to an immutable dataset version and served with
`Cache-Control: public, max-age=31536000, immutable` and an ETag
`"wetland-{version_id}-{z}-{x}-{y}"`; a matching `If-None-Match` returns `304`
(mirrors the suitability tile endpoint). Metadata/list/detail use FastAPI's
default response semantics (no bespoke cache layer introduced).

## 12. Test results (local, 2026-07-24)

- **Backend unit** — `tests/test_wetland_metadata_unit.py`: 7 passed (disclosures,
  lifecycle, read-only route audit, tile-SQL/import separation).
- **Backend integration (PostGIS)** — `tests/test_wetland_routes_integration.py`:
  25 passed (metadata provider/reference/served/lifecycle/UM901, list
  pagination/limit/offset/type/designation/sido/source-name/q/bbox/sort/empty/
  no-raw-attributes, detail valid/404/provenance/disclaimer/designation/opt-in raw,
  tiles valid/empty/invalid-coord/304/layer-name/light-properties, no-mutation of
  UM901/candidate counts, no score/legal field). Total **32 passed**.
- **Frontend** — `WetlandLayerControl.test.tsx`, `WetlandSourceNote.test.tsx`,
  `MapView.test.tsx` (wetland source/order/visibility/filter/popup),
  `dataSources.test.ts` (environmental area). Full suite **737 passed**; lint,
  `tsc --noEmit`, and `next build` clean.
- **Backend lint/type** — `ruff check` + `ruff format --check` + `mypy` clean.
- Six pre-existing backend integration failures (`test_migration_head_is_0016`
  and data-dependent latest-run/year tests) are unrelated: those test files are
  byte-identical to `origin/main` and fail because Phase 1B-1's migration 0018
  (already on main) advanced the DB head past the `0016` they assert.

## 13. Local validation — baseline unchanged

| Table | Before | After |
| --- | --- | --- |
| `environmental_wetland_inventory_features` | 2704 | 2704 |
| `environmental_dataset_versions` | 1 | 1 |
| `structural_protected_features` (UM901) | 6 | 6 |
| `structural_protected_features` (total) | 20895 | 20895 |
| `suitability_candidates` | 95786 | 95786 |
| `suitability_analysis_runs` | 2 | 2 |

All endpoints verified against the real local load: metadata served count 2,704;
list total 2,704 with 하천습지 1,326 / 호수습지 635 / 산지습지 466 / 인공습지 277 and
35 designation-note features; detail geometry MultiPolygon with opt-in
`source_attributes`; tiles non-empty over Korea and empty over ocean.

## 14. Known limitations

- Normalized region codes exist only for capital-region features (224/225); the
  rest keep NULL codes with source names, so `sido_code`/`sigungu_code` filters
  cover the capital region while `source_sido_name` covers the nationwide set.
- The popup's 출처 시도/시군구 + 주소 arrive via a follow-up detail fetch (kept out of
  the light tile); if that fetch fails the tile-based popup stays as shown.
- Local only — no production run, no deployment.

## 15. Rollback

Frontend-and-API only; no migration was added. To remove: revert the merge commit
(or the feature commit). The underlying table and data (migration 0018) are
untouched, so no data rollback is involved and no score/rank/status can change.

## 16. Future scoring boundary

Any future use of this inventory in scoring, weighting, or exclusion requires a
**separate, explicit policy-version review** (contract §16). It is not authorized
by this API/map exposure. This phase adds **no** score, and `scoring_integration`
stays `NOT_IMPLEMENTED`.

## 17. Deployment status

**NOT ATTEMPTED.** Verified locally only; not deployed to OCI or AWS.
