# 내륙습지 목록 (Inland Wetland Inventory) — Data Contract

**Phase:** Suitability 1B-0 (contract verification)
**Layer name:** `wetland_inventory`
**Status:** source dataset `PLANNED` · contract verification `LIVE_VERIFIED` · scoring integration `NOT_IMPLEMENTED`

This document is the **contract** for the 국립생태원 inland wetland inventory: what
the official source is, what the file actually contains, how it would be
normalized, and — just as importantly — where Phase 1B-0 stops. Observed values
are recorded separately in
[WETLAND_INVENTORY_VALIDATION_REPORT.md](WETLAND_INVENTORY_VALIDATION_REPORT.md).

Nothing described here has been ingested. No suitability score, weight,
exclusion rule, candidate rank, candidate status, policy version, API response,
or frontend behaviour changes as a result of this document.

---

## 1. Dataset identity

| Field | Value |
| --- | --- |
| Official dataset name | 국립생태원_내륙습지 공간데이터 및 속성정보_20220720 |
| Provider (제공기관) | 국립생태원 (National Institute of Ecology) |
| Managing department | 지능정보전략팀 |
| Official URL | <https://www.data.go.kr/data/15086410/fileData.do> (공공데이터포털 파일데이터 `15086410`) |
| Secondary publication | 에코뱅크 (EcoBank) <https://www.nie-ecobank.kr> |
| Legal/survey basis | 「습지보전법」 전국내륙습지 기초조사 (2000–2021; 1–2차 2000–2010, 3차 2011–2015, 4차 2016–2021). 환경부·국립생태원 보도자료 2022-08-01. |
| Licence / use condition | 이용허락범위 제한 없음 (portal-stated; no attribution or derived-use restriction declared) |
| Reference date | 2022-07-20 (dataset label); archive member timestamps 2022-06-23 |
| Portal 등록일 / 수정일 | 2022-07-22 / 2025-07-24 (portal metadata, not necessarily new content) |
| Update cycle | 수시 (1회성 데이터) — one-off publication of a survey round |
| Declared feature count | 2,704 |
| Distribution format | ESRI Shapefile (`.shp/.shx/.dbf/.prj/.cpg`, plus a `.qmd` QGIS sidecar) |

The licence stated on the portal (`이용허락범위 제한 없음`) is materially **less
restrictive** than the KOGL Type 3 condition the Phase 1A audit flagged for
생태자연도. That constraint applies to 생태자연도, which is a *different* dataset
and is **not** covered by this contract.

## 2. Source CRS

| Field | Value |
| --- | --- |
| `.prj` content | ESRI WKT `PROJCS["Korea_2000_Korea_Central_Belt_2010", …]` |
| Resolved EPSG | **5186** (Korea 2000 / Central Belt 2010) |
| Datum | Korean Geodetic Datum 2002 (KGD2002), ellipsoid GRS 1980 |
| Projection | Transverse Mercator |
| Central meridian / latitude of origin | 127.0° / 38.0° |
| False easting / northing | 200 000 m / 600 000 m |
| Scale factor | 1.0 |
| Axis units | metre, metre |

Resolution uses the same `epsg_from_prj` helper as the production structural
loaders, so the CRS is read exactly as ingestion would read it. EPSG:5186 is
already in the loaders' `SUPPORTED_SOURCE_EPSG` allowlist.

**Axis-order note.** The ESRI WKT declares no `AXIS` elements, so pyproj reads it
as easting/northing, whereas the EPSG registry definition of 5186 declares
northing/easting. `CRS.equals()` therefore returns `False` even though the two
are the same projected CRS — a round-trip transform between them is the identity
to sub-millimetre. Any Phase 1B transform must use `always_xy=True` (the existing
loader convention) rather than relying on `CRS.equals`.

## 3. Source encoding

| Field | Value |
| --- | --- |
| `.cpg` content | `UTF-8` |
| Effective DBF encoding | UTF-8, strict |
| Ingestion requirement | Read with `encoding="utf-8", encodingErrors="strict"` |

This differs from every structural layer already ingested: the LSMD/NA_24 bulk
shapefiles are CP949/EUC-KR (`DEFAULT_SOURCE_ENCODING = "cp949"`). A Phase 1B
loader **must not** inherit the CP949 default for this source. The encoding is
taken from the `.cpg`; if a future release ships without one, the loader must
fail rather than guess.

## 4. Source schema

Fifteen DBF columns. `Required` means "a Phase 1B ingestion cannot proceed
without it"; `Public` means "safe to expose in a public API/UI".

