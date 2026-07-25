# 세분류 [2025] 토지피복지도 (Detailed / Level-3 Land Cover) — Data Contract

**Phase:** Suitability land-cover 1B (contract validation)
**Layer name:** `land_cover`
**Status:** source dataset `ACQUIRED_LOCALLY` · contract validation `LIVE_VERIFIED` · ingestion implementation `IMPLEMENTED_AND_TESTED` (foundation; full local load `NOT_RUN`) · scoring integration `NOT_IMPLEMENTED`. See `docs/LAND_COVER_INGESTION_FOUNDATION.md` (Phase 1B-LC1).

This document is the **contract** for the 환경부/EGIS 세분류 (Level-3) 토지피복지도,
2025 edition, for the Seoul Metropolitan Area: what the official source is, what
the local files actually contain, how a future ingestion would normalize them,
and — as importantly — where this phase stops. Observed values are recorded
separately in [LAND_COVER_VALIDATION_REPORT.md](LAND_COVER_VALIDATION_REPORT.md).

Nothing described here has been ingested. **No suitability score, weight,
exclusion rule, candidate rank, candidate status, policy version, suitability
run, API response, or frontend behaviour changes as a result of this document.**
This phase adds a read-only validator, tests, and documentation — no database
migration, no PostGIS write, no API endpoint, and no frontend change.

It reuses the pattern established by the inland-wetland contract
([WETLAND_INVENTORY_DATA_CONTRACT.md](WETLAND_INVENTORY_DATA_CONTRACT.md)) and the
environmental-layer architecture
([SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md](SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md),
layer `land_cover`, modality `vector_polygon`, lifecycle `PLANNED`).

---

## 1. Dataset identity

| Field | Value |
| --- | --- |
| Official dataset name | 세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map, 2025) |
| Provider (제공기관) | 환경부 환경공간정보서비스 EGIS (Ministry of Environment, Environmental Geographic Information Service) |
| Official portal | 환경공간정보서비스 EGIS <https://egis.me.go.kr> (토지피복지도 대/중/세분류 download) |
| Product level | 세분류 (Level 3, ~1:5,000 map-sheet tiling) |
| Reference **year** | **2025** (dataset label). A precise per-feature reference *date* is **not** asserted (see §11). |
| Acquisition scope | Seoul, Incheon, Gyeonggi (수도권) |
| Acquisition (download) | Local observation only; files present on the external drive as of 2026-07-25 |
| Distribution format | Per-map-sheet ESRI Shapefile (`.shp/.shx/.dbf/.prj`), one directory per sheet |
| Map sheets acquired | **2,117** (Seoul 130 · Incheon 346 · Gyeonggi 1,641) |
| Licence | KOGL / EGIS terms for the vector 토지피복지도 download. The **exact licence receipt is not committed** and must be reconfirmed before ingestion (§16). This is *not* the WMS-only display product, which would be NO-GO for analysis. |

The raw files are **local-only and Git-ignored**. They live on an external
drive exposed through the Git-ignored symlink
`data/raw/environment/land_cover/2025_lv3`; nothing under that path is committed,
copied into Git, or modified. The physical drive path is never hard-coded — the
validator takes the repository-relative source root as an explicit argument.

## 2. On-disk layout

Each map sheet is one directory named `SG05_<map-sheet>_<imagery-date>`, e.g.
`SG05_37705097_20251113`, containing:

| File | Role | Committed? |
| --- | --- | --- |
| `<map-sheet>.shp` / `.shx` / `.dbf` / `.prj` | the shapefile set | never |
| `2025_meta_<map-sheet>.xml` | per-sheet imagery metadata | never |
| `2025년_세분류토지피복지도_영상메타데이터.xlsx` | imagery metadata workbook | never |
| `토지피복지도_XML_Schema_Definition.xsd` | metadata schema | never |
| `._*`, `.DS_Store` | macOS AppleDouble / Finder artifacts | never — **always ignored** |

- **The map-sheet identifier (도엽번호)** is the `.shp` stem (e.g. `37705097`),
  which also appears as the middle token of the directory name. Both are read and
  cross-checked; a disagreement is reported, never silently reconciled.
