# 세분류 [2025] 토지피복지도 (Level-3 Land Cover) — PostGIS Ingestion Foundation

**Phase:** Suitability land-cover 1B-LC1 (scalable PostGIS ingestion foundation + controlled pilot)
**Layer name:** `land_cover`

## Lifecycle

| Aspect | Label |
| --- | --- |
| Source dataset | `ACQUIRED_LOCALLY` (Seoul/Incheon/Gyeonggi, Git-ignored) |
| Contract validation | `LIVE_VERIFIED` (see `docs/LAND_COVER_VALIDATION_REPORT.md`) |
| Ingestion implementation | `IMPLEMENTED_AND_TESTED` (schema, migration, loader, CLI, tests, pilot) |
| Full local official load | `COMPLETE` (Phase 1B-LC2, local dev DB only — see `docs/LAND_COVER_FULL_LOCAL_INGESTION_REPORT.md`: 6,901,309 canonical features, 2,013 map sheets, dataset_version 212, idempotent re-run) |
| Production load | `NOT_RUN` |
| API / map exposure | `NOT_IMPLEMENTED` |
| Scoring integration | `NOT_IMPLEMENTED` |

This phase builds the production-quality database schema, transformation
pipeline, bulk loader, CLI, and tests, and runs a **controlled read-only pilot**
against the official USB source plus a **synthetic PostGIS integration write**.
It deliberately does **not** perform the full persistent write of all 7,438,457
official features — that is a separate operational phase gated on the
GO/CONDITIONAL_GO/NO_GO recommendation below.

---

## 1. Phase scope

**In scope:** the additive migration and schema for future land-cover loads; a
reusable, bounded-memory transformation pipeline; a dry-run + guarded-write CLI;
deterministic map-sheet de-duplication; an explicit geometry-repair audit;
dataset-version and ingestion-run provenance; test-only synthetic fixtures; an
isolated PostGIS integration write; a controlled official-source dry-run; and a
performance + capacity report.

**Out of scope (not done here):** the full write of all 7,438,457 features; any
active partial release; OCI transfer/deploy; production migration; API, map, or
vector-tile endpoints; frontend; 500 m cell statistics; and any score, weight,
exclusion, ranking, candidate-status, policy-version, or derivation change. No
prior suitability run is touched.

---

## 2. Source dataset

| Field | Value |
| --- | --- |
| Official dataset | 세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map, 2025) |
| Provider | 환경부 환경공간정보서비스 EGIS |
| Acquisition scope | Seoul (130), Incheon (346), Gyeonggi (1,641) = 2,117 map-sheet shapefiles |
| Source features | 7,438,457 (Polygon 7,438,453 · MultiPolygon 4) |
| Invalid source geometries | 14,244 (~0.19%), all ring self-intersections |
| Duplicate map-sheet ids | 101 cross-region, byte-identical, 0 conflicting |
| Source CRS | EPSG:5186 (resolved by TM parameters; `.prj` names ITRF2000) |
| Source encoding | CP949 (no `.cpg`; DBF LDID byte `0x4E`; strict-decode proven) |
| Reference period | **2025** (year only) — no precise reference date is proven |
| Licence | EGIS/KOGL vector-download terms — **not yet reconfirmed in writing** (§"Licence") |
| Aggregate manifest SHA-256 | `9b3e5d5e150015c3707f1df5b4f434155164ecbd41cbfc1162c3e7b27a9f2b5e` |

The raw files live behind the Git-ignored symlink
`data/raw/environment/land_cover/2025_lv3`. The physical USB path is never
hard-coded; the source root is always an explicit argument.

---

## 3. Schema decision

Reuses the environmental release table `environmental_dataset_versions` (the same
table the inland-wetland loader uses) rather than inventing a competing generic
version table, and adds two land-cover-specific tables:

### `environmental_land_cover_map_sheets` — one row per canonical map sheet

Records the canonical `.shp` filename + checksum, **every** folder/region
occurrence (`source_regions` JSONB), the duplicate occurrence count and
classification, the source feature count, source bounds (EPSG:5186), CRS,
encoding, processing status, and the per-sheet accepted/repaired/rejected
tallies. The 101 byte-identical cross-region border sheets are represented here
as provenance (occurrence count 2, one canonical row) but their features are
loaded once. A conflicting-checksum duplicate never reaches this table — the
loader halts on it.

### `environmental_land_cover_features` — one row per normalized feature

