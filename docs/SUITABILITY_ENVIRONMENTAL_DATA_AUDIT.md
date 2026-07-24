# Suitability Environmental Data Audit (Phase 1A)

Audit date: 2026-07-23.

Scope: a **planning-only** feasibility audit of the environmental and physical
datasets that a future suitability phase (Phase 1B) could add to the 후보지 분석
screening for Seoul, Incheon, and Gyeonggi-do. This document catalogues *future*
datasets; it does **not** ingest data, add scores, or change any suitability
result.

This is Phase 1A of the Suitability Analysis Roadmap. Phase 1A prepares the
foundation only — a verified dataset catalogue, an architecture, empty backend
scaffolding, and a metadata registry table. **No suitability score, ranking,
candidate status, weight profile, API contract, or production output changes in
Phase 1A.** The actual addition of any dataset below to the *scoring* is a future
Phase 1B change that carries its own `policy_version` / `derivation_version`
bump, a candidate rebuild, and its own review — see
[SUITABILITY_ENVIRONMENTAL_ROADMAP.md](SUITABILITY_ENVIRONMENTAL_ROADMAP.md).

The datasets audited here are exactly the physical/environmental conditions that
the Phase 0 transparency pass disclosed as **not yet evaluated**
(`경사·지질·지하수·토지피복·건축물·홍수·부지 규모·소유권·차량 진입·현장조사/EIA`;
see [SUITABILITY_PHASE_0_TRANSPARENCY.md](SUITABILITY_PHASE_0_TRANSPARENCY.md)).

## Method and evidentiary caution

- This audit is **documentation research only**. Unlike the Phase 2.5A VWorld
  audit ([VWORLD_STRUCTURAL_LAYER_AUDIT.md](VWORLD_STRUCTURAL_LAYER_AUDIT.md)),
  it performed **no** live contract probes, no downloads, and no ingestion. Any
  source, license, CRS, resolution, or file-size figure below that was not
  already live-verified by an earlier phase is marked **DOCUMENTED_NOT_TESTED**
  and must be re-validated with a small live/manual contract probe before Phase
  1B ingestion, exactly as Phase 2.5A did for the structural layers.
- Per `AGENTS.md`, every unverified assumption is labelled as such. File sizes
  are **order-of-magnitude estimates** for the three-province (수도권) extent, not
  measured values. Licenses that conflict across portals (VWorld 제19조 vs KOGL vs
  CC BY-NC-ND) are flagged, never silently resolved.
- "Technically available" ≠ "legally usable as an exclusion." This audit records
  what each dataset *is*; assigning it hard-exclusion / soft-penalty / display
  effect remains a human policy decision recorded in
  [SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md), never invented here.
- CRS caution (`AGENTS.md`): distance/area must never be computed in decimal
  degrees. The platform standard is geodesic measurement (`ST_DWithin` on
  `geography`) or a validated projected CRS (EPSG:5179/5186); every dataset below
  records both its source CRS and the EPSG:4326 storage CRS.

## Status legend

Two orthogonal axes are tracked for every dataset.

**Platform lifecycle** — where the dataset stands *in this codebase today*:

| Lifecycle | Meaning |
| --- | --- |
| `IMPLEMENTED` | Already production-ingested and available in the current schema. |
| `PLANNED` | Targeted for a specific future Phase 1B subphase; source is well-documented. |
| `FUTURE` | Desirable later; source exists but is lower priority or has open conditions. |
| `EXPERIMENTAL` | Source/legal/quality uncertainty makes analytical use unproven; research first. |

**Contract-verification status** (reused from the Phase 2.5A vocabulary):
`LIVE_VERIFIED`, `DOCUMENTED_NOT_TESTED`, `PROXY_ONLY`, `UNAVAILABLE`.

**Phase 1B readiness recommendation** — the go/no-go for *ingestion*:

| Recommendation | Meaning |
| --- | --- |
| `GO` | Official, analytically interpretable, license-clear, reproducible; ready to schedule for Phase 1B. |
| `CONDITIONAL GO` | Usable once one or more named conditions (license, CRS validation, coverage, geocoding) are resolved. |
| `NO GO` | Not analytically usable now — licence prohibition, WMS-only imagery, no official feature source, or statutory-only interpretation. |

