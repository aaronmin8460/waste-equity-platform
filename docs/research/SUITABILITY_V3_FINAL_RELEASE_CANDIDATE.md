# Suitability Successor V3 — Final Release Candidate

**RC branch:** `release/v3-final-rc-20260817`
**Base:** `be93abb` (the frontend deployed to production before this release)
**Status:** RC GREEN on every local gate. Production **untouched** at time of writing.

---

## 1. Authoritative handoffs — all contained, verified by ancestry

| handoff | SHA | contained in RC |
| --- | --- | --- |
| backend | `b93393a` | ✅ |
| Page 1/2 **production code** | `f01d3bf` | ✅ |
| Page 1/2 branch tip (docs-only) | `f8b18f6` | ✅ |
| Page 4 | `36cdb33` | ✅ |
| Page 5 | `4910cc5` | ✅ |
| Page 6 | `49be6e5` | ✅ |

All five merged **conflict-free**.

### Proof that the Page-1/2 production code is preserved

`git diff f01d3bf HEAD -- frontend/src/lib/metrics.ts frontend/src/components/landfill/`
is **empty** — byte-identical. The user's final Page-2 copy-removal decision is intact
and nothing removed after `eb7849e` has been restored. The only `page.tsx` delta versus
`f8b18f6` is Page 4's own change, and it is scoped inside the `viewDeepAnalysis`
branch, so Pages 1–3 are unaffected.

---

## 2. RC-only fixes — the cross-model defect class

Integration exposed a class of defect no individual lane could see, because each lane
tested only its own model. **Root cause, once:** `profile_ranks` / `profile_totals`
are the *historical* model's per-profile storage. A successor run has one approved
profile and stores rank/score in the first-class `rank` / `total_score` columns,
leaving both JSONB maps empty. Every path reading only the maps served a successor run
as unranked and unscored.

Every occurrence across backend and frontend was enumerated and classified
**A** (historical-only by design) / **B** (model-aware, correct) /
**C** (successor-incompatible defect). All eight C items are fixed.

| surface | verdict | fix |
| --- | --- | --- |
| `engine.py` | A — the historical engine | none |
| scenario routes / `scenario.py` | A/B — refuses successor with 422 `COMPONENT_MODEL_MISMATCH` | none |
| Page 4 factor cards | B — already `successor ? V3 : legacy` | none |
| Page 5 scenario lab | A — historical-only by contract | none |
| summary `top_stable_candidates` | **C** | `18a6c0d` |
| summary `top_candidates` (primary ranking) — 0 rows | **C** | `d024a1a` |
| candidate list rank/score + ordering — null for all 47,893 | **C** | `d024a1a` |
| candidate detail rank/score | **C** | `d024a1a` |
| **MVT tile** rank/score — the map *styles* on `score`, so a successor run rendered an **unstyled grid** | **C** | `d024a1a` |
| `SuitabilityCandidateSummary` — Z/R/E/D labels over a successor run | **C** | `d024a1a` |
| stability denominators (list / dialog / summary) | **C** | `d024a1a` |
| stable short-list "세 비교 방식" — untrue at 4 perturbations | **C** | `d024a1a` |
| `SuitabilitySummary` / `…Collection` types missing the served field | **C** | `d024a1a` |

Earlier RC commits: `a7e7888` (map filter, badge, summary `top_stable`),
`f864b7a` (api.ts duplicate-field semantic merge defect), `ca3c9c1` (map test migration).

### Why the class survived until integration

`seeded_successor_shaped` seeded `profile_ranks` **and** `rank`, making the fixture
strictly more generous than any real successor run. It now follows the real write
rule (empty JSONB maps), and a new test asserts rank/score/`top_candidates`/
`top_stable` across all four endpoints. That is the durable fix — the fixture, not
just the code.

---

## 3. Both models verified end-to-end on real local data

| | run 47 (historical) | run 465 (successor) |
| --- | --- | --- |
| list rank / total | 1 / 69.2500 | 1 / 61.0558 |
| detail rank / total | 1 / 69.2500 | 1 / 61.0558 |
| `top_candidates` / `top_stable` | 10 / 0¹ | 10 / 10 |
| decoded MVT scored cells | 154 / 234 | 154 / 234 |
| component shape | Z/R/E/D, `component_scores {}` | `component_scores`, legacy **null** |
| stability | none¹ | STABLE, `stable_count` 4 |

¹ Runs 1 and 47 carry **no** stability data in this snapshot, so the old count test and
the new class test both return 0 rows — **no historical regression**. For the
historical model `STABLE ⇔ stable_count == 3` by definition, so the class test is
equivalent wherever stability exists.

**Missing is never zero:** an unavailable component is absent from `component_scores`
and renders `-`, never `0` — which would be the *best possible* score for a
lower-is-better component.