Typed core columns (`l1/l2/l3_code`, `l1/l2/l3_name`, `img_name`, `img_date`,
`inx_num`, `anno`) **plus** a lossless `raw_attributes` JSONB holding all 15
source DBF columns verbatim (including the five `*_INFO` imagery-processing
fields). Korean labels, spacing, and capitalization are stored exactly as
published — never corrected. Geometry is `MULTIPOLYGON`/EPSG:4326;
`geometry_area_m2` is measured in EPSG:5186. A dedicated geometry-repair audit
records `source_geometry_valid`, `source_invalidity_reason`,
`geometry_repair_status`, `geometry_repair_method`, `discarded_component_count` /
`discarded_component_types`, and `source_area_m2` / `repaired_area_m2` /
`area_delta_m2`. **No score, weight, exclusion, rank, candidate-status, or policy
column exists**, and no scoring code reads these tables.

### Identity and indexes

- `uq_land_cover_map_sheets_version_sheet` = (`dataset_version_id`, `map_sheet_id`).
- `uq_land_cover_features_version_sheet_record` = (`dataset_version_id`,
  `map_sheet_id`, `source_record_index`) — stable per-sheet record identity.
- `uq_land_cover_features_version_fingerprint` = (`dataset_version_id`,
  `feature_fingerprint`) — geometry-derived identity guard.
- Kept deliberately lean for 7.4 M rows: the two unique indexes already serve the
  `(dataset_version_id[, map_sheet_id])` prefix lookups, so only `l3_code` gets a
  standalone btree; geoalchemy2 attaches the GIST spatial index on `geometry`.
- **Index build cost at scale:** the batched-COPY writer (§"Bulk-write strategy")
  fills an unindexed temp table and merges into the indexed target, so index
  maintenance happens once per batch at INSERT time. For the full 7.4 M load,
  dropping the non-essential btrees + GIST before the load and rebuilding them
  after is the faster path and is recommended in the operational phase.

---

## 4. Reference-period decision

The land-cover source has a defensible reference **year** (2025) but **no**
defensible precise reference **date**. No date is fabricated from the `SG05_…`
directory suffix, `IMG_DATE`, a DBF update byte, or a filesystem timestamp.

`environmental_dataset_versions` previously required a NOT-NULL `reference_date`.
Migration 0019 (§5):

- adds a NOT-NULL `reference_period` string (the identity component going
  forward);
- relaxes `reference_date` to **NULLABLE**;
- backfills every existing (wetland) row so `reference_period` = the ISO string
  of its `reference_date` (`'2022-07-20'`), preserving that `reference_date`
  exactly;
- re-keys the release-identity unique constraint from `reference_date` to
  `reference_period`, because a NULL `reference_date` cannot anchor a unique key.

Land cover is stored with `reference_period = "2025"` and `reference_date = NULL`.
The inland-wetland release is unchanged in meaning (its `reference_period` and
`reference_date` agree).

---

## 5. Migration

`backend/alembic/versions/20260725_0019_land_cover_features.py` — revision
**0019**, down_revision **0018**, single head. Additive and reversible:

- adds `reference_period`, relaxes `reference_date`, re-keys the release
  constraint (§4), with a data-preserving backfill;
- adds the `egis_land_cover` data source (STRUCTURAL / non-periodic);
- creates the two land-cover tables + their constraints and indexes;
- seeds **no** feature data.

**Downgrade** drops only the objects introduced here, deletes any `land_cover`
release rows (which exist only because of this loader) so the `reference_date`
NOT-NULL can be restored, and reverts the constraint. The
upgrade → downgrade → upgrade round-trip is covered by
`backend/tests/test_migration_land_cover_integration.py`, including the
reference-period backfill and existing-row survival.

---

## 6. Source and target CRS

Resolved from the `.prj` TM parameters with the shared `epsg_from_prj` helper —
**never** from the ITRF2000 datum name and **never** via `CRS.equals` (which is
`False` for this source). A sheet resolving to any EPSG other than 5186 is a hard
failure. Geometry is measured in EPSG:5186 (metres) **before** reprojection, then
transformed EPSG:5186 → EPSG:4326 with `always_xy=True` and promoted to
`MultiPolygon`.

---

## 7. CP949 handling

The DBF encoding is forced to strict `cp949` (DBF LDID byte `0x4E`; no `.cpg`
ships). The inland-wetland UTF-8 assumption is **not** reused — it would corrupt
every Korean label. A strict-decode error is a **hard failure** (the loader
refuses replacement characters and aborts) — verified by a test that feeds a
UTF-8-encoded sheet and confirms it is rejected rather than silently mis-decoded.

