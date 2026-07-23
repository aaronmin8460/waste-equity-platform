# Suitability Environmental Roadmap (Phase 1A → 1B → 1C)

This roadmap sequences the addition of environmental/physical factors to the
후보지 분석 suitability screen. It is the umbrella for three documents:

- [SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md](SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md) — the per-dataset feasibility audit.
- [SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md](SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md) — the future layer architecture.
- This file — the phased plan, migration strategy, and rollback strategy.

It continues the boundary the Phase 0 transparency pass drew: Phase 0 *disclosed*
the unmodelled factors; this roadmap is where they are eventually *added* — "only
after their official data and a validated analytical method exist"
([SUITABILITY_PHASE_0_TRANSPARENCY.md](SUITABILITY_PHASE_0_TRANSPARENCY.md) §"Future
Phase 1 boundary").

## Guiding invariants (all phases)

1. **Missing ≠ safe.** A cell with no value for a factor is `REVIEW_REQUIRED` or
   excluded from that component, never scored 0 or "safe".
2. **No invented numbers.** No buffer, setback, threshold, or weight without a
   cited statutory basis or an explicitly labelled, reviewed policy assumption.
3. **Additive versioning.** Adding a factor to scoring bumps
   `policy_version` / `derivation_version` and produces a **new**
   `suitability_analysis_runs` row; historical runs are never overwritten.
4. **Screening, not siting.** Every output remains analytical decision-support,
   never a legal/permit/EIA determination — the standing disclaimer stays.
5. **Reproducible provenance.** Every dataset load records source, reference
   period, retrieval time, checksum, CRS (source + target), and transformation
   version; raw source files stay Git-ignored.

---

## Phase 1A — Environmental foundation (this phase)

**Status: implemented in this branch. Presentation/foundation only — no score,
rank, status, weight, API contract, or production output changed.**

Phase 1A delivers the *foundation* for later work and nothing that alters the
current analysis:

| Deliverable | What it adds | What it does NOT do |
| --- | --- | --- |
| Data audit | A verified catalogue of 15 future datasets with GO/CONDITIONAL/NO-GO | No download, no ingestion |
| Architecture | The future layer/versioning/refresh/tiling/API design | No pipeline runs |
| Backend prep | `waste_equity_backend.environment` — registry + inert abstract interfaces | No scoring, no calculation |
| Ingestion prep | `waste_equity_ingestion.environment` — empty framework (env config + abstract job) | Not wired to the CLI; reads no files |
| Database prep | One catalogue table `environmental_layer_registry` (migration 0017), seeded | No score column, no geometry, no change to existing tables |

**Explicitly unchanged in Phase 1A:** the four components (`zoning`, `road`,
`equity`, `demand`), their weights/thresholds/curve, the four static profiles +
`critic`, candidate statuses/ranks/scores/stability, the 500 m grid, MVT tiles,
the suitability API contract, and every stored run. `POLICY_VERSION`,
`DERIVATION_VERSION`, and `CANDIDATE_GRID_VERSION` are **not** bumped. Alembic
gains exactly one additive table.

---

## Phase 1B — First environmental factors (future, not in this branch)

**Goal:** ingest and score the highest-value, license-clear new factors —
**slope (DEM), land cover, river network, geology, wetland inventory** — the
`PLANNED` layers.

Phase 1B is itself sub-sequenced so each factor is a small, reviewable step:

1. **1B-0 — Live contract probes.** For each `DOCUMENTED_NOT_TESTED` source, run
   a small probe (source, CRS from `.prj`/metadata, licence, one sample feature),
   exactly as Phase 2.5A did for the structural layers. A source that fails its
   probe does not advance.
2. **1B-1 — Raster capability.** Stand up the raster→per-cell-statistic pipeline
   (mosaic → reproject → derive surface → zonal statistics against the EPSG:5179
   500 m grid). This unblocks DEM/slope and any raster land-cover variant. Purely
   an ingestion capability; it adds no score yet.
3. **1B-2 — Ingest the planned layers.** One concrete
   `EnvironmentalLayerPipeline` / `EnvironmentalIngestionJob` per layer, each with
   its own `TRANSFORMATION_VERSION` (e.g. `env-dem-slope-v1`), persisting
   versioned features / per-cell statistics under the existing
   `structural_dataset_versions` + `ingestion_runs` provenance. Idempotent,
   fail-visible, sanitized-raw-preserved.
4. **1B-3 — Adopt a factor into scoring (per factor, reviewed).** Only after a
   layer is `IMPLEMENTED` and passes the `docs/ANALYTICAL_METHODS.md` review does
   it become a scoring input. This is the step that bumps `policy_version` /
   `derivation_version`, rebuilds candidates into a **new** run, and updates the
   glossary/disclosure so the "not yet included" list shrinks honestly.

Each 1B-3 adoption is independent: adding slope does not require land cover, and
each carries its own migration (if a per-cell column or table is needed), its own
run, and its own rollback.

**Registry transitions.** As a layer is ingested, its
`environmental_layer_registry.lifecycle` moves `PLANNED → IMPLEMENTED` and its
row in the "not yet included" citizen disclosure is removed — both driven by the
same registry, so the catalogue, the DB, and the UI never disagree.

---

## Phase 1C — Extended and experimental factors (future)

**Goal:** the `FUTURE` and `EXPERIMENTAL` layers — **building footprints, parcel,
ownership, groundwater, flood hazard, faults** — each gated by a specific
unresolved condition (volume, field completeness, licence, or public
availability).

- **Building footprints / parcel / ownership** — high volume; parcel and
  ownership stay candidate-refinement (per-PNU / per-candidate) rather than
  region-wide sweeps, consistent with the 500 m grid being the candidate
  geometry.
- **Groundwater** — usable only as coarse hydrogeological context with an
  explicit uncertainty label; the observation network is too sparse for a
  defensible per-cell water table.
- **Flood hazard / faults** — **blocked** until redistribution/derived-use
  licences and public availability are confirmed in writing. They remain
  `EXPERIMENTAL` / `NO_GO` until then and are never ingested speculatively.

Phase 1C follows the same 1B discipline (probe → ingest → reviewed adoption) and
the same versioning/rollback rules.

---

## Expected datasets (summary)

| Phase | Layers | Lifecycle | Recommendation |
| --- | --- | --- | --- |
| Reuse | admin boundary, zoning, road centreline, protected areas | IMPLEMENTED | GO (reuse) |
| 1B | DEM/slope, land cover, river network, geology, wetland inventory | PLANNED | CONDITIONAL GO |
| 1C | building footprints, parcel, ownership, groundwater | FUTURE | CONDITIONAL GO |
| 1C | flood hazard, faults | EXPERIMENTAL | NO GO (blocked) |

Full per-dataset detail (source, licence, CRS, resolution, geometry, size,
preprocessing, difficulty) is in
[SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md](SUITABILITY_ENVIRONMENTAL_DATA_AUDIT.md).

## Expected preprocessing (summary)

- **Vector layers** reuse the existing structural loader: read source CRS →
  reproject to EPSG:4326 → `MakeValid`/promote-to-Multi (reject, never repair) →
  normalize attributes → clip nationwide→시도 → fingerprint → batched
  `ON CONFLICT DO NOTHING` under a dataset version.
- **Raster layers** (new) run ingestion-only: mosaic → reproject to a metric CRS
  → derive the analytical surface (e.g. `slope`) → zonal statistics against the
  500 m grid → persist only the per-cell numeric summary. Raw rasters stay in the
  Git-ignored data root.
- All distance/area operations use geodesic `geography` or a validated projected
  CRS; never decimal degrees.

Detail: [SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md](SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md) §8.

---

## Migration strategy

The platform uses linear, integer-id Alembic revisions (`0001`…`0017`), each
additive and reversible. The environmental work follows the same rules:

1. **Phase 1A migration (0017) — this branch.** Creates
   `environmental_layer_registry` and idempotently seeds it. It is:
   - **Additive** — one new table; no existing table, column, index, or
     constraint is altered.
   - **Non-analytical** — no score/geometry column; touches no suitability run,
     candidate, or structural feature.
   - **Idempotent seed** — the seed inserts only when the table is empty, so a
     re-run never duplicates rows (the facility standard-cost pattern). A unit
     test asserts the seed never diverges from the code registry.
2. **Phase 1B/1C migrations (future).** Each new per-cell statistic table (or, if
   a factor is adopted into scoring, any new provenance column) is its own
   additive migration, chained after 0017. Adopting a factor produces a **new**
   `suitability_analysis_runs` row via a rebuild — it does **not** mutate or
   backfill historical runs, and it never adds a `*_score` column that overwrites
   an existing candidate's stored scores.
3. **No destructive migration.** Environmental work never drops or rewrites an
   existing analytical table. Superseding a dataset load is an `is_active` flip on
   `structural_dataset_versions`, not a delete.

Deployment gate (unchanged, per [DEPLOYMENT.md](DEPLOYMENT.md)): apply the
migration, then `GET /health` → `{"status":"ok","database":"ok"}`, and confirm
existing suitability counts/statuses are unchanged.

## Rollback strategy

Phase 1A is trivially reversible because it is additive and inert:

- **Application rollback.** Reverting this branch removes the `environment`
  packages and the docs. No production behaviour depends on them (nothing is
  wired to the CLI, no route reads the new table yet), so the app runs exactly as
  before.
- **Database rollback.** `alembic downgrade 0016` drops
  `environmental_layer_registry` (and its index). Because the table holds only
  catalogue metadata — no score, no geometry, no foreign key from any existing
  table — dropping it affects **no** suitability run, candidate, structural
  feature, or served metric. The Postgres volume is never wiped
  (`docker compose down -v` is never used); `rollback-app.sh` refuses to roll the
  app below the DB's current migration, and here the migration is independently
  reversible.
- **Data safety.** Phase 1A ingested nothing, so there is no data to lose on
  rollback. The only rows created are the 15 seeded catalogue rows, which the
  downgrade drops with the table.

For Phase 1B/1C, rollback of a factor adoption is: revert the app to the prior
`policy_version`, and — because a new run was created rather than the old one
mutated — simply point the read API back at the previous `SUCCEEDED` run. The old
run's candidates, scores, ranks, and tiles are still present and immutable. Any
per-cell statistic table added for the factor is dropped by its own additive
migration's `downgrade`, with no effect on the suitability tables.

## Confirmation

Phase 1A changes **no** suitability calculation, score, ranking, candidate
status, weight profile, API contract, or production output. It prepares verified
datasets, a scalable architecture, inert backend scaffolding, and one additive
catalogue table — and nothing more.
