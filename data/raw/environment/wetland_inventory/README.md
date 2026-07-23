# 내륙습지 공간데이터 — local raw source

Provenance record for the local, **Git-ignored** copy of the 국립생태원 inland
wetland inventory. This README is the only file in this directory that is
committed; every data file listed below stays local.

> **Do not commit the raw dataset.** The ZIP, `.shp`, `.shx`, `.dbf`, `.prj`,
> `.cpg`, `.qmd`, and everything under `extracted/` are excluded by `.gitignore`
> (`data/raw/environment/wetland_inventory/*`, with this README explicitly
> re-included). Do not rename, edit, reproject, repair, or delete them — the
> checksums below are the identity of the verified release.

## Dataset identity

| Field | Value |
| --- | --- |
| Official dataset name | 국립생태원_내륙습지 공간데이터 및 속성정보_20220720 |
| Provider (제공기관) | 국립생태원 (National Institute of Ecology) |
| Managing department (관리부서) | 지능정보전략팀 |
| Source page | <https://www.data.go.kr/data/15086410/fileData.do> (공공데이터포털, 파일데이터 15086410) |
| Also published at | 에코뱅크 (EcoBank) <https://www.nie-ecobank.kr> |
| Survey basis | 「습지보전법」에 따른 전국내륙습지 기초조사, 2000–2021 (1–2차 2000–2010, 3차 2011–2015, 4차 2016–2021) — 환경부·국립생태원 보도자료 2022-08-01 |
| Reference date (dataset label) | 2022-07-20 |
| Portal 등록일 / 수정일 | 2022-07-22 / 2025-07-24 (portal metadata dates) |
| Update cycle (업데이트 주기) | 수시 (1회성 데이터) |
| Licence / use condition | 이용허락범위 제한 없음 (no stated usage restriction, 공공데이터포털) |
| Declared feature count | 2,704 내륙습지 (filename and portal description) |
| Stated CRS | EPSG:5186 (filename), confirmed against the `.prj` — see below |
| Provision format | SHP |

## Local storage

Repository-relative path: `data/raw/environment/wetland_inventory/`

```
국립생태원_내륙습지 공간데이터 및 속성정보_20220720.zip   # original archive, untouched
extracted/                                                # unpacked, untouched
  Wetlands_Inventory_2,704_EPSG5186.shp
  Wetlands_Inventory_2,704_EPSG5186.shx
  Wetlands_Inventory_2,704_EPSG5186.dbf
  Wetlands_Inventory_2,704_EPSG5186.prj
  Wetlands_Inventory_2,704_EPSG5186.cpg
  Wetlands_Inventory_2,704_EPSG5186.qmd   # QGIS metadata sidecar (optional)
```

The comma in `2,704` is part of the official file name and is **not** corrected.

Local acquisition date: 2026-07-23 (ZIP), extracted 2026-07-23.
Source file modification dates inside the archive: 2022-06-23 17:40:38 +0900.

## Checksums (SHA-256)

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `국립생태원_내륙습지 공간데이터 및 속성정보_20220720.zip` | 5,713,059 | `f9d77a74b942cad354e59ec093c39f0a2a33d14372829253bf29e1c80a2af196` |
| `extracted/…EPSG5186.shp` | 7,567,368 | `1a0863886179dc3ea429cb9a4243452f5f0bda7a396511cc6f641cb8c632085f` |
| `extracted/…EPSG5186.shx` | 21,732 | `12e781cfa65001a5672b2471098c654f4b4dcb1c22a80b1069560b163b82bd15` |
| `extracted/…EPSG5186.dbf` | 5,319,282 | `72b28d6b3cf85bc3a0ef726208aaa1551e12fda2e8a954b278c5988a01a6f777` |
| `extracted/…EPSG5186.prj` | 422 | `dcfa42cfd392417d954aeb5038d12fdaa32a30879b3f5d611f207c7115dc9e7e` |
| `extracted/…EPSG5186.cpg` | 5 | `3ad3031f5503a4404af825262ee8232cc04d4ea6683d42c5dd0a2f2a27ac9824` |
| `extracted/…EPSG5186.qmd` | 651 | `3b98d581eb558d899199eae26ad93a7adb5e12ec536554f99b52e8f0cd90e72d` |

Re-verify with:

```bash
shasum -a 256 "국립생태원_내륙습지 공간데이터 및 속성정보_20220720.zip" extracted/*
```

## Verified facts

Confirmed by reading the local files (Phase 1B-0, 2026-07-23):

- `.prj` = ESRI WKT `Korea_2000_Korea_Central_Belt_2010`, resolved to **EPSG:5186**.
- `.cpg` = **`UTF-8`**; all 2,704 DBF records decode strictly, Korean text intact.
- 2,704 polygon records, **0** null / empty / invalid geometries.
- `CODE`, `FID`, and `NAME` are each unique across all 2,704 records.

## Status

This dataset has completed **local contract verification only**. It is **not**
ingested into PostGIS, **not** used in suitability scoring, and is **not** the
same thing as the statutory 습지보호지역 layer (`UM901`) already in the platform.

- Contract: [`docs/WETLAND_INVENTORY_DATA_CONTRACT.md`](../../../../docs/WETLAND_INVENTORY_DATA_CONTRACT.md)
- Observed values: [`docs/WETLAND_INVENTORY_VALIDATION_REPORT.md`](../../../../docs/WETLAND_INVENTORY_VALIDATION_REPORT.md)
