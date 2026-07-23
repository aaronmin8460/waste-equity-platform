# 내륙습지 목록 — Contract Validation Report

**Phase:** Suitability 1B-0 · **Date:** 2026-07-23 · **Verification:** `LIVE_VERIFIED` (local file inspection)

Every value below was measured against the local, Git-ignored copy of the
국립생태원 inland wetland inventory. Nothing here is estimated, sampled, or copied
from portal metadata unless the row says so. The contract these values are
checked against is [WETLAND_INVENTORY_DATA_CONTRACT.md](WETLAND_INVENTORY_DATA_CONTRACT.md).

**No data was ingested.** No database write, no score, rank, candidate status,
policy version, API response, or frontend behaviour changed.

**Reproduce with:**

```bash
python -m waste_equity_ingestion.wetland_inventory_contract \
  "data/raw/environment/wetland_inventory/extracted/Wetlands_Inventory_2,704_EPSG5186.shp"
```

---

## 1. File integrity and checksums

Source archive: `국립생태원_내륙습지 공간데이터 및 속성정보_20220720.zip`
(5,713,059 bytes, acquired 2026-07-23, extracted 2026-07-23, archive member
timestamps 2022-06-23 17:40:38 +0900). The ZIP was neither modified nor renamed.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `…_20220720.zip` | 5,713,059 | `f9d77a74b942cad354e59ec093c39f0a2a33d14372829253bf29e1c80a2af196` |
| `Wetlands_Inventory_2,704_EPSG5186.shp` | 7,567,368 | `1a0863886179dc3ea429cb9a4243452f5f0bda7a396511cc6f641cb8c632085f` |
| `…​.shx` | 21,732 | `12e781cfa65001a5672b2471098c654f4b4dcb1c22a80b1069560b163b82bd15` |
| `…​.dbf` | 5,319,282 | `72b28d6b3cf85bc3a0ef726208aaa1551e12fda2e8a954b278c5988a01a6f777` |
| `…​.prj` | 422 | `dcfa42cfd392417d954aeb5038d12fdaa32a30879b3f5d611f207c7115dc9e7e` |
| `…​.cpg` | 5 | `3ad3031f5503a4404af825262ee8232cc04d4ea6683d42c5dd0a2f2a27ac9824` |
| `…​.qmd` | 651 | `3b98d581eb558d899199eae26ad93a7adb5e12ec536554f99b52e8f0cd90e72d` |

Checksums are stable across repeated runs and match an independent
`shasum -a 256`.

## 2. Sidecar completeness

| Sidecar | Required | Present |
| --- | --- | --- |
| `.shp` | — (the file itself) | ✅ |
| `.shx` | ✅ | ✅ |
| `.dbf` | ✅ | ✅ |
| `.prj` | ✅ | ✅ |
| `.cpg` | ✅ | ✅ |
| `.qmd` | optional | ✅ (QGIS metadata sidecar; its `<crs>` block is **empty** and carries no CRS — the `.prj` is the only CRS source) |

**Result: complete.** No required sidecar is missing.

## 3. CRS

| Property | Observed |
| --- | --- |
| `.prj` CRS name | `Korea_2000_Korea_Central_Belt_2010` |
| Resolved EPSG | **5186** (`pyproj.CRS.to_epsg()`, confidence ≥ 70) |
| Datum | Korean Geodetic Datum 2002 |
| Ellipsoid | GRS 1980 |
| Projection method | Transverse Mercator |
| Latitude of natural origin | 38.0° |
| Longitude of natural origin (central meridian) | 127.0° |
| Scale factor at natural origin | 1.0 |
| False easting / northing | 200 000 m / 600 000 m |
| Axis units | metre, metre |
| Projected | yes |

The filename claims EPSG:5186 and the `.prj` **independently confirms it** — all
seven defining parameters match the EPSG:5186 definition.

