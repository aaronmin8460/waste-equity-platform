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
- `test_migration_population_monthly_integration.py` and the reporting integration
  fixtures are **data-dependent** — they expect a DB with real ingested
  `regions`/`ingestion_runs`/SGIS rows and fail on a fresh schema-only DB. These are
  pre-existing (migration 0015 is additive and cannot cause them).
- **One real regression was fixed in this phase:** that file hard-coded
  `assert revision == "0014"` (the Alembic head before this release). Because Docker
  was unavailable during Phase 4, the test never ran and the head change to `0015`
  went unnoticed. It is now robust: it asserts the DB head equals the Alembic **script**
  head (computed), so future additive migrations never re-break it, while still
  asserting `0014` is part of the chain.

## Gates on the QA branch

- Frontend: typecheck ✓, lint ✓ (0 warnings), `vitest run` ✓ (179), `next build` ✓,
  Playwright ✓ (33 passed / 15 env-skipped).
- Backend: `ruff format --check` ✓, `ruff check` ✓, `mypy src` ✓, `pytest` ✓ (243
  passed / 49 skipped — PostGIS tier skips without `TEST_DATABASE_URL`; verified
  separately against the disposable PostGIS as above).
- `docker compose config --quiet` ✓.
