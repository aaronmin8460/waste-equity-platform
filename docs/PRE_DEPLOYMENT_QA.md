# Pre-deployment QA results (Phase 6)

Validation of the merged application before the facility-cost release. **No
deployment and no production database migration were performed.**

## Functional regression (e2e, mocked backend)

`e2e/integration.spec.ts` tours every mode/feature — 형평성 → 후보지 점수 → **비용
살펴보기** (with a real calculate) → 수도권매립지 → back — at all five required
viewports, asserting each mode renders and the document never scrolls horizontally:

| Viewport | Result |
| --- | --- |
| 390 × 844 (iPhone) | ✓ |
| 430 × 932 (large phone) | ✓ |
| 768 × 1024 (tablet portrait) | ✓ |
| 1024 × 768 (tablet landscape) | ✓ |
| 1440 × 900 (desktop) | ✓ |

Full Playwright suite: **33 passed, 15 skipped**. The 15 skips are the live smoke
specs (`map`/`regressions`/`landfill`) which require `E2E_BACKEND_URL` (a real
backend) and self-skip otherwise — an intentional environment condition, not a
failure. The landfill mode is driven to its honest 404 "no official data" state
(never a fabricated official summary).

## Accessibility (e2e)

`e2e/accessibility.spec.ts` (mobile + desktop): `lang="ko"`, skip link
hide→focus→moves-focus-to-main, keyboard focus ring, map `region` label +
description, fieldset groups, live regions, and a no-keyboard-trap walk. All pass.

## Backend & database (disposable local PostGIS, `:5433`, removed after)

- Migration chain **0001 → 0015** upgrades cleanly on a fresh PostGIS; `0014 → 0015`
  applies the facility-cost table.
- `facility_standard_costs` seeded with 15 `capex-standard-v2022dec` rows; band
  shapes/flags and provenance match the canonical seed; **re-seeding is idempotent**
  (0 inserted) and fails visibly on a partial/mismatched version.
- API served from the real DB: `/standards` (count 15), `/options` (facility types +
  subsidy rates 0.30/0.40/0.30/0.50, 300 days), and `/calculate` returns a structured
  404/422 with **no fabricated data** when official inputs are absent. The stored
  band flags are correct (sorting_auto `(30, 40]` → min-exclusive, max-inclusive, 3.45).
- No production connection used (disposable container on a non-default port,
  removed after the run).

## Test-flake review

The previously-observed intermittent responsive map test did **not** reproduce:
`responsive.spec.ts` ran green **3/3** (16 tests each). The map-container assertions
are deterministic — the container renders regardless of WebGL/tile availability, and
the mock aborts basemap tiles — so no readiness/animation hack was needed. (A genuine
skip-link transition flake was found and fixed deterministically back in Phase 2.)

## Integration-tier characteristics (not regressions)

The PostGIS integration tier is designed to run **per file against a fresh DB**, not
as a whole-suite single-DB run:

- Running the whole tier against one persistent DB interleaves migration tests
  (which downgrade/drop) with route tests (which expect the schema), causing
  cascading `ingestion_runs does not exist` errors. Run integration files
  individually (the README convention).
- ~~`test_migration_population_monthly_integration.py` and the reporting integration
  fixtures are **data-dependent** — they expect a DB with real ingested
  `regions`/`ingestion_runs`/SGIS rows and fail on a fresh schema-only DB. These are
  pre-existing (migration 0015 is additive and cannot cause them).~~
  **Corrected — see "Integration-test data prerequisites" below.** Only one of those
  assertions was genuinely data-dependent; the rest were a missing fixture and a
  hard-coded foreign key, and are fixed.
- **One real regression was fixed in this phase:** that file hard-coded
  `assert revision == "0014"` (the Alembic head before this release). Because Docker
  was unavailable during Phase 4, the test never ran and the head change to `0015`
  went unnoticed. It is now robust: it asserts the DB head equals the Alembic **script**
  head (computed), so future additive migrations never re-break it, while still
  asserting `0014` is part of the chain.

## Integration-test data prerequisites

The PostGIS tier runs against a **schema-only** database (`alembic upgrade head`, no
ingestion). Anything that needs rows creates them itself. Three classes of false red
were removed to get there; none of them was a product defect.

**1. Migration-head assertions pinned to a stale revision.** Two tests asserted the
applied head equalled `0016` — the head when those features were written. Additive
migrations `0017`–`0023` moved it, so both failed on a release rather than on a
defect. The rule, now applied consistently across all six head assertions in the
suite: **never assert the head's value.** Assert instead that the chain has exactly
one head (a fork is what actually breaks a deployment), that the database is at that
head (so the rest of the file is testing the schema it thinks it is), and that the
revision the feature depends on is still reachable — an immutable historical fact.
Replacing `0016` with `0023` would have rebuilt the same trap. Both replacements were
checked against a deliberately forked chain and a deliberately un-migrated database,
and fail on each with a message naming the cause.

