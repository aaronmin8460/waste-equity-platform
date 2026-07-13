# RCIS Reporting Geography Audit

Reference year: **2024**. Reference source: RCIS (Korea Environment Corporation
Resource Circulation Information System) regional waste generation/treatment PIDs
`NTN007`, `NTN008`, `NTN018`, `NTN022`. Canonical geography: SGIS 2024. All counts
and values below were measured against the live local database at Alembic head
`0011` and re-derived offline from the stored sanitized raw RCIS responses using
the production parser (`rcis_waste_contract.parse_pid_response`) and the
deterministic crosswalk (`rcis_region_crosswalk.RegionCrosswalk`). No value in
this document is estimated, generated, or allocated.

## 1. Executive summary

SGIS represents seven large Gyeonggi cities at the administrative-district (구)
level — 20 child regions — while RCIS reports those same cities as seven
city-level records. The current crosswalk classifies the seven city records
`REQUIRES_AGGREGATION` and the RCIS waste ingestion rejects them from normalized
writes. Consequently the 20 child districts carry SGIS boundaries and SGIS
population but **no** district-level RCIS waste value, and the waste-generation
and per-capita-waste maps render generic `데이터 없음` for all 20.

These are **missing observations caused by a reporting-geography mismatch**, not
numeric zeros and not (for the seven cities) source omissions. RCIS *does* report
each of the seven cities once per PID, with real values.

The fix is additive and metric-scoped: introduce an explicit **RCIS waste
reporting geography** that keeps native SGIS regions untouched. Population,
facility-burden, and native boundary browsing continue to use native SGIS
geography. Waste-generation and per-capita-waste use RCIS-compatible reporting
geography, in which the seven cities appear **once each** with a deterministic
`ST_Union` of their SGIS child boundaries and the official source-native city
value. Seoul stays autonomous-district level; Incheon stays county/district
level; ordinary Gyeonggi cities/counties stay at their native level.

The city statistic itself is **not aggregated** — it is the source-native RCIS
city total copied verbatim. Only the display geometry (union of child boundaries)
and the per-capita **denominator** (sum of child SGIS populations) are derived,
and both are labelled as derived.

## 2. Current native SGIS geography (unchanged by this work)

`regions` at Alembic `0011`, boundary vintage 2024:

| Level | Count |
| --- | --- |
| SIDO | 3 (서울특별시, 인천광역시, 경기도) |
| SIGUNGU | 79 (서울 25, 인천 10, 경기 44) |

`regional_population` 2024: 82 rows (3 SIDO + 79 SIGUNGU), exactly one row per
region. Each of the 20 child districts has exactly one 2024 SGIS population row
(verified — see §7).

## 3. Current RCIS reporting geography

RCIS regional waste PIDs identify regions by Korean name pairs only
(`CITY_JIDT_CD_NM` sido, `CTS_JIDT_CD_NM` sigungu); no numeric code. Capital-region
coverage for 2024:

- Seoul: 25 autonomous districts, all exact-matched to SGIS.
- Incheon: 10 counties/districts, all exact-matched (2024 structure, `미추홀구`);
  plus `인천 경제청` (Incheon Free Economic Zone office), which is not a canonical
  administrative region.
- Gyeonggi: 24 ordinary cities/counties exact-matched, **plus the seven cities
  below reported at city level**.

## 4. The exact seven cities and their exact 20 child districts

| RCIS city (source-native) | Reporting code (minted) | SGIS child districts (code · name) |
| --- | --- | --- |
| 경기 수원시 | `KR-RCISRG-3101` | 31011 장안구 · 31012 권선구 · 31013 팔달구 · 31014 영통구 |
| 경기 성남시 | `KR-RCISRG-3102` | 31021 수정구 · 31022 중원구 · 31023 분당구 |
| 경기 안양시 | `KR-RCISRG-3104` | 31041 만안구 · 31042 동안구 |
| 경기 부천시 | `KR-RCISRG-3105` | 31051 원미구 · 31052 소사구 · 31053 오정구 |
| 경기 안산시 | `KR-RCISRG-3109` | 31091 상록구 · 31092 단원구 |
| 경기 고양시 | `KR-RCISRG-3110` | 31101 덕양구 · 31103 일산동구 · 31104 일산서구 |
| 경기 용인시 | `KR-RCISRG-3119` | 31191 처인구 · 31192 기흥구 · 31193 수지구 |

