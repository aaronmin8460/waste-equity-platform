# Waste Equity Ingestion

This directory contains API probes and explicit one-shot production ingestion
jobs. Phase 2.1 implements SGIS canonical geography and total population
ingestion; Phase 2.2 adds RCIS regional waste generation/treatment ingestion for
the four documented sigungu generation PIDs; Phase 2.3 adds RCIS waste-treatment
facility ingestion for the six documented facility PIDs; Phase 2.4 geocodes
facility addresses through the VWorld geocoder and resolves multi-district-city
facilities by point-in-polygon.

Current constraints:

- Do not create fake official datasets.
- Do not silently fall back to fixtures after live API failure.
- Do not print or save credentials.
- Do not print the RCIS `USRID` value configured as `RCIS_USER_ID`.
- Do not print or store SGIS access-token values.
- Save only sanitized samples under `data/samples/`.
- Production ingestion runs only through an explicit CLI command; there is no
  scheduler in this phase.

## Package Dependency Direction

Production ingestion imports the backend package's SQLAlchemy models and
database settings. This keeps one database model layer in the repository. Local
development should install both packages into the same Python 3.11+ environment
or set `PYTHONPATH=backend/src:ingestion/src`.

## Environment Variables

See [API Authentication](../docs/API_AUTHENTICATION.md).

The package loads `.env` with `python-dotenv` from the current directory or a
parent project directory when the file exists. Credential values are never
printed or saved.

SGIS production ingestion requires:

- `SGIS_CONSUMER_KEY`
- `SGIS_CONSUMER_SECRET`
- `DATABASE_URL` for write mode

RCIS waste ingestion requires:

- `RCIS_API_KEY` (the only RCIS secret)
- `RCIS_USER_ID` (non-secret `USRID` request configuration; never printed)
- `DATABASE_URL` (used in both dry-run and write; dry-run reads the SGIS
  canonical geography loaded in Phase 2.1 to map regions)

## Probe Semantics

- Missing credentials exit distinctly from remote API failure.
- HTTP status and provider-level result codes are both validated.
- Samples are marked `LIVE_VERIFIED` or `FIXTURE_ONLY`.
- Fixture tests validate response-shape handling only and must not be presented as real public data.

## SGIS Production Ingestion

Selected reference year: `2024`.

Reason: live validation found 2025 boundaries are available, but 2025 SGIS
population returns provider `errCd=-100` for Seoul, Incheon, and Gyeonggi-do.
2024 is the latest year where population and administrative boundaries both
return successful responses across the full 수도권 scope.

Official endpoints:

- Authentication: `OpenAPI3/auth/authentication.json`
- Population: `OpenAPI3/stats/population.json`
- Administrative boundary: `OpenAPI3/boundary/hadmarea.geojson`

Coordinate handling:

- Source CRS: EPSG:5179, SGIS UTM-K meter coordinates.
- Target CRS: EPSG:4326 in PostGIS.
- Geometry is normalized to MultiPolygon.
- Invalid polygonal geometry is repaired only with deterministic
  `shapely.make_valid` polygonal extraction; unrepaired invalid or empty
  geometry fails the run.

Coverage:

- Seoul special city plus 25 autonomous districts.
- Incheon metropolitan city plus the 10 counties/districts valid in SGIS 2024
  data. The 2026 Incheon administrative restructuring is not forced onto 2024
  data.
- Gyeonggi-do plus 44 SGIS-native 5-digit child areas. Some large-city
  administrative districts appear because SGIS natively returns them at this
  level; they are preserved as SGIS `SIGUNGU` level and are not collapsed into
  city/county records.

Dry run:

```bash
PYTHONPATH=../backend/src:src \
  python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 --scope capital-region --dry-run
```

Write against a local database:

```bash
PYTHONPATH=../backend/src:src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 --scope capital-region --write
```

Write through Docker Compose:

```bash
docker compose --profile ingestion run --rm ingestion \
  sgis-ingest --year 2024 --scope capital-region --write
```

Idempotency policy:

- `regions` is unique by canonical region code and validity start date.
- `regional_population` is unique by region, reference year, source, and
  population definition.
- `region_code_map` is unique by canonical region code and validity start date.
- Raw responses are append-only by exact sanitized response hash and endpoint.
  SGIS includes fresh transaction metadata in each live data response, so
  identical normalized data can still create new raw response rows. Normalized
  regions and population rows must not duplicate.
