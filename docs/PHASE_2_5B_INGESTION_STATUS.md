# Phase 2.5B Structural Ingestion — Status and Manual-Download Checklist

Generated during the Phase 2 recovery/verification run on 2026-07-12. This
report records **actual** results only. Nothing here is marked complete unless
it was live-verified against PostgreSQL/PostGIS.

## Infrastructure and data recovery

- Repository root: `/Users/byeongilmin/dev/waste-equity-platform` (branch
  `phase-2.5b-1-zoning-ingestion`).
- Two other local repository copies exist (`~/Desktop/Project/...`,
  `~/Projects/...`); neither holds any files in `data/raw|interim|processed`,
  so there is **no overlooked official source data**. They were not modified.
- Docker Desktop was started (the earlier daemon-socket error was Docker being
  off, not data loss). Context `desktop-linux`.
- The PostgreSQL volume `waste-equity-platform_pgdata` (created 2026-07-08,
  PG_VERSION 16, `base`/`global`/`pg_wal` present) was found intact. **No
  database data was lost.** No volume was removed or recreated.
- Migrations applied to head **0009** (0006 versioned structural schema; 0007
  line-feature table; 0008 widen `coverage_status`; 0009
  `structural_protected_features` table). The 0006/0007 schema migrations were
  round-trip (upgrade→downgrade→upgrade) verified on a disposable scratch
  database; 0009 ships a symmetric downgrade and is applied forward (the live
  DB `alembic_version` is at 0009).

## Existing Phase 2 data (recovered, verified idempotent)

Re-running each ingestion job produced zero new normalized rows (idempotent):

| Dataset | Rows | Idempotent re-run |
| --- | --- | --- |
| Regions (3 SIDO + 79 SIGUNGU) | 82 | inserted 0 |
| Regional population (2024) | 82 | inserted 0 |
| Regional waste statistics (2024) | 234 | inserted 0 / updated 0 |
| Waste-treatment facilities (2024) | 651 | inserted 0 |
| — geocoded (POINT) | 547 | 0 API calls |
| — failed geocode (review queue) | 104 | unchanged |

Freshness: `sgis`, `waste_statistics`, `vworld` all `2024 / FRESH`.
Facilities by 시도: 서울 38 / 인천 164 / 경기 449. RCIS coverage: Seoul 25/25,
Incheon 10/10, Gyeonggi 24/44 exact (20 large-city districts documented as
`REQUIRES_AGGREGATION`, not loaded).

## Structural layer completeness (2026-07-12: zoning + protected + roads live)

Zoning, protected/restricted areas, and road/road-network lines are all now
production-ingested for the capital region. Each **provider dataset release** is
its own `structural_dataset_versions` row (own official reference date + CRS);
protected polygons live in `structural_protected_features`, road lines in
`structural_line_features`, zoning polygons in the untouched `structural_features`.

### Zoning (`structural_features`)

9 official VWorld LSMD ZIPs (release `202606`, reference date `2026-06-01`, source
EPSG:5186 → EPSG:4326). `structural_features` = **88,252** (received 88,790; 538
invalid polygons rejected). Seoul UQ112–UQ114 `OFFICIAL_SOURCE_UNAVAILABLE`;
coverage `COMPLETE_FOR_AVAILABLE_SOURCES`. Unchanged by this subphase.

### Protected/restricted (`structural_protected_features`) — **20,892 features**

Two dataset versions: LSMD 용도구역·보호구역 (국토교통부, release 202606, ref
`2026-06-01`, EPSG:5186) + 국립공원 공원경계 (국립공원공단, ref `2023-12-31`,
EPSG:5179). Received 20,960; accepted 20,892; **47 invalid polygons rejected**
(reported per file, never repaired). Coverage `COMPLETE_FOR_AVAILABLE_SOURCES`.

| Layer | Seoul | Incheon | Gyeonggi |
| --- | --- | --- | --- |
| UD801 개발제한구역 | 43 | 26 | 261 |
| UM710 상수원보호구역 | 3 | 2 | 18 |
| UM901 습지보호지역 | **OFFICIAL_SOURCE_UNAVAILABLE** | 3 | **OFFICIAL_SOURCE_UNAVAILABLE** |
| UF151 산림보호구역 | **OFFICIAL_SOURCE_UNAVAILABLE** | 1 | 1,584 |
| UO101 교육환경보호구역 | 3,760 | 2,016 | 9,568 |
| UO301 국가유산 지정/보호구역 | 1,297 | 426 | 1,882 |
| WGISNPGUG 국립자연공원 (nationwide, clipped) | 1 | 0 | 1 |

WGISNPGUG is the KNPS `BSI_NPK_BBNDR` national-park boundary (23 parks
nationwide), transformed EPSG:5179 → 4326 and clipped to each SIDO: 북한산국립공원
crosses the Seoul/Gyeonggi boundary and becomes one clipped feature per 시도
(Seoul 1 + Gyeonggi 1); 22 parks outside the capital region were skipped. Seoul
UM901/UF151 and Gyeonggi UM901 are `OFFICIAL_SOURCE_UNAVAILABLE` (the official
LSMD download publishes no shapefile for those cells — see the Git-ignored
`data/raw/vworld/protected/source_manifest.json`), **not** `SOURCE_MISSING` and
**not** a verified zero-occurrence.

