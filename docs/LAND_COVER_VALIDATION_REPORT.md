# 세분류 [2025] 토지피복지도 — Contract Validation Report

**Phase:** Suitability land-cover 1B · **Date:** 2026-07-25 · **Verification:** `LIVE_VERIFIED` (local file inspection)

Every value below was measured against the local, Git-ignored copy of the
환경부/EGIS 세분류 (Level-3) 토지피복지도, 2025 edition, for Seoul, Incheon, and
Gyeonggi. Nothing here is estimated, sampled, or copied from portal metadata
unless the row says so. The contract these values are checked against is
[LAND_COVER_DATA_CONTRACT.md](LAND_COVER_DATA_CONTRACT.md).

**No data was ingested.** No database write, no migration, no PostGIS load, no API
endpoint, no frontend change, and no suitability score, weight, exclusion,
ranking, status, candidate row, policy version, or existing run changed.

**Reproduce with:**

```bash
waste-equity-probe land-cover-contract-validate \
  --source-root data/raw/environment/land_cover/2025_lv3 \
  --report-json <local-output-path>
```

The console/JSON output is sanitized: region counts, file names, column names,
declared types, aggregate counts, ascii class codes, and one aggregate checksum
only — no local filesystem path, no per-feature payload, no raw Korean row dump.

---

## 1. Source discovery

Map-sheet shapefiles discovered per region (AppleDouble `._*`, `.DS_Store`, and
hidden directories ignored):

| Region | Tile directories | Real `.shp` files |
| --- | --- | --- |
| Seoul (서울) | 130 | **130** |
| Incheon (인천) | 346 | **346** |
| Gyeonggi (경기) | 1,641 | **1,641** |
| **Total** | **2,117** | **2,117** |

All three required regional directories are present. The counts match the
manually-checked source state exactly.

## 2. File-set integrity

| Check | Result |
| --- | --- |
| Shapefile sets with all required sidecars (`.shx/.dbf/.prj`) | **2,117 / 2,117** |
| Missing required sidecars | **0** |
| Zero-byte source files | **0** |
| Unreadable source files | **0** |
| `.cpg` sidecars present | **0** (encoding taken from the DBF LDID byte — §5) |
| Optional sidecars present per sheet | `.xml`, `.xlsx`, `.xsd` (imagery metadata) on all 2,117 |
| AppleDouble `._*` counted as source | **never** |
| DBF vs SHX record-count mismatches | **0** |

## 3. Map-sheet identity and duplication

The map-sheet identifier (도엽번호) is the `.shp` stem (e.g. `37705097`),
cross-checked against the directory-name token (`SG05_37705097_20251113`).

| Check | Result |
| --- | --- |
| Distinct map-sheet ids | 2,013 |
| Duplicate map-sheet ids | 101 |
| — within a single region | **0** |
| — across regions (border sheets) | **101** |
| Cross-region duplicates that are **byte-identical** | **101** |
| Cross-region duplicates with **conflicting** `.shp` checksums | **0** |

Border sheets legitimately appear under more than one province: a 1:5,000 sheet
straddling a 시도 boundary is filed under each province it touches. **No source
file is deleted or merged.** The recommended ingestion policy (contract §7) keys
features by `(map-sheet id + geometry fingerprint)`, loads byte-identical
duplicates once, and **halts on a conflicting-checksum duplicate for human
review** rather than silently merging.

### 3.1 The 137-vs-130 Seoul discrepancy

- Seoul directory: **130** shapefiles.
- Seoul map-sheet ids that **also** appear under Incheon/Gyeonggi (border sheets):
  **71**.

A prior web search reportedly showed **137** Seoul results. The local evidence
shows Seoul border sheets are also filed under adjacent provinces, which is a
**candidate** explanation for the 137→130 gap. **The original 137-item web
listing is not part of the local evidence**, so the exact reconciliation cannot be
proven locally and is recorded as **UNRESOLVED** — no explanation is invented.