| # | Source field | Type | Width | Dec | Nullable (observed) | Inferred meaning | Proposed normalized name | Required | Public | Ambiguity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `FID` | N | 4 | 0 | never empty | Source row number (1–2705 with one gap) | *(not persisted)* | No | No | Not a stable identifier across releases |
| 2 | `NAME` | C | 33 | 0 | never empty | Wetland name (Korean) | `wetland_name` | Yes | Yes | — |
| 3 | `CODE` | C | 15 | 0 | never empty | Wetland identifier, `YY-NNNNNN-T-NNN` | `wetland_code` | Yes | Yes | Segment semantics not documented — `UNRESOLVED_SOURCE_FIELD` (see §4.1) |
| 4 | `TYPE` | C | 254 | 0 | never empty | Wetland type, Korean label (4 values) | `wetland_type` | Yes | Yes | — |
| 5 | `TYPE_KOREA` | C | 254 | 0 | never empty | Korean wetland classification code (`H1`–`R7`) | `type_code_korea` | No | Yes | 1 record holds the label `하도습지` instead of a code |
| 6 | `TYPE_RAMSA` | C | 254 | 0 | never empty | Ramsar wetland type code | `type_code_ramsar` | No | Yes | Mixed case (`Xp`/`XP`, `Tp`/`TP`); code list not shipped |
| 7 | `AREA` | N | 10 | 0 | never empty | Wetland area, m² | `source_area_m2` | No | Yes | Provider-stated area; keep separate from computed area |
| 8 | `LONGITUDE` | N | 21 | 10 | never empty | Representative point longitude (WGS84) | `source_point_lon` | No | Yes | Not the polygon centroid (see §7) |
| 9 | `LATITUDE` | N | 21 | 10 | never empty | Representative point latitude (WGS84) | `source_point_lat` | No | Yes | Not the polygon centroid (see §7) |
| 10 | `ADDRESS` | C | 63 | 0 | never empty | Full 지번 address string | `source_address` | No | Yes | Concatenation of fields 11–14 |
| 11 | `SD_NN` | C | 21 | 0 | never empty | 시도명 | `sido_name` | Yes | Yes | 제주 is spelled `제주특별자치시` (official: `제주특별자치도`) |
| 12 | `SGG_NM` | C | 254 | 0 | never empty | 시군구명 | `sigungu_name` | Yes | Yes | Mixes 시군구 and sub-시 구 (`처인구`, `일산서구`) with no parent 시 — not a key on its own |
| 13 | `EMD_NM` | C | 254 | 0 | never empty | 읍면동명 | `emd_name` | No | Yes | — |
| 14 | `RI_NM` | C | 254 | 0 | 336 empty | 리명 | `ri_name` | No | Yes | Empty is legitimate (동 지역) |
| 15 | `EXP` | C | 254 | 0 | 2,669 empty | Statutory designation note | `designation_note` | Yes | Yes | Only two values, both 습지보호지역 (§9) |

No column carries a survey date, a management organisation, a source/remarks
free-text field, or an administrative **code** (only names). Those are absent
from the source and must not be invented:

- **Survey / reference date per feature:** `UNRESOLVED_SOURCE_FIELD`. The
  dataset-level reference date (2022-07-20) is the only defensible date.
- **Management organisation:** `UNRESOLVED_SOURCE_FIELD` — absent.
- **Source / remarks:** `EXP` is the only note-like field and carries designation
  text, not provenance.
- **Administrative codes (법정동코드 / 시군구 코드):** absent; only names are
  supplied. Region assignment must therefore be geometric (§13), not a string
  join.

### 4.1 `CODE` structure — what is and is not known

`CODE` matches `NN-NNNNNN-N-NNN` (e.g. `06-376034-9-011`). Observed regularities:

- Segment 1 takes values `99`, `00`, `02`, `04`, `06`, `09`–`22` — consistent
  with a two-digit year, but the source ships no code book.
- Segment 3 correlates strongly with `TYPE` (`1`↔산지습지, `2`↔하천습지,
  `3`↔호수습지, `4`/`0`↔인공습지) but is not a clean 1:1 mapping.

Both readings are **inferences**. Until 국립생태원 publishes a code book, `CODE`
is treated as an **opaque unique identifier** and is marked
`UNRESOLVED_SOURCE_FIELD` for any decomposed meaning. No segment may be parsed
into a survey year, a type, or a map sheet in scoring or UI.

## 5. Normalized schema (proposed, Phase 1B)

Not implemented. Recorded so a future ingestion has a contract to satisfy.