- **No `.cpg` sidecar exists** anywhere in the distribution (§4).
- macOS AppleDouble files (`._*`) and `.DS_Store` are filesystem artifacts of the
  copy medium, **not** source files, and are excluded from every count, checksum,
  and read.

## 3. Source CRS

| Field | Value |
| --- | --- |
| `.prj` content | ESRI WKT `PROJCS["PCS_ITRF2000_TM", GEOGCS["GCS_ITRF_2000", DATUM["D_ITRF_2000", …]]]` |
| `.prj` byte-identity | All 2,117 `.prj` files are **byte-identical** (single SHA-256) |
| Projection | Transverse Mercator |
| Central meridian / latitude of origin | 127.0° / 38.0° |
| False easting / northing | 200 000 m / 600 000 m |
| Scale factor / units | 1.0 / metre, metre |
| Declared datum | **ITRF2000** (`D_ITRF_2000`, GRS 1980 ellipsoid) — *not named* Korea 2000 |
| Resolved EPSG | **5186** (Korea 2000 / Central Belt 2010) |
| Resolution method | **Exact TM-parameter match** via the shared `epsg_from_prj` helper |

**EPSG:5186 is confirmed from the projection *parameters*, never from a name.**
The seven defining TM parameters are exactly those of EPSG:5186. Two pieces of
evidence are recorded honestly rather than hidden:

- `pyproj.CRS.to_epsg()` returns **`None`** — PROJ's authority resolver will not
  map this WKT to an EPSG code, because the datum is declared as ITRF2000 rather
  than Korea 2000.
- `CRS.from_wkt(prj).equals(CRS.from_epsg(5186))` returns **`False`** for the same
  reason.

The Korea 2000 geodetic datum (KGD2002) **is realized as ITRF2000 at epoch
2002.0**, so an ITRF2000 TM with EPSG:5186's parameters is the same projected CRS
family; the platform already treats exactly this ITRF2000-central-belt WKT as
EPSG:5186 for the 표준노드링크 road source. EPSG:5186 is on the loaders'
`SUPPORTED_SOURCE_EPSG` allowlist.

**Ingestion requirement.** A Phase-later loader must resolve the CRS with the same
parameter-match helper and transform **EPSG:5186 → EPSG:4326 with
`always_xy=True`** — it must **not** gate on `CRS.equals`, and must **not** infer
the EPSG from the projection name alone. A `.prj` that resolves to any code other
than 5186, or a mix of CRS across sheets, is a hard failure.

## 4. Source encoding (no `.cpg` — proven, not assumed)

There is **no `.cpg` sidecar**, so the DBF attribute encoding must be established
from evidence, never guessed.

| Field | Value |
| --- | --- |
| `.cpg` present | **No** (0 of 2,117) |
| DBF language-driver byte (LDID, byte 29) | **`0x4E`** on every sheet = Windows code page **949** (Korean, UHC — a strict superset of EUC-KR) |
| Strict decode under CP949 | succeeds (Korean intact) |
| Strict decode under EUC-KR | also succeeds on the observed values (EUC-KR ⊂ CP949) |
| Strict decode under UTF-8 | **fails** — the bytes are not UTF-8 |
| Observed compatible encoding | **CP949** |
| Exact provider-declared encoding string | **UNRESOLVED** — no `.cpg` shipped; CP949 is taken from the LDID byte and *proven* by strict decode |

Korean class labels decode cleanly under CP949 (e.g. `시가화건조지역`, `주거지역`,
`단독주거시설`). A replacement character or a decode-with-errors-ignore result is
treated as a decode failure, never accepted.

**This is the opposite of the inland-wetland inventory**, whose `.cpg` declared
UTF-8. A land-cover loader must be given an **explicit, validated `cp949`** and
must reject a `.prj`-less/`.cpg`-less guess. CP949 is chosen (over EUC-KR) because
it strictly supersets EUC-KR and matches the LDID byte, so it stays safe even for
a future sheet carrying a Hangul syllable outside the EUC-KR subset.

## 5. Source schema (all 15 DBF columns)

A single schema variant is observed across all 2,117 shapefiles. `Required` means
"a later ingestion cannot proceed without it".

