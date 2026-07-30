# 세분류 [2025] 토지피복지도 — Full Local PostGIS Ingestion Report (Phase 1B-LC2)

**Phase:** Suitability land-cover 1B-LC2 — first complete local PostGIS write of the
official 2025 detailed (Level-3) land-cover dataset, stored-release verification,
real-source idempotency check, capital-region coverage assessment, and storage/integrity report.

**Scope boundary:** LOCAL TECHNICAL VALIDATION ONLY. This phase performed the full
local write, verified it, re-ran it to prove idempotency, measured coverage and
storage, and pushed only code/documentation. It did **not** deploy to OCI, expose a
public API or map, redistribute raw or transformed geometry, or change any
suitability score, weight, exclusion, candidate rank/status, policy version,
derivation version, or existing suitability run.

## Lifecycle

| Aspect | Label |
| --- | --- |
| Source dataset | `ACQUIRED_LOCALLY` (Seoul/Incheon/Gyeonggi, Git-ignored) |
| Contract validation | `LIVE_VERIFIED` |
| Ingestion implementation | `IMPLEMENTED_AND_TESTED` |
| **Full local official load** | **`COMPLETE`** (this phase — local dev database only) |
| Production / OCI load | `NOT_RUN` |
| API / map exposure | `NOT_IMPLEMENTED` |
| Scoring integration | `NOT_IMPLEMENTED` |
| Licence / public-use status | `LOCAL_USE_ONLY_PENDING_CLARIFICATION` |

---

## 1. Licence evidence status (sanitized)

Sanitized acquisition evidence is retained **outside Git** under the external Waste
Equity data directory (`download_receipts/land_cover/2025_lv3`): four EGIS PDFs
covering the KOGL/copyright policy page, the dataset detail, the download history,
and the separate WMS service. The evidence confirms the EGIS application/download
history and distinguishes the **vector** download from the separate **WMS** service,
but does **not** conclusively establish a dataset-specific KOGL type for the
downloaded vector SHP product.

Recorded status: **`LOCAL_USE_ONLY_PENDING_CLARIFICATION`**. This phase is authorized
only for private local technical ingestion, database validation, transformation
testing, and coverage analysis. No public-display, public-API, redistribution,
commercial-use, or confirmed-KOGL-Type-1 permission is claimed. No PDF, personal
application detail, receipt identifier, account detail, local path, or screenshot is
committed; dataset-specific vector-use conditions remain **pending clarification**.

---

## 2. Preflight observations

