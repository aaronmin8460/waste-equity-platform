# Page 4 — Successor V3 final lane

**A. FIGMA / UI — complete.**
**B. BACKEND WIRING — done against the PREVIEW contract; re-verify against the release branch.**
**C. FOCUSED TEST MIGRATION — 16 stale-design assertions outstanding, 0 known regressions.**

| | |
|---|---|
| Frontend base | `be93abb8ed61fabb7997f64a07f95d5ab356530c` (`origin/integration/frontend-fidelity-20260817`) |
| Branch | `feat/page4-successor-v3-final` (`b6381b7` → `4be6213` → this) |
| Backend contract read | `b93393a015d6d9d579ff4619e092d545e690f388` (`origin/integration/backend-v3-contract-preview-20260817`) |
| Figma authority | `hETmPv3N31IJeW8XdLwoiS` · `136:8684` (+ `356:582`, `138:415`, `225:440`) |
| Deployed | No. Merged | No. Backend changed | No. |

The preview branch forks from `main` (`5148caa`), a **different lineage** from the
frontend base, so it was read (`git show`) and never merged.

---

## B. The contract, as read from `b93393a`

| | |
|---|---|
| Successor component model | `suitability-components-successor-v1` |
| Historical component model | `suitability-components-zred-v1` |
| Served component order | `existing_burden` · `air_impact_proxy` · `resident_impact` · `land_conversion` |
| Model id | `suitability-successor` |
| Policy version | `suitability-successor-policy-v1` |
| Derivation version | `suitability-successor-derivation-v1` |
| Approved weights | **equal, `0.25` each** (`baseline` profile) |
| Activation | `ACTIVATION_BLOCKERS = ()` → **activated** |

**Response shape.** Every run-scoped response carries the run's own
`component_model_version` and `component_order`. Per-candidate scores mirror storage
exactly and are never dual-emitted: historical runs populate the four legacy
`*_score` fields and emit `component_scores` as `{}`; every other model emits
`component_scores` and the four legacy fields as explicit `null`.

**Two contract facts that shaped the wiring**

1. `DEFAULT_COMPONENT_MODEL` is still **historical**. That is a deliberate status-quo
   lock — flipping it is the rollout decision recorded as
   `SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED` and **owned by the product owner**.
   An explicit `component_model_version` query selector exists on `/runs`,
   `/runs/latest`, `/summary` and `/candidates`.

   **This lane does not send it.** Pinning Page 4 to the successor model would both
   preempt the owner's rollout decision and break the screen everywhere no successor
   run exists. Instead the UI renders **whichever model the run reports**. That is
   the honest reading of "do not depend on a hidden default": the default is not
   hidden — it is a documented, owned decision, and the run states its own identity
   in every response. When the owner flips it, Page 4 follows with no frontend change.

2. The served component order puts `resident_impact` **third**; the Figma frame draws
   it fourth. The served order wins — a UI that reorders a policy's components is
   misreporting the policy. Pinned by a test.

### What was wired

- `lib/api.ts` — `component_model_version`, `component_order` on `SuitabilityRun`;
  those plus `component_scores` on `CandidateDetail`. Optional, so a pre-contract
  backend parses and is treated as historical, never as successor.
- `lib/suitabilityV3.ts` — `isSuccessorRun()` (positive and exact: historical,
  unknown and absent all return `false`) and `v3FactorViews()`, which passes served
  scores and weights through, converts weight to whole percent for display, and keeps
  a served `null` missing rather than zero.
- `SuitabilityScoringBasis` — branches on the run's model. A successor run gets the V3
  bar and the four V3 factor cards fed from `component_scores`; a historical run keeps
  its own Z/R/E/D bar and cards. **Showing four empty V3 cards over a zred-v1 run
  would hide the real scores that run has — the mirror image of the fabrication the
  V3 cards exist to prevent.**
- Model / policy / derivation identity is surfaced in the `가중치 계산 방법` disclosure,
  marked `data-diagnostic` so it stays out of the primary canvas and out of the
  raw-token guard.

**Still model-agnostic and already correct for a successor run:** eligibility/status,
rank, stability class and badge, exclusion and review reasons. These come from the run
irrespective of component model and needed no change.