| # | Field | Type | Width | Inferred meaning | Required |
| --- | --- | --- | --- | --- | --- |
| 1 | `L1_CODE` | C | 3 | 대분류 (Level-1) class code | **Yes** |
| 2 | `L1_NAME` | C | 25 | 대분류 class name (Korean) | **Yes** |
| 3 | `L2_CODE` | C | 3 | 중분류 (Level-2) class code | **Yes** |
| 4 | `L2_NAME` | C | 25 | 중분류 class name (Korean) | **Yes** |
| 5 | `L3_CODE` | C | 3 | 세분류 (Level-3) class code | **Yes** |
| 6 | `L3_NAME` | C | 25 | 세분류 class name (Korean) | **Yes** |
| 7 | `IMG_NAME` | C | 25 | Source imagery identifier | No |
| 8 | `IMG_DATE` | D | 8 | Imagery acquisition date | No |
| 9 | `LU_INFO` | C | 25 | Land-use annotation | No |
| 10 | `ETC_INFO` | C | 25 | Miscellaneous annotation | No |
| 11 | `ENV_INFO` | C | 25 | Environmental annotation | No |
| 12 | `FOR_INFO` | C | 25 | Forestry annotation | No |
| 13 | `UD_INFO` | C | 25 | Urban-development annotation | No |
| 14 | `INX_NUM` | C | 8 | Map-sheet index number | No |
| 15 | `ANNO` | C | 254 | Free-text annotation | No |

Geometry: shapefile shape type **Polygon** on every sheet.

`IMG_DATE` is an **imagery** date. It is recorded as source evidence only and is
**never** used as the dataset reference date (§11). No survey/management/licence
field exists in the DBF; none is invented.

## 6. Class taxonomy (대·중·세분류)

Land cover uses a three-level hierarchical code system. Codes are 3-digit numeric
strings; the hierarchy is by prefix (a Level-2 code sits under a Level-1, a
Level-3 under a Level-2). The observed **Level-1 (대분류)** dictionary is the
standard national seven-class scheme:

| L1 code | L1 name |
| --- | --- |
| 100 | 시가화건조지역 (developed/built-up) |
| 200 | 농업지역 (agricultural) |
| 300 | 산림지역 (forest) |
| 400 | 초지 (grassland) |
| 500 | 습지 (wetland) |
| 600 | 나지 (barren) |
| 700 | 수역 (water) |

The observed **Level-2 (중분류)** dictionary — 22 classes, each mapping to a single
name, verified against the files — is the standard national scheme:

| L2 | Name | L2 | Name |
| --- | --- | --- | --- |
| 110 | 주거지역 | 310 | 활엽수림 |
| 120 | 공업지역 | 320 | 침엽수림 |
| 130 | 상업지역 | 330 | 혼효림 |
| 140 | 문화·체육·휴양지역 | 410 | 자연초지 |
| 150 | 교통지역 | 420 | 인공초지 |
| 160 | 공공시설지역 | 510 | 내륙습지 |
| 210 | 논 | 520 | 연안습지 |
| 220 | 밭 | 610 | 자연나지 |
| 230 | 시설재배지 | 620 | 인공나지 |
| 240 | 과수원 | 710 | 내륙수 |
| 250 | 기타재배지 | 720 | 해양수 |

Level-3 (세분류) expands these to **41** national classes. The exact observed
counts — **L1 = 7, L2 = 22, L3 = 41**, with **zero** code/name or hierarchy
conflicts — are recorded in the validation report; the full Korean L3 dictionary
is validated by the tool but not reproduced verbatim here to avoid a bulk
attribute dump.

**Preservation rule.** Class codes and names are stored **verbatim**. Spelling,
spacing, and capitalization are never "corrected". Conflict detection is
evidence-based, not corrective:

- one code mapped to more than one name → **conflict (hard failure)**;
- one name mapped to more than one code → recorded (non-fatal);
- a Level-3 (or Level-2) code appearing under more than one parent → **hierarchy
  conflict (hard failure)**;
- a code that is not a 3-digit numeric, or a null/blank required code/name →
  recorded.

## 7. Map-sheet identity and duplication

- **Identifier:** the map-sheet number (도엽번호) = the `.shp` stem, cross-checked
  against the directory-name token.