## 4. CRS

| Property | Observed |
| --- | --- |
| `.prj` files | 2,117 |
| Distinct `.prj` byte-contents | **1** (all byte-identical) |
| `.prj` CRS name | `PCS_ITRF2000_TM` |
| Declared datum | **ITRF2000** (`D_ITRF_2000`), GRS 1980 ellipsoid |
| Projection | Transverse Mercator; CM 127.0°, lat origin 38.0°, FE 200 000 m, FN 600 000 m, scale 1.0, metre |
| Resolved EPSG | **5186** |
| Resolution method | **exact TM-parameter match** (`epsg_from_prj`) |
| `pyproj.CRS.to_epsg()` (authority) | **None** |
| `CRS.from_wkt(prj).equals(EPSG:5186)` | **False** |

**EPSG:5186 is confirmed from the projection parameters, not the datum name.** The
`.prj` names the ITRF2000 datum rather than Korea 2000, so PROJ's authority-based
`to_epsg()` returns `None` and `CRS.equals(5186)` is `False`. The Korea 2000 datum
(KGD2002) is realized as ITRF2000 at epoch 2002.0, so the two are the same
projected CRS family; the platform already treats this exact ITRF2000-central-belt
WKT as EPSG:5186 for the 표준노드링크 road source, and 5186 is on the loaders'
`SUPPORTED_SOURCE_EPSG` allowlist. A future transform must use `always_xy=True`
and must not gate on `CRS.equals`. **This is documented, not a defect.**

**Coordinate plausibility.** Combined source extent (EPSG:5186 m):
(86 464.7, 475 176.2, 275 137.3, 619 467.2). Transformed to WGS84: (125.704°E, 36.868°N, 127.857°E, 38.175°N) — within the South Korea envelope (`within_south_korea_envelope: true`).

## 5. Encoding (no `.cpg` — proven, not assumed)

| Property | Observed |
| --- | --- |
| `.cpg` present | **No** (0 of 2,117) |
| DBF language-driver byte (LDID) | **`0x4E`** on all 2,117 = Windows code page **949** (Korean, UHC; superset of EUC-KR) |
| Records strict-decoded under CP949 | **7,438,457 / 7,438,457** (undecodable: **0**) |
| Strict decode under EUC-KR | files OK: 2,117, failed: 0 |
| Strict decode under UTF-8 | files OK: 0, failed: 2,117 → **UTF-8 rejected** |
| Korean samples decoded | yes (e.g. `시가화건조지역`, `주거지역`, `단독주거시설`) |
| Observed compatible encoding | **CP949** |
| Exact provider-declared encoding string | **UNRESOLVED** (no `.cpg` shipped) |

CP949 is taken from the DBF LDID byte and **proven** by strict decoding every
record; a replacement character or decode-with-errors-ignore is treated as a
failure, never accepted. UTF-8 is actively disproven. **A future loader must be
given the explicit validated `cp949` encoding** — the inland-wetland UTF-8 default,
or any guess, would corrupt every Korean value.

## 6. Field schema

A **single** schema variant is observed across all 2,117 shapefiles; it matches
the authoritative 15-column schema (contract §5) exactly:

`L1_CODE`(C3) `L1_NAME`(C25) `L2_CODE`(C3) `L2_NAME`(C25) `L3_CODE`(C3)
`L3_NAME`(C25) `IMG_NAME`(C25) `IMG_DATE`(D8) `LU_INFO`(C25) `ETC_INFO`(C25)
`ENV_INFO`(C25) `FOR_INFO`(C25) `UD_INFO`(C25) `INX_NUM`(C8) `ANNO`(C254).

| Check | Result |
| --- | --- |
| Distinct schema variants | **1** |
| Files matching authoritative schema | **2,117** |
| Files missing a required class field | **0** |
| Files with extra fields | **0** |
| Files with type/width mismatch | **0** |
| Shapefile shape type | **Polygon** on all sheets |

