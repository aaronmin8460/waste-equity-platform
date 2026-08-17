# Page 4 — Successor V3 final lane

**A. FIGMA / UI — complete.**
**B. BACKEND WIRING — complete against the authoritative contract.**
**C. FOCUSED TESTS — green (202 unit, 51 browser).**

| | |
|---|---|
| Frontend base | `be93abb8ed61fabb7997f64a07f95d5ab356530c` (`origin/integration/frontend-fidelity-20260817`) |
| Branch | `feat/page4-successor-v3-final` (`b6381b7` → `4be6213` → `87c751b` → this) |
| Backend contract | `b93393a015d6d9d579ff4619e092d545e690f388` |
| Figma authority | `hETmPv3N31IJeW8XdLwoiS` · `136:8684` (+ `356:582`, `138:415`, `225:440`) |
| Deployed | No. Merged | No. Backend changed | No. |

---

## 0. Authoritative backend diff: **ZERO**

`origin/release/backend-v3-ready-20260817` and
`origin/integration/backend-v3-contract-preview-20260817` both resolve to
`b93393a`. Verified rather than assumed:

- identical commit SHA;
- identical **tree hash** `b918441187a4bf6b62557903f0ff957edb8fa189`;
- `git diff preview..release` → **0 lines**;
- the four contract files (`component_model.py`, `successor/policy.py`,
  `schemas/suitability.py`, `api/routes/suitability.py`) byte-identical by blob hash.

**No V3 wiring was redone.** The wiring landed in `87c751b` against the preview and
stands unchanged.

---

## B. The contract, and how Page 4 consumes it

| | |
|---|---|
| Successor component model | `suitability-components-successor-v1` |
| Historical component model | `suitability-components-zred-v1` |
| Served component order | `existing_burden` · `air_impact_proxy` · `resident_impact` · `land_conversion` |
| Model id / policy / derivation | `suitability-successor` · `suitability-successor-policy-v1` · `suitability-successor-derivation-v1` |
| Approved weights | **equal, `0.25` each** (`baseline`) |
| Activation | `ACTIVATION_BLOCKERS = ()` → activated |

Per-candidate scores are **never dual-emitted**: historical runs fill the four legacy
`*_score` fields and emit `component_scores` as `{}`; every other model fills
`component_scores` and emits the legacy fields as explicit `null`.

### The one judgement call, stated plainly

`DEFAULT_COMPONENT_MODEL` is still **historical**, and an explicit
`component_model_version` selector exists on `/runs`, `/runs/latest`, `/summary` and
`/candidates`. **This lane does not send it.**

Flipping the default is the rollout decision recorded as
`SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED`, owned by the product owner, with an
in-code instruction that it "must not be flipped as a side effect of any other work."
Pinning Page 4 to the successor model would preempt that decision and break the screen
wherever no successor run exists. The default is not *hidden* — it is documented,
owned, and every response states the run's own identity — so Page 4 renders **whichever
model the run reports** and will follow the flip with no frontend change.

### What that produces

- **Successor run** → the V3 bar and the four V3 factor cards, fed from
  `component_scores`, with the approved 25% weights in each card's control.
- **Historical run** → its own Z/R/E/D bar and cards. Rendering empty V3 cards over a
  `zred-v1` run would *hide* real scores — the mirror image of the fabrication the V3
  cards exist to prevent.
- **A backend reporting no model** → treated as historical, never as successor.

Model / policy / derivation identity is surfaced in the `가중치 계산 방법` disclosure,
marked `data-diagnostic` so it stays out of the primary canvas and out of the
raw-token audit.

Eligibility, rank, stability class and badge, and exclusion/review reasons are
model-agnostic and were already correct for a successor run.

**Still not reachable:** the qualitative grade word (우수/미흡). The backend serves no
such label, so the slot stays empty rather than deriving one from a threshold this
layer would have to invent.

---

## A. Figma / UI

Geometry was already exact at ≥1440: left `396 = 20 + 360 + 16`, right `376`, map
`668` by `flex`. Body inset 20, gaps 16, card rhythm 20.

Four V3 factor cards at the frame's `r=14` / 1.6px accents `#C9433C` `#188A52`
`#D6A419` `#6E4FE0`, with the `가중치 설정 [ ] %` control, the one-line description and
the per-card disclosure. The weight input is rendered **disabled** — Page 4 shows a
stored run, so an editable weight would imply a recomputation that does not happen.

**Strike list applied**, with every struck semantic relocated rather than dropped:

