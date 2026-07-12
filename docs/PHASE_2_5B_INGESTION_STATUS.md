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
- Migrations applied to head **0007** (0006 versioned structural schema; 0007
  line-feature table). Full alembic upgrade→downgrade→upgrade round-trip
  verified on a disposable scratch database.

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

## Structural layer completeness (as of this run)

Structural tables (`structural_dataset_versions`, `structural_features`,
`structural_line_features`) exist and are **empty (0 rows)**. Official bulk
source files are **not present locally** and the official bulk downloads are
browser/솔루션-mediated (interactive login/approval per the Phase 2.5A audit),
so they cannot be fetched from the CLI. No mirror or synthetic substitute was
used.

Per-layer / per-region status — every mandatory cell is `SOURCE_MISSING`
(distinct from “zero features”); no region has been evaluated yet:

| Family | Layers | Seoul | Incheon | Gyeonggi | Coverage |
| --- | --- | --- | --- | --- | --- |
| zoning | UQ111–UQ114 | SOURCE_MISSING | SOURCE_MISSING | SOURCE_MISSING | INCOMPLETE |
| protected (mandatory) | UD801, UM710, UM901, UF151, WGISNPGUG, UO101, UO301 | SOURCE_MISSING | SOURCE_MISSING | SOURCE_MISSING | INCOMPLETE |
| protected (optional) | UM221, UQ162 | SOURCE_MISSING | SOURCE_MISSING | SOURCE_MISSING | INCOMPLETE |
| roads | STDLINK / N3A0020000 / MOCTLINK | SOURCE_MISSING | SOURCE_MISSING | SOURCE_MISSING | INCOMPLETE |

The ingestion framework is ready: place the official files and run the write
command; the loader validates sidecars, reads/validates the source CRS,
transforms to EPSG:4326, classifies coverage, and persists versioned features
idempotently.

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
`--write` to confirm zero duplicate versions/features.

## AirKorea / KMA

`AIRKOREA_SERVICE_KEY` and `KMA_SERVICE_KEY` are MISSING and only probe code
exists; these are real-time sources and are **not** blockers for Phase 5.4
structural suitability. Left as remaining Phase 2 work; no data fabricated.

## Phase status

- **Phase 2.5B-1 (zoning foundation): not complete** — schema/loader/CLI/tests
  are done and PostGIS-verified, but no official zoning data has been ingested
  (files require manual download).
- **Phase 2.5B (full structural package): not complete** — protected and road
  layers are also awaiting manual downloads.
- **Phase 5.4: remains blocked** — mandatory zoning + protected/restricted +
  road data are not yet ingested for all three regions. Storage/licensing is
  resolved for this project by the confirmed prior government-project
  authorization; the remaining conditions are the manual downloads, live
  ingestion with per-시도 completeness, and the exclusion/penalty policy
  decisions (separate human decisions, unchanged).