- Existing normalized rows may be updated with the latest ingestion-run
  provenance.

SGIS region codes are stored as SGIS codes only. Later RCIS and VWorld phases
must build reviewed cross-source mappings; Phase 2.1 leaves cross-source review
status as `NEEDS_REVIEW`.

## RCIS Waste Production Ingestion (Phase 2.2)

One-shot production ingestion of regional waste generation and treatment
statistics from the RCIS waste-statistics OpenAPI (source id `waste_statistics`,
endpoint `/sds/JsonApi.do`).

### PIDs, official form names, and waste streams (2024, 2020-onward schema era)

| PID | Official form name (`result[0].TITLE`) | Waste stream | Grand-total label |
| --- | --- | --- | --- |
| `NTN007` | 2-나-1). (시군구) 생활(가정)폐기물 발생량 | `HOUSEHOLD` | `총계` |
| `NTN008` | 2-나-2). (시군구) 사업장비(非)배출시설계폐기물 | `BUSINESS_NON_FACILITY` | `합계` |
| `NTN018` | 1-나. (시군구) 사업장배출시설계폐기물 발생량 | `INDUSTRIAL_FACILITY` | `총계` |
| `NTN022` | 1-나. (시군구) 건설폐기물 발생량 | `CONSTRUCTION` | `합계` |

Only the `YEAR >= 2020` schema era is implemented. Years `<= 2019` are rejected
with an unsupported-schema-era error; they are never parsed with the 2020+
transformation. `NTN008` carries an extra `WSTE_S_CODE_NM` sub-category column
that the other PIDs do not; each PID's required fields are validated explicitly.

### Row grain

One normalized row per `(region, reference_year, source_pid)` — the region-level
**grand total across all waste categories** for that PID's waste stream. The
grand-total row is the one whose waste-type group is a total marker
(`총계`/`합계`) and whose major/detail category fields are the `EMPTY`
placeholder. This is stricter than the `EMPTY` placeholder alone because each
region also carries a memo re-breakdown line (`음식물류 폐기물 분리배출` for
NTN007/008, `기타` for NTN022) that is `EMPTY` at major/detail level but is not
the grand total. The uniqueness key is
`(region_id, reference_year, source_pid, waste_category_name)`.

Deeper waste-category detail rows, treatment-actor splits (`PUB_`/`SELF_`/`COM_`
public/self/consigned), and pseudo-total rows (`전국`/`합계`/`소계`/`총계`
regions) are retained only inside the sanitized raw response — never as
canonical rows.

### Quantity fields (unit 톤/년, from `result[0].DUNIT` metadata)

| Column | Source field | Direct/derived |
| --- | --- | --- |
| `generation_quantity` | `WSTE_QTY` | direct |
| `recycling_quantity` | `TOT_RECY_QTY` | direct |
| `incineration_quantity` | `TOT_INCI_QTY` | direct |
| `landfill_quantity` | `TOT_FILL_QTY` | direct |
| `other_treatment_quantity` | `TOT_ETC_QTY` | direct |
| `total_treatment_quantity` | recycling+incineration+landfill+other | **derived** (no direct total column; `total_treatment_is_derived = true`) |

Quantities are stored as exact `NUMERIC(20,6)` decimals (no binary float). Blank
and null cells are parsed explicitly and distinguished from zero; invalid
numeric strings and negative values are rejected. `treatment_reconciliation_difference`
= generation − derived total; observed to be exactly `0` for all regions because
the origin-based treatment splits reconcile to generation by construction
(tolerance `1.0` 톤 absorbs documented rounding).

### Accounting basis

`ORIGIN_BASED_TREATMENT_OUTCOME`: the treatment fields describe how the reporting
region's own generated waste was treated by method. They are **not** facility
throughput, imported/exported waste, transferred waste, local treatment
responsibility, or proof of burden shifting. No origin-to-destination flow field
exists; the platform must not infer interregional movement.

### Geographic mapping

RCIS responses use Korean region names only (`CITY_JIDT_CD_NM` sido,
`CTS_JIDT_CD_NM` sigungu) — no numeric code. `rcis_region_crosswalk` maps the
name pair to the SGIS 2024 canonical regions with exact deterministic rules
only; there is no fuzzy matching. Original RCIS names are preserved; normalized
forms are used only for candidate matching. Live-verified 2024 coverage:

- **Seoul**: 25/25 autonomous districts exact-matched.
- **Incheon**: 10/10 counties/districts exact-matched using the 2024 structure
  (`미추홀구`); the 2026 restructuring is not forced onto 2024 data. RCIS also
  reports `인천 경제청` (Incheon Free Economic Zone office), which is not a
  canonical administrative region — reported as unmatched and excluded.
- **Gyeonggi-do**: 24/44 SGIS regions exact-matched. The seven large cities that
  SGIS represents at the administrative-district (구) level — `고양시`,
  `부천시`, `성남시`, `수원시`, `안산시`, `안양시`, `용인시` — are reported by
  RCIS at the **city** level. A city-level record cannot be split across SGIS
  districts without a documented rule, so it is classified
  `REQUIRES_AGGREGATION` and excluded; the 20 corresponding SGIS 구 regions are
  reported as missing RCIS records. No record is aggregated or split silently.

Unmatched, ambiguous, and city-vs-district-mismatch records are reported and
excluded from publishable normalized metrics. Matched RCIS name pairs are stored
on the shared `region_code_map` crosswalk row (`rcis_sido_name`,
`rcis_sigungu_name`, `cross_source_review_status = RCIS_NAME_MATCHED`),
preserving the existing SGIS provenance on that row.

### Counter definitions

Counters are scoped to the capital region and are directly comparable because
one source grand-total record maps to at most one normalized database row:

- `rows_received`: in-scope (capital-region) source grand-total records observed.
- `rows_inserted` / `rows_updated`: normalized rows inserted / updated (exact
  matches). A re-run with identical official data updates nothing; provenance
  (retrieved-at, run id, raw-response id) is refreshed only when material data
  changes.
- `rows_rejected`: in-scope records excluded from writes
  (`REQUIRES_AGGREGATION` + unmatched + ambiguous).
- `parse_rejected_nationwide` (per PID, diagnostic): nationwide structural parse
  rejects (blank/negative/duplicate grand total); `0` for all four PIDs in 2024.

### CLI

```bash
# Dry-run: live RCIS reads, validates all four PIDs, maps regions, reports
# unmatched/reconciliation, writes nothing.
PYTHONPATH=../backend/src:src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli rcis-waste-ingest \
  --year 2024 --scope capital-region --dry-run

# Write:
PYTHONPATH=../backend/src:src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli rcis-waste-ingest \
  --year 2024 --scope capital-region --write
```

Options: `--year` (required), `--scope capital-region` (required), one of
`--dry-run`/`--write` (required, mutually exclusive), `--pid` (comma-separated
allowlist within the four documented PIDs), `--request-delay` (seconds between
PID requests; default respects the 100 calls/minute quota),
`--fail-on-unmatched`. API keys and user IDs are never accepted as CLI
arguments. Unsupported PIDs, unsupported year schema, missing/duplicate
execution mode, and unsupported scope are rejected.

Dry-run makes real RCIS requests and never falls back to local samples. Like the
SGIS dry-run, it creates no `ingestion_runs` audit row and performs no
normalized writes.

### Docker one-shot

```bash
docker compose --profile ingestion run --rm ingestion \
  rcis-waste-ingest --year 2024 --scope capital-region --dry-run

docker compose --profile ingestion run --rm ingestion \
  rcis-waste-ingest --year 2024 --scope capital-region --write
```

### Idempotency

Normalized rows are unique by `(region_id, reference_year, source_pid,
waste_category_name)`. Re-running the same 2024 write creates no duplicate
waste-statistics rows and no duplicate crosswalk rows; the normalized row count
stays stable and unchanged records are not counted as inserts or updates. As
with SGIS, RCIS embeds fresh transaction metadata (`result[0].callId`) in each
response, so an identical re-run appends new sanitized raw-response rows (dedup
is by exact response hash) while normalized rows remain idempotent. Dataset
freshness (`waste_statistics`) is updated only after a successful run; failed
runs are marked `FAILED`, retain a sanitized error category, roll back partial
writes, and do not update `last_success_at`.

Verified 2024 live run: first run received 263 / inserted 234 / updated 0 /
rejected 29; identical second run received 263 / inserted 0 / updated 0 /
rejected 29; final normalized table count 234 (NTN007 59, NTN008 59, NTN018 57,
NTN022 59). Reconciliation mismatches: 0.

## RCIS Facility Production Ingestion (Phase 2.3)