A `GO` here authorizes *ingestion planning*, never scoring. Scoring adoption is
governed separately by the analytical-methods review workflow.

---

## Part A — Datasets already implemented (reuse, do not re-ingest)

Four of the fifteen audited datasets already exist in the platform. Phase 1B
**reuses** these through the existing schema rather than re-ingesting them; they
are catalogued here for completeness and to make the "what is new" boundary
explicit.

### A1. Administrative Boundary — `IMPLEMENTED`

| Field | Value |
| --- | --- |
| Official source | 통계청 SGIS 행정구역 경계 (Phase 2.1), reference year 2024 |
| License | KOGL / SGIS terms (already cleared for this project) |
| Update cycle | Periodic / versioned (annual boundary vintage) |
| Source CRS → storage CRS | EPSG:5179 → EPSG:4326 |
| Spatial resolution | Vector (sido/sigungu/adm-dong polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | n/a — already stored (`regions` table) |
| Preprocessing required | None (done); reproject, boundary-versioned |
| Suitability usage | Denominators, aggregation geography, per-region roll-ups, clipping mask |
| Implementation difficulty | Low (done) |
| Verification | `LIVE_VERIFIED` (Phase 2.1) |
| **Phase 1B recommendation** | **GO (reuse)** — no action; boundary vintage already travels with each run (`boundary_vintage`). |

### A2. Detailed Zoning (용도지역) — `IMPLEMENTED` (broad) / `PLANNED` (subclass)

| Field | Value |
| --- | --- |
| Official source | 국토교통부 용도지역도 `LT_C_UQ111`–`UQ114` + NA_24 bulk (Phase 2.5B) |
| License | Prior government-project authorization confirmed for this project (resolves VWorld 제19조 / CC BY-NC-ND) |
| Update cycle | 전체분 매월 / 변동분 매일 (bulk); 변경발생시 (LSMD) |
| Source CRS → storage CRS | EPSG:5186/2097 (bulk) or 4326 (API) → EPSG:4326 |
| Spatial resolution | Vector (parcel-precision zone polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | ~88,252 rows already ingested (`structural_features`) |
| Preprocessing required | Reproject, normalize `uname`/`ucode`, category mapping (done for 대분류) |
| Suitability usage | `용도지역 호환성` (Z component) — already scored today |
| Implementation difficulty | Low for 대분류 (done); Medium to add 제2종일반주거지역-level subclass detail |
| Verification | `LIVE_VERIFIED` (Phase 2.5B) |
| **Phase 1B recommendation** | **GO (reuse)**; subclass re-ingestion is a documented follow-on (`PLANNED`) that would bump `policy_version`. |

### A3. Road Centerlines — `IMPLEMENTED`

| Field | Value |
| --- | --- |
| Official source | 국토지리정보원 연속수치지형도 도로중심선 `LT_L_N3A0020000` + ITS 표준노드링크 (Phase 2.5B) |
| License | NGII bulk CC BY; 표준노드링크 제한 없음; project authorization confirmed |
| Update cycle | 연간 (NGII); 수시/자동 (표준노드링크) |
| Source CRS → storage CRS | EPSG:5179 (bulk) / 4326 (API) → EPSG:4326 |
| Spatial resolution | Vector (road centreline lines; width/lane/class attributes) |
| Geometry type | MultiLineString |
| Expected file size (수도권) | ~2,971,494 line rows already ingested (`structural_line_features`) |
| Preprocessing required | Reproject, normalize, clip nationwide→시도 (done) |
| Suitability usage | `도로 근접성 대리지표` (R component) — already scored today. **Truck access is never claimed from geometry.** |
| Implementation difficulty | Low (done) |
| Verification | `LIVE_VERIFIED` (Phase 2.5B) |
| **Phase 1B recommendation** | **GO (reuse)** — distance-to-road already available; restriction-field (`REST_VEH/W/H`) truck-access modelling remains explicitly out of scope. |

### A4. Protected Areas — `IMPLEMENTED`

| Field | Value |
| --- | --- |
| Official source | VWorld 용도구역/보호구역 계열 — 개발제한구역 `UD801`, 상수원보호구역 `UM710`, 습지보호지역 `UM901`, 산림보호구역 `UF151`, 국립자연공원 `WGISNPGUG`, 교육환경보호구역 `UO101`, 국가유산 `UO301` (Phase 2.5B) |
| License | Project authorization confirmed for this project |
| Update cycle | 변경발생시 (bulk) / 매일-매월 (API) |
| Source CRS → storage CRS | EPSG:5186/2097 or 4326 → EPSG:4326 |
| Spatial resolution | Vector (statutory-zone polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | ~20,892 rows already ingested (`structural_protected_features`) |
| Preprocessing required | Reproject, normalize `layer_category`, clip nationwide→시도 (done) |
| Suitability usage | Hard-exclusion / review screening (existing policy v1/v2) |
| Implementation difficulty | Low (done) |
| Verification | `LIVE_VERIFIED` (Phase 2.5B) |
| **Phase 1B recommendation** | **GO (reuse)** — already the backbone of the exclusion/review screen. |

---

## Part B — New datasets planned for Phase 1B ingestion

These datasets are **not** in the platform. Each entry is a planning record; none
is verified beyond documentation in Phase 1A.

### B1. DEM (Digital Elevation Model → slope 경사)

| Field | Value |
| --- | --- |
| Official source | 국토지리정보원(NGII) 수치표고모델(DEM) via 국토정보플랫폼 (map.ngii.go.kr); 5 m / 30 m grid DEM |
| License | KOGL / NGII 성과 활용 신청 (approval-mediated download) — **verify per grid**; DOCUMENTED_NOT_TESTED |
| Update cycle | 부정기 (periodic re-survey; national DEM refresh cycle multi-year) |
| Source CRS → storage CRS | EPSG:5186 (UTM-K) typical → analysis in EPSG:5179/5186; derived slope stored/served EPSG:4326 |
| Spatial resolution | Raster; 5 m (preferred) or 30 m grid cell |
| Geometry type | Raster (GeoTIFF); slope/aspect derived as raster, sampled to the 500 m grid |
| Expected file size (수도권) | ~2–10 GB at 5 m (estimate); ~100–300 MB at 30 m (estimate) |
| Preprocessing required | Mosaic tiles, reproject, compute slope (`gdaldem slope` or PostGIS raster), aggregate slope statistic (mean/max/%>threshold) per 500 m cell |
| Suitability usage | **Slope (경사)** — the top unmodelled factor; steep-slope soft-penalty or review flag per candidate cell |
| Implementation difficulty | High (raster pipeline is new to the platform; no raster tooling exists yet) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO** — resolve NGII download/approval workflow, confirm grid resolution/license, and stand up a raster→cell-statistic pipeline first. Highest analytical value of the new set. |

### B2. Land Cover (토지피복)

| Field | Value |
| --- | --- |
| Official source | 환경부(기후에너지환경부) 환경공간정보서비스 EGIS 토지피복지도 (대/중/세분류); egis.me.go.kr download + WMS |
| License | KOGL (SHP download) vs WMS-only for some layers — **verify vector availability**; DOCUMENTED_NOT_TESTED |
| Update cycle | 부정기 (periodic national land-cover updates by 권역) |
| Source CRS → storage CRS | EPSG:5186 (UTM-K) typical → EPSG:4326 |
| Spatial resolution | Vector polygons (세분류 down to ~1:5,000); raster variant also exists |
| Geometry type | MultiPolygon (vector 세분류) |
| Expected file size (수도권) | ~0.5–3 GB for 세분류 vector (estimate) |
| Preprocessing required | Reproject, normalize land-cover class codes, dominant-class or area-share per 500 m cell |
| Suitability usage | **토지피복 / 실제 토지 이용 상태** — actual-use context (built-up vs forest vs water vs cropland) beyond administrative zoning |
| Implementation difficulty | Medium (vector, but large; class-code normalization required) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO** — confirm the vector (not WMS-only) download and KOGL terms; the WMS product is display-only and NO GO for analysis. |

### B3. River Network (하천망)

| Field | Value |
| --- | --- |
| Official source | 국토지리정보원 연속수치지형도 하천 계열 (VWorld `LT_L`/`LT_C` hydrography); 환경부 하천망분석도(RIMGIS)/WAMIS as alternates |
| License | NGII CC BY / KOGL (per product) — DOCUMENTED_NOT_TESTED |
| Update cycle | 연간 (NGII 연속수치지형도) |
| Source CRS → storage CRS | EPSG:5179 → EPSG:4326 |
| Spatial resolution | Vector (river centrelines + water-body polygons) |
| Geometry type | MultiLineString (centrelines) and/or MultiPolygon (water bodies) |
| Expected file size (수도권) | ~100–500 MB (estimate) |
| Preprocessing required | Reproject, classify 국가하천/지방하천/소하천, distance-to-water computed geodesically |
| Suitability usage | Distance-to-water context; **input to any future setback** — but no statutory buffer may be invented (policy decision) |
| Implementation difficulty | Medium |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO** — usable as distance context once CRS/coverage validated; any setback distance requires a cited legal basis, never an invented buffer. |

### B4. Geology (지질)

| Field | Value |
| --- | --- |
| Official source | 한국지질자원연구원(KIGAM) 1:50,000 수치지질도 via 지질정보시스템 (mgeo.kigam.re.kr) |
| License | KOGL / KIGAM 이용 신청 — **verify derivative-use terms**; DOCUMENTED_NOT_TESTED |
| Update cycle | 부정기 (map-sheet revisions) |
| Source CRS → storage CRS | EPSG:5186 typical → EPSG:4326 |
| Spatial resolution | Vector (1:50,000 geological-unit polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | ~50–300 MB (estimate) |
| Preprocessing required | Reproject, normalize lithology/formation codes, cell-dominant unit |
| Suitability usage | **상세 지질** — bedrock/lithology context; ground-condition screening (advisory only) |
| Implementation difficulty | Medium (domain code normalization) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO** — confirm KIGAM licence for derived analysis; geology is a screening context, never a geotechnical/site-survey substitute. |

### B5. Wetlands (내륙습지 — beyond the existing 습지보호지역)

| Field | Value |
| --- | --- |
| Official source | **국립생태원_내륙습지 공간데이터 및 속성정보_20220720** (공공데이터포털 파일데이터 `15086410`), from the 「습지보전법」 전국내륙습지 기초조사 2000–2021; separate from 습지보호지역 (existing `UM901`). 생태자연도 is a **different** dataset, not part of this source. |
| License | **이용허락범위 제한 없음** (portal-stated, verified 2026-07-23). The KOGL Type 3 (변경금지) concern applies to 생태자연도 only, which this source does not include. |
| Update cycle | 수시 (1회성 데이터) — one-off publication per 조사 round |
| Source CRS → storage CRS | **EPSG:5186 (verified from the `.prj`)** → EPSG:4326 |
| Spatial resolution | Vector (wetland-inventory polygons) |
| Geometry type | Polygon 2,696 / MultiPolygon 8 (normalize to MultiPolygon) |
| Actual file size | 5.7 MB ZIP / 12.9 MB extracted, **nationwide** (well under the earlier estimate) |
| Preprocessing required | Reproject (`always_xy=True`), force **UTF-8** DBF decode (**not** the `cp949` structural default), normalize categories, geometric region assignment; keep separate from `UM901` |
| Suitability usage | Environmental sensitivity screening (extends context to surveyed, non-designated wetlands) — **not implemented, and no scoring role is granted by verification** |
| Implementation difficulty | Medium |
| Verification | **`LIVE_VERIFIED`** (local contract verification, Phase 1B-0, 2026-07-23) — 2,704 features, 0 invalid/null/empty geometry, unique `CODE`, Korean text intact. The designated `UM901` subset is separately `IMPLEMENTED`. |
| Ingestion | **`IMPLEMENTED_AND_LOCALLY_VERIFIED`** (Phase 1B-1, 2026-07-24) — all 2,704 features loaded idempotently into a dedicated `environmental_wetland_inventory_features` table (migration 0018), local PostGIS only, **not run in production**, kept separate from `UM901`, no scoring role. See [WETLAND_INVENTORY_INGESTION.md](WETLAND_INVENTORY_INGESTION.md). |
| **Phase 1B recommendation** | **GO FOR PHASE 1B INGESTION** — **done for the inventory (1B-0 verify → 1B-1 local ingest).** Both original conditions were resolved: 생태자연도 is a different dataset, and the `UM901` overlap is quantified (4 of 232 capital-region features overlap; 1 is geometrically identical to the 김포 `UM901` polygon) with `CODE`-keyed dedup rules. Carried conditions were met at ingest: PostGIS-based region assignment, forced UTF-8, raw storage of source anomalies. See [WETLAND_INVENTORY_DATA_CONTRACT.md](WETLAND_INVENTORY_DATA_CONTRACT.md) and [WETLAND_INVENTORY_VALIDATION_REPORT.md](WETLAND_INVENTORY_VALIDATION_REPORT.md). |

---

## Part C — New datasets: future / lower priority

### C1. Building Footprints (건축물)

| Field | Value |
| --- | --- |
| Official source | 국토교통부 GIS건물통합정보 / 도로명주소 건물 전자지도 (juso.go.kr); VWorld 건물 layer |
| License | KOGL Type 1 (도로명주소) — approval-mediated download; DOCUMENTED_NOT_TESTED |
| Update cycle | 월전체/월변동 (도로명주소 건물) |
| Source CRS → storage CRS | ITRF2000/GRS80/UTM or EPSG:5186 → EPSG:4326 |
| Spatial resolution | Vector (building outline polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | ~2–8 GB (millions of buildings; estimate) |
| Preprocessing required | Reproject, building-count/coverage-ratio per 500 m cell, optional height/use join to 건축물대장 |
| Suitability usage | **건축물 점유와 철거 필요성** — occupancy/density context (a densely built cell is less usable) |
| Implementation difficulty | High (very large; approval download; join to 대장 non-trivial) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO** — high volume and an approval workflow; density-aggregate use is feasible, per-building demolition claims are not. |

### C2. Parcel (연속지적도)

| Field | Value |
| --- | --- |
| Official source | 국토교통부 연속지적도 `LSMD_CONT_LDREG`; per-parcel land-use via NED `dt_d154` (audited Phase 2.5A) |
| License | Project authorization confirmed; bulk browser/솔루션-mediated |
| Update cycle | 수시 / 월 |
| Source CRS → storage CRS | EPSG:5186 → EPSG:4326 |
| Spatial resolution | Vector (cadastral parcel polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | **Very large** — the national ownership/parcel corpus is documented at 68.5M records / 10.7 GB; 수도권 parcels number in the millions (estimate multi-GB) |
| Preprocessing required | Reproject; **not** a full-region sweep — candidate-parcel refinement by PNU/bbox only |
| Suitability usage | **연속 사용 가능 부지 규모** refinement of a selected candidate; never a region-wide grid replacement in v1 |
| Implementation difficulty | Very High (volume; the 500 m grid deliberately avoids parcel-based candidates) |
| Verification | `dt_d154` `LIVE_VERIFIED` (Phase 2.5A) for per-parcel API; bulk `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO (candidate refinement only)** — API-side per-candidate lookups are viable; region-wide parcel ingestion is out of scope (grid is the candidate geometry). |

### C3. Ownership (토지소유정보)

| Field | Value |
| --- | --- |
| Official source | 국토교통부 국가공간정보센터 토지소유공간정보 `dt_d160` (NED); bulk NA_12/NA_30 (audited Phase 2.5A) |
| License | data.go.kr 제한 없음 (NED listing); project authorization confirmed |
| Update cycle | 실시간 (API) / 매년(전체)·매월(월변동) (bulk) |
| Source CRS → storage CRS | EPSG:4326 (served) → EPSG:4326 |
| Spatial resolution | Vector (parcel-level ownership polygons) |
| Geometry type | MultiPolygon |
| Expected file size (수도권) | Multi-GB bulk (national CSV 10.7 GB / 68.5M rows) |
| Preprocessing required | Field-completeness validation of `posesn_se_code`/`nation_instt_se_code` before any public-land claim |
| Suitability usage | **필지 소유권과 취득 가능성** — public-land identification; **ownership must never be inferred from zoning/PNU/address** |
| Implementation difficulty | Very High (volume + field-completeness caveat) |
| Verification | `LIVE_VERIFIED` with caveat (classification fields null in 2 of 3 probed parcels, Phase 2.5A) |
| **Phase 1B recommendation** | **CONDITIONAL GO (optional)** — promote beyond experimental only after `posesn_se_code` completeness is validated on a large sample. |

### C4. Groundwater (지하수위 · 수문지질)

| Field | Value |
| --- | --- |
| Official source | 국가지하수정보센터 GIMS (gims.go.kr) 국가지하수관측망 수위/수질; 수문지질도 |
| License | KOGL / GIMS 이용 신청 — DOCUMENTED_NOT_TESTED |
| Update cycle | 관측: 시간/일 단위; 수문지질도: 부정기 |
| Source CRS → storage CRS | EPSG:5186 / decimal-degree points (EPSG undeclared → validate) → EPSG:4326 |
| Spatial resolution | Point observation network (sparse) + coarse 수문지질 polygons |
| Geometry type | Point (wells) + MultiPolygon (hydrogeology units) |
| Expected file size (수도권) | Small (< 50 MB; sparse network) |
| Preprocessing required | CRS validation of point coordinates; **interpolation is a modelling assumption, not measured groundwater level** — must be labelled |
| Suitability usage | **지하수위 및 수문지질** — sensitivity screening; real-time levels must not become permanent siting evidence (`AGENTS.md`) |
| Implementation difficulty | High (sparse network → any surface is modelled/uncertain) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **CONDITIONAL GO (advisory only)** — the observation network is too sparse for a defensible per-cell water table; usable as coarse hydrogeological context with an explicit uncertainty label. |

---

## Part D — New datasets: experimental / not usable now

### D1. Flood Hazard (홍수·침수 위험)

| Field | Value |
| --- | --- |
| Official source | 행정안전부 홍수위험지도정보시스템 (floodmap.go.kr) 홍수위험지도/침수예상도; 환경부 홍수위험지도 |
| License | **Access-restricted** — much of the flood-hazard product requires application/approval and is not openly licensed for redistribution/derived analysis; DOCUMENTED_NOT_TESTED |
| Update cycle | 부정기 (재해지도 갱신) |
| Source CRS → storage CRS | EPSG:5186 → EPSG:4326 |
| Spatial resolution | Raster depth grids and/or MultiPolygon inundation extents |
| Geometry type | Raster and/or MultiPolygon |
| Expected file size (수도권) | ~0.5–2 GB (estimate) |
| Preprocessing required | Reproject; class/return-period normalization; cell overlap flag |
| Suitability usage | **홍수·침수 위험** — flood-exposure screening (high analytical value if obtainable) |
| Implementation difficulty | High (raster + restricted access) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **NO GO until licence resolved** — do not ingest until redistribution/derived-use terms are confirmed in writing; treat as `EXPERIMENTAL` and pursue the licence question first. |

### D2. Faults (단층)

| Field | Value |
| --- | --- |
| Official source | 한국지질자원연구원(KIGAM) / 행정안전부 활성단층 정보 (2017–2022 활성단층 조사); 수치지질도 단층선 |
| License | Restricted — active-fault data is partially non-public for disaster-management reasons; DOCUMENTED_NOT_TESTED |
| Update cycle | 부정기 (조사 단계별 공개) |
| Source CRS → storage CRS | EPSG:5186 → EPSG:4326 |
| Spatial resolution | Vector (fault-trace lines) |
| Geometry type | MultiLineString |
| Expected file size (수도권) | Small (< 50 MB) |
| Preprocessing required | Reproject; distance-to-fault; **any setback is a policy/legal decision, not invented** |
| Suitability usage | **단층** — seismic-sensitivity screening context (advisory) |
| Implementation difficulty | Medium (small data) but High (availability/licence) |
| Verification | `DOCUMENTED_NOT_TESTED` |
| **Phase 1B recommendation** | **NO GO / EXPERIMENTAL** — confirm public availability and licence; fault proximity is advisory context, never a geotechnical determination. |

---

## Summary matrix

| # | Dataset | Lifecycle | Geometry / raster | Storage CRS | Verification | Difficulty | Phase 1B recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Administrative Boundary | IMPLEMENTED | Vector polygon | 4326 | LIVE_VERIFIED | Low | GO (reuse) |
| 2 | Detailed Zoning | IMPLEMENTED / PLANNED | Vector polygon | 4326 | LIVE_VERIFIED | Low–Med | GO (reuse) |
| 3 | Road Centerlines | IMPLEMENTED | Vector line | 4326 | LIVE_VERIFIED | Low | GO (reuse) |
| 4 | Protected Areas | IMPLEMENTED | Vector polygon | 4326 | LIVE_VERIFIED | Low | GO (reuse) |
| 5 | DEM (slope) | PLANNED | Raster | 4326 (derived) | DOCUMENTED_NOT_TESTED | High | CONDITIONAL GO |
| 6 | Land Cover | PLANNED | Vector polygon | 4326 | DOCUMENTED_NOT_TESTED | Medium | CONDITIONAL GO |
| 7 | River Network | PLANNED | Vector line/polygon | 4326 | DOCUMENTED_NOT_TESTED | Medium | CONDITIONAL GO |
| 8 | Geology | PLANNED | Vector polygon | 4326 | DOCUMENTED_NOT_TESTED | Medium | CONDITIONAL GO |
| 9 | Wetlands (inventory) | IMPLEMENTED (local ingest; **not in production, not scored**) | Vector polygon | 4326 | **LIVE_VERIFIED** | Medium | **GO (ingested locally, Phase 1B-1)** |
| 10 | Building Footprints | FUTURE | Vector polygon | 4326 | DOCUMENTED_NOT_TESTED | High | CONDITIONAL GO |
| 11 | Parcel | FUTURE | Vector polygon | 4326 | LIVE_VERIFIED (API) | Very High | CONDITIONAL GO (refine) |
| 12 | Ownership | FUTURE | Vector polygon | 4326 | LIVE_VERIFIED (caveat) | Very High | CONDITIONAL GO (optional) |
| 13 | Groundwater | FUTURE | Point + polygon | 4326 | DOCUMENTED_NOT_TESTED | High | CONDITIONAL GO (advisory) |
| 14 | Flood Hazard | EXPERIMENTAL | Raster / polygon | 4326 | DOCUMENTED_NOT_TESTED | High | NO GO (licence) |
| 15 | Faults | EXPERIMENTAL | Vector line | 4326 | DOCUMENTED_NOT_TESTED | Medium | NO GO / EXPERIMENTAL |

## Cross-cutting conditions before any Phase 1B ingestion

1. **Live contract probes.** Every `DOCUMENTED_NOT_TESTED` source must pass a
   small live/manual probe (source, CRS from `.prj`/metadata, license, one
   sample feature) — the same gate Phase 2.5A applied — before ingestion.
   *Wetlands (#9) has now cleared this gate* (Phase 1B-0, 2026-07-23): its
   contract is `LIVE_VERIFIED` against the real local file. Clearing the gate
   authorizes **ingestion planning only** — it is not ingestion, and it grants
   the layer no scoring role.
2. **Raster capability is new.** DEM, Land Cover (raster variant), and Flood
   Hazard require a raster pipeline the platform does not have. This is the
   single largest engineering prerequisite and is scoped in
   [SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md](SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md).
3. **Licence resolution per dataset.** Flood hazard, active faults, 생태자연도
   (Type 3), and any WMS-only land-cover layer are blocked until redistribution/
   derived-use terms are confirmed. Conflicting portal licences are never
   silently resolved.
4. **No invented buffers.** River, fault, and groundwater setbacks require a
   cited statutory basis or an explicitly labelled policy assumption — never a
   fabricated distance (`SUITABILITY_DATA_REQUIREMENTS.md`).
5. **Missing ≠ safe.** Consistent with the Phase 0 disclosure, a cell with no
   value for a future factor is never scored 0 or "safe"; it is `REVIEW_REQUIRED`
   or excluded from that component until real data exists.

## What this audit does not do

- It does not authorize scoring, ingestion, downloads, or any score/rank/status
  change. Those are Phase 1B and later.
- It does not assign legal exclusion effect to any layer.
- It does not treat any real-time reading (weather, air quality, groundwater
  level) as permanent siting evidence.
- It does not present any planned dataset as if it were implemented; the
  lifecycle column is authoritative.