**Axis-order caveat (documented, not a defect).** `CRS.from_wkt(prj).equals(CRS.from_epsg(5186))`
returns `False`: the ESRI WKT declares no `AXIS` elements (read as easting/northing)
while the EPSG registry entry declares northing/easting. A round-trip transform
between the two is the identity — verified at three points including the
projection origin and both bbox corners, delta `0.000000 m` in x and y. Phase 1B
must transform with `always_xy=True` and must not gate on `CRS.equals`.

**Coordinate plausibility.** Source bounds (EPSG:5186 metres):
`(50 434.459, 70 209.123) – (542 014.699, 654 628.834)`.
Transformed to WGS84: **125.286°E – 130.916°E, 33.171°N – 38.492°N** — entirely
within South Korea (제주 in the south-west, 강원 in the north-east). Zero features
fall outside the coarse plausibility envelope.

## 4. Encoding

| Property | Observed |
| --- | --- |
| `.cpg` content | `UTF-8` |
| Records decoded strictly under UTF-8 | 2,704 / 2,704 |
| Undecodable records | **0** |
| Mojibake | none observed |

Korean text decodes cleanly (e.g. `한강하구`, `임진강하구`, `대암산 용늪`,
`경상남도 고성군 거류면 거산리`). No replacement characters appear anywhere.

**Ingestion must force `encoding="utf-8"`.** The platform's existing structural
loaders default to `cp949` for LSMD/NA_24 sources; applying that default here
would corrupt every Korean value. The encoding must be taken from the `.cpg`.

## 5. Field schema (all 15 DBF columns)

| # | Field | Type | Width | Dec | Empty | Distinct | Max len | Inferred meaning |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `FID` | N | 4 | 0 | 0 | 2,704 | 4 | Source row number |
| 2 | `NAME` | C | 33 | 0 | 0 | 2,704 | 12 | Wetland name |
| 3 | `CODE` | C | 15 | 0 | 0 | 2,704 | 15 | Wetland identifier |
| 4 | `TYPE` | C | 254 | 0 | 0 | 4 | 4 | Wetland type (Korean label) |
| 5 | `TYPE_KOREA` | C | 254 | 0 | 0 | 24 | 4 | Korean classification code |
| 6 | `TYPE_RAMSA` | C | 254 | 0 | 0 | 33 | 5 | Ramsar type code |
| 7 | `AREA` | N | 10 | 0 | 0 | 2,679 | 8 | Area, m² |
| 8 | `LONGITUDE` | N | 21 | 10 | 0 | 2,704 | 14 | Representative point lon |
| 9 | `LATITUDE` | N | 21 | 10 | 0 | 2,704 | 13 | Representative point lat |
| 10 | `ADDRESS` | C | 63 | 0 | 0 | 2,209 | 23 | 지번 address |
| 11 | `SD_NN` | C | 21 | 0 | 0 | 17 | 7 | 시도명 |
| 12 | `SGG_NM` | C | 254 | 0 | 0 | 188 | 8 | 시군구명 |
| 13 | `EMD_NM` | C | 254 | 0 | 0 | 1,130 | 5 | 읍면동명 |
| 14 | `RI_NM` | C | 254 | 0 | **336** | 1,525 | 5 | 리명 |
| 15 | `EXP` | C | 254 | 0 | **2,669** | 2 | 13 | Statutory designation note |

Proposed normalized names, required/public flags, and per-field ambiguities are
in §4 of the contract. Observed value sets for the low-cardinality columns:

- `TYPE` (4): `하천습지`, `호수습지`, `산지습지`, `인공습지`
- `TYPE_KOREA` (24): `H1`–`H9`, `L2`–`L5`, `M1`–`M4`, `R1`, `R3`–`R7`, **and one
  non-code value `하도습지`**
- `TYPE_RAMSA` (33): `1`–`9`, `D`, `F`, `G`, `H`, `I`, `J`, `K`, `M`, `N`, `O`,
  `P`, `Q`, `R`, `Sp`, `TP`, `Tp`, `Ts`, `U`, `W`, `XP`, `Xf`, `Xp`, `Y`, `Zk(a)`