One-shot production ingestion of waste-treatment facilities from the six RCIS
facility PIDs (source id `waste_statistics`, endpoint `/sds/JsonApi.do`) into
`waste_treatment_facilities`.

### PIDs, categories, and archetypes (2024, 2020-onward era)

| PID | Official form name | Category | Archetype | Ownership |
| --- | --- | --- | --- | --- |
| `NTN031` | 1-가. 공공소각 | `PUBLIC_INCINERATION` | PROCESSING | PUBLIC |
| `NTN032` | 1-나. 공공기타 | `PUBLIC_OTHER` | PROCESSING | PUBLIC |
| `NTN033` | 1-다. 공공매립 | `PUBLIC_LANDFILL` | LANDFILL | PUBLIC |
| `NTN040` | 4-가. 중간처분(소각) | `PRIVATE_INTERMEDIATE_INCINERATION` | PROCESSING | PRIVATE |
| `NTN043` | 5. 최종처분 | `PRIVATE_FINAL_DISPOSAL` | LANDFILL | PRIVATE |
| `NTN046` | 8-가. 재활용처리(중간) | `PRIVATE_RECYCLING` | PROCESSING | PRIVATE |

### Row grain and identity

One row per reported facility line. `DUNIT` is blank; units are per field and
per PID from the official guide: capacity `FAC_CAP`/`ABILITY_QTY` 톤/일,
throughput `DISP_QTY` (processing) / `FILL_QTY_TON` (landfill) 톤/년, landfill
`TOT_FILL_CAP`/`RMN_FILL_CAP` ㎥, `TOT_FILL_AREA` ㎡. Public PIDs give facility
name (`FAC_NM`); private PIDs give company name (`COM_NM`) + operator (`CEO_NM`).
PID-specific fields (costs, energy, landfill gas, waste-type descriptors) are
preserved verbatim in `source_fields` (JSONB).

Facilities have no official id, and a single site can report multiple process
lines sharing every business attribute (name, address, SEQ, sub-type) and
differing only in quantities. The reviewed identity key is therefore
`(source_pid, reference_year, source_row_index)`, where `source_row_index` is the
stable 0-based position of the facility among the real facility rows in the PID
response. This is idempotent for identical published data.

Aggregate rows (`전국`/`합계` national and per-sido `소계`, with a `N개소` count
in `SEQ` and a null facility name) are excluded.

### Accounting basis

`FACILITY_LOCATION_BASED_THROUGHPUT` — quantities describe activity at the
facility's own location. This is distinct from the Phase 2.2 origin-based
regional accounting and must never be conflated with it (see
METRIC_FEASIBILITY_MATRIX); it is not proof of waste movement.

### Geographic mapping

Reuses the Phase 2.2 deterministic name crosswalk. Unlike the aggregate regional
rows, in-scope facilities are always stored, with a `region_mapping_status`:

- `EXACT_MATCH`: RCIS sigungu maps to one SGIS canonical region; `region_id` set.
- `REQUIRES_GEOCODE`: facility in an SGIS multi-district city (RCIS reports the
  city); `region_id` NULL pending geocoding.
- `UNMATCHED` / `AMBIGUOUS`: non-canonical or ambiguous label; `region_id` NULL.

Geocoding is deferred to a later VWorld phase; the nullable POINT `geometry`
column is added now but never populated here.

Verified 2024 live run: 651 in-scope facilities (552 `EXACT_MATCH`, 99
`REQUIRES_GEOCODE`, 0 unmatched/ambiguous), by sido 서울 38 / 인천 164 / 경기
449. First run inserted 651; identical second run inserted 0 / updated 0; final
count 651. Freshness (`waste_statistics`) updates only on success; failed runs
are visible and roll back.

### CLI and Docker

```bash
python -m waste_equity_ingestion.cli rcis-facility-ingest \
  --year 2024 --scope capital-region --dry-run
python -m waste_equity_ingestion.cli rcis-facility-ingest \
  --year 2024 --scope capital-region --write
docker compose --profile ingestion run --rm ingestion \
  rcis-facility-ingest --year 2024 --scope capital-region --write
```

Options mirror `rcis-waste-ingest`: `--year`, `--scope capital-region`,
`--dry-run`/`--write`, `--pid` (allowlist within the six facility PIDs),
`--request-delay`. Credentials are environment-only.

## VWorld Zoning Production Ingestion (Phase 2.5B-1)