- **Within a region:** no map-sheet id repeats.
- **Across regions:** border sheets legitimately appear under more than one
  province (a 1:5,000 sheet straddling a 시도 boundary is filed under each
  province it touches). Each such duplicate id is classified as **byte-identical**
  (same `.shp` SHA-256 → the same sheet duplicated) or **conflicting** (different
  `.shp` SHA-256 → province-clipped copies of the same sheet). Exact counts are in
  the validation report.

**Duplicate policy for the ingestion phase (recommendation).** Key each feature by
`(map-sheet id + geometry fingerprint)`. A byte-identical duplicate sheet is
loaded once. A duplicate id whose `.shp` checksums **differ** is a genuine
conflict that must **halt ingestion for that sheet** for human review — never be
silently merged, de-duplicated, or auto-picked. No source file is ever deleted,
renamed, or merged.

### 7.1 The 137-vs-130 Seoul question

A prior web search reportedly returned **137** Seoul results; **130** Seoul
shapefiles were downloaded. From the local evidence, a subset of Seoul map-sheet
ids **also appear under Incheon/Gyeonggi** as border sheets, which is a plausible
candidate for the gap (border sheets filed under an adjacent province). **However,
the original 137-item web listing is not part of the local evidence**, so the
exact reconciliation cannot be proven locally and is recorded as **UNRESOLVED**
rather than explained by invention.

## 8. Region assignment (future ingestion)

The tiles are already grouped by province on disk, but border sheets belong to
more than one 시도. A later ingestion must assign region **geometrically** against
the platform's own official 시도 boundaries in PostGIS (the same boundaries the
structural loaders use), never by the folder name alone — consistent with the
wetland-inventory method. Source folder membership is retained as reported
provenance and disagreement is recorded, never overwritten.

## 9. Geometry normalization rules (future ingestion)

1. Read the source-CRS (EPSG:5186) geometry; validate strictly.
2. Reproject **EPSG:5186 → EPSG:4326** with `always_xy=True`.
3. Promote `Polygon` → `MultiPolygon` for a uniform stored type.
4. **Invalid source geometry exists** in this dataset (self-intersections/ring
   issues are normal for large detailed land-cover polygon sets). It is **counted
   and reported** by this phase, never repaired. A later ingestion must
   `MakeValid` (and record the correction) — it must **not** silently drop or
   silently accept invalid geometry.
5. Measure area in the **projected** source CRS (EPSG:5186, metres), never in
   degrees.
6. Do **not** buffer, simplify, snap, or merge geometry in this phase.

## 10. Suitability usage (context, deferred)

Land cover would contribute **actual land-use context** (built-up vs forest vs
water vs cropland vs wetland) beyond administrative zoning — most naturally as a
per-500 m-cell dominant-class / area-share statistic in the environmental
architecture's derived-per-cell tier. **No such statistic, weight, or exclusion
is created, proposed as active, or implied by this contract.**

## 11. Provenance requirements

- The reference **year** is **2025** (dataset label). It is kept strictly distinct
  from the **acquisition/download** (a local observation, files present as of
  2026-07-25) and from **imagery dates** (`IMG_DATE` / the directory date token,
  which describe the underlying imagery, not the dataset reference date). No
  precise source reference date is inferred from folder names, DBF update bytes, or
  filesystem timestamps.
- A single **aggregate manifest SHA-256** is computed deterministically over only
  the real shapefile-set files (`.shp/.shx/.dbf/.prj`), using **path-free relative
  names** (`<region>/<map-sheet><suffix>`), excluding AppleDouble and metadata
  files. Per-region sub-digests are also recorded. **The full per-file checksum
  manifest is never committed** (it would expose local paths and bloat the repo);
  only the sanitized aggregate digests are recorded, in the validation report.
- Provider/label are recorded from the project's Phase 1A environmental audit and
  the dataset title. The local files carry per-sheet imagery metadata
  (XML/XLSX/XSD) but **no standalone licence receipt is committed**; the licence
  must be reconfirmed before ingestion.

## 12. Coverage