## 7. Class dictionary and hierarchy

Observed class code↔name dictionaries, built by strict-decoding every record:

| Level | Distinct codes |
| --- | --- |
| L1 (대분류) | **7** |
| L2 (중분류) | **22** |
| L3 (세분류) | **41** |

Observed Level-1 (대분류) classes are the standard national seven-class scheme
(100 시가화건조지역, 200 농업지역, 300 산림지역, 400 초지, 500 습지, 600 나지,
700 수역). Codes/names are preserved verbatim; nothing is corrected.

| Integrity check | Result |
| --- | --- |
| One code → multiple names (conflict) | **0** |
| One name → multiple codes | 0 |
| Level-2/3 code under multiple parents (hierarchy conflict) | **0** |
| Malformed codes (not 3-digit numeric) | 0 |
| Null/blank required code/name | 0 (all six required fields) |

## 8. Geometry statistics

Every geometry was read and validated in the **source CRS**; nothing was repaired.

| Property | Observed |
| --- | --- |
| Total features | **7,438,457** |
| — Seoul | 1,013,095 |
| — Incheon | 601,765 |
| — Gyeonggi | 5,823,597 |
| Geometry types | Polygon 7,438,453 · MultiPolygon 4 |
| Null geometry | 0 |
| Empty geometry | 0 |
| **Invalid source geometry** | **14,244** (0.19% of features) |
| Invalid reasons (top) | Ring Self-intersection ×14,244 |
| Zero-feature shapefiles | **0** |

> **Note.** Border-sheet features are counted once per physical province copy, so
> the total includes the cross-region duplicate sheets (§3). De-duplication is an
> ingestion-phase concern, not a physical-file count.

**Invalid geometries are present and reported, never repaired.** They do not block
a `CONDITIONAL_GO`: a later ingestion must `MakeValid` them (and record the
correction), and must never silently drop or silently accept them.

## 9. Spatial extents and coverage

Per-region source extents (EPSG:5186 m), from the `.shp` headers:

| Region | Extent (minx, miny, maxx, maxy) |
| --- | --- |
| Seoul | (177 901.0, 536 180.4, 217 679.2, 569 477.9) |
| Incheon | (86 464.7, 481 393.4, 182 338.5, 567 159.9) |
| Gyeonggi | (144 422.1, 475 176.2, 275 137.3, 619 467.2) |
| Combined | (86 464.7, 475 176.2, 275 137.3, 619 467.2) |
| Implausible-extent files | **0** (far-western Incheon island sheets are within the generous 5186 envelope) |

**Coverage status: NOT_PROVEN.** Per-region extents are recorded and plausible for
the capital region, but proving no-gap coverage requires unioning tile footprints
and intersecting them with the platform's official 시도 boundaries in PostGIS.
That comparison is **deferred to the ingestion phase** (which loads into PostGIS);
no coverage claim is fabricated here. The evidence still missing is the
boundary-intersection proof, and it is the reason coverage is left unproven.

## 10. Provenance and checksums

| Field | Value |
| --- | --- |
| Official dataset | 세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map, 2025) |
| Provider | 환경부 환경공간정보서비스 EGIS |
| Acquisition scope | Seoul, Incheon, Gyeonggi |
| Reference **year** | 2025 (dataset label) |
| Acquisition (download) | local observation, files present as of 2026-07-25 (not a source reference date) |
| Imagery dates | `IMG_DATE` / directory date tokens — recorded as source evidence only (distinct values: 1) |
| Real source files hashed | 8,468 (2,117 × 4) (`.shp/.shx/.dbf/.prj`, AppleDouble/metadata excluded) |
| Real source total bytes | 8,198,946,332 (≈ 8.20 GB) |
| **Aggregate manifest SHA-256** | **`9b3e5d5e150015c3707f1df5b4f434155164ecbd41cbfc1162c3e7b27a9f2b5e`** |
| Per-region manifest SHA-256 | Seoul `3274ea27ea7d942d…` · Incheon `ce2d1cc847484045…` · Gyeonggi `623559c758dcccaf…` |