One-shot production ingestion of the 용도지역 (zoning) structural spatial layers
UQ111–UQ114 from **official bulk shapefiles** into the versioned structural
schema (`structural_dataset_versions`, `structural_features`). This is a
bulk-file loader: it requires **no `VWORLD_API_KEY`** and never falls back to
`data/samples` probe files or any synthetic data.

Authorization: this project is conducted with a government partner; prior
authorization for use, local storage, transformation, and analytical processing
of the relevant VWorld/government spatial datasets has been confirmed by the
project owner (see `docs/DEVELOPMENT_PHASES.md`, Phase 2.5B).

### Zoning layers

| Layer | Code | Category | Korean name |
| --- | --- | --- | --- |
| `LT_C_UQ111` | UQ111 | `URBAN` | 도시지역 |
| `LT_C_UQ112` | UQ112 | `MANAGEMENT` | 관리지역 |
| `LT_C_UQ113` | UQ113 | `AGRICULTURAL_FOREST` | 농림지역 |
| `LT_C_UQ114` | UQ114 | `NATURAL_ENV_CONSERVATION` | 자연환경보전지역 |

### Source files (Git-ignored; never committed)

Place the official ZIP archives or extracted shapefile sets under the per-region
directories (all under the ignored `data/raw/` tree):

- `data/raw/vworld/zoning/seoul/`
- `data/raw/vworld/zoning/incheon/`
- `data/raw/vworld/zoning/gyeonggi/`

Each shapefile must ship its `.shp`, `.shx`, `.dbf`, and `.prj` sidecars. The
source CRS is read from the `.prj`/metadata and rejected when missing or not in
the supported allowlist (EPSG:4326/2097/5174/5179/5185–5188; LSMD zone bulk is
natively EPSG:5186, 일부 2097). Korean DBF attributes are decoded explicitly
(default `cp949`); undecodable values are recorded and rejected, never silently
replaced. Geometry is validated as polygon/multipolygon, single polygons are
normalized to MultiPolygon (counted), invalid/point/line geometry is rejected
(no silent topology-changing repair), and accepted geometry is transformed to
EPSG:4326 for PostGIS.

If the official archives are absent the command reports exactly which archives
and directories are required plus the write command to run afterwards, and it
does **not** claim success or mark the subphase complete.

### CLI

```bash
# Dry run: validate archives, sidecars, attributes, CRS, geometry, and coverage
# without any database write.
PYTHONPATH=src:../backend/src \
  python -m waste_equity_ingestion.cli vworld-zoning-ingest \
  --source-path data/raw/vworld/zoning --reference-date 2026-05-20 \
  --scope capital-region --dry-run

# Write: same validation, then transactional persistence (partial writes roll
# back; a dedicated ingestion_runs row records the outcome).
PYTHONPATH=src:../backend/src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli vworld-zoning-ingest \
  --source-path data/raw/vworld/zoning --reference-date 2026-05-20 \
  --scope capital-region --write
```

Options: `--source-path` (default `data/raw/vworld/zoning`), `--reference-date`
(required, `YYYY-MM-DD`), `--scope capital-region` (required), one of
`--dry-run`/`--write` (required), `--source-encoding` (default `cp949`). No API
keys or credentials are accepted as CLI arguments.

### Docker one-shot

The `ingestion` service mounts `./data` read-only at `/app/data`, so the default
`--source-path` resolves inside the container:

```bash
docker compose --profile ingestion run --rm ingestion \
  vworld-zoning-ingest --reference-date 2026-05-20 --scope capital-region --dry-run
```

### Coverage and idempotency

The result reports per-region and per-layer feature counts and a
region-by-layer completeness matrix over Seoul, Incheon, and Gyeonggi-do that
distinguishes `EVALUATED_WITH_FEATURES`, `EVALUATED_ZERO_FEATURES` (an honest
zero, e.g. no 관리지역 in urban Seoul), `NOT_EVALUATED`, `SOURCE_MISSING`,
`VALIDATION_FAILURE`, and `OFFICIAL_SOURCE_UNAVAILABLE`. Zero features is never
treated as not-evaluated, and a layer legitimately absent in a jurisdiction does
not fail the run.

