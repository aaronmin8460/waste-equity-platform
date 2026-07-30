# Land-cover statistics in the candidate-detail panel (Phase 1B-LC5A)

Status: **implemented and verified against a local development database only.**
Not deployed to OCI or production. No map-wide land-cover layer, legend, or filter
exists yet — that is Phase 1B-LC5B.

## 1. Purpose

Phase 1B-LC3 derived, and Phase 1B-LC4 exposed, the land-cover composition of the
acquired 세분류 [2025] 전국 토지피복지도 release per canonical 500 m candidate-grid cell.
Until this phase those statistics were reachable only through the API.

LC5A puts them in front of the reader at the one moment they are useful: when a
suitability candidate is selected, the existing candidate-detail panel now shows that
cell's land-cover statistics.

The scope is deliberately narrow. This phase is **candidate-detail integration only**.
It adds no choropleth, no map layer, no legend, no land-cover filter, and it changes
nothing about suitability scoring.

## 2. Files

| File | Change |
| --- | --- |
| `frontend/src/lib/api.ts` | Added the LC4 response types and the two fetchers. |
| `frontend/src/lib/landCover.ts` | **New.** Presentation + validation helpers (pure). |
| `frontend/src/components/LandCoverCellPanel.tsx` | **New.** The 토지피복 section. |
| `frontend/src/app/page.tsx` | Renders the section inside `CandidateDetailPanel`. |
| `frontend/src/lib/landCover.test.ts` | **New.** 34 helper tests. |
| `frontend/src/components/LandCoverCellPanel.test.tsx` | **New.** 35 component tests. |
| `frontend/src/lib/landCover.live.test.ts` | **New.** 7 live-backend integration tests. |
| `backend/.../api/routes/land_cover_cells.py` | `frontend_exposure` lifecycle label. |
| `backend/tests/test_land_cover_cell_routes.py` | Asserts the new lifecycle label. |
| `docs/LAND_COVER_CELL_STATISTICS_API.md` | Lifecycle table corrected. |

The backend change is metadata only: the served
`disclosures.lifecycle.frontend_exposure` was `NOT_IMPLEMENTED`, which this phase makes
untrue. It is now `CANDIDATE_DETAIL_ONLY` — deliberately not a bare `IMPLEMENTED`,
because no map-wide exposure exists. No query, response value, index, or migration
changed; the Alembic head stays at `0020`.

## 3. API endpoints used

Two of the five LC4 endpoints, both read-only:

- `GET /api/v1/environment/land-cover/cell-statistics/cells/{candidate_key}`
- `GET /api/v1/environment/land-cover/cell-statistics/cells/{candidate_key}/classes`

`/release`, `/summary`, and `/cells` are **not** called by the panel (the live test
file calls `/release` and `/cells` only to discover keys and assert the contract).

Raw land-cover features, per-feature records, original land-cover geometry, and vector
tiles are never requested. Verified in the browser: the only backend URLs the page hits
for land cover are the two above.

## 4. Selection and request flow

1. A candidate is selected (map click, top-candidate list, or a shared `?cand=` link).
   The existing `page.tsx` state fetches the suitability `CandidateDetail`.
2. `CandidateDetailPanel` renders `<LandCoverCellPanel candidateKey={detail.candidate_key} />`.
   The key is the candidate's **served stable identity** (`<grid version>:<i>_<j>`) —
   never derived from coordinates, array order, rank, or display text.
3. The panel's effect issues the two GETs, percent-encoding the key (the canonical key
   contains a colon, so `:` → `%3A`).
4. While `candidateKey` is null, **no request is issued at all**.

The section renders for every screening status, including `EXCLUDED`: the statistics
describe the cell, not its screening outcome.

## 5. Stale-request prevention

Two independent mechanisms, following the repo's existing conventions:

- **Cancellation.** Each selection change aborts the previous pair of requests through
  an `AbortController` returned from the effect cleanup (`fetchJsonSignal` already
  takes a signal).