**Source & evidence.** The Git-ignored source-root symlink
`data/raw/environment/land_cover/2025_lv3` resolves to the external Waste Equity root
(derived from the resolved symlink, never hard-coded). All three regional
directories are present: Seoul 130, Incheon 346, Gyeonggi 1,641 shapefiles (2,117
total). The four evidence PDFs exist outside Git (existence only; not parsed for
personal detail, except a single privacy-safe text pass for §8's tile-id question).

**Docker & database.** Docker running; the existing Compose PostgreSQL/PostGIS
service (`postgis/postgis:16-3.4`, PostGIS 3.4.3) was started non-destructively from
its existing container and reached `healthy`. The target is the normal local
development database `waste_equity` at `localhost:5432` — **not** OCI and **not** the
isolated test database (`wep-testdb`, port 5433). Alembic revision before this phase:
**0018**. PostGIS installed. Database size before: **4,702 MB**.

**Host disk & safety margin.** Observed host free (`/System/Volumes/Data`): **~30
GiB**; external drive free: **47 GiB**. Conservative project-specific requirement,
computed from observations (not a universal threshold):

| Component | GiB |
| --- | --- |
| Upper persistent estimate (feature heap + TOAST + GIST/btree indexes) | 13 |
| Single-transaction WAL headroom (loader commits once at the end; WAL cycles at `max_wal_size`) | 3 |
| Inline index-maintenance / transient overhead | 2 |
| Operational headroom (autovacuum, catalog) | 2 |
| Compressed pre-load backup | 0 (stored on external drive) |
| **Required host free** | **~20** |

Observed 30 GiB ≥ required ~20 GiB → **GO on disk** (surplus ~10 GiB). During the
load, host free was driven partly by pre-existing macOS **swap** growth (contract
phase), which plateaued (~9–10 GiB swap) and eased in the streaming phase; host free
never approached exhaustion.

**Contract & checksum gate.** The existing contract gate was invoked without the
redundant full geometry-validation scan (`--no-geometry`; the write's own gate
performs the mandatory complete geometry pass). Result **PASS_WITH_WARNINGS**
(warnings are the known ITRF2000-named-PRJ-resolved-by-parameters and no-`.cpg`
items):

- **aggregate manifest SHA-256 = `9b3e5d5e150015c3707f1df5b4f434155164ecbd41cbfc1162c3e7b27a9f2b5e`** — exact match to the validated source.
- Source CRS EPSG:5186 resolved by TM parameters (`matches_expected`).
- Encoding CP949; UTF-8 rejected; 0 undecodable records; Korean samples decode.
- 2,013 unique map-sheet ids, 101 duplicate ids, **0 conflicting `.shp` checksums**.
- Regions seoul 130 / incheon 346 / gyeonggi 1,641; classes L1=7 / L2=22 / L3=41.
- Real source bytes 8.20 GB across 8,468 files; errors: none.

No source-contract drift.

---

## 3. Pre-load backup and baseline (outside Git)

A compressed **`pg_dump` custom-format** backup of the development database was
written to a timestamped file beneath the external Waste Equity `backups/` directory
(off the host volume needed for the load), never overwriting an existing backup.
Verified: nonzero (**858,612,710 bytes ≈ 819 MB**), a valid custom-format archive
(`pg_restore --list` → 340 TOC entries, gzip). Sanitized checksum recorded locally
(no path, no credentials):

```
backup_sha256 = 256710dabd85eaf9ba9df7fc09fc0b652be38de234b9db80c3eb2bc69433a595
```

A detailed analytical baseline (row counts, version anchors, and content checksums
for every table that must stay analytically unchanged) was captured locally outside
Git before the load. Only sanitized aggregate comparisons appear here (§9).

---

## 4. Migration result

Development database was at **0018**; the backend container's auto-`alembic upgrade`
was stopped first to avoid a race, then `alembic upgrade head` applied **0019**
(single head). Verified on the dev database:

- Both land-cover tables created (`environmental_land_cover_map_sheets`,
  `environmental_land_cover_features`; feature geometry `MULTIPOLYGON`/SRID 4326).
- `reference_period` backfilled for the existing wetland row (`2022-07-20`) with its
  `reference_date` preserved exactly; `reference_period` NOT NULL; `reference_date`
  NULLABLE; release unique constraint re-keyed onto `reference_period`.
- `egis_land_cover` data source present (STRUCTURAL, enabled).
- **No** feature or map-sheet rows seeded by the migration.

---

## 5. First full official write

**Long-run safety:** the write ran under `caffeinate -i -m -s` (system + idle-sleep
assertions confirmed active) as a durable background process; timestamped
stdout/stderr and the report JSON went to Git-ignored `logs/` and `test-results/`
paths (never committed).

**Command (equivalent, no partial/selectored write):**

```bash
waste-equity-probe land-cover-ingest \
  --source-root data/raw/environment/land_cover/2025_lv3 \
  --write \
  --expected-manifest-sha256 9b3e5d5e150015c3707f1df5b4f434155164ecbd41cbfc1162c3e7b27a9f2b5e \
  --report-json <ignored-local-report-path> \
  --progress
```

Default batch size (1000) was used (existing default; no faster value invented).

**Interruption and clean recovery (documented honestly).** A first attempt was
interrupted by an external `SIGINT` (the local Docker service was stopped) at
`[write 317/2013]`, CLI exit 130. Because the loader commits the entire feature load
in a **single transaction at the very end**, the interruption **rolled back
cleanly**: verified 0 feature rows, 0 map-sheet rows, no `land_cover` release, and an
intact analytical baseline. The lingering `ingestion_runs` row (run 1239) was marked
`FAILED` (honest status). Docker was restarted non-destructively (the `pgdata`
volume was untouched), and the write was re-run from a clean state — not blindly, but
after full interrupted-state inspection.

**Result of the completed write (exit code 0, status SUCCEEDED):**

| Metric | Value |
| --- | --- |
| Elapsed (wall) | **4:24:16** (start 2026-07-27T09:22:00Z, end 13:46:16Z) |
| Transform elapsed / throughput | 12,947 s / **533 features/s** |
| Peak process RSS | **1,875.6 MB** (bounded; streaming) |
| Raw/canonical feature occurrences encountered | **6,901,309** |
| Canonical map sheets processed | **2,013** (0 truncated) |
| Duplicate occurrences skipped (loaded once) | **104** (2,013 + 104 = 2,117 source sheets) |
| Accepted features | 6,901,309 |
| Repaired features (MakeValid) | 13,467 |
| **Rejected features** | **0** |
| Discarded non-polygonal components | 0 |
| Inserted features | 6,901,309 |
| Skipped features (ON CONFLICT) | 0 |
| Inserted map sheets | 2,013 |
| Geometry types (out) | MultiPolygon × 6,901,309 |
| Class codes seen | L1=7, L2=22, L3=41 |
| `dataset_version_id` | **212** (created) |
| `ingestion_run_id` | **1240** (SUCCEEDED) |
| Report warnings | none |

**Canonical vs raw.** The raw occurrence count is 7,438,457; the canonical stored
count is **6,901,309** because the 101 byte-identical cross-region map sheets (104
duplicate occurrences) are loaded once — a difference of **537,148** features, exactly
as anticipated. No canonical count was asserted before observation.

**Rejections.** Rejected feature count is **0**, so no rejection-reason investigation
was required. The 13,467 source-invalid polygons (ring self-intersections) were all
repaired by `shapely.make_valid` with a full audit trail (§6C), none dropped.

---

## 6. Database integrity verification (read-only)

### A. Dataset release
Exactly **one** active `land_cover` release (id **212**): `reference_period` = `2025`,
`reference_date` IS NULL, `source_checksum` = the validated aggregate manifest,
`source_crs` = EPSG:5186, `target_crs` = EPSG:4326, `source_encoding` = cp949,
`transformation_version` = land-cover-v1, licence note records pending
clarification, owning `ingestion_run` 1240 = SUCCEEDED.

### B. Map sheets
**2,013** canonical rows; **0** duplicate `(dataset_version_id, map_sheet_id)` pairs;
classification `byte_identical_cross_region` = 101 + `unique` = 1,912; the 101
cross-region duplicate ids are represented honestly (occurrence count > 1, features
loaded once); **0** conflicting classifications; all `PROCESSED`; `source_regions`
provenance populated for all 2,013. Sheet tallies reconcile with feature rows:
accepted 6,901,309 / repaired 13,467 / rejected 0.

### C. Features
- Table count **6,901,309** = report inserted/accepted.
- Both uniqueness constraints present (`…version_sheet_record`,
  `…version_fingerprint`); 0 duplicate record identities (and `skipped=0` on the
  first write proves no fingerprint conflicts).
- **0** NULL geometry, **0** empty geometry, **0** SRID≠4326, **0** non-MULTIPOLYGON.
- **`ST_IsValid` = 0 invalid** over all 6,901,309 geometries (valid after MakeValid).
- `geometry_area_m2` nonnegative and non-null for all (measured in source CRS 5186).
- All required class codes/names populated (0 nulls); dictionaries **L1=7, L2=22,
  L3=41** (matches the contract; the canonical de-duplicate process introduced no
  conflict).
- Korean labels decode correctly (e.g. 갯벌 · 공항 · 도로 · 묘지 · 염전 · 철도).
- All **15** source attributes recoverable via typed columns + `raw_attributes`
  (0 rows missing any of the 15).
- Repair audit reconciles: source-invalid 13,467 = repaired (`made_valid`) 13,467;
  every repaired row carries method + reason; **0** valid features falsely marked
  repaired; valid-none 6,887,842.

### D. Spatial plausibility
Combined EPSG:4326 extent `BOX(125.725 36.875, 127.85 38.175)` — lon 125.7–127.85°E,
lat 36.9–38.2°N: plausible for Seoul/Incheon/Gyeonggi (matches the contract's
observed far-western Incheon edge ≈125.7°E), within the South Korea envelope, correct
axis order (lon > lat — no reversal). No arbitrary tolerance invented.

### E. Database storage (actual)

| Object | Size |
| --- | --- |
| `environmental_land_cover_features` (total) | **11 GB** (12,323,307,520 B) |
| — heap | 7,466 MB (7,828,766,720 B) |
| — indexes | 2,836 MB (2,973,949,952 B) |
| — TOAST | 1,450 MB (1,520,590,848 B) |
| index: GIST geometry | 336 MB |
| index: uq_version_fingerprint | 1,044 MB |
| index: ix feature_fingerprint | 879 MB |
| index: uq_version_sheet_record | 308 MB |
| index: PK | 171 MB |
| index: ix dataset_version_id / ix l3_code | 49 MB each |
| `environmental_land_cover_map_sheets` (total) | 1,336 kB |
| **Total database size** | **16 GB** (17,254,838,755 B) |
| Host free after load | **20.4 GiB** |
| External drive free after load | 46 GiB |

Observed feature-table footprint **11 GB** sits at the low end of the pilot's 11–13
GB estimate — the estimate held. (Note: `feature_fingerprint` carries both a
standalone btree and the composite unique index — ~1.9 GB combined — an existing
migration-0019 schema property, not changed here.)

---

## 7. Identical second full write (idempotency)

**Predicted behavior (from the implementation):** the loader has **no existing-release
fast path** — a `--write` run always repeats the full contract-with-geometry gate and
the full transformation stream, reuses the existing release, and relies on
`INSERT … ON CONFLICT DO NOTHING` for idempotency. So the second run was expected to
take a similar ~4 h and insert **zero** rows.

**Observed behavior:** the second run **did** repeat the full transformation pass (no
fast path — it re-read, re-transformed, and re-fingerprinted all 6,901,309 canonical
features and re-ran the full contract-with-geometry gate), then inserted nothing.

**Result (exit code 0, status SUCCEEDED):**

| Metric | Value |
| --- | --- |
| Elapsed (wall) | **3:04:02** (start 2026-07-27T15:04:34Z, end 18:08:36Z) |
| Transform elapsed / throughput | 8,270 s / 834.5 features/s |
| `dataset_version_id` reused | **212** (`dataset_version_created` = false — no second active release) |
| **Inserted features** | **0** |
| **Skipped features (ON CONFLICT)** | **6,901,309** |
| **Inserted map sheets** | **0** |
| Accepted / raw re-processed | 6,901,309 (full pass) |
| Rejected / repaired | 0 / 13,467 |
| `ingestion_run_id` | **1241** (new run, SUCCEEDED) |

**Post-run DB verification:** feature count **6,901,309** (unchanged), map-sheet count
**2,013** (unchanged), exactly **one** active `land_cover` release (id 212, no second
release), **0** duplicate record identities, and `dataset_freshness` re-touched
(FRESH, latest 2025). The `ingestion_runs` history reads honestly: 1239 FAILED
(interrupted first attempt), 1240 SUCCEEDED (first full write, 6,901,309 inserted),
1241 SUCCEEDED (idempotent re-run, 0 inserted). Real-source idempotency is
**confirmed**. The second run changed no suitability, wetland, or structural data —
the exact §9 checksums are byte-identical after it (candidates
`9af16ab3dc1b0ebfb0bcc917040c0e43`, runs `1acfb8d290ac83c03ddb2ce4c1a07615`, wetland
`d382aca930ae39726afbc7324ca719c1`); `db_size` stayed 16 GB and host free recovered to
~19.4 GiB.

---

## 8. Capital-region coverage assessment

Coverage was previously `NOT_PROVEN`. A minimal, read-only CLI
(`land-cover-coverage`) was added to run the existing coverage function
operationally. Method: each **canonical** map-sheet footprint =
`ST_UnaryUnion(ST_Collect(feature geometry))` per `map_sheet_id` (duplicate
cross-region sheets stored once), unioned across sheets; official `regions` SIDO
boundaries transformed to EPSG:5186; areas computed in **EPSG:5186 m²**. No tolerance
invented.

| Region | Boundary km² | Covered km² | Uncovered km² | Coverage ratio |
| --- | --- | --- | --- | --- |
| Seoul (KR-SGIS-11) | 617.52 | 586.86 | 30.66 | **0.9503** |
| Incheon (KR-SGIS-23) | 1,026.94 | 627.30 | 399.64 | **0.6108** |
| Gyeonggi (KR-SGIS-31) | 10,338.70 | 8,805.46 | 1,533.24 | **0.8517** |
| **Combined** | 11,983.16 | 10,019.61 | 1,963.55 | **0.8361** |

Footprint overlap (union vs sum-of-areas) = **0.00 km²** (clean de-duplication, no
double-count).

**Interpretation (kept separate from the measurement): `INCOMPLETE` — complete land
coverage `NOT_PROVEN`.** Coverage against the official SIDO administrative boundaries
is measurably partial. Documented, evidence-based reasons for the shortfall:

1. SGIS SIDO administrative boundaries include coastal/maritime/inter-island extent
   that a land-cover product's coastline legitimately excludes — inflating
   "uncovered", most strongly for **Incheon** (many islands, wide maritime boundary)
   and coastal Gyeonggi.
2. The acquired tile extent (min lon ≈ 125.72°E, from the stored data) does **not**
   reach Incheon's far West Sea islands (e.g. Baengnyeong ≈124.7°E) — a genuine
   acquisition-scope gap.
3. Boundary-model / coastline / vintage differences between the SGIS boundary and the
   EGIS tile footprints (Seoul's ~5% gap, with no islands, is consistent with pure
   boundary-geometry differences).

The exact land-vs-sea (data-gap vs administrative-sea) decomposition was **not**
computed here (no coastline reference was intersected), so it is left **UNRESOLVED**
and complete coverage is **not** claimed. Full coverage is not inferred from feature
presence alone.

### 8.1 The 137-vs-130 Seoul discrepancy — UNRESOLVED
Local Seoul canonical tile ids: **130** (confirmed from the stored map-sheet
provenance). A single privacy-safe text extraction of the dataset-detail PDF found
only ~10 tile-id tokens in its text layer (all already among the 130 local sheets) —
it is **not** an enumerable 137-item manifest. The exact seven-item reconciliation is
therefore **not possible** from the saved evidence and remains **UNRESOLVED**. The
missing item identities are **not fabricated**. (No application-specific detail is
committed.)

---

## 9. Analytical baseline regression

Post-load vs the pre-load baseline — **every** analytically-frozen anchor is
byte-identical:

| Anchor | Pre = Post |
| --- | --- |
| suitability_analysis_runs / candidates | 2 / 95,786 |
| candidates content md5 | `9af16ab3dc1b0ebfb0bcc917040c0e43` |
| runs content md5 | `1acfb8d290ac83c03ddb2ce4c1a07615` |
| structural_features + geometry md5 | 88,252 / `e8b9339d8fe5c326ab1f9731510ab6c6` |
| wetland features + md5 | 2,704 / `d382aca930ae39726afbc7324ca719c1` |
| policy / derivation / grid versions | policy-v1 / screening-v1,v2 / capital-grid-500m-v1 |
| structural line / protected / dataset versions | 2,971,494 / 20,895 / 6 |
| facility / population / waste / landfill / cost | 651 / 748 / 234 / 9,212 / 15 |

No suitability score, rank, status, policy version, derivation version, candidate-grid
version, structural feature, wetland release, or facility/population/waste/cost
reference row changed. The only additions are the land-cover environmental metadata
(one release, 2,013 map sheets, 6,901,309 features) plus its `ingestion_runs` and
`dataset_freshness` provenance.

---

## 10. Tests and validation

| Check | Result |
| --- | --- |
| ruff format / ruff check (ingestion) | pass (43 files) |
| mypy --strict (ingestion / backend) | pass (43 / 52 files) |
| land-cover ingestion tests | 33 passed (incl. PostGIS integration) |
| land-cover contract tests | 33 passed |
| backend migration land-cover integration | 6 passed |
| reference-period-affected backend tests | 62 passed |
| Alembic single-head | `0019 (head)` |
| Python compile (modified files) | OK |

The isolated `wep-testdb` was migrated 0016 → 0019 to run the PostGIS tier. The full
backend suite also surfaced **pre-existing** failures unrelated to this phase —
`backend/` is byte-identical to `main` on this branch (`git diff --stat main -- backend/`
is empty): two stale `test_migration_head_is_0016` assertions (head is 0019 because
migrations 0017–0019 merged before this phase) and data-dependent FK failures on an
unseeded test database (population-monthly ×6, reporting-routes ×3 — "a regions row is
required by the FK"). These fail on `main` too and are neither caused nor fixed here;
skipped/failing integration tests are not represented as passing.

---

## 11. Unresolved issues

- Dataset-specific **vector-use licence** conditions: pending clarification
  (`LOCAL_USE_ONLY_PENDING_CLARIFICATION`).
- **Coverage** against administrative boundaries is `INCOMPLETE`; the land-vs-sea
  decomposition of the uncovered area is UNRESOLVED (no coastline reference).
- **137-vs-130** Seoul tile-count gap: UNRESOLVED (no enumerable manifest in the
  saved evidence).

---

## 12. Recommendation for the later read-only API/map phase

**CONDITIONAL_GO.** The technical foundation for a read-only API/map is in place: the
full local load is `COMPLETE` and verified (6,901,309 valid MULTIPOLYGON/4326
features, one active release, all geometry valid after MakeValid), real-source
idempotency is proven (identical second write inserts zero rows), storage is
characterized (~11 GB feature table, ~16 GB database), and the load changed no
scoring/candidate/policy/derivation/structural/wetland/reference data. The remaining
conditions before a read-only API/map phase are **not** technical blockers of the data
itself but must be resolved first:

1. **Licence (blocking for public exposure).** Status is
   `LOCAL_USE_ONLY_PENDING_CLARIFICATION`; the dataset-specific vector-use conditions
   are unconfirmed. A **public** API/map or any redistribution of raw/transformed
   geometry must **not** proceed until the EGIS/KOGL vector-download terms are
   reconfirmed in writing. A private/local read-only view is within the current
   authorization.
2. **Coverage honesty.** Capital-region coverage is measured `INCOMPLETE`
   (combined 0.836; Incheon 0.611). Any map/API must present the partial,
   administrative-boundary-relative coverage honestly and must not imply full
   capital-region coverage.
3. **Production/OCI load is `NOT_RUN`** — a prerequisite for a production-served API.
4. **Scoring stays out of scope** — a read-only API/map grants `land_cover` no scoring
   role (that remains a separate, explicitly-gated decision).

---

## 13. Rollback / recovery procedure

- **Schema/metadata rollback:** `alembic downgrade 0018` drops the two land-cover
  tables, the `egis_land_cover` source, and any `land_cover` release/run/freshness
  rows, and restores the prior `reference_date` NOT-NULL / `reference_date`-keyed
  release identity. Existing wetland rows and every other table are untouched (covered
  by the migration integration test).
- **Full restore:** the pre-load `pg_dump` custom-format backup (verified, SHA-256
  above) can restore the database to its pre-load 0018 state via `pg_restore` if ever
  needed. Stored outside Git on the external drive.
- **Interruption recovery (proven this phase):** a mid-write interruption rolls back
  the single transaction cleanly (0 rows, no partial release); inspect
  `environmental_land_cover_features`, `environmental_dataset_versions`, and
  `ingestion_runs` before any re-run; mark a stuck `RUNNING` run `FAILED`; re-run from
  the clean state.

---

## 13.1 Follow-on phase (1B-LC3)

The loaded release documented here is the sole input to **Phase 1B-LC3**, which derives
versioned land-cover statistics for every unique canonical 500 m candidate-grid cell
(migration 0020, derivation version `land-cover-cell-stats-v1`) **from this database
only** — it re-reads no source file, requires no source root, and does not touch the
external drive. The counts recorded above (release 212, 6,901,309 features, 2,013 map
sheets, L1=7/L2=22/L3=41, `ST_IsValid` 0 invalid) are the inputs that phase verifies
before it computes anything, and it leaves every one of them unchanged. See
[LAND_COVER_CANDIDATE_CELL_STATISTICS.md](LAND_COVER_CANDIDATE_CELL_STATISTICS.md).

## 14. Confirmation — local-only

This phase remains **local-only**. No OCI deploy, no public API, no public map, no raw
or transformed geometry redistribution, and no change to any suitability score,
weight, exclusion, candidate rank/status, policy version, derivation version, or
historical suitability run. No source data, PDFs, logs, run reports, or database dumps
are committed.