- `SD_NN` (17): all 17 시도, but 제주 is spelled **`제주특별자치시`** (official name
  is `제주특별자치도`) on all 127 제주 records
- `EXP` (2): `습지보호지역(환경부지정)` ×29, `습지보호지역(시도지정)` ×6

Fields that do **not** exist in the source (must not be invented): per-feature
survey/reference date, management organisation, source/remarks, and any
administrative **code** (only names are supplied).

### 5.1 Attribute cross-checks

| Check | Result |
| --- | --- |
| `AREA` field vs geometry area | All 2,704 within **±1 %** (median +0.01 %, range −0.72 % … +0.30 %). Field sum 1,153,513,271 m² vs geometry sum 1,153,738,956 m² (+0.02 %). |
| `LONGITUDE`/`LATITUDE` vs polygon representative point | Median offset 0.00023° / 0.00042°; p95 0.0092° / 0.0032°; max 0.042° / 0.057°. **3 records** exceed 0.05°. The provider point is *not* the centroid and must not be used as geometry. |
| `ADDRESS` vs `SD_NN` | 2,704 / 2,704 consistent (every `ADDRESS` starts with its `SD_NN`). |
| `FID` range | 1 – 2,705 over 2,704 records → **one gap**; `FID` is a source row number, not a stable key. |
| `SGG_NM` uniqueness | 5 values (`고성군`, `남구`, `동구`, `북구`, `서구`) occur under more than one 시도 — `SGG_NM` alone is not a municipality key. |

## 6. Geometry statistics

| Property | Observed |
| --- | --- |
| Shapefile shape type | `POLYGON` |
| Record count (`.shx` / `.dbf` / geometry) | **2,704 / 2,704 / 2,704** — consistent |
| Geometry types | `Polygon` 2,696 · `MultiPolygon` 8 |
| Multipart / singlepart | 8 / 2,696 |
| Null geometry | **0** |
| Empty geometry | **0** |
| Invalid geometry | **0** |
| Self-intersections | **0** |
| Bounds (EPSG:5186, m) | `50 434.459, 70 209.123, 542 014.699, 654 628.834` |
| Bounds (WGS84) | `125.286, 33.171, 130.916, 38.492` |
| Features outside the South Korea envelope | **0** |
| Total source area (measured, EPSG:5186) | 1,153,738,956 m² ≈ **1,153.74 km²** |
| Smallest polygon | 63.54 m² (`12-336102-3-003` 중천이물) |
| Largest polygon | 58,214,212 m² ≈ 58.21 km² (`06-376034-9-011` 한강하구) |
| Polygons < 100 m² | 1 |
| Polygons < 1 000 m² | 76 |
| Polygons > 10 km² | 18 |

### 6.1 Invalid geometry summary

**None.** All 2,704 geometries are OGC-valid under shapely; there are no
self-intersections, no ring-order failures, and no empty parts. **No repair was
attempted or needed** — Phase 1B-0 reports geometry, it never fixes it.

### 6.2 Duplicate summary

| Check | Distinct | Duplicated values | Surplus records |
| --- | --- | --- | --- |
| `CODE` | 2,704 | **0** | 0 |
| `FID` | 2,704 | **0** | 0 |
| `NAME` | 2,704 | **0** | 0 |
| Geometry (normalized WKB SHA-256) | 2,704 | **0** | 0 |

`CODE` is a usable natural key for this release. No intra-dataset deduplication
is required.

## 7. Capital-region coverage

### 7.1 Method (and its limitation)

The platform's authoritative 시도 boundaries live in PostGIS. **No database was
available for this offline verification** (Docker daemon not running, no local
`psql`), so boundaries were rebuilt from the repository's own locally-held
official source: the 국토교통부 **LSMD 용도지역 release 202606** shapefiles already
used by the zoning loader — `UQ111`(도시지역) for 서울, and `UQ111`+`UQ112`+`UQ113`+`UQ114`
(도시/관리/농림/자연환경보전지역) for 인천 and 경기 (서울 publishes only `UQ111`, which
covers it entirely). All polygons were reprojected to EPSG:5186 and unioned per
시도. Wetland features were then tested against those unions in the same
projected CRS: **representative-point-in-boundary** for the primary region, plus
a separate **intersects** test against each 시도 so cross-boundary features stay
visible.