| Struck | Where its meaning now lives |
|---|---|
| 상단 소제목 + 설명 | `sr-only` — the `<h1>` and its landmark survive |
| ① 하단 작은 글씨 | `분석 범위 자세히 보기` |
| ② 안정 후보 row | the map legend (rule) + ②'s disclosure (the legal limit) |
| 후보 상태 요약 | the map legend names/counts the statuses; ②'s disclosure defines them |
| 자료 공백 안내 | ②'s `점수 기준 자세히 보기` |
| 계산 방법과 가정 | ②'s disclosure; **the screening disclaimer stayed visible** |
| 4 right-column cards | struck; stability still on every ranking row + the legend |
| 선택한 후보 구역 | moved INSIDE ③, rendering only once a row is selected |
| 순위보기 small print | one line, per the frame; the descriptive sentences → `자세히 보기` |
| rail titles | visually struck; the collapse control kept |
| ④ weight recap | `저장되는 가중치 보기` |

The `suitability-summary` readiness sentinel — load gate for nine specs across five
other pages — was **migrated** to a wrapper around card ②, a real `div` (a
`display: contents` box has no rect, so `toBeVisible()` would fail).

**Three instructions deliberately refused**, all documented in code:
1. the A/B/C rows take the frame's shape but **not** its `스크리닝 통과 / 제외` labels,
   which would turn a relative band into a screening verdict;
2. rank rows keep the served 4-decimal score — run 47's top-50 tie, and the frame's
   `94.8` rounding would render distinct candidates identical;
3. the **screening disclaimer stayed visible**, outside the disclosure. Relocating the
   methodology card was a copy cleanup; putting *that* line behind a keystroke would
   have been a semantic weakening.

Remaining divergence: ③ has no scope pill row (one scope drives ranking, A/B/C
population, map filter and selection together; a second control risks two surfaces
disagreeing); the map legend is not compacted to the frame's 110×118 (it is shared with
the equity map); rank-row accent is not tied to A/B/C grade.

---

## C. Tests — all green

Every one of the previously-failing assertions was individually verified as **stale
design, not regression**, then migrated to the surface that now carries the semantic.
None was deleted, and no struck UI was restored to satisfy an old assertion.

| Was asserting | Migrated to |
|---|---|
| `candidate-counts`, `status-summary-total` | `status-filters` + `status-filter-count-*` on the map legend |
| `status-display-state-*` | the legend checkbox — it *is* the state, not a report of it |
| `status-visibility-note` | the legend's own control + `stability-legend-note` |
| `status-explanation-*` | ②'s disclosure (same testids — the meaning is preserved) |
| `suitability-run-context` | ②'s disclosure, with run id, reference year and policy version |
| `coverage-warnings` | `score-basis-coverage` |
| `suitability-disclaimer` | `score-basis-disclaimer`, still **visible** |
| `stability-summary` | `score-basis-stability-meaning` (incl. the legal limit) |
| `scoring-basis-stability` | the legend rule + ②'s definition |
| `candidate-list-map-hint` prose | `candidate-list-row-meaning` in `자세히 보기` |
| `candidate-detail-empty` | asserts no detail and no sample score when unselected |
| e2e `h1` in viewport | `h1` exists (sr-only by design) |

Two new files pin the wiring itself:
- `src/lib/suitabilityV3.test.ts` — 9 tests: positive-only model detection, served
  null stays missing, unserved stays missing, served order beats frame order, non-V3
  keys ignored, no derived grade label.
- `src/components/suitability/SuitabilityScoringBasis.v3.test.tsx` — 7 tests proving
  the branch end-to-end, which the shared fixtures never exercise because they all
  serve a historical run: V3 cards render with served scores, a served `null` prints
  `—/100` and never `0`, the weight input shows 25% and is disabled, the run's own
  identity is reported, and a historical or model-less run keeps its Z/R/E/D cards.

### Final verification

| Check | Result |
|---|---|
| Focused unit (`page4a/b/c/d`, `page4PrimaryCopy`, `suitabilityDashboard`, `phase0`, both new files) | **202 passed / 0 failed** (`--maxWorkers=1`) |
| Focused browser (`page4VisualQa`, `suitabilityDashboard`, `page4cRankingDialog`, `page4dScenarios`) | **51 passed / 0 failed** |
| `tsc --noEmit` | **exit 0** |
| `eslint src/ e2e/` | **exit 0, zero output** (also cleared one unused import inherited from `be93abb`) |
| Final 1440×900 visual pass | captured; renders the historical model correctly, since the mock serves a `zred-v1` run |
| Global suite | not run — Backend Master owns heavy regression |

**Always measure with `--maxWorkers=1`.** A 2-worker run reported 29 failures where 1
worker reported 24; five were cross-lane contention
(`vitest-parallel-lane-contention`).

---

## Handover

The lane is complete against the authoritative contract. The two open items are
product decisions, not engineering gaps:

1. **The rollout flip.** When the product owner changes `DEFAULT_COMPONENT_MODEL` to
   the successor model, Page 4 follows with no frontend change. Worth a visual pass
   at that point, since the canvas will switch to the V3 cards.
2. **The grade word.** If policy defines the thresholds that turn a component score
   into 우수/미흡, serve the label and the slot fills; it must not be derived here.

No backend file modified. Nothing deployed. Nothing merged to `main`.

READY FOR FINAL INTEGRATION