An optional Git-ignored `source_manifest.json` in the source root records
official-source availability: a layer the official provider does not publish for
a region (e.g. Seoul UQ112–UQ114, which VWorld does not distribute) is
classified `OFFICIAL_SOURCE_UNAVAILABLE` (with evidence) rather than the
`SOURCE_MISSING` used for an unexpectedly absent local file. When every target
region is evaluated, every present file validates, and each gap is a documented
`OFFICIAL_SOURCE_UNAVAILABLE`, the run reports
`COMPLETE_FOR_AVAILABLE_SOURCES`.

Live result (2026-07-12): the 9 official LSMD ZIPs (release `202606`, reference
date `2026-06-01`, source EPSG:5186 → EPSG:4326) ingested **88,252** features
(88,790 received, 538 invalid polygons rejected — reported, never repaired);
Seoul UQ112–114 `OFFICIAL_SOURCE_UNAVAILABLE`; identical second write inserted 0
(idempotent). All stored geometries are SRID 4326 MultiPolygon, 0 invalid.

A `structural_dataset_versions` row identifies one reproducible official release
(provider dataset + reference date + combined source checksum + transformation
version); previous versions are preserved, never overwritten. Features are
unique per `(dataset_version_id, feature_fingerprint)`, where the fingerprint is
a deterministic hash of normalized geometry plus relevant official attributes
(the provider feature id is not used as identity because its cross-refresh
stability is unverified). An identical second write reuses the version and
inserts zero features; `dataset_freshness` (`vworld_structural`) is updated only
after a successful complete write, and failed runs roll back and remain visible.

### Tests

```bash
# Pure loader/contract tests (synthetic pyshp fixtures, no database):
PYTHONPATH=src:../backend/src pytest tests/test_vworld_zoning_contract.py \
  tests/test_vworld_zoning_loader.py
# PostGIS-backed persistence/idempotency tests:
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  PYTHONPATH=src:../backend/src pytest tests/test_vworld_zoning_persistence.py
```

## Protected and Road Structural Layers (Phase 2.5B, framework)

The versioned structural schema is reused beyond zoning by a generalized loader
(`structural_layer_ingestion.py`) driven by a layer registry
(`structural_layers.py`):

- **Protected/restricted polygon layers** (`vworld-protected-ingest`) persist to
  `structural_features`: mandatory UD801 개발제한구역, UM710 상수원보호구역,
  UM901 습지보호지역, UF151 산림보호구역, WGISNPGUG 국립자연공원, UO101
  교육환경보호구역, UO301 국가유산 지정/보호구역; optional (flagged) UM221
  야생생물보호구역, UQ162 도시자연공원·녹지.
- **Road/transport line layers** (`vworld-roads-ingest`) persist to the
  `structural_line_features` table (MULTILINESTRING/4326) — line geometry is
  **not** forced into the polygon table: STDLINK 표준노드링크 (preferred bulk),
  N3A0020000 도로중심선, MOCTLINK (API cross-check only). Road-class/lane/width/
  node/restriction attributes are preserved; geometric proximity never proves
  truck accessibility.

Same contract as zoning: bulk-file loader (no API key, no sample fallback),
`.prj` CRS read and validated against the allowlist, transform to EPSG:4326,
polygon→MultiPolygon / line→MultiLineString normalization, deterministic
fingerprint idempotency, versioned dataset releases, coverage matrix over
Seoul/Incheon/Gyeonggi (COMPLETE_WITH_FEATURES / COMPLETE_ZERO_FEATURES /
SOURCE_MISSING / VALIDATION_FAILURE / NOT_EVALUATED).

```bash
python -m waste_equity_ingestion.cli vworld-protected-ingest \
  --source-path data/raw/vworld/protected --reference-date YYYY-MM-DD \
  --scope capital-region --dry-run   # then --write
python -m waste_equity_ingestion.cli vworld-roads-ingest \
  --source-path data/raw/vworld/roads --reference-date YYYY-MM-DD \
  --scope capital-region --write
```

Official bulk source files require manual download (browser/솔루션-mediated);
see `docs/PHASE_2_5B_INGESTION_STATUS.md` for the exact per-layer checklist and
destination directories. As of the 2026-07-12 recovery run no structural data
had been ingested (all layers `SOURCE_MISSING`).

## Probe Commands

Probe commands remain available for Phase 0 source validation:

```bash
python -m waste_equity_ingestion.cli airkorea --save-sample
python -m waste_equity_ingestion.cli sgis --save-sample
python -m waste_equity_ingestion.cli kma --save-sample
python -m waste_equity_ingestion.cli vworld --save-sample
python -m waste_equity_ingestion.cli waste-statistics

# Phase 0.7 RCIS PID discovery: probe the documented target PIDs (default)
# or an explicit list, and save sanitized truncated samples per PID/year.
python -m waste_equity_ingestion.cli waste-statistics-discovery --year 2023 --save-sample
python -m waste_equity_ingestion.cli waste-statistics-discovery --pids NTN007,NTN018 --year 2024

# Phase 2.5A VWorld structural-layer contract audit: smallest possible live
# probes (WFS + 2D Data API + NED ownership/land-use) across three regional
# bounding boxes; saves sanitized samples. Audit tooling only — not ingestion.
python -m waste_equity_ingestion.cli vworld-structural-audit --save-sample
python -m waste_equity_ingestion.cli vworld-structural-audit --service wfs,data
```

Discovery respects the documented provider quota (100 calls/minute, 3,000 calls/day) with an inter-request delay, and classifies each PID as `LIVE_VERIFIED`, `NO_DATA_FOR_CONDITION` (`E099`), `PROVIDER_ERROR`, `SCHEMA_UNVERIFIED`, or `HTTP_ERROR`.

Run tests after dependencies are installed:

```bash
PYTHONPATH=../backend/src:src pytest tests
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
RUN_LIVE_SGIS=1 \
  PYTHONPATH=../backend/src:src pytest tests/test_sgis_integration.py
```

Phase 0.5 live result:

- SGIS: LIVE_VERIFIED, sample saved to `data/samples/sgis.live.json`.
- VWorld: LIVE_VERIFIED, sample saved to `data/samples/vworld.live.json`.
- Waste statistics: LIVE_VERIFIED for `wss/JsonApi/NTN001`, `YEAR=2024`; sanitized sample saved to `data/samples/waste-statistics.live.json`. This PID verifies the management-area table only, not waste generation or treatment quantities.
- AirKorea, KMA: CREDENTIAL_MISSING.

Phase 0.7 live result (2026-07-08):

- RCIS generation/treatment PIDs (`NTN007`, `NTN008`, `NTN018`, `NTN022`) and facility PIDs (`NTN031`, `NTN032`, `NTN033`, `NTN040`, `NTN043`, `NTN046`): LIVE_VERIFIED at sigungu granularity for 2023 and 2024; sanitized truncated samples saved as `data/samples/waste-statistics.<PID>.<YEAR>.live.json`.
- `NTN044`: SCHEMA_UNVERIFIED (single placeholder-like record).
- See `docs/API_CONTRACTS/waste_statistics.md` for the full PID contract.

## Phase 2.4 VWorld Facility Geocoding

Geocode `waste_treatment_facilities` addresses through the official VWorld
geocoder and resolve multi-district-city facilities by point-in-polygon:

```bash
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
PYTHONPATH=src:../backend/src \
python -m waste_equity_ingestion.cli vworld-geocode --dry-run --limit 5

DATABASE_URL=... PYTHONPATH=src:../backend/src \
python -m waste_equity_ingestion.cli vworld-geocode --write
```

Rules enforced by the job (see `docs/API_CONTRACTS/vworld.md`):

- The request address is the RCIS sido/sigungu prefix plus `ADDR`; the attempt
  ladder tries ROAD, PARCEL, then a simplified form of each.
- Coordinates come only from provider `OK` responses; `NOT_FOUND`/`ERROR`
  keeps `geometry` NULL with `geocode_status='FAILED'` (the review queue).
- `GEOCODED_MATCH` requires point-in-polygon agreement with the RCIS sido,
  the RCIS city name, and the `level4AC` legal-dong sido prefix.
- `EXACT_MATCH` region assignments are never changed; point-in-polygon
  disagreements are recorded in `geocode_note` for review.
- Idempotent: the stored `geocode_request_address` is the built canonical
  address, so an identical re-run makes zero API calls and zero row changes;
  `--retry-failed` re-attempts prior failures.

Live result (2026-07-09, after Phase 2.3 data): 547/651 geocoded, 97/99
`REQUIRES_GEOCODE` resolved, 104 failures queued for review, zero
point-in-polygon disagreements with exact name matches.

Live integration test:

```bash
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
RUN_LIVE_VWORLD=1 \
  PYTHONPATH=../backend/src:src pytest tests/test_vworld_geocoding_integration.py
```