Total: 7 reporting cities, 20 child districts (고양시 has no SGIS `31102`; its three
children are 31101/31103/31104). The `KR-RCISRG-` namespace cannot be mistaken for
an SGIS code (`KR-SGIS-`); the numeric suffix is the shared 4-digit SGIS prefix of
the member districts, used only to make the platform code stable and traceable. It
is a **minted platform reporting-region code**, not an SGIS `adm_cd` and not an
RCIS code (RCIS provides no code).

## 5. Current ingestion behavior

`rcis-waste-ingest` (transformation `rcis-waste-capital-region-v1`) maps each
in-scope RCIS name pair to a canonical SGIS region. The seven cities resolve to
`REQUIRES_AGGREGATION` (`rcis_region_crosswalk.py:132-142`) because SGIS splits
them into 구 records; the ingestion counts them as `rejected` and never writes a
normalized row (`rcis_waste_ingestion.py:383-385`). Reconciliation against the
last ingestion run (run 233, all four PIDs, 2024):

- rows_received (in-scope) = 263, rows_inserted = 234, rows_rejected = 29.
- Per-PID normalized rows written: NTN007 = 59, NTN008 = 59, NTN018 = 57,
  NTN022 = 59 (total 234).

## 6. Current API and frontend behavior

- API: `/api/v1/regions/boundaries?level=SIGUNGU` serves all 79 native SIGUNGU
  boundaries; `/api/v1/waste-statistics` serves the 234 normalized rows;
  `/api/v1/equity/waste-per-capita` derives per-capita on the same native regions.
  No endpoint serves the seven city-level records.
- Frontend: every metric renders on the **same** hardcoded SIGUNGU geometry
  (`fetchBoundaries()` pins `level=SIGUNGU`); only the value join changes per
  metric. For waste-generation and per-capita-waste, the 20 child districts have
  no joined value, so `MapView` colors them `NO_DATA_COLOR` and the popup reads
  `데이터 없음 (no served value)`.

## 7. Complete PID-by-region coverage matrix (2024, capital region)

Measured offline from the stored raw responses with the production parser and
crosswalk (script in §10):

| PID | source rows | grand-total regions | in-scope (capital) | EXACT_NATIVE_MATCH | COARSER_REPORTING (7 cities) | UNMATCHED_REGION_LABEL | AMBIGUOUS | INVALID_NUMERIC | parse-rejected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| NTN007 | 10,374 | 229 | 66 | 59 | 7 | 0 | 0 | 0 | 0 |
| NTN008 | 10,374 | 229 | 66 | 59 | 7 | 0 | 0 | 0 | 0 |
| NTN018 |  7,755 | 218 | 64 | **57** | 7 | 0 | 0 | 0 | 0 |
| NTN022 |  4,712 | 230 | 67 | 59 | 7 | 1 (`인천 경제청`) | 0 | 0 | 0 |

Reconciliation: in-scope 66+66+64+67 = **263** (= run rows_received); rejected
7+7+7+8 = **29** (= run rows_rejected); exact 59+59+57+59 = **234**
(= run rows_inserted). Every count matches the database exactly.

Source-native city generation values (톤/년) that will populate
`reporting_region_waste_statistics` (verbatim, not aggregated):

| City | NTN007 (생활) | NTN008 (사업장비배출) | NTN018 (사업장배출시설계) | NTN022 (건설) |
| --- | ---: | ---: | ---: | ---: |
| 수원시 | 359,693.7 | 64,171.5 | 133,331.022 | 870,909.9 |
| 성남시 | 299,171.9 | 65,164.6 | 186,940.577 | 1,375,691 |
| 안양시 | 147,268.5 | 30,037.8 | 182,318.261 | 887,993 |
| 부천시 | 243,044.2 | 67,915.3 | 236,741.806 | 550,921.1 |
| 안산시 | 231,179.3 | 51,629.8 | 684,717.532 | 442,982.5 |
| 고양시 | 451,322.5 | 503,651.2 | 810,534.487 | 1,669,110.9 |
| 용인시 | 256,460.1 | 108,336 | 1,110,471.875 | 1,035,586.8 |

7 cities × 4 PIDs = **28** reporting-region waste rows.