### Roads (`structural_line_features`) — **2,971,494 features**

Two dataset versions: 연속수치지형도 도로중심선 N3A0020000 (국토지리정보원, ref
`2024-04-18`, EPSG:5179, regional) + 표준노드링크 STDLINK (ITS 국가교통정보센터,
ref `2026-07-01`, EPSG:5186, nationwide LINK shapefile `MOCT_LINK`). Received
4,147,995; **982 records rejected** — all Gyeonggi 도로중심선 (N3A0020000), each
a **cp949-undecodable source-DBF attribute** (the geometry was readable, but the
attribute bytes were not valid cp949; rejected and reported per record, never
repaired or mojibake-substituted); coverage `COMPLETE`.
The 표준노드링크 `MOCT_NODE` point file, `MULTILINK`/`TURNINFO` tables, and the
`내역서.csv` changelog were excluded (by alias + geometry-family guard). STDLINK
was clipped to the capital region: 1,555,158 nationwide links → 379,168 accepted
(1,176,579 outside the capital region skipped; 1,766 clipped at SIDO boundaries).

| Layer | Seoul | Incheon | Gyeonggi |
| --- | --- | --- | --- |
| N3A0020000 도로중심선 (regional) | 414,791 | 192,981 | 1,984,554 |
| STDLINK 표준노드링크 (nationwide, clipped) | 64,021 | 40,772 | 274,375 |

### Family-level status

| Family | Layers evaluated | Coverage |
| --- | --- | --- |
| zoning | UQ111–UQ114 (Seoul UQ112–114 OFFICIAL_SOURCE_UNAVAILABLE) | COMPLETE_FOR_AVAILABLE_SOURCES |
| protected | UD801/UM710/UM901/UF151/UO101/UO301 + WGISNPGUG; Seoul UM901/UF151, Gyeonggi UM901 OFFICIAL_SOURCE_UNAVAILABLE | COMPLETE_FOR_AVAILABLE_SOURCES |
| roads | N3A0020000 (all 3 regions) + STDLINK nationwide (evaluated for all 3) | COMPLETE |

Optional layers (UM221, UQ162, MOCTLINK) are not blockers and were not ingested.

### Verification (2026-07-12, re-verified live against PostGIS)

**Counts** (all live-queried):

- Roads `structural_line_features` = **2,971,494** across **2** dataset versions.
  Each version's recorded `accepted_feature_count` equals its actual stored
  feature count — v77 N3A0020000 도로중심선 = **2,592,326**, v100 STDLINK
  표준노드링크 = **379,168** (sum 2,971,494). No orphan features, neither version
  empty, exactly two coherent road versions.
- Zoning `structural_features` = **88,252** across **1** dataset version (id 18);
  protected `structural_protected_features` = **20,892** across **2** versions.
  Both were untouched by the road ingestion (verified before and after).

**Road geometry** (all 2,971,494): SRID **4326** (1 distinct value), geometry
type **MULTILINESTRING** (1 distinct value), **0** null, **0** empty, **0**
invalid (`ST_IsValid`), **0** duplicate `feature_fingerprint` (both within a
dataset version and globally).

**STDLINK capital-region containment:** **0** STDLINK features lie outside
Seoul/Incheon/Gyeonggi. Every clipped STDLINK feature is on or within the SIDO
boundary — the maximum distance from any STDLINK feature to the capital-region
boundary is **0.000000 m**. (A strict `ST_CoveredBy` against `ST_Union` of the
three latest SIDO boundaries flags 384 features as not-covered, but each lies at
distance 0 on the clip edge — a GEOS floating-point edge-representation artifact,
not an out-of-region feature; all 384 are within 1e-7° ≈ 0.01 mm of the region.)
The check uses the same `regions` SIDO boundaries and clip-to-boundary semantics
as the live ingestion (`structural_clipping.py`).

**Second-write idempotency** (this run, 2026-07-12): an identical
`vworld-roads-ingest --write` re-run exited 0 in **17.66 s** wall-clock
(**≈12.3 s** CPU), status `SUCCEEDED`, **0** features inserted, **2,971,494**
skipped-existing, **0** new dataset versions (both v77 and v100 reported
`created: false`), message *"all 2 dataset version(s) already present
(idempotent)."* Road totals stayed **2,971,494 / 2 versions**. (Protected
idempotency was verified in an earlier run; per the run plan, protected
ingestion was not re-run.)

Freshness `vworld_structural` = `2026-07-01 / FRESH` (newest reference date
across families; monotonic — never regressed).

## Manual-download checklist (required before structural ingestion)

Official sources are documented in `docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`; no
new research was performed. Bulk downloads require an interactive session at the
official portals (login/approval) that cannot be completed from the CLI. Do not
use unofficial mirrors.