| Normalized column | Type | Source | Notes |
| --- | --- | --- | --- |
| `wetland_code` | text, unique per dataset version | `CODE` | Natural key |
| `wetland_name` | text | `NAME` | UTF-8, preserved verbatim |
| `wetland_type` | text | `TYPE` | Korean label kept; no invented English enum |
| `type_code_korea` | text, nullable | `TYPE_KOREA` | Stored raw; anomalous value not "fixed" |
| `type_code_ramsar` | text, nullable | `TYPE_RAMSA` | Stored raw plus an upper-cased variant |
| `source_area_m2` | bigint | `AREA` | Provider-stated |
| `computed_area_m2` | double precision | derived | Measured in EPSG:5186; stored beside, never replacing, `source_area_m2` |
| `sido_name`, `sigungu_name`, `emd_name`, `ri_name` | text | fields 11–14 | Source strings, unmodified |
| `source_address` | text | `ADDRESS` | |
| `source_point_lon`, `source_point_lat` | double precision | `LONGITUDE`/`LATITUDE` | Provider representative point |
| `designation_note` | text, nullable | `EXP` | Never reinterpreted as a legal status (§9) |
| `assigned_region_code` | text, nullable | derived | Geometric assignment (§13); nullable, never defaulted |
| `geometry` | `MultiPolygon`, SRID 4326 | `.shp` | §6 |
| `source_feature_checksum` | text | derived | Normalized-geometry + identity digest, per the structural-loader pattern |

Provenance columns follow the existing structural pattern exactly: one dataset
version row carrying `provider`, `official_dataset_name`, `provider_dataset_identifier`,
`reference_date`, `source_crs`, `source_file_checksum`, `transformation_version`,
`retrieved_at`, and `licence_note`.

## 6. Geometry normalization rules

1. Read with pyshp; convert via `__geo_interface__` to shapely.
2. Reproject **EPSG:5186 → EPSG:4326** with `always_xy=True` (§2).
3. Promote `Polygon` → `MultiPolygon` so the stored type is uniform, exactly as
   `normalize_polygonal_geometry` does for zoning/protected layers.
4. Reject — never repair — empty, non-polygonal, or invalid geometry. A rejected
   feature is counted and reported, not silently dropped.
5. Measure area in the **projected** source CRS (EPSG:5186, metres), never in
   EPSG:4326 degrees.
6. Do **not** buffer, simplify, snap, or `buffer(0)` any geometry.

## 7. Validation rules

A Phase 1B ingestion must fail visibly (not degrade to partial data) when:

- a required sidecar (`.shx`, `.dbf`, `.prj`, `.cpg`) is missing;
- the `.prj` does not resolve to EPSG:5186;
- the `.cpg` is absent or empty (encoding must never be guessed);
- any record fails a strict decode under the declared encoding;
- `CODE` is not unique within the release.

Reported but non-fatal (recorded in the run report):

- invalid / null / empty geometry counts;
- polygons below 1 000 m² or above 10 km²;
- `AREA` vs computed area divergence — observed within ±1 % for all 2,704
  records, so a >5 % divergence is a genuine signal;
- divergence between `LONGITUDE`/`LATITUDE` and the polygon's representative
  point — the provider point is *not* the centroid (median offset ≈ 0.0002°/0.0004°,
  maximum ≈ 0.042°/0.057°). The provider point is stored, never used as geometry.

## 8. Deduplication rules

- **Within the release:** `CODE`, `FID`, and `NAME` are each unique across all
  2,704 records, and no two features share identical geometry. No intra-dataset
  dedup is required; the uniqueness check stays as an assertion, not an assumption.
- **Across releases:** `CODE` is the merge key. A changed geometry under an
  unchanged `CODE` is a new dataset version, never an in-place edit.
- **Against `UM901`:** see §9 — the datasets are **not** deduplicated into one
  another.

## 9. Relationship to `UM901` (습지보호지역)

These are two different things and must stay separate.

| | `UM901` (already ingested) | `wetland_inventory` (this contract) |
| --- | --- | --- |
| What it is | 습지보호지역 — a **designated statutory protection area** | A **surveyed inventory** of inland wetlands |
| Legal effect | Designation under 「습지보전법」 with regulatory consequences | None. Being surveyed confers no protected status |
| Publisher | 국토교통부 LSMD (`LT_C_UM901`) via VWorld/국가공간정보포털 | 국립생태원 via 공공데이터포털 |
| Scope | Includes **coastal** 연안습지 (e.g. 송도갯벌) | **Inland** wetlands only |
| Platform role | `WETLAND_PROTECTION` structural protected layer | Not ingested |

Evidence for the distinction, from the data itself: only **35 of 2,704** records
carry any `EXP` designation note (29 `습지보호지역(환경부지정)`, 6 `습지보호지역(시도지정)`)
— i.e. **98.7 % of inventoried inland wetlands are not designated protection
areas**. The 환경부/국립생태원 press release of 2022-08-01 describes the survey
results as 기초자료 used *for* 습지보호지역 designation, confirming that the
inventory is an input to designation, not designation itself.