## 8. The exact NTN018 two-row discrepancy

NTN018 (`1-나. (시군구) 사업장배출시설계폐기물 발생량` — emission-facility business
waste) writes 57 normalized rows, two fewer than the other PIDs' 59. The two
missing regions are **exact-match native regions**, not cities:

| Region | SGIS code | NTN007 | NTN008 | NTN018 | NTN022 | Classification |
| --- | --- | :-: | :-: | :-: | :-: | --- |
| 인천광역시 옹진군 | KR-SGIS-23520 | ✓ | ✓ | **✗** | ✓ | `SOURCE_NOT_REPORTED` |
| 경기도 연천군 | KR-SGIS-31550 | ✓ | ✓ | **✗** | ✓ | `SOURCE_NOT_REPORTED` |

Source evidence (SQL over the stored raw NTN018 payload, §10): `옹진군` and `연천군`
appear **42 rows each** in the NTN007 category matrix and **0 rows** in the NTN018
payload. They are absent from the NTN018 source response entirely — not present
with a blank quantity, not rejected by the parser, not a mapping failure. 옹진군 is
a remote island county and 연천군 a rural border county; neither reports
emission-facility business waste in 2024. This is an **official source omission**,
a distinct cause from the seven-city reporting mismatch, and it must continue to
render as a precise `SOURCE_NOT_REPORTED` no-data state for the
`INDUSTRIAL_FACILITY` stream only (both regions have data for the other three
streams). This fix does **not** invent a value for them.

## 9. Distinguishing the no-data causes

Every no-data region visible on the current waste map falls into exactly one of:

| Cause | Regions | Meaning | This fix |
| --- | --- | --- | --- |
| `COARSER_REPORTING_GEOGRAPHY` | 20 child districts of the 7 cities | RCIS reports the parent city, not the child; SGIS has the child | Replaced by 7 city reporting polygons carrying the official city value |
| `SOURCE_NOT_REPORTED` | 옹진군, 연천군 (NTN018 only) | Region absent from that PID's source response | Preserved as a precise no-data reason; never zero-filled |
| `UNMATCHED_REGION_LABEL` | 인천 경제청 (NTN022 only) | Non-canonical entity (free-economic-zone office), no SGIS boundary | Remains excluded; not a map boundary |
| observed zero | none | A real 0 quantity from the source | n/a (not present in this data) |

No `AMBIGUOUS_REGION_LABEL`, `PSEUDO_REGION_EXCLUDED` (전국/합계/소계/총계 are
excluded pre-map), `INVALID_NUMERIC_VALUE`, or `MISSING_GRAND_TOTAL` cases exist in
the 2024 capital-region data.

## 10. SQL and commands used

Coverage and discrepancy were derived with:

- `docker compose exec -T database psql -U waste_equity -d waste_equity` over
  `regions`, `regional_population`, `regional_waste_statistics`,
  `raw_api_responses`, `ingestion_runs`, `suitability_*`.
- NTN018 omission check (raw payload):
  ```sql
  WITH raw AS (
    SELECT sanitized_response->'payload'->'data' AS data
    FROM raw_api_responses
    WHERE endpoint_identifier='wss/JsonApi/NTN018:year=2024'
    ORDER BY id DESC LIMIT 1)
  SELECT elem->>'CTS_JIDT_CD_NM', count(*)
  FROM raw, jsonb_array_elements(raw.data) elem
  WHERE elem->>'CTS_JIDT_CD_NM' IN ('옹진군','연천군') GROUP BY 1;   -- 0 rows
  ```
- Offline coverage matrix: re-parse each PID's latest stored raw response with
  `parse_pid_response` + `RegionCrosswalk` and classify every capital-region
  grand-total record. This is the same code path the ingestion uses, run against
  the persisted raw responses (no live API call).

## 11. Selected implementation architecture

Keep SGIS canonical regions unchanged; add an explicit metric reporting geography
in **three additive tables** (migration `0012`, never editing an applied
revision):

1. `waste_reporting_regions` — one row per derived RCIS reporting region (the 7
   cities). Fields: minted `reporting_region_code` (`KR-RCISRG-*`),
   `reporting_region_name`, source-native `rcis_sido_name`/`rcis_sigungu_name`,
   `reporting_geography_type = DERIVED_CITY_UNION`, `geometry_kind = DERIVED`,
   `derived_geometry_method = ST_UNION_OF_SGIS_CHILDREN`, `source_reporting_level =
   CITY`, boundary provenance (source id, reference period, target CRS,
   geometry hash, retrieved-at), `child_region_count`, and the derived
   MULTIPOLYGON(4326) geometry.