Sanity check on the proxy boundaries:

| 시도 | 용도지역 union area | Published land area | Δ |
| --- | --- | --- | --- |
| 서울특별시 | 605.5 km² | ≈ 605.2 km² | +0.05 % |
| 인천광역시 | 1,079.0 km² | ≈ 1,067 km² | +1.1 % |
| 경기도 | 10,287.1 km² | ≈ 10,199 km² | +0.9 % |

**Limitation:** 용도지역 covers designated land, so a wetland lying wholly in
공유수면 / 해면부 outside any 용도지역 polygon can be missed — exactly one such case
was found (§7.3). A Phase 1B ingestion must use the platform's own 시도 geometry,
not this proxy.

### 7.2 Counts

| 시도 | Intersects | Representative point inside | Primary assignment | Source `SD_NN` attribute |
| --- | --- | --- | --- | --- |
| 서울특별시 | 11 | 9 | 9 | 8 |
| 인천광역시 | 28 | 24 | 26 | 24 |
| 경기도 | 200 | 188 | 197 | 196 |
| **Unique features in the capital region** | **232** | 221 | **232** | **228** |

- Features intersecting **more than one** capital 시도: **7**
- Features **outside** the capital region: **2,472** (of 2,704)
- Total source polygon area of capital-region features: **185.06 km²**
  (서울 0.76 · 인천 9.83 · 경기 174.47 km², by primary assignment)
- Area actually falling *within* each 시도 boundary: 서울 0.76 · 인천 8.23 ·
  경기 138.93 km² (a large estuarine polygon extends beyond the 용도지역 union)

The four features whose representative point falls outside every 시도 union but
which still intersect one are all estuary/coastal-fringe polygons — a direct
consequence of the proxy-boundary limitation, not a data defect.

### 7.3 Attribute vs spatial agreement

**223 of 232** capital-region features agree between `SD_NN` and geometry. The
**9** disagreements:

| `CODE` | `NAME` | `SD_NN` (source) | `SGG_NM` | Geometric result | Kind |
| --- | --- | --- | --- | --- | --- |
| `15-377153-2-083` | 원당습지 | 충청북도 | 음성군 | 경기도 | attributed outside, sits inside |
| `15-377071-3-001` | 관천리1습지 | 강원도 | 춘천시 | 경기도 | attributed outside, sits inside |
| `15-377071-3-002` | 관천리2습지 | 강원도 | 춘천시 | 경기도 | attributed outside, sits inside |
| `14-367012-2-043` | 건천리습지 | 충청남도 | 천안시 | 경기도 | attributed outside, sits inside |
| `20-366042-5-301` | 안성천하구습지 | 충청남도 | 아산시 | 경기도 | attributed outside, sits inside |
| `20-376154-5-301` | 어은천하구습지(화성) | 경기도 | 화성시 | (no 용도지역 hit) | attributed inside, no boundary hit |
| `20-376112-5-301` | 보통천하구습지 | 경기도 | 시흥시 | 인천 + 경기 | straddles 시도 |
| `21-376112-5-301` | 신천하구습지 | 경기도 | 시흥시 | 인천 + 경기 | straddles 시도 |
| `15-377054-1-076` | 둔촌동습지 | 경기도 | 하남시 | 서울특별시 | 시도 differs |

Five are boundary-straddling or border-adjacent features whose attribute names a
single 시도; one (`어은천하구습지(화성)`) is the 공유수면 case noted in §7.1. **This is
why region assignment must be geometric, not a string join on `SD_NN`.**

### 7.4 Largest 10 capital-region wetlands