- **Key-tagged request state.** The settled outcome is stored tagged with the candidate
  key that produced it, and the panel derives its state as "the outcome whose tag equals
  the current key, else loading". This mirrors the dashboard's existing `flowKey`
  convention and makes a stale render *structurally* impossible: a response tagged with
  a previous candidate can never satisfy the current key, even if it arrives late.

A third, narrower guard sits in the validators: a response whose `candidate_key` is not
the requested one is treated as malformed rather than displayed.

Because loading is derived rather than stored, the effect contains no synchronous
`setState` — which is also what the React 19 / Next 16 `react-hooks/set-state-in-effect`
lint rule requires.

Selecting a different candidate remounts the body (`key={candidateKey}`), so one
candidate's chosen class level and row expansion never carry onto another's numbers.

## 6. Coverage-state UX

The three states are visibly and semantically distinct: each has its own Korean label
carrying the machine status, its own explanatory sentence, its own container tone, and
its own `data-coverage-status` / `data-coverage-tone` attribute. State is never conveyed
by colour alone. Every response's own served `coverage_status_meaning` is also rendered
verbatim beside our summary.

### COMPLETE_EXACT — 격자 전체 평가

Explained as: the acquired release evaluated the cell with no residual, under the LC3
exact set-theoretic emptiness rule. The panel explicitly does **not** describe this as
legally complete, universally complete, or proof that every possible land condition in
the cell is known.

### PARTIAL — 격자 일부만 평가

A prominent amber warning shows **both sides**: evaluated area and percentage, and
uncovered area and percentage. It states that the class distribution below describes the
evaluated part, not the whole cell.

`share_of_evaluated_area` and `share_of_cell_area` are shown as two clearly-labelled
columns and are never conflated.

**A PARTIAL cell is never displayed as 100% covered.** LC3 decides coverage by exact
residual emptiness rather than by an area threshold, so a real PARTIAL cell can carry a
ratio of `0.9999999999999876`; naive rounding would print "100%" directly beside the
word PARTIAL. Such a value renders as `100% 미만`, and its sub-m² uncovered residual as
`1 m² 미만` / `0.1% 미만`.

### NO_COVERAGE — 격자 미평가

The API's served Korean warning is rendered, plus our own sentence. The meaning shown is
only that the acquired land-cover extent did not evaluate this candidate cell. It is
never presented as no land cover, empty land, unused land, vacant land, safe, suitable,
or zero-valued land cover.

A NO_COVERAGE cell shows **no class rows at all**. No `Unknown`, `Unclassified`,
`미분류`, `No land`, or `기타` class is synthesized from the uncovered area, and the
validator *rejects* a NO_COVERAGE response that arrives carrying class rows rather than
rendering them. The dominant classes display as `해당 없음 (미평가)` — never an empty
string and never a zero class code.

## 7. Class-distribution presentation

A `SegmentedControl` (the existing project pattern) switches 대분류 (L1) / 중분류 (L2) /
세분류 (L3), and a compact four-column table shows, per class:

| Column | Content |
| --- | --- |
| 코드 · 공식 분류명 | Official source code and official Korean name, both verbatim |
| 면적 | Class area in m² |
| 평가면적 대비 | `share_of_evaluated_area` |
| 격자 전체 대비 | `share_of_cell_area` |

- **Deterministic order.** Rows are the API's own order (level ascending, then area
  descending), preserved by filtering. Nothing is re-sorted, re-grouped, or merged.
- **No forced 100%.** Neither share column is normalized. A note under the table names
  both denominators by value and states that the totals are not made to reach 100% —
  and for a PARTIAL cell, that the whole-cell shares deliberately do not.
- **Never a fabricated zero.** A real sub-1 m² class renders `1 m² 미만`, a real
  sub-0.1% share renders `0.1% 미만`. A `null` share (undefined denominator) renders an
  em dash, never 0%.
- **Many classes stay usable.** A level with more than 8 rows collapses to 8 with an
  explicit `나머지 N개 분류 더 보기 (전체 M개)` control — the hidden count is always
  stated, never silently truncated.
- **Empty cases** are handled separately: no classes at all (with the NO_COVERAGE
  reason where applicable) and no classes at *this level*.