2. `waste_reporting_region_members` — child lineage (20 rows). `UNIQUE(child_region_id)`
   guarantees no child belongs to two reporting cities; FK to `regions.id`.
3. `reporting_region_waste_statistics` — the 28 source-native city waste rows,
   keyed by `reporting_region_id`, mirroring the quantity/provenance columns of
   `regional_waste_statistics` with the same non-negativity and accounting-basis
   check constraints. `UNIQUE(reporting_region_id, reference_year, source_pid,
   waste_category_name)`.

Build/backfill (`rcis-reporting-geography` ingestion command, offline & idempotent):
resolve each city's exact child set by SGIS code (visible failure on missing or
duplicate child), compute and validate the `ST_Union` (non-empty, valid,
EPSG:4326), upsert the reporting region + members, then re-parse the stored raw
responses and upsert the 28 city stats. The live `rcis-waste-ingest` is also
updated so future live runs write the city rows via the same shared writer.

API (new `waste-reporting` contract, existing endpoints unchanged): a
reporting-boundary endpoint returns the 59 native RCIS reporting regions + 7
derived cities (66 features) with native-vs-derived metadata and child lineage; a
reporting-statistics endpoint returns the city and native values with precise
availability reasons; a reporting per-capita endpoint divides the city numerator
once by the summed child population.

Per-capita denominator for a city = exact-decimal sum of its member SGIS child
populations (same reference year, exactly one row per child), exposed as a derived
city total with child lineage. Numerator source = RCIS (city level); denominator
source = SGIS (sum of children).

## 12. Rejected alternatives

- **Copy the city value into each child district** — violates data integrity
  ("Never copy a city-level RCIS value into each child district"); would
  triple/quadruple-count a single city total. Rejected.
- **Split the city value across children (equal / population-weighted)** — invents
  district-level observations RCIS never reported. Rejected.
- **Add nullable `reporting_region_id` + nullable `region_id` to
  `regional_waste_statistics`** — would put NULL-`region_id` rows into the table the
  suitability engine reads by `region_id` (`engine.py:569`, `:183`) and the
  facility-burden/per-capita joins read, risking silent behavior change to
  production suitability. A separate table fully isolates the city rows. Rejected in
  favor of separate tables.
- **Convert the whole platform to city-level geography** — destroys native SGIS
  granularity that population, facility-burden, and suitability depend on. Rejected.
- **Rebuild suitability against city geography** — an analytical-policy change
  explicitly out of scope; suitability must remain byte-for-byte unchanged.
  Rejected.

## 13. Known limitations

- The derived city polygon is a display geometry (union of official SGIS child
  boundaries); it is labelled `DERIVED` and must never be presented as a native
  SGIS region.
- The per-capita denominator is a derived city total (sum of SGIS children);
  labelled as such.
- `옹진군`/`연천군` remain genuine `SOURCE_NOT_REPORTED` for `INDUSTRIAL_FACILITY`;
  this is preserved, not filled.
- `인천 경제청` remains unmatched and off-map; it is not a canonical region.
- Only the four 2020-onward regional generation PIDs are in scope; facility PIDs
  and origin-to-destination flows are unaffected and out of scope.

## 14. Production impact assessment

- Migration `0012` is **purely additive** (three new tables, no column/constraint
  change to any existing table). Existing rows in `regions`, `regional_population`,
  `regional_waste_statistics`, `waste_treatment_facilities`, `structural_*`, and
  `suitability_*` are untouched.
- The suitability engine reads `regional_waste_statistics` by `region_id`; because
  the city rows live in a separate table, existing suitability runs (run 1, run 47)
  and all candidate rows/status counts remain byte-for-byte unchanged.
- The seven-city stats and reporting geometry are new data only; no production
  value is altered, only added.
- Deployment is application + additive migration + in-place backfill (the backfill
  reads only data already present in production: SGIS geometries and the stored raw
  RCIS responses). See `docs/RCIS_REPORTING_GEOGRAPHY_DEPLOYMENT.md`.