| # | Area (km²) | `CODE` | `NAME` | `SD_NN` / `SGG_NM` | `TYPE` | Primary | `EXP` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 58.214 | `06-376034-9-011` | 한강하구 | 경기도 김포시 | 하천습지 | 경기도 | 습지보호지역(환경부지정) |
| 2 | 23.865 | `20-366042-5-301` | 안성천하구습지 | 충청남도 아산시 | 하천습지 | 경기도 | — |
| 3 | 14.294 | `20-376152-5-302` | 화성호하구습지 | 경기도 화성시 | 하천습지 | 경기도 | — |
| 4 | 11.158 | `21-376034-5-001` | 임진강하구 | 경기도 파주시 | 하천습지 | 경기도 | — |
| 5 | 7.305 | `20-376163-5-301` | 남양호하구습지 | 경기도 평택시 | 하천습지 | 경기도 | — |
| 6 | 3.014 | `15-377134-3-047` | 이동저수지 | 경기도 처인구 | 인공습지 | 경기도 | — |
| 7 | 2.109 | `13-377111-2-040` | 금사습지 | 경기도 여주시 | 하천습지 | 경기도 | — |
| 8 | 2.064 | `15-377133-2-063` | 궁안교습지 | 경기도 평택시 | 하천습지 | 경기도 | — |
| 9 | 1.951 | `15-377054-2-069` | 미사동습지 | 경기도 하남시 | 하천습지 | 경기도 | — |
| 10 | 1.892 | `15-376034-2-010` | 공릉천하구습지 | 경기도 파주시 | 하천습지 | 경기도 | — |