- Four columns rather than five so that both share columns fit the ~300 px sidebar
  without horizontal scrolling; the whole-cell column is the one carrying "this is not
  the whole cell", so it must not sit off-screen. An `overflow-x-auto` container remains
  as a safety net for very narrow viewports.

This phase assigns no map colours and renders no legend.

## 8. Scoring disclosure

Always-visible body text (not a tooltip, not inside a `<details>`):

- `점수 반영: 미반영 (used_in_suitability_scoring: false)` — read from the served flag,
  not hardcoded.
- 이 토지피복 통계는 설명용 자료이며, 적합성 점수·순위·적격 상태·제외 사유·검토 사유에 사용되지 않습니다.
- A `점수 미반영 · 참고용` badge in the section heading.

Nothing in this phase reads land-cover statistics into any score, rank, status,
exclusion, review reason, weight, policy version, or suitability derivation version.

## 9. Licence disclosure

The served licence state is preserved exactly: **`LOCAL_USE_ONLY_PENDING_CLARIFICATION`**,
shown as always-visible body text together with the backend's own licence statement
("KOGL Type 1 is NOT claimed and commercial-use permission is NOT claimed. Local
analytical use only."), the availability statement (local development database only;
Production/OCI availability not established), the class-label statement, and the
uncovered-area statement.

KOGL Type 1, commercial-use permission, production availability, and completed OCI
deployment are **not** claimed anywhere.

Compact provenance is also shown: `land-cover-cell-stats-v1 · 통계 릴리스 #1 · 자료판
#212 · capital-grid-500m-v1`.

## 10. Loading, error, and empty states

| State | Behaviour |
| --- | --- |
| No candidate selected | Idle message; **no request issued** |
| Loading | `role="status"` message; no partial or fabricated values |
| Success | Full section |
| Candidate not in the active release (404) | "활성화된 토지피복 통계 릴리스에 포함되어 있지 않습니다. 토지피복이 없다는 뜻은 아닙니다." |
| LC4 unavailable (5xx, network, CORS) | "토지피복 통계를 불러오지 못했습니다. 토지피복이 없다는 뜻은 아니며…" |
| Malformed / inconsistent response | "…해석할 수 없어 표시하지 않습니다. 불완전한 값을 대신 표시하지 않습니다." |
| NO_COVERAGE | Warning + no class rows |
| Empty class rows | Explicit message; no invented rows |
| Selection changed mid-request | Loading for the new candidate; stale response discarded |

A land-cover failure is contained inside this section: the existing suitability details
(identity key, status, scores, components, stability, disclaimers) remain fully intact.
Verified in the browser by failing only the land-cover endpoints.

No stack traces, SQL, local paths, connection strings, or raw backend error text are
exposed — errors are classified into three bounded kinds and rendered as fixed Korean
messages.

## 11. Types

Explicit TypeScript interfaces in `frontend/src/lib/api.ts`, no `any`:
`LandCoverCoverageStatus`, `LandCoverDominantClass`, `LandCoverClassCounts`,
`LandCoverStatisticsRelease`, `LandCoverLifecycle`, `LandCoverDisclosures`,
`LandCoverCellStatistics`, `LandCoverClassShare`, `LandCoverCellClassDistribution`.

Only the consumed subset of the 19-model backend schema is typed, but nothing
load-bearing is weakened: candidate key, coverage status, coverage ratio, both share
denominators, lifecycle/licence metadata, and the scoring flag are all typed exactly.

Nullability follows the contract: dominant-class fields are `string | null` (all null
for NO_COVERAGE, and preserved as null — never `""` or a zero code), and
`share_of_evaluated_area` / `share_of_cell_area` are `number | null`.

## 12. Test results