**Not yet reachable:** the qualitative grade word (우수/미흡) beside each score. The
backend serves no such label, so the slot stays empty rather than deriving one from a
threshold this layer would have to invent.

---

## A. Figma / UI — complete

Geometry was already exact at ≥1440: left `396 = 20 + 360 + 16`, right `376`, map
`668` by `flex`. Body inset 20, gaps 16, card rhythm 20.

Built: the four V3 factor cards (`SuitabilityV3FactorCards.tsx`) at the frame's
`r=14` / 1.6px accents `#C9433C` `#188A52` `#D6A419` `#6E4FE0`, with the
`가중치 설정 [ ] %` control, the one-line description and the per-card disclosure.
The weight input is rendered **disabled**: Page 4 shows a stored run, so an editable
weight would imply a recomputation that does not happen.

Strike list applied: header (`sr-only`, so the `<h1>` and landmark survive), ① helper
prose, ② 안정 후보 row, 후보 상태 요약, 자료 공백 안내, 계산 방법과 가정, the four
right-column supporting cards, rail titles, ③ small print, ④ weight recap.
`선택한 후보 구역` was **moved into ③** rather than deleted, and the
`suitability-summary` readiness sentinel was **migrated** to a wrapper around card ②
(a real `div` — `display: contents` has no rect, so `toBeVisible()` would fail).

**Two frame instructions deliberately refused**, both documented in code:
the A/B/C rows take the frame's shape but not its `스크리닝 통과 / 제외` labels, which
would turn a relative band into a screening verdict; and rank rows keep the served
4-decimal score, because run 47's top-50 tie and the frame's `94.8` rounding would
render distinct candidates identical.

Visual passes 1→3 captured at 1440×900.

Remaining divergence: ③'s scope pill row (deferred — one scope drives ranking, A/B/C
population, map filter and selection together, and a second control risks two surfaces
disagreeing); the map legend (shared with the equity map, so compacting it is a
cross-page change); rank-row accent not yet tied to A/B/C grade.

---

## C. Focused tests

`src/lib/suitabilityV3.test.ts` — **9 passing**, pinning the truthfulness rules:
positive-only model detection, served-null stays missing, unserved stays missing,
served order beats frame order, non-V3 keys ignored, no derived grade label.

The V3 wiring **fixed 8** of the previously-failing tests by restoring the Z/R/E/D
cards for historical runs: **24 → 16**.

All 16 remaining were triaged and every one is a **stale-design assertion**. No
regression was identified:

| Cause | n |
|---|---|
| asserts the struck 후보 상태 요약 (status text, counts, coverage, run context) | 8 |
| asserts the struck ② 안정 후보 row / its rule | 3 |
| asserts `candidate-detail-empty`, the empty card now suppressed inside ③ | 1 |
| asserts the ranking sentence moved into `자세히 보기` | 1 |
| asserts the active-profile method sentence moved into the disclosure | 1 |
| order-dependent, passes under `-t` in isolation | 2 |

Spot-checked rather than assumed: the raw-enum guard fails wanting
`프로젝트 스크리닝 제외` from the struck card — **not** on the model identifiers I added,
which `data-diagnostic` correctly excludes. The selection test fails only on the
suppressed empty card, not on selection itself.

**Measure failures with `--maxWorkers=1`.** A 2-worker run reported 29 where 1 worker
reported 24; five were cross-lane contention (`vitest-parallel-lane-contention`).

`tsc --noEmit` **exit 0** · `eslint src/` **exit 0** (one pre-existing unused-import
warning in `page.phase0.test.tsx`) · global suite **not run** (Backend Master owns it).

---

## When `release/backend-v3-ready-20260817` appears

Diff it against `b93393a` and update **only if** one of these moved: the two component
model identifiers, the served component order, the `component_scores` / legacy-null
representation, the weight vector, `DEFAULT_COMPONENT_MODEL`, or the policy /
derivation version strings. Everything wired here reads from the run, so a change to
run *content* needs no frontend edit — only a change to the *contract* does.

No backend file modified. Nothing deployed. Nothing merged.