**Exactly one** capital-region inventory feature carries a statutory designation
note (#1, 한강하구). The other nine — including the four largest after it — are
surveyed wetlands with **no** protected-area status.

## 8. Comparison with existing `UM901` (습지보호지역)

### 8.1 Availability of the existing data

The platform's `UM901` data is **available locally** as the same official LSMD
release the protected-layer loader ingests:

- `data/raw/vworld/protected/incheon/LSMD_CONT_UM901_인천.zip` — 3 features
- `data/raw/vworld/protected_um901_supplement/gyeonggi/LSMD_CONT_UM901_경기.zip` — 3 features
- **서울: `OFFICIAL_SOURCE_UNAVAILABLE`** — recorded as such in
  `data/raw/vworld/protected/source_manifest.json`; no Seoul UM901 source exists
  in the 202606 release.

Both files declare EPSG:5186 and carry the LSMD schema
(`MNUM/COL_ADM_SE/SGG_OID/NTFDATE/ALIAS/REMARK`). **No `UM901` data was
modified, re-clipped, or re-versioned by this verification** — the archives were
extracted to a temporary directory, read, and discarded.

### 8.2 `UM901` features in Seoul / Incheon / Gyeonggi

| # | 시도 | `COL_ADM_SE` | Note | Area (km²) |
| --- | --- | --- | --- | --- |
| 1 | 인천광역시 | 28185 (연수구) | `ALIAS = 11공구 대체서식지` | 3.640 |
| 2 | 인천광역시 | 28185 (연수구) | `ALIAS = 6, 8공구 주변갯벌` | 2.502 |
| 3 | 인천광역시 | 28710 (강화군) | `REMARK = 한강하구 습지보호지역` | 59.674 |
| 4 | 경기도 | 41280 (고양시) | — | 10.970 |
| 5 | 경기도 | 41480 (파주시) | — | 13.453 |
| 6 | 경기도 | 41570 (김포시) | `REMARK = 환경보전과 확인요망` | 58.214 |

**Count: 6.** Sum of areas 148.45 km²; **union 65.89 km²** — the 한강하구
protection area is published as overlapping per-시군구 polygons, so areas must be
unioned, never summed.

### 8.3 Overlap

| Measure | Value |
| --- | --- |
| Capital-region inventory features overlapping the `UM901` union | **4** |
| Capital-region inventory features **not** overlapping `UM901` | **228** |
| `UM901` union area represented in the inventory | 58.21 km² = **88.3 %** |
| `UM901` union area **not** represented in the inventory | **7.68 km²** |

Per overlapping inventory feature:

| `CODE` | `NAME` | Overlap (km²) | % of inventory polygon |
| --- | --- | --- | --- |
| `06-376034-9-011` | 한강하구 (경기 김포) | 58.2142 | **100.00 %** |
| `21-376034-5-001` | 임진강하구 (경기 파주) | 0.0036 | 0.03 % |
| `20-376072-5-302` | 장월평천하구습지 (경기 고양) | 0.0011 | 1.10 % |
| `20-376024-5-304` | 숭릉천하구습지 (인천 강화) | 0.0005 | 0.73 % |

Three of the four are sliver contacts along a shared boundary. The fourth is an
exact match:

> **`06-376034-9-011` 한강하구 is geometrically identical to `UM901` feature #6
> (경기 김포, 41570).** Symmetric difference = **0.000 m²**, both 58,214,212 m².
> The same polygon is published in both datasets.

Per `UM901` feature, share covered by the inventory:

| `UM901` feature | Covered |
| --- | --- |
| 인천 28185 — 11공구 대체서식지 | **0.0 %** |
| 인천 28185 — 6, 8공구 주변갯벌 | **0.0 %** |
| 인천 28710 — 한강하구 | 97.5 % |
| 경기 41280 — 고양 | 99.5 % |
| 경기 41480 — 파주 | 99.9 % |
| 경기 41570 — 김포 | 100.0 % |

The two entirely uncovered `UM901` features are the 송도갯벌 tidal-flat areas —
**coastal (연안) wetlands**. This inventory is **내륙 (inland) only**, so their
absence is correct behaviour, not a gap.

Identifier/name matching is **not practical**: `UM901` carries `MNUM`/`ALIAS`/`REMARK`
with no wetland name for 4 of 6 features, and the inventory carries `CODE`/`NAME`
with no `MNUM`. The only reliable correspondence is geometric.

### 8.4 The two datasets are different legal and analytical concepts

Confirmed, and required to stay separate:

| | `UM901` | `wetland_inventory` |
| --- | --- | --- |
| Concept | **Statutory** 습지보호지역 designated under 「습지보전법」 | **Surveyed/inventoried** inland wetland |
| Legal effect | Designation with regulatory consequences | None — being surveyed confers no status |
| Publisher | 국토교통부 LSMD (VWorld/국가공간정보포털) | 국립생태원 (공공데이터포털) |
| Includes coastal 연안습지 | Yes (송도갯벌) | No — inland only |
| Capital-region features | 6 (서울 `OFFICIAL_SOURCE_UNAVAILABLE`) | 232 |
| Platform status | `IMPLEMENTED` (protected structural layer) | `NOT_IMPLEMENTED` |

Evidence from the data itself: only **35 of 2,704** inventory records (1.3 %)
carry any 습지보호지역 note in `EXP`; in the capital region it is **1 of 232**.
The 환경부·국립생태원 press release of 2022-08-01 states the survey results are used
as 기초자료 *for* 습지보호지역 designation — the inventory is an **input to**
designation, not designation itself.

Accordingly the two datasets are **not merged**, inventoried wetlands are **not**
classified as protected areas, **no hard exclusion** is derived from the
inventory, and existing `UM901` data is left untouched.

## 9. Unresolved issues

| # | Issue | Impact | Disposition |
| --- | --- | --- | --- |
| 1 | `CODE` segment semantics undocumented (no code book published) | Cannot derive a per-feature survey year or type from the identifier | `UNRESOLVED_SOURCE_FIELD` — treat `CODE` as opaque; do not parse |
| 2 | No per-feature survey/reference date | Only the dataset-level 2022-07-20 date is defensible | Documented; no date invented |
| 3 | No management organisation and no source/remarks field | Cannot attribute per-feature stewardship | Documented as absent |
| 4 | No administrative **codes**, only names | Region join must be geometric | Handled by §7 method; blocks a string-join approach |
| 5 | `SD_NN` = `제주특별자치시` on all 127 제주 records (official: `제주특별자치도`) | Source naming error | Report as-is; normalize on read only with an explicit, documented mapping — never silently |
| 6 | `TYPE_KOREA` holds the label `하도습지` on 1 record instead of a code | Breaks a strict code enum | Store raw; do not "fix" |
| 7 | `TYPE_RAMSA` mixed case (`Xp`/`XP` ×1, `Tp`/`TP` ×2) and no shipped code list | Naïve grouping would split categories | Store raw + an upper-cased variant |
| 8 | `SGG_NM` mixes 시군구 with sub-시 구, and 5 values recur across 시도 | Not a municipality key | Never use alone as a join key |
| 9 | `FID` is not contiguous (1–2,705 over 2,704 rows) | Not a stable identifier | Use `CODE` |
| 10 | Provider `LONGITUDE`/`LATITUDE` is not the polygon centroid (max offset 0.057°) | Misleading if used as geometry | Store as a provider attribute only |
| 11 | Capital-region boundaries had to be proxied from 용도지역 (no DB available offline) | One 공유수면 feature missed; counts are ±1 | **Phase 1B must re-run assignment against the platform's own PostGIS 시도 geometry** |
| 12 | `.qmd` sidecar's `<crs>` block is empty | No independent CRS confirmation from the QGIS metadata | `.prj` is authoritative; parameters independently verified |
| 13 | Portal `수정일 = 2025-07-24` vs dataset label `20220720` | Unclear whether content changed after 2022 | Metadata-only per the portal's `1회성 데이터` cycle; re-check before any Phase 1B ingestion |

Pre-existing, unrelated to this dataset:

| Issue | Status |
| --- | --- |
| `backend/alembic/versions/20260719_0016_suitability_critic_stability.py` fails `ruff format --check` | **Pre-existing on `main` before this branch**; not touched here (out of scope) |
| 102 backend PostGIS-tier tests skip without `TEST_DATABASE_URL` | Expected; Docker daemon not running locally |

## 10. Recommendation

### GO FOR PHASE 1B INGESTION

Every blocking check passes on the real file:

- ✅ complete shapefile set, all required sidecars present, checksums stable
- ✅ `.prj` independently confirms **EPSG:5186** (all seven parameters match)
- ✅ `.cpg` declares **UTF-8** and all 2,704 records decode strictly; Korean intact
- ✅ **2,704** records — matches the declared feature count exactly
- ✅ **0** null, **0** empty, **0** invalid geometries, **0** self-intersections
- ✅ `CODE` unique; no duplicate geometry
- ✅ all coordinates plausible for South Korea; `AREA` agrees with geometry within ±1 %
- ✅ licence is `이용허락범위 제한 없음` — no redistribution or derived-use restriction
- ✅ the relationship to `UM901` is understood and evidenced, not assumed

The Phase 1A audit's `CONDITIONAL GO` was conditioned on (a) resolving the
생태자연도 KOGL Type 3 licence and (b) deduplicating against existing protected
wetlands. Both are now resolved: 생태자연도 is a **different dataset** not covered
by this contract, and the overlap with `UM901` is quantified exactly (4 features,
1 of them geometrically identical) with `CODE`-keyed dedup rules written.

Ingestion is GO **subject to these carried conditions**, all recorded in the
contract:

1. Region assignment must be re-run against the platform's own PostGIS 시도
   geometry, not the offline 용도지역 proxy (issue 11).
2. The loader must force `encoding="utf-8"` — the `cp949` structural default
   would corrupt every Korean value.
3. Source anomalies (issues 5–9) are stored raw and normalized only via an
   explicit, documented mapping.
4. Portal metadata must be re-checked for a post-2022 content change before load
   (issue 13).
5. Ingestion remains **additive and non-scoring**: no weight, exclusion rule,
   rank, or candidate status may change without a separate policy-version bump
   (contract §16).

**Scoring integration remains `NOT_IMPLEMENTED` and is out of scope for Phase 1B
ingestion.**