---

## 8. Duplicate map-sheet behaviour

Duplication is detected from the directory listing alone (cheap). For a selected
duplicate id the canonical copy is the deterministic first occurrence in
(region-order, dir-name) order; every occurrence is preserved in the map-sheet
`source_regions` provenance, and features are loaded once. A duplicate id whose
`.shp` checksums **differ** raises and halts — never merged, auto-picked, or
silently de-duplicated. Source files are never deleted, renamed, or rewritten.

**Region semantics:** a feature is **never** assigned a 시도 from its folder name
(border sheets span provinces). Folder membership is retained as reported
provenance only; feature-to-region materialization is deferred to a spatial
intersection against the official `regions` boundaries (see §"Coverage-proof
design").

---

## 9. Geometry-repair policy

For every feature, in the source CRS (EPSG:5186):

1. empty/null or non-polygonal source geometry → rejected with a reason;
2. valid geometry → promoted to `MultiPolygon` unchanged (`repair_status = "none"`);
3. invalid geometry → `source_invalidity_reason` recorded, then
   `shapely.make_valid` (`repair_status = "made_valid"`,
   `repair_method = "shapely.make_valid"`);
4. only polygonal components of the result are retained; a mixed
   `GeometryCollection`'s non-polygonal parts are counted + typed
   (`discarded_component_count` / `discarded_component_types`);
5. a record with **no** valid polygon remaining is rejected visibly;
6. `source_area_m2`, `repaired_area_m2`, `area_delta_m2` are recorded for repaired
   features.

`buffer(0)`, `simplify`, `snap`, arbitrary tolerances, silent drops, and silent
acceptance of invalid geometry are never used.

---

## 10. Feature identity, fingerprints, idempotency

- `source_geometry_fingerprint` = sha-256 over the source-CRS geometry WKB.
- `feature_fingerprint` = sha-256 over the normalized EPSG:4326 geometry WKB +
  release identity (`map_sheet_id`, `source_record_index`, canonical sheet
  checksum, `reference_period`, `transformation_version`) — reproducible from the
  source sheet alone, independent of surrogate ids and of ring order.
- The release row (`environmental_dataset_versions`) is keyed on (`layer_name`,
  `provider_dataset_identifier`, `reference_period`, `source_checksum` = aggregate
  manifest, `transformation_version`). An identical re-run reuses the release and,
  via `ON CONFLICT DO NOTHING` on both feature unique constraints, inserts zero
  new rows and creates no second active release. Verified by the synthetic
  integration test (first write 6 rows → second write 0).

---

## 11. Bulk-write strategy and batch size

`_BatchCopyWriter` streams feature rows and, for each batch of at most
`--batch-size` rows (default 1000), runs
`COPY → INSERT … SELECT … ON CONFLICT DO NOTHING → TRUNCATE` against a `TEMP`
staging table. This bounds **both** memory (one batch of Python rows) **and**
transient disk (the staging table never exceeds one batch) — critical at 7.4 M
rows, where accumulating the whole release in a temp table would roughly double
on-disk storage during the load. Nothing is loaded with row-by-row ORM inserts,
and no full in-memory feature list or GeoDataFrame is built. `--batch-size` is
tunable; larger batches reduce per-batch overhead at the cost of a larger
transient staging table.

---

## 12. Provenance

Each run writes an `ingestion_runs` row (`source_id = egis_land_cover`,
`reference_period = 2025`, `transformation_version = land-cover-v1`, counts,
status) and, on a full successful write, an `environmental_dataset_versions`
release (provider, official name/URL, `reference_period`, `reference_date = NULL`,
`source_checksum` = aggregate manifest, source/target CRS, encoding, geometry
types, counts, licence note, owning run id, `is_active`) and updates
`dataset_freshness`. A failed run is set `FAILED` with the error category/message
and never updates `last_success_at`. Sanitized output only: no local absolute
path, no per-record source values, no USB volume name.

---

## 13. Commands

Dry-run (pilot; selectors allowed):

```bash
waste-equity-probe land-cover-ingest \
  --source-root data/raw/environment/land_cover/2025_lv3 \
  --dry-run \
  --map-sheet-id <id[,id...]>  # or --region seoul|incheon|gyeonggi / --max-map-sheets N
  --report-json <local-path> --progress
```

Guarded full write (**not run in this phase**):

```bash
waste-equity-probe land-cover-ingest \
  --source-root data/raw/environment/land_cover/2025_lv3 \
  --write \
  --expected-manifest-sha256 9b3e5d5e150015c3707f1df5b4f434155164ecbd41cbfc1162c3e7b27a9f2b5e \
  --report-json <local-path> --progress
```

Rules: exactly one of `--dry-run` / `--write`; `--source-root` required; a
filtered/partial `--write` is **prohibited** (selectors are dry-run only);
`--write` requires an aggregate manifest checksum matching the validated source;
sanitized JSON to stdout, progress to stderr; exit 0 for successful/partial
completion, nonzero for a contract failure, checksum mismatch, transformation
failure, database failure, or prohibited partial write.

---

## 14. Controlled pilot result (2026-07-25)

### A. Synthetic PostGIS integration write (isolated test database)

Test-only synthetic shapefiles (built with pyshp; never official data) covering a
valid Polygon, a valid MultiPolygon, an invalid self-intersecting Polygon
(MakeValid), a byte-identical cross-region duplicate, a conflicting duplicate,
and Korean CP949 values. Verified: normalized `MULTIPOLYGON`/4326 output; area in
EPSG:5186; repair audit fields; duplicate loaded once with two-occurrence
provenance; strict CP949; first write inserts all rows; **an identical second
write inserts zero new rows**; conflicting duplicate halts before persisting;
scoring/candidate/wetland tables unchanged; migration downgrade + re-upgrade.
Also exercised with `--batch-size 2` to force multiple COPY→INSERT→TRUNCATE
flushes. All 33 land-cover tests pass (28 unit + 5 PostGIS) against a real
PostGIS test database.

### B. Controlled official-source dry-run (real USB, no DB write)

Deterministic bounded subset (no full rescan): Seoul unique sheet `37608058`,
Incheon unique sheet `36503010`, Gyeonggi unique sheet `36604002`, and
cross-region duplicate `37607042` (Incheon + Gyeonggi, loaded once).

| Metric | Value |
| --- | --- |
| Map sheets processed | 4 (of 2,013 unique / 101 duplicate ids discovered) |
| Raw features read | 10,340 |
| Accepted | 10,340 |
| Source-invalid | 15 |
| Repaired (MakeValid) | 15 |
| Discarded non-polygonal components | 0 |
| Rejected | 0 |
| Geometry types (out) | MultiPolygon × 10,340 |
| Class codes seen | L1 = 7, L2 = 22, L3 = 33 |
| Transformed geometry payload | 4,822,020 bytes (≈ 466 B/feature normalized WKB) |
| Duplicate occurrences loaded once | 1 |
| Elapsed (transform) | 14.39 s |
| Throughput | **718.7 features/s** |
| Peak process RSS | **231 MB** (bounded; streaming) |

The directory discovery walk over all 2,117 sheets took ≈ 16 s (directory
enumeration only, no file contents). Memory stayed bounded — no full-release
accumulation.

---

## 15. Full-load estimate (labelled ESTIMATE — not an observed full load)

Extrapolated from the pilot's measured throughput and geometry payload, and
calibrated against the platform's own comparable feature tables
(`structural_features`: 88,252 MULTIPOLYGON/4326 features, 3,104 B/row total, avg
geometry 1,981 B; land-cover geometry is ≈ 4× smaller at 466 B/feature).

| Quantity | Estimate | Basis |
| --- | --- | --- |
| Transformation duration | ≈ 2.9 h pure transform; **3–5 h** end-to-end | 7,438,457 ÷ 718.7 feat/s, single-thread over USB, + 2,117 sheet opens + discovery + COPY |
| Normalized geometry payload | ≈ **3.5 GB** | 466 B/feature × 7.44 M |
| Feature table data (heap + toast) | ≈ **8 GB** | ≈ 1.0–1.1 KB/row heap × 7.44 M |
| Feature indexes (GIST + btrees) | ≈ **3–4 GB** | GIST on 7.44 M polygons + 4 btrees |
| Total persistent (feature table + indexes) | ≈ **11–13 GB** | table + indexes + toast |
| Map-sheet table | < 5 MB | 2,013 rows |
| Transient staging (batched writer) | **≈ one batch** (negligible) | `--batch-size` rows, truncated each batch |
| Recommended free space for the load | **≈ 18–20 GB** | persistent footprint + WAL headroom + margin |

Because the writer batches the COPY staging, the historical "temp table doubles
storage" risk is avoided — the binding constraint is the ~11–13 GB persistent
footprint (plus WAL), not transient staging.

### Disk observations (2026-07-25)

- macOS host volume backing Docker (`/System/Volumes/Data`): **≈ 11 GB free**
  (95% used). This is the real ceiling — the Docker Desktop Linux VM reports ~199
  GB free on `/`, but its virtual disk is a sparse file that grows against the
  host volume, so host free space is what limits the load.
- Docker reclaimable (informational, **not** pruned here): ≈ 5.9 GB build cache +
  ≈ 10 GB unused images.
- Dev database `waste_equity`: ≈ 4.7 GB; still at Alembic head **0018** (this
  phase migrated only the isolated `waste_equity_test` database).

---

## 16. GO / CONDITIONAL_GO / NO_GO for the later full local write

**CONDITIONAL_GO** — the schema, migration, loader, CLI, and tests are
`IMPLEMENTED_AND_TESTED`, and the pilot proves correctness (strict CP949, EPSG:5186
by parameters, MakeValid audit, duplicate policy, idempotency) with bounded
memory. Conditions before the full local load:

1. **Disk (blocking today).** On the current ~11 GB of host free space, the
   ~11–13 GB persistent load (+ WAL) does **not** safely fit — running it *now* is
   **NO_GO**. Free ≥ ~10–15 GB of host space (e.g. reclaim the ~16 GB of Docker
   build-cache + unused images, or clear host disk), or load onto a volume with
   ≥ ~20 GB free, to reach CONDITIONAL_GO.
2. **Licence.** Reconfirm the EGIS/KOGL vector-download terms in writing before an
   official write (the WMS-only product is display-only and NO_GO for analysis).
3. **Coverage proof** runs only after the load (§17); it is not a precondition for
   loading, but the load is not "complete" until coverage is computed.

No universal pass/fail disk threshold is invented; the numbers above are the
measured pilot figures, the calibration tables, the conservative overhead model,
and the observed free space.

---

## 17. Coverage-proof design

The contract reports coverage as `NOT_PROVEN`. `coverage_against_boundaries` /
`compute_land_cover_coverage` implement a reproducible method: construct each
canonical map-sheet footprint (the union of its stored feature geometries),
transform the official `regions` 시도 boundaries into EPSG:5186, then compute per
region the exact covered area (boundary ∩ footprint-union), uncovered area
(boundary − union), coverage ratio, and the footprint overlap (union vs
sum-of-areas), all measured in EPSG:5186 m².

**No tolerance is invented.** The method reports exact geometry results and leaves
threshold interpretation `UNRESOLVED` — no legally/methodologically justified
tolerance is asserted. The method is validated on fixtures (and runs against the
database in the integration test); it must **not** claim full official coverage
until the complete calculation actually runs over a full load.

---

## 18. Licence

The EGIS/KOGL vector-download licence for the 토지피복지도 is **not yet
reconfirmed in writing**; no standalone licence receipt is committed. The release
row carries a `license_note` recording that reconfirmation is required before an
official write. This is distinct from — and does not inherit — any other layer's
licence.

---

## 19. Rollback

`alembic downgrade 0018` removes the two land-cover tables, the `egis_land_cover`
source, and any `land_cover` release/run/freshness rows, and restores the prior
`reference_date` NOT-NULL / `reference_date`-keyed release identity (dropping
`reference_period`). Existing wetland rows and every other table are untouched.
The round-trip is covered by the migration integration test.

---

## 20. Exact phase boundary

Done: additive migration 0019; the `environmental_land_cover_map_sheets` and
`environmental_land_cover_features` tables; the reusable
`land_cover_ingestion.py` pipeline (streaming, strict CP949, EPSG:5186→4326,
MakeValid audit, deterministic de-duplication, batched COPY); the
`land-cover-ingest` CLI with dry-run/write and pilot selectors; test-only
synthetic fixtures; a synthetic PostGIS integration write + idempotency check; a
controlled official-source dry-run; and this performance/capacity report.

Not done (by design): the full write of all 7,438,457 features; any active
partial release; OCI/production; API/map/tiles; frontend; 500 m cell statistics;
and any score, weight, exclusion, rank, candidate-status, policy, or derivation
change. `land_cover` remains `NOT_IMPLEMENTED` for scoring — the loader existing
does not make it a live scored dataset.