All commands run from `frontend/` unless noted. Recorded as observed.

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | **pass** (exit 0, no warnings) |
| Types | `npm run typecheck` | **pass** (exit 0) |
| Helper tests | `npx vitest run src/lib/landCover.test.ts` | **34 passed** |
| Component tests | `npx vitest run src/components/LandCoverCellPanel.test.tsx` | **35 passed** |
| Full frontend suite | `npm test` | **806 passed, 7 skipped** (41 files passed, 1 skipped) in 5 of 6 runs; see §12.1 for the one intermittent pre-existing failure |
| Production build | `npm run build` | **pass** (compiled, TypeScript ok, 4/4 static pages) |
| Live LC4 integration | `LC_LIVE_BACKEND_URL=http://localhost:8000 npx vitest run src/lib/landCover.live.test.ts` | **7 passed** |
| Backend LC4 routes | `backend/.venv/bin/pytest tests/test_land_cover_cell_routes.py` | **79 collected, exit 0** |
| Backend LC4 integration | same file `_integration.py` with `TEST_DATABASE_URL` | **21 passed, exit 0** |
| Backend health | `GET /health` | **200** `{"status":"ok","database":"ok"}` |
| Backend readiness | `GET /ready` | **404 — pre-existing**; the app defines no `/ready` route (unchanged by this phase) |

The 7 skipped tests are the live-backend file, which skips itself unless
`LC_LIVE_BACKEND_URL` is set (mirroring the `E2E_BACKEND_URL` convention). They are
**skipped, not passed**, in a default run; they pass when run against the local backend.

### 12.1 One intermittent failure observed (pre-existing test, not a land-cover defect)

Reported rather than smoothed over. Across **six** full-suite runs on this branch, one
run failed a single test:

```
FAIL src/app/page.phase7.test.tsx > landfill filters restore from a shared link
     > falls back to the product default for each invalid value, never a blank control
TestingLibraryElementError: Unable to find an element by: [data-testid="landfill-year-select"]
```

Evidence gathered:

- **5 of 6** full-suite runs on this branch passed 806/806 (the failure appeared once).
- `src/app/page.phase7.test.tsx` passes **9/9 times run in isolation** on this branch.
- The clean pre-change baseline (`da27f1e`, this file's changes stashed) passed the full
  suite **3/3** — but at 737 tests rather than 813, so that is *not* proof the baseline is
  immune; it is only a failure to reproduce there.
- The test's helper awaits a full `<Home />` render with testing-library's **default 1 s
  `waitFor` timeout**; the failing run took 1,813 ms. The failure mode is a timeout under
  parallel-worker CPU contention, not a wrong value.
- It is **not reachable from land-cover code**: that test drives landfill/flow mode, while
  `LandCoverCellPanel` mounts only inside the suitability candidate-detail panel with a
  candidate selected. No land-cover request is issued in that test.

Assessment: a load-sensitive timing flake in a pre-existing test, made more likely by this
phase adding 76 tests (and so more concurrent workers) rather than by any behaviour change.
The pre-existing test was deliberately **left unmodified** — raising its timeout would
reduce suite noise but also weaken an unrelated test's guarantees, which is outside this
phase's scope. It is recorded here so the next phase can decide.

Focused coverage includes: candidate-key request construction (including percent
encoding and the no-key-no-request rule), loading state, COMPLETE_EXACT display, PARTIAL
warning with both areas/percentages, the float-edge PARTIAL that must not read 100%,
NO_COVERAGE warning, absence of any synthetic class for uncovered area, L1/L2/L3
switching, evaluated-area versus cell-area shares, null dominant classes, API-failure
isolation with no leaked internals, key-mismatch rejection, malformed-response
rejection, stale-request protection under both orderings, candidate selection change and
level reset, close/reopen, scoring disclosure, licence disclosure, the
horizontally-scrollable table container, and accessibility (region/group names, table
caption and scoped headers, `aria-pressed`, `role="status"`, keyboard focus and
activation).

The live file additionally proves the types and validators accept what the API actually
serves for all three coverage states, on candidate keys **discovered from the live
release** rather than remembered.

## 13. Manual local verification

Driven in Chromium against the real dev server (`:3000`) and the real backend
(`:8000`), deep-linking real candidate ids taken from the live database for each
coverage status. 23/23 checks passed.

| # | Check | Result |
| --- | --- | --- |
| 1 | Equity mode still works | pass |
| 2 | Suitability mode still works | pass — 전체 47,893 · 통과 17,501 · 검토 18,132 · 제외 12,260 |
| 3 | Selecting a candidate opens the existing detail panel | pass |
| 4 | COMPLETE_EXACT candidate shows land-cover details | pass |
| 5 | PARTIAL candidate shows the partial warning | pass — 평가된 82,879 m² (33.1%) · 미평가 167,284 m² (66.9%) |
| 6 | NO_COVERAGE shows the correct warning and no class rows | pass — 0 class rows, distinct tone |
| 7 | Switching candidates updates the section | pass |
| 8 | Rapid switching shows no stale data | pass — loading observed, final state correct |
| 9 | Close and reopen candidate detail | pass |
| 10 | Backend failure does not break the rest of the panel | pass — bounded error, no internals |
| 11 | Desktop layout | pass — table 299 px in a 299 px container, no page-level h-scroll |
| 12 | Mobile layout (iPhone 13) | pass — table 306 px in 306 px, no page-level h-scroll |
| 13 | Korean official class names | pass — 산림지역 / 습지 / 수역 / 나지 / 시가화건조지역, 암벽·바위 preserved |
| 14 | Scoring and licence disclosures | pass — 미반영, `false`, `LOCAL_USE_ONLY_PENDING_CLARIFICATION` |
| 15 | No raw land-cover geometry requested | pass — only the two `/cell-statistics/cells/...` URLs |

Extra checks in the same run: no land-cover request is issued with no candidate
selected; the float-edge PARTIAL cell displays `100% 미만`; the two share denominators
differ visibly (60.9% of evaluated vs 20.2% of the whole cell); and no synthetic class
appears for a NO_COVERAGE cell.

## 14. Database safety

A read-only baseline was captured before implementation and again after all
implementation, testing, browser verification, and the backend image rebuild:

```
alembic|0020
suitability_runs|2
suitability_candidates|95786
cand_score_sum|993069.458500
cand_digest|c63f9733954aaf54e9c37f0cd77c9191
lc3_versions|1
lc3_version_digest|2041bd1f291660ada96e1d4d484ccf73
lc3_cells|47893
lc3_classes|1142780
lc_features|6901309
```

The two captures are **byte-identical**. `cand_digest` covers every candidate's status,
rank, total score, and geometry; `lc3_version_digest` covers the statistics version's
derivation version, status, and input signature. Zero database writes: suitability runs,
candidates, scores, ranks, statuses, candidate geometry, the LC3 statistics version, LC3
cell rows, and LC3 class rows are all unchanged.

No LC3 statistic was changed or recomputed. No external USB or raw EGIS source file was
accessed.

## 15. Known limitations

- **Local only.** Verified against a local development database and a local backend. Not
  deployed to OCI or production.
- **Licence still pending.** `LOCAL_USE_ONLY_PENDING_CLARIFICATION` is unresolved;
  written provider confirmation has not been obtained.
- **No map exposure.** No choropleth, layer, legend, or filter. Selecting a candidate is
  currently the only way to see a cell's land cover.
- **Candidate-driven only.** The panel cannot show statistics for a cell that is not a
  selectable suitability candidate.
- **Coverage is incomplete overall.** The acquired release evaluates 83.7% of the
  candidate-grid area; 7,387 of 47,893 cells are NO_COVERAGE and 4,604 are PARTIAL. The
  panel discloses this per cell but does not resolve it.
- **`/ready` returns 404.** Pre-existing; the backend defines no such route.
- **The live integration file needs a running backend.** It skips by default, so a CI run
  without `LC_LIVE_BACKEND_URL` proves nothing about the real contract.
- No Playwright spec was added; the browser verification ran as a one-off script against
  the real stack.
- **The frontend suite has one load-sensitive flake** in a pre-existing test
  (`page.phase7.test.tsx`, §12.1), observed once in six runs and left unmodified.

## 16. Next phase

**Phase 1B-LC5B — map layer, legend, and filters:** a map-wide land-cover presentation
(choropleth or vector-tile layer), a legend with class colour assignment, and land-cover
filters. `vector_tiles` stays `NOT_IMPLEMENTED` until then.

Not complete, and not claimed as complete by this phase: LC5B, OCI deployment,
production deployment, licence resolution, and scoring integration.