Rules:

- Do **not** merge the two datasets into one table or one layer.
- Do **not** classify inventoried wetlands as statutory protected areas.
- Do **not** apply hard exclusion from the inventory.
- Do **not** modify, re-version, or re-clip existing `UM901` data.
- Where the two overlap (§13 of the validation report: the 한강하구 feature is
  geometrically identical to the 김포 `UM901` polygon), the `UM901` record
  remains authoritative for legal status; the inventory record adds ecological
  survey context only.

## 10. Region-assignment method

The source ships administrative **names** but no administrative **codes**, and
its 시도 name disagrees with the polygon's actual location for 9 of 2,704
records. Region assignment is therefore **geometric**:

1. Reproject wetlands and the reference boundaries to a common projected CRS
   (EPSG:5186).
2. Assign a primary region by **representative-point-in-boundary**; record every
   intersecting region separately so cross-boundary features are visible rather
   than forced into one.
3. Keep `SD_NN`/`SGG_NM` as reported source attributes and record disagreement
   with the geometric result — never overwrite one with the other.

For a Phase 1B ingestion the reference boundary must be the platform's own
official 시도 geometry in PostGIS (the same boundaries `load_capital_region_boundaries`
already serves the structural loaders), not the 용도지역 proxy the offline
validation report had to use.

## 11. Provenance requirements

Every ingestion run records `source` (`nie_wetland_inventory`), the file
identifier and SHA-256, `retrieved_at`, `reference_date` (2022-07-20),
`source_crs` (`EPSG:5186`), `source_encoding` (`UTF-8`), the licence note, and a
`transformation_version`. Raw files are preserved untouched under
`data/raw/environment/wetland_inventory/` and are never committed.

## 12. Error handling and missing values

- Sidecar/CRS/encoding failures abort the run with an explicit message; there is
  no fallback to sample or synthetic data.
- A record that fails geometry or decode validation is counted and reported;
  the run's coverage status reflects it.
- Missing is never zero and never "safe": a wetland-related component with no
  data stays `REVIEW_REQUIRED`, consistent with the Phase 0 disclosure.
- An empty `RI_NM` or `EXP` is a legitimate empty value, not an error.

## 13. Refresh strategy

Update cycle is 수시 / one-off. There is no polling. A refresh is triggered by a
new 국립생태원 publication, detected by a manual metadata check, and ingested as a
**new dataset version** with its own reference date and checksum. Prior versions
are retained; `CODE` is the cross-version merge key.

## 14. Rollback strategy

Phase 1B ingestion would be additive-only: a new table plus a new dataset
version row. Rollback = delete the dataset version's rows (and, if needed,
downgrade the additive migration). Because nothing in this contract feeds
scoring, a rollback cannot change any suitability score, rank, or candidate
status.

## 15. Phase 1B ingestion boundary

**In scope for a future Phase 1B:** an additive `wetland_inventory_features`
table + migration, a read-only loader following the structural-loader
conventions, a versioned dataset row, and coverage reporting.

**Explicitly not done in Phase 1B-0 (this phase):** no table, no migration, no
PostGIS load, no CLI subcommand, no API endpoint, no frontend layer.

## 16. Scoring boundary

`wetland_inventory` has **no** scoring role today and acquires none from this
document. Any future use requires, separately and explicitly:

1. a policy version bump with a documented weight or screening rule;
2. a stated justification for treating a *surveyed* (non-designated) wetland as
   a siting constraint — which is a policy judgement, not a data fact;
3. an explicit statement that it does not silently duplicate the existing
   `UM901` protected-area screen.

Until all three exist, the layer stays `NOT_IMPLEMENTED` for scoring.

---

## Lifecycle labels

| Aspect | Label |
| --- | --- |
| Source dataset | `PLANNED` |
| Contract verification | `LIVE_VERIFIED` (local file inspection, 2026-07-23 — see the validation report) |
| Database ingestion | `NOT_IMPLEMENTED` |
| Scoring integration | `NOT_IMPLEMENTED` |

## Verification tooling

`ingestion/src/waste_equity_ingestion/wetland_inventory_contract.py` —
read-only, offline, no database access, no geometry repair, no file mutation.
Takes the shapefile path as an argument:

```bash
python -m waste_equity_ingestion.wetland_inventory_contract /path/to/Wetlands_Inventory_2,704_EPSG5186.shp
```

Exit code `0` = PASS or PASS_WITH_WARNINGS, `1` = FAIL, `2` = the path could not
be inspected. Output is a sanitized JSON summary: file names, column names,
declared types, and aggregate counts only — no per-record attribute values and
no local filesystem paths.