Full capital-region coverage is **NOT proven** by this phase. Per-region source
extents (from the `.shp` headers) are recorded and are plausible for the capital
region, but proving no-gap coverage requires unioning tile footprints and
intersecting them with the platform's official 시도 boundaries in PostGIS —
deferred to the ingestion phase, which loads into PostGIS. No coverage claim is
fabricated.

## 13. Error handling and missing values

- A missing region directory, a missing required sidecar (`.shx/.dbf/.prj`), a
  zero-byte or unreadable file, an unresolved/mixed CRS, a strict-decode failure,
  a missing required class column, a code/name conflict, or a class hierarchy
  conflict is a **hard failure** — the run reports it and exits nonzero. There is
  no fallback to sample or synthetic data.
- Invalid/empty geometry, duplicate map sheets, schema-variant/extra-field
  deviations, malformed codes, and implausible extents are **reported** (they
  make the recommendation `CONDITIONAL_GO`), never silently fixed.
- Missing is never treated as zero or "safe".

## 14. Phase boundary

**In scope for this phase:** a read-only validation module under the ingestion
package, a CLI subcommand (`land-cover-contract-validate`), focused tests with
test-only fixtures, and this documentation.

**Explicitly out of scope (not done here):** no database table, no migration, no
PostGIS load, no API endpoint, no frontend layer, no scoring, and no change to any
suitability score, weight, exclusion, ranking, status, candidate row, policy
version, or existing suitability run. The layer stays `PLANNED` and unscored.

## 15. Scoring boundary

`land_cover` has **no** scoring role today and acquires none from this document.
Any future use requires, separately and explicitly: (1) a policy-version bump with
a documented weight or screening rule; (2) a stated justification for the chosen
per-cell land-cover statistic; and (3) confirmation it does not silently duplicate
the existing zoning (`용도지역`) screen. Until all three exist, the layer stays
`NOT_IMPLEMENTED` for scoring.

## 16. Carried conditions before any ingestion phase

1. **Licence reconfirmation** — confirm the EGIS/KOGL vector-download terms in
   writing (the WMS-only product is display-only and NO-GO for analysis).
2. **Explicit CP949** — the loader must be given the validated `cp949` encoding;
   the wetland UTF-8 default and any guess would corrupt every Korean value.
3. **Parameter-match CRS + `always_xy`** — resolve EPSG:5186 from TM parameters,
   transform with `always_xy=True`, never gate on `CRS.equals`.
4. **Duplicate policy** — byte-identical border sheets load once; conflicting
   copies halt for review (§7).
5. **Geometry validity** — `MakeValid` invalid source polygons and record the
   correction; never silently drop or accept them.
6. **PostGIS region assignment** and **coverage proof** are done at ingestion, not
   here (§8, §12).

---

## Lifecycle labels

| Aspect | Label |
| --- | --- |
| Source dataset | `ACQUIRED_LOCALLY` (Seoul/Incheon/Gyeonggi, Git-ignored) |
| Contract validation | `LIVE_VERIFIED` (local file inspection, 2026-07-25 — see the validation report) |
| Ingestion implementation | `IMPLEMENTED_AND_TESTED` (Phase 1B-LC1 foundation + controlled pilot — see `docs/LAND_COVER_INGESTION_FOUNDATION.md`) |
| Full local official load | `NOT_RUN` |
| Production load | `NOT_RUN` |
| API / map exposure | `NOT_IMPLEMENTED` |
| Scoring integration | `NOT_IMPLEMENTED` |

## Verification tooling

`ingestion/src/waste_equity_ingestion/land_cover_contract.py` — read-only,
offline, no database access, no geometry repair, no file mutation. Reuses the
inland-wetland contract patterns and the `epsg_from_prj` helper.

```bash
waste-equity-probe land-cover-contract-validate \
  --source-root data/raw/environment/land_cover/2025_lv3 \
  --report-json <local-output-path>
```

(Equivalently `python -m waste_equity_ingestion.land_cover_contract --source-root …`.)
Exit code `0` = PASS or PASS_WITH_WARNINGS, `1` = hard contract failure, `2` = the
source root could not be inspected. Output is a sanitized JSON summary — region
counts, file names, column names, declared types, aggregate counts, ascii class
codes, and one aggregate checksum only — with **no** local filesystem path, **no**
per-feature payload, and **no** raw Korean attribute dump.