**2. Foreign-key parents borrowed from ambient data.** Five constraint tests in
`test_migration_population_monthly_integration.py` resolved their FKs with
`SELECT id FROM regions LIMIT 1`, failing with "a regions row is required by the FK"
on a clean database and, worse, binding to an arbitrary ingested row when one
existed. They now use an `fk_parents` fixture that creates one synthetic region and
one ingestion run and removes them afterwards. The constraints under test — the two
granularity-scoped partial unique indexes and the granularity/month check — do not
care which region a row points at.

**3. A hard-coded foreign key.** `test_reporting_routes_integration.py` built its own
`IngestionRun` and then wrote `ingestion_run_id=1` on the population rows instead of
using it. That resolved only while the `ingestion_runs` sequence was still at 1, so
the fixture raised `ForeignKeyViolation` on any reused database and, on a virgin one,
survived exactly the first test. Now threaded from the fixture's own run.

**Genuinely data-dependent, and now explicit.** Two assertions require ingested data
that cannot be reconstructed after the fact, and skip with a precise reason rather
than failing:

| Test | Prerequisite |
| --- | --- |
| `test_the_ingested_sgis_series_survived_the_upgrade` | a pre-0014 SGIS series (seeding rows now would create post-upgrade rows and prove nothing about the backfill) |
| `test_loaded_registry_has_exactly_66_rows_for_2024` | the 2024 municipal-cost registry ingestion |

The checkable half of the first was split out into
`test_no_sgis_row_was_given_a_monthly_grain`, which runs unconditionally: no SGIS row
may carry a `reference_month` or a non-`ANNUAL` grain. That is the assertion with
analytical weight — it is what stops a monthly observation from being read as an
annual denominator — and it holds on a loaded database and vacuously on an empty one.

**Test-only dependency.** `mapbox-vector-tile` decodes MVT bodies in nine tile tests
guarded by `pytest.importorskip`. It was never declared, so a `pip install -e '.[dev]'`
following the README silently dropped 23 tile assertions. It is now in the `dev`
extra; the production image installs `.`, never `.[dev]`.

### Measured result

Run against a throwaway project-scoped PostGIS volume (`postgis/postgis:16-3.4`,
`alembic upgrade head` to `0023`, **no ingestion**: `regions`, `ingestion_runs` and
`regional_population` all empty). Backend Phase 2 is unchanged at `88079d6` — no
runtime, migration or frontend file was touched.

| Tier | Phase-2 baseline | After hygiene |
| --- | --- | --- |
| Full PostGIS suite | 1143 passed / **8 failed** / 1 skipped / **3 errors** | **1154 passed / 0 failed / 2 skipped / 0 errors** (exit 0) |
| No-PostGIS suite | 866 passed / 289 skipped / 0 failed | 866 passed / 290 skipped / 0 failed |
| The four affected files alone | 8 failed / 3 errors | 60 passed / 1 skipped |

All eleven non-passing results are accounted for, with none suppressed:

| Original | Count | Category | Disposition |
| --- | --- | --- | --- |
| `assert version_num == "0016"` | 2 | stale test contract | now invariant-based, passes |
| `SELECT id FROM regions LIMIT 1` FK borrow | 5 | missing deterministic fixture | `fk_parents`, passes |
| `ingestion_run_id=1` hard-coded FK | 3 (errors) | missing deterministic fixture | threaded from the fixture's own run, passes |
| `assert rows[0] > 0` (SGIS series present) | 1 | unavailable production dataset | split: invariant half passes, prerequisite half skips with a reason |

The `+1` in the collected total (1155 to 1156) is that split; the `+1` skip in the
no-PostGIS tier is the same new test, skipped there along with the rest of its file.

The baseline row was re-measured on this same database from a pristine checkout of
`88079d6` rather than carried over from an earlier report. It reproduced 8 failed /
3 errors exactly, and all eleven fell inside these four files.

Both replacement head assertions were checked against a deliberately forked chain
(`0023`/`0023b`) and against a database stamped back to `0022`; each fails on each,
naming the cause. The `fk_parents` fixture leaves no rows behind — verified by
re-counting the three tables after the run.

Contrary to the note above about whole-suite single-DB runs, the whole tier completed
clean in one pass at this revision. The per-file convention in `backend/README.md`
still stands as the documented default; this run is evidence about this revision, not
a change of policy.

**Known remaining debt (pre-existing, not introduced here, not fixed here).**
`ruff format --check` reports 14 files needing reformatting: they are formatted at
line length 88 while `[tool.ruff]` sets 100. The list is byte-identical at `88079d6`
and on this branch, so the drift predates this lane, and all 14 are Phase-2
suitability files this lane never touched. Reformatting them here would be an
unrelated change to production sources, so it is left for its own commit. `ruff check`
— the lint gate — passes.

## Gates on the QA branch

- Frontend: typecheck ✓, lint ✓ (0 warnings), `vitest run` ✓ (179), `next build` ✓,
  Playwright ✓ (33 passed / 15 env-skipped).
- Backend: `ruff format --check` ✓, `ruff check` ✓, `mypy src` ✓, `pytest` ✓ (243
  passed / 49 skipped — PostGIS tier skips without `TEST_DATABASE_URL`; verified
  separately against the disposable PostGIS as above).
- `docker compose config --quiet` ✓.