For each mandatory layer, download the official per-시도 bulk shapefile
(서울/인천/경기) and place the ZIP archive or extracted `.shp/.shx/.dbf/.prj`
set in the destination directory. Filenames must contain the layer code so the
loader can route them.

### Zoning (용도지역) — `data/raw/vworld/zoning/{seoul,incheon,gyeonggi}/`

| Layer | Name | Official source |
| --- | --- | --- |
| UQ111 | 도시지역 | VWorld 데이터 카탈로그 (dtmk) LSMD 용도지역 / NA_24 용도지역지구 bulk |
| UQ112 | 관리지역 | same (NA_24 용도지역지구) |
| UQ113 | 농림지역 | same |
| UQ114 | 자연환경보전지역 | same |

Source page: `https://www.vworld.kr/dtmk/dtmk_ntads_s001.do` (LSMD/NA_24).

### Protected/restricted — `data/raw/vworld/protected/{seoul,incheon,gyeonggi}/`

| Layer | Name | Official source (dtmk dsId / portal) |
| --- | --- | --- |
| UD801 | 개발제한구역 | VWorld dtmk 30261 |
| UM710 | 상수원보호구역 | VWorld dtmk 30372 |
| UM901 | 습지보호지역 | VWorld dtmk 30380 |
| UF151 | 산림보호구역 | VWorld dtmk 30355 |
| WGISNPGUG | 국립자연공원 | VWorld 용도구역/보호구역 bulk (국립공원공단 boundary as cross-check, data.go.kr 15017313) |
| UO101 | 교육환경보호구역 | VWorld dtmk 30442 |
| UO301 | 국가유산 지정/보호구역 | 시도별 ZI002 세트 / 국가유산청 GIS |
| UM221 (optional) | 야생생물보호구역 | NA_24 / 환경 기타용도지역지구 |
| UQ162 (optional) | 도시자연공원·녹지 | NA_24 |

### Roads — `data/raw/vworld/roads/{seoul,incheon,gyeonggi}/`

| Layer | Name | Official source |
| --- | --- | --- |
| STDLINK | 표준노드링크 | ITS 국가교통정보센터 `https://www.its.go.kr/nodelink` (data.go.kr 15025526); nationwide SHP, filter to capital region |
| N3A0020000 | 도로중심선 (도로폭/차로수) | NGII/VWorld dtmk 30182 (per-시도, EPSG:5179) |
| MOCTLINK | 국가교통정보 교통링크 | VWorld API cross-check only (no bulk download) |

### After placing files, run

```bash
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  vworld-zoning-ingest    --source-path data/raw/vworld/zoning    --reference-date <YYYY-MM-DD> --scope capital-region --write
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  vworld-protected-ingest --source-path data/raw/vworld/protected --reference-date <YYYY-MM-DD> --scope capital-region --write
PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli \
  vworld-roads-ingest     --source-path data/raw/vworld/roads     --reference-date <YYYY-MM-DD> --scope capital-region --write
```

Run each with `--dry-run` first, then `--write`, then an identical second
`--write` to confirm zero duplicate versions/features. `vworld-protected-ingest`
and `vworld-roads-ingest` no longer take `--reference-date` (per-dataset dates
come from the Git-ignored `source_manifest.json`).

## AirKorea / KMA

`AIRKOREA_SERVICE_KEY` and `KMA_SERVICE_KEY` are MISSING and only probe code
exists; these are real-time sources and are **not** blockers for Phase 5.4
structural suitability. Left as remaining Phase 2 work; no data fabricated.

## Phase status

- **Phase 2.5B-1 zoning: operationally complete for the available official
  source package** — all 9 published LSMD ZIPs validated and ingested (88,252
  features), Seoul UQ112–114 documented `OFFICIAL_SOURCE_UNAVAILABLE`,
  idempotency verified.
- **Phase 2.5B (full structural package): complete for the available official
  sources.** Zoning (88,252), protected/restricted (20,892), and road/road-
  network lines (2,971,494) are all production-ingested for Seoul/Incheon/
  Gyeonggi. Every published mandatory source validated; the national-park
  nationwide layer was processed and clipped for all three 시도; the only gaps
  are the documented `OFFICIAL_SOURCE_UNAVAILABLE` cells (Seoul UM901/UF151,
  Gyeonggi UM901 — the provider publishes no shapefile). No published mandatory
  source is unexpectedly missing. Optional layers (UM221, UQ162, MOCTLINK) are
  not blockers. Idempotency verified for every family.
- **Phase 5.4: data precondition satisfied; remaining blockers are policy, not
  data.** The minimum official constraint package (land-use/zoning +
  protected-area + road feature layers) is now production-ingested with
  capital-region coverage, so the Phase 5.4 data prerequisite is met. What
  remains is **not** data ingestion but the analytical policy decisions: the
  per-layer exclusion/penalty rules, the weighting rationale and sensitivity
  (see `docs/ANALYTICAL_METHODS.md`), and the review workflow. These are
  separate human decisions and are unchanged by this ingestion. The layers are
  **spatial screening layers**, not legal determinations — a boundary
  intersection flags a location for review and never proves a permitting
  outcome or truck accessibility (legal-boundary caveat).