The aggregate checksum is computed deterministically over path-free relative
names (`<region>/<map-sheet><suffix>`) plus each file's size and SHA-256. **The
full per-file manifest is not committed** (it would expose local paths and bloat
the repo); only the sanitized aggregate digests above are recorded. Reference year
2025 is kept distinct from the acquisition/download observation and from the
imagery dates. No standalone licence receipt is committed; the licence must be
reconfirmed before ingestion.

## 11. Unresolved issues

| # | Issue | Impact | Disposition |
| --- | --- | --- | --- |
| 1 | Exact provider-declared **encoding** string (no `.cpg` shipped) | Cannot cite a provider-declared encoding artifact | `UNRESOLVED` — CP949 inferred from the DBF LDID byte and proven by strict decode |
| 2 | **137-vs-130** Seoul web/local gap | Cannot reconcile exactly | `UNRESOLVED` — border-sheet redistribution is a candidate, but the web listing is not local evidence |
| 3 | Full capital-region **coverage** | Cannot claim no-gap coverage | `NOT_PROVEN` — deferred to PostGIS boundary intersection at ingestion |
| 4 | **Licence** receipt not committed | Terms not reconfirmed | Must reconfirm EGIS/KOGL vector-download terms before ingestion |
| 5 | **CRS authority** (`to_epsg()` = None, `equals(5186)` = False) | Naïve resolvers would reject 5186 | Documented — resolve by TM parameters, transform `always_xy=True` |
| 6 | **Invalid source geometry** present | Ingestion must handle it | Reported; ingestion must `MakeValid`, never silently drop/accept |
| 7 | Cross-region **border-sheet duplicates** (101) | All **byte-identical**; 0 conflicting observed | Not an error — ingestion loads each once (policy §7); a future conflicting-checksum copy would halt for review |

Pre-existing, unrelated to this dataset:

| Issue | Status |
| --- | --- |
| `backend/alembic/versions/20260719_0016_suitability_critic_stability.py` fails `ruff format --check` | Pre-existing on `main`; not touched here (out of scope) |
| Backend PostGIS-tier tests skip without `TEST_DATABASE_URL` | Expected; Docker not required for this offline phase |

## 12. Recommendation

### CONDITIONAL_GO FOR THE LATER POSTGIS INGESTION PHASE

Blocking checks that **pass** on the real files:

- ✅ all three required regional directories present; **2,117** shapefile sets, all
  required sidecars, 0 zero-byte/unreadable/missing
- ✅ `.prj` resolves consistently to **EPSG:5186** from TM parameters (all 2,117
  byte-identical); no mixed/unresolved CRS
- ✅ encoding proven **CP949** from the DBF LDID byte; every record strict-decodes;
  UTF-8 disproven; Korean intact
- ✅ single 15-column schema across all sheets; all required class columns present
- ✅ 0 zero-feature files; 0 DBF/SHX mismatches
- ✅ class dictionaries built with zero code/name conflicts

Carried conditions (all recorded in the contract) that make this a
**CONDITIONAL_GO** rather than an unqualified GO:

1. **Licence** — reconfirm the EGIS/KOGL vector-download terms in writing.
2. **Explicit CP949** — the loader must be given the validated encoding; no `.cpg`
   ships and any guess corrupts Korean.
3. **CRS by parameters + `always_xy`** — never gate on `CRS.equals`.
4. **Duplicate policy** — byte-identical border sheets load once; conflicting
   copies halt for review.
5. **Geometry validity** — `MakeValid` the invalid source polygons and record the
   correction; never silently drop or accept them.
6. **PostGIS region assignment + coverage proof** happen at ingestion, not here.

**Scoring integration remains `NOT_IMPLEMENTED` and is out of scope for the
ingestion phase.**