---

## 4. Gates

| gate | result |
| --- | --- |
| Backend full regression (incl. PostGIS) | **1271 passed · 2 skipped · 0 failed** |
| Backend Ruff | clean |
| Backend mypy `--strict` | clean, 87 files |
| Backend focused (routes / model / migration) | 200 passed; integration 45 passed |
| Migration compatibility 0021→0022→0023 | applied + **downgrade round trip proven** |
| **Frontend unit suite** | **2188 passed · 7 skipped · 0 FAILURES** (90 files) |
| Frontend typecheck | clean |
| Frontend ESLint | clean |
| Frontend production build (`next build --webpack`) | ✅ compiled |
| Local integrated stack | backend healthy · alembic 0023 · both models readable |

### The four inherited Page-4 test failures — resolved, not deferred

- `page.page4c` "returns to the first page…" — **contention, not staleness.** Passes
  in isolation; it timed out at 5,872 ms under parallel load.
- `page.test` "vector-tile wording" — **stale**, migrated. The
  not-viewport-limited contract is still asserted three other ways in the same test.
- `terminology.audit` "plain status names" — **stale**, migrated to audit the whole
  rendered view: **broader** than the original element-scoped check.
- `accessibility` "stability summary counts" — **stale**, migrated to assert the
  never-colour-alone contract on the badges, where stability now surfaces.

Staleness was **proven, not assumed**: a temporary probe enumerated every rendered
`data-testid` across all three suitability destinations. `candidate-counts` and
`stability-counts` render in **none** of them — 후보 상태 요약 is struck per the Figma
기술 참고사항 and only the `part="all"` layout renders it, which no destination reaches.

---

## 5. Migration and rollback plan

**Migration is metadata-only.** Both 0022 and 0023 are pure `add_column` with
constant `server_default`, which PostgreSQL 11+ applies without a table rewrite — so
production's 391 MB `suitability_candidates` does not change the cost. No data
migration of any kind.

**Proven locally on real data:** `0021 → 0022 → 0023` labels both historical runs,
backfills nothing (95,786 rows get `component_scores = {}`), and leaves all 18,600
historical scores intact. `0023 → 0021` drops the column with those scores still
intact; re-upgrade is clean. The downgrade was exercised deliberately **before** any
successor run existed, which is the window the persistence design says it is safe in.

**Rollback artifacts confirmed present on the host:**
`waste-equity-prod-frontend:f01d3bf` = `933b6efee8dc` — the image **currently
running**, so the rollback target is the live artifact rather than a rebuild. Also
present: `:eb7849e`, `:rollback-be93abb`, `:rollback-5148caa`. Backend running image
`89173f47a9ec`. `pg_dump 16.4` available inside the database container.

---

## 6. Production default model — unchanged, deliberately

`component_model.DEFAULT_COMPONENT_MODEL` remains
`suitability-components-zred-v1`.

No explicit project-owner approval to switch the production default exists in the
master state or anywhere in `docs/`, and the default was **not** flipped as a side
effect of integration. Verified live on the local stack: runs 465 and 466 are *newer*
than run 47, and the unpinned default still resolves to **run 47 (historical)**.

Deploying the V3 backend and making successor runs reachable by explicit run id is a
different act from making successor the unpinned default. Only the first is in scope
here.

---

## 7. Known limitations carried forward

1. **`AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED`** — 22 regions and 6,349,306
   residents (24.13%) outside the model; remedy is upstream geocoding or
   district-grain statistics.
2. **`RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED`** — one population value per
   SIGUNGU at one representative point; no available floor controls the placement
   artifact (46.71 → 40.55 across a tenfold floor increase).
3. **Regional concentration** — the successor top 10 is 10/10 양평군 and the top 50 is
   49/50. Not a tie artifact (13,672 distinct composites among 13,734). Deliberately
   **not** "fixed" by reweighting, because a vector chosen to break the concentration
   would be choosing a ranking.
4. **Ranking population spans 16 of 79 regions** (5,736,197 residents) — narrower than
   the complete case's 57 regions. Use 16 when describing the *ranking*.
5. The successor stability disclaimer sentence lived in the struck 안정성 요약 panel;
   stability now reaches the reader as a text-first badge. The broader
   "법적·공학적 적합 판정이 아닙니다" labelling remains across the view.

---

## 8. Deployment readiness

Every local gate is green, migration safety and rollback capability are proven, and
production preflight is complete and read-only.

**Remaining before a production verdict:** one authoritative integrated Playwright
run and 1440×900 Pages 1–6 visual QA, then the deployment sequence — verified DB
backup → `0021→0022→0023` → backend → health → frontend → Pages 1–6 smoke.
`docker compose down` is never used and no volume is ever destroyed.
