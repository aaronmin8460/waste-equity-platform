# 내륙습지 목록 (Inland Wetland Inventory) — PostGIS Ingestion

**Phase:** Suitability 1B-1 (production PostGIS ingestion)
**Layer name:** `wetland_inventory`

## Lifecycle

| Aspect | Status |
| --- | --- |
| Contract verification | `LIVE_VERIFIED` (Phase 1B-0) |
| PostGIS ingestion | **`IMPLEMENTED_AND_LOCALLY_VERIFIED`** (2026-07-24) |
| Production ingestion (OCI/AWS) | `NOT_RUN` |
| Read-only API exposure | `NOT_IMPLEMENTED` |
| Frontend map exposure | `NOT_IMPLEMENTED` |
| Scoring / weight / exclusion integration | `NOT_IMPLEMENTED` |
| OCI deployment | `NOT_ATTEMPTED` |

This phase loads the verified inland-wetland shapefile into a **local** PostGIS
database. It changes **no** suitability score, weight, exclusion rule, candidate
rank, candidate status, or policy version, adds no API endpoint and no map layer,
and does not deploy anywhere.

## 1. Purpose and scope

Persist the 국립생태원 전국 내륙습지 inventory as a reproducible, versioned,
idempotent PostGIS load so a later phase (1B-2) can expose it read-only. Scope is
exactly: model + migration + loader + CLI + tests + local verification. Anything
that would score, rank, exclude, or publish is out of scope.

## 2. Source dataset

| Field | Value |
| --- | --- |
| Official dataset name | 국립생태원_내륙습지 공간데이터 및 속성정보_20220720 |
| Provider (제공기관) | 국립생태원 (National Institute of Ecology) |
| Official URL | <https://www.data.go.kr/data/15086410/fileData.do> (공공데이터포털 파일데이터 `15086410`) |
| Reference date | 2022-07-20 |
| Licence | 이용허락범위 제한 없음 (공공데이터포털, 확인일 2026-07-23) |
| Declared feature count | 2,704 |
| Source archive (ZIP) SHA-256 | `f9d77a74b942cad354e59ec093c39f0a2a33d14372829253bf29e1c80a2af196` |
| Read `.shp` SHA-256 | `1a0863886179dc3ea429cb9a4243452f5f0bda7a396511cc6f641cb8c632085f` |
| Source CRS | **EPSG:5186** (Korea 2000 / Central Belt 2010) |
| Source encoding | **UTF-8** (from `.cpg`) |
| Authoritative identifier | `CODE` |

The raw files are **local-only and Git-ignored**; nothing under
`data/raw/environment/wetland_inventory/` except its `README.md` is committed.
Provenance and the full observed schema are in
[WETLAND_INVENTORY_DATA_CONTRACT.md](WETLAND_INVENTORY_DATA_CONTRACT.md) and
[WETLAND_INVENTORY_VALIDATION_REPORT.md](WETLAND_INVENTORY_VALIDATION_REPORT.md).

## 3. Database schema

Migration **0018** (`20260723_0018_wetland_inventory_features.py`, revises 0017)
adds — additively, dropping and altering nothing — two tables and one data
source. Nothing is seeded; the 2,704 features are loaded by the CLI.

### `environmental_dataset_versions` — one row per ingested release

The environmental-layer counterpart of `structural_dataset_versions`, kept
separate because environmental layers are not structural/regulatory layers.
Release identity (and idempotency key) is:

```
uq_environmental_dataset_versions_release =
  (layer_name, provider_dataset_identifier, reference_date,
   source_checksum, transformation_version)
```

It records provider, official dataset name/URL, reference date, source archive +
`.shp` filenames and checksums, source CRS/encoding, source and normalized
geometry types, declared/total/accepted/rejected counts, transformation version,
licence note, the owning `ingestion_run_id`, per-file provenance (names +
checksums only), sanitized run metadata, and `is_active`.

### `environmental_wetland_inventory_features` — one row per wetland

MULTIPOLYGON / SRID 4326. Columns (per the task contract):

`id`, `dataset_version_id` (FK → `environmental_dataset_versions`),
`source_feature_id` (= `CODE`), `source_fid` (`FID`, metadata only),
`wetland_name`, `wetland_code`, `wetland_type`, `wetland_type_korea`,
`wetland_type_ramsar`, `reported_area_m2`, `source_longitude`,
`source_latitude`, `source_address`, `source_sido_name`, `source_sigungu_name`,
`source_eupmyeondong_name`, `source_ri_name`, `designation_note`,
`normalized_sido_code` (nullable), `normalized_sigungu_code` (nullable),
`geometry`, `geometry_area_m2`, `source_crs`, `transformation_version`,
`source_reference_date`, `source_checksum`, `feature_fingerprint`,
`raw_attributes` (JSONB), `created_at`.

**No score column. No statutory-protection boolean.** `designation_note` (`EXP`)
is stored verbatim and must never be read as legal status.

Constraints and indexes:

| Object | Purpose |
| --- | --- |
| `uq_wetland_inventory_features_version_source_id` (`dataset_version_id`, `source_feature_id`) | Idempotency key — `CODE` is unique within a release |
| `uq_wetland_inventory_features_version_fingerprint` (`dataset_version_id`, `feature_fingerprint`) | Geometry-derived identity guard |
| GiST on `geometry` | Spatial index (auto, via geoalchemy2) |
| btree `source_feature_id`, `wetland_code`, `dataset_version_id` | Identity / provenance lookups |
| btree `source_sido_name`, `source_sigungu_name` | Source-name lookups |

### `data_sources` row

`nie_wetland_inventory` — provider 국립생태원, dataset 내륙습지 공간데이터 및 속성정보,
frequency `STRUCTURAL` (수시 / 1회성). Distinct from every API source and from
`vworld_structural`.

## 4. Ingestion command (CLI)

```bash
waste-equity-probe wetland-inventory-ingest \
  --write \
  --source-shp "data/raw/environment/wetland_inventory/extracted/Wetlands_Inventory_2,704_EPSG5186.shp"
```

- `--source-shp` is **required** — no default path, no sample/mock fallback.
- `--dry-run` reads, validates, and normalizes without writing; `--write` loads.
- `--no-region-assignment` skips spatial SIDO/SIGUNGU code assignment.
- Output is a sanitized JSON summary (counts + identifiers only — no local paths,
  no per-record attribute values, no raw DBF dump). Exit code `0` on
  SUCCEEDED/PARTIAL, `1` on failure.

## 5. Transformation rules

Implemented in `ingestion/src/waste_equity_ingestion/wetland_inventory_ingestion.py`:

1. **Contract gate first.** Phase 1B-0 `validate_wetland_inventory` runs before
   any write. A `FAIL` status, a CRS other than EPSG:5186, an encoding other than
   UTF-8, a non-strict decode, or a missing required column aborts the run.
2. **Strict UTF-8 decode.** Korean text is read strictly; a decode failure
   aborts rather than substituting replacement characters.
3. **Identity.** `CODE` → `source_feature_id`/`wetland_code`; `FID` kept only as
   `source_fid` (it has a gap and is not a key).
4. **Verbatim source values.** `TYPE_KOREA` and `TYPE_RAMSA` are stored exactly
   as published — no case folding (`Tp`/`TP` are not merged), and the one
   anomalous `TYPE_KOREA` label (`하도습지`) is not corrected. Empty `RI_NM` and
   `EXP` are stored as `NULL`, never `""`. Every source column is preserved in
   `raw_attributes`. Source anomalies are surfaced as warnings, not fixes.
5. **Reported point is metadata.** `LONGITUDE`/`LATITUDE` are stored as
   `source_longitude`/`source_latitude`; they are never used as the geometry.
6. **Geometry.** The **source-CRS** geometry is validated strictly (empty /
   non-polygonal / invalid → rejected with a reason, never repaired), area is
   measured in EPSG:5186 metres (`geometry_area_m2`), then it is reprojected to
   EPSG:4326 with `always_xy=True` and promoted to `MultiPolygon`, canonicalized
   with `shapely.normalize`. The provider's `AREA` is kept separately in
   `reported_area_m2`.
7. **No topology repair.** `buffer(0)`, `make_valid`, `simplify`, `snap` are
   never called.
8. **Fingerprint.** `feature_fingerprint` = SHA-256 over the normalized stored
   geometry + release identity (`source_feature_id`, `source_checksum`,
   `reference_date`, `transformation_version`) — reproducible in any database and
   independent of surrogate ids.

### Reprojection self-intersection artifact (documented, not repaired)

Six of the 2,704 polygons are valid in EPSG:5186 but become **self-intersecting
after reprojection to EPSG:4326**, because they carry near-degenerate
micro-segments (consecutive source vertices as close as ~5.5 µm). The induced
error is sub-square-centimetre (0.000035–0.009 m²). Per AGENTS.md the official
boundaries are neither silently repaired nor dropped: the transformed geometry is
stored exactly as computed, and every affected `CODE` is named in the run report
(`post_transform_invalid_count = 6`). Validity is asserted on the **source**
geometry, not re-asserted after our own transform. Affected ids:
`13-358042-2-027`, `13-368112-2-002`, `14-357024-4-303`, `14-366073-2-054`,
`15-359014-2-009`, `15-359014-2-010`.

## 6. Idempotency

Release identity + `CODE` identity + `ON CONFLICT DO NOTHING` make re-runs safe.
The loader never truncates or deletes; a second run reuses the existing version
row and inserts nothing.

| Run | inserted | skipped | rejected |
| --- | --- | --- | --- |
| First (empty table) | 2704 | 0 | 0 |
| Second (identical) | 0 | 2704 | 0 |

## 7. Provenance

Each run writes an `ingestion_runs` row (`source_id = nie_wetland_inventory`,
started/completed, status, rows received/inserted/rejected, reference period,
transformation version) and updates `dataset_freshness`. On success the release
row records both checksums, CRS, encoding, counts, and sanitized run metadata. A
failure sets the run `FAILED` with the error category/message — never silent.

## 8. Local validation results (2026-07-24)

Local PostGIS (`postgis/postgis:16-3.4`, compose service `database`), Alembic at
head `0018`. First run then idempotent second run:

| Check | Result |
| --- | --- |
| First-run insert | 2704 inserted / 0 skipped / 0 rejected, version created |
| Second-run insert | 0 inserted / 2704 skipped / 0 rejected, version reused |
| Row count | 2704 |
| Distinct `source_feature_id` | 2704 |
| Distinct `wetland_code` | 2704 |
| Distinct `feature_fingerprint` | 2704 |
| Null / empty geometry | 0 / 0 |
| Geometry SRID | 4326 (single value) |
| Geometry type | `ST_MultiPolygon` (single value) |
| `raw_attributes` present | 2704 |
| `designation_note` populated | 35 (unchanged from the 1B-0 finding) |
| `source_ri_name` NULL (preserved empty) | 336 |
| `normalized_sido_code` assigned | 224 |
| `normalized_sigungu_code` assigned | 225 |
| Provenance | CRS 5186→4326, UTF-8, `wetland-inventory-v1`, ref 2022-07-20, both checksums stored |
| `post_transform_invalid_count` | 6 (reported, stored as transformed) |
| Migration round-trip | `0018 → 0017 → 0018`, single head, wetland objects only |

### Baseline unchanged (before ≡ after)

| Table | Count |
| --- | --- |
| `structural_protected_features` total | 20895 |
| `structural_protected_features` UM901 | 6 |
| `structural_features` | 88252 |
| `structural_line_features` | 2971494 |
| `suitability_candidates` | 95786 |
| `suitability_analysis_runs` | 2 |

No wetland row was written to any `structural_*` table; there is no FK from the
inventory table to any `structural_*` table.

## 9. Region assignment

Assigned **spatially** against the official `regions` boundaries already in
PostGIS (EPSG:4326), by representative-point-in-boundary at both SIDO and SIGUNGU
level (`region_assignment = SPATIAL_OFFICIAL_BOUNDARIES`). The inventory is
nationwide but the platform stores only capital-region (Seoul/Incheon/Gyeonggi)
boundaries, so 224 features receive a SIDO code and 225 a SIGUNGU code; the rest
keep `NULL` normalized codes with their **source names preserved** — never a
string-only assignment. If no official boundary is present the loader records
`DEFERRED_NO_OFFICIAL_BOUNDARIES`, warns, and does not block.

## 10. Relationship to UM901 (습지보호지역) — kept separate

`UM901` is the **statutory** 습지보호지역 layer (legal effect, includes coastal
연안습지) stored in `structural_protected_features`. This inventory is a
**surveyed** set of inland wetlands and confers no legal status. They are
different datasets and are never merged:

- the inventory has its own table and its own `data_sources` row;
- there is no foreign key or view joining the two;
- `EXP` is never read as legal protection (only 35 of 2,704, and 1 of 232 in the
  capital region, carry any note);
- existing `UM901` data is not modified, re-clipped, or re-versioned.

Overlap does not imply equivalence — see the validation report §8 (the 한강하구
polygon is geometrically identical to the 김포 UM901 polygon, yet the two remain
distinct records with distinct meaning).

## 11. Rollback

```bash
cd backend && alembic downgrade 0017   # drops both wetland tables + the data source
```

The downgrade removes only the objects added by 0018 (both tables, their indexes
and constraints, and the `nie_wetland_inventory` data source plus its runs and
freshness row). It touches no `structural_*`, `suitability_*`, or `regions` data.
Because nothing here feeds scoring, a rollback cannot change any score, rank, or
candidate status. To reload after a downgrade+upgrade, re-run the CLI `--write`.

## 12. Known limitations

- **Capital-region boundaries only.** 224/225 features get normalized codes; the
  remaining ~2,479 keep `NULL` codes with source names. Full-nationwide
  normalized codes require nationwide official boundaries the platform does not
  yet store.
- **Six reprojection self-intersections** (§5) are stored as transformed by
  design; a consumer that needs OGC-valid 4326 geometry must treat them
  explicitly rather than assume validity.
- **Local only.** No production run and no deployment (§lifecycle).
- **Migration 0017 widening.** 0017 (Phase 1A) declared
  `implementation_difficulty` as `VARCHAR(40)` while its own seed contains a
  50-character value; SQLite ignored the limit so unit tests passed, but the
  migration aborted on PostgreSQL with `StringDataRightTruncation`. It is widened
  to `VARCHAR(80)` at the source (model + migration). Because 0017's DDL is
  transactional and always rolled back, no database ever held the table at width
  40, so fixing in place is safe. This is what let 0017 (and therefore 0018)
  apply on PostgreSQL for the first time.

## 13. Phase 1B-2 boundary (next, not in this phase)

Phase 1B-2 may add a **read-only** API endpoint and/or a separate map layer over
this table. It must keep the layer **distinct from UM901**, must not infer legal
status, and must not add any scoring role. Any future scoring use requires a
separate, explicit policy-version review (contract §16) — it is not authorized by
ingestion.

## 14. Production deployment boundary

Not attempted. Deploying to OCI/AWS is a separate, later step and is explicitly
out of scope for Phase 1B-1.
