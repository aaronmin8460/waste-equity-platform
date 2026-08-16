# Suitability Successor V3 — Phase 5 activation: decision request

**Status:** BLOCKED BEFORE PHASE 5. Production untouched.
**Author:** autonomous completion orchestrator, 2026-08-17
**Base SHA:** `30926eb26cff0e42bd6a1d5d4d99b73fe2be411e` (Phase 4 final)

---

## 1. Why this document exists

Phase 4 handed off cleanly and its verdict is **NOT READY FOR PHASE 5**. This
document does not re-argue that verdict — it re-verifies it independently, proves
*why* the remaining work cannot be done autonomously, and reduces the blocker to
**four decisions a human owner can make in a single sitting.**

Everything downstream — the Phase 5 runtime, the Page 4 and Page 5 rebuilds, the
Page 6 V3 methodology, the release candidate, and the V3 production deployment —
is gated behind those four decisions. None of them is an engineering problem.

---

## 2. What was independently verified (not taken from the Phase 4 report)

Re-run on the Phase 4 branch, this session, on a freshly created empty PostGIS
16/3.4 database (`v3_master_verify`):

| Gate | Result |
| --- | --- |
| Phase 4 pushed to origin | `30926eb` — worktree clean, 0 ahead / 0 behind |
| Ruff `check` | **All checks passed** |
| mypy (project config, `src/waste_equity_backend`) | **Success — 66 source files** |
| mypy `--strict src research` | **Success — 80 source files** |
| **Full backend suite incl. PostGIS** | **1193 passed · 2 skipped · 0 failed** (116.39 s) |
| Production frontend `/` | **HTTP 200** |
| Production `/health` | **HTTP 200** |
| Production `/api/v1/suitability/runs` | **HTTP 200**, 3 runs, latest run 48 |

The suite total **reproduces Phase 4's reported 1193 / 2 / 0 exactly**, on a
database created fresh for this verification. 1,195 tests are collected; 2 skip.

**Production is healthy and still serving the historical model.** Run 48 is
`policy_version: suitability-policy-v2` / `derivation_version:
suitability-screening-v3`, `weight_profile: baseline`, 47,893 candidates
(17,501 ELIGIBLE / 18,132 REVIEW / 12,260 EXCLUDED).

> **Naming trap, recorded deliberately.** The production derivation version is
> `suitability-screening-v3`. That **"v3" is the historical Z/R/E/D engine's third
> derivation**, and is *not* the Successor V3 component model
> (`suitability-components-successor-v1`). Anyone reading "v3" in a production
> payload as evidence that the successor model is live would be wrong.

---

## 3. Why Phase 5 cannot be started autonomously

Phase 5's deliverable is the successor **run write path** — code that scores the
four successor components into candidate rows. The repository states its
dependency explicitly:

> `docs/SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md` §8:
> "**A successor run write path** — the persistence migrations and the
> version-aware API contract are applied, but nothing scores successor components
> into candidate rows. **That work depends on items 1–7.**"

Items 1–7 include the weight vector, the normalization strategy, the
`land_conversion` direction, the resident distance floor, the land-cover class
registry, and the air-impact numerator basis. A composite score cannot be
computed without them, so there is nothing for the write path to write.

### 3.1 The weight vector is the binding constraint, and three independent in-repo contracts forbid me choosing it

**(a) The data-derived route is closed.** Phase 4 §4.2 established that CRITIC
cannot weight the successor components — its σ term measures normalization and
analytical grain, not information. Proof: switching one component's normalization
strategy moves its σ by **11.9%** while leaving the ranking identical at Spearman
**0.9999988** and top-50 overlap **50/50**. A method that responds to a change
carrying provably zero ranking information is measuring the wrong thing.
Recorded as blocker `SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING`. **No replacement
weighting method is approved.**

**(b) A placeholder vector is explicitly forbidden.**

> `docs/SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md` §6:
> "`SUCCESSOR_WEIGHT_PROFILES` is empty — inventing **'equal weights as a
> placeholder' would be an unapproved analytical assumption**, so there is no
> provisional vector at all."

**(c) Serving any weighted composite requires a recorded human reviewer.**

> `docs/ANALYTICAL_METHODS.md`, *Weighting Policy*:
> "Adopting any weighted composite requires, **before it is served**:
> 1. A written rationale per weight in this document, including what the weight
>    claims to represent and its sensitivity …
> 3. The review workflow below, **with the reviewer recorded in the PR**."

The historical composite satisfied this via `docs/SUITABILITY_POLICY_V1.md`, a
**project-approved** policy document carrying a written per-weight rationale
(`zoning 0.35` — "land-use context is fundamental to screening"; `equity 0.25` —
"prevents already-burdened communities from being favored"; …). That document
states the weights are explicitly **"not an expert/AHP result"** — they are an
asserted project-owner judgement, not a derived quantity.

**There is therefore no algorithm, no data, and no documented procedure that
yields successor weights.** Their legitimacy comes from human authorship. An
agent authoring them would be manufacturing the appearance of approval for a
judgement nobody made.

### 3.2 This is not a theoretical concern — the weights choose the ranking

Phase 4 §4.3, corrected complete case (n = 33,980), baseline = equal weights:

| perturbation | Spearman | top-10 retained | top-50 retained |
| --- | --- | --- | --- |
| **+0.15 → `resident_impact`** | 0.8523 | **0/10** | **1/50** |
| +0.15 → `existing_burden` | 0.9731 | 10/10 | 49/50 |
| +0.15 → `air_impact_proxy` | 0.9535 | 5/10 | 44/50 |
| +0.15 → `land_conversion` | 0.9338 | 8/10 | 44/50 |
| equal weights vs research CRITIC | 0.9222 | **0/10** | **12/50** |

**The ranking head is `resident_impact`-determined.** A single 0.15 shift onto it
retains **1 of the top 50**; the identical shift onto anything else retains 44–49.

And the output is a real-world siting recommendation over real neighbourhoods:
under equal weights the **top 50 sits almost entirely in two Seoul districts** —
광진구 29, 서대문구 20, 양평군 1. Choosing the weight vector *is* choosing which
communities this platform recommends for waste facilities. That is a product and
environmental-justice decision, not an implementation detail.

---

## 4. The four decisions needed

Each is stated with the measured evidence already in hand, so the decision can be
made from this document alone.

### Decision 1 — successor weight vector *(blocker `SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED`)*

**Question.** What weight does each of `existing_burden`, `air_impact_proxy`,
`resident_impact`, `land_conversion` carry, and **what does each weight assert**?

**What is needed to close it:** four numbers summing to 1, plus one sentence per
weight saying what it claims to represent — in the form
`docs/SUITABILITY_POLICY_V1.md` §237–240 already uses for the historical model.

**Constraints established by measurement, not opinion:**
- CRITIC and any other data-derived vector is **rejected** (§3.1a).
- `resident_impact` is the sensitive axis; its weight should be argued explicitly
  rather than landed on, because it alone can rewrite the ranking head.
- Whatever is chosen must be defensible against the two-district concentration
  above, not only against rank-stability metrics.

**Note.** Decision 1 must come first — Decision 2 is not settleable before it.

### Decision 2 — `resident_impact` distance floor *(blocker `RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED`)*

**Question.** What distance floor, if any?

**Measured (Phase 4 §3.4):**

| comparison | on the component alone | in the 4-component composite |
| --- | --- | --- |
| 500 m vs 1 km | Spearman 0.99977 · top-50 50/50 | 0.99989 · 50/50 |
| 500 m vs 2 km | 0.99870 · 50/50 | 0.99945 · 49/50 |
| 500 m vs 5 km | 0.99560 · **top-50 33/50** | 0.99815 · 49/50 |

The floor is **decisive on the component (33/50) and nearly inert in an
equal-weighted composite (49/50)** — so its importance is a function of Decision 1.
**2 km is explicitly not a default.**

**Known limitation no floor can fix:** the finest population geography is one
value per SIGUNGU at a single representative point, and every candidate floor is
smaller than the average region's own equivalent-circle radius
(`RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED`). A floor chosen now is
calibrated against that point's arbitrary placement. Accepting the floor means
accepting that caveat in writing.

### Decision 3 — land-cover developed-class registry + ambiguous classes *(blockers `LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE`, `LAND_CONVERSION_DIRECTION_UNAPPROVED`)*

**Question A.** Which official L2 classes count as **developed**?
**Question B.** Confirm the direction: is a larger *not-already-developed* share
the **worse** screening outcome?

The official class list **is** authoritative and already in-repo
(`docs/LAND_COVER_DATA_CONTRACT.md`): `100` 시가화건조지역 · `200` 농업지역 ·
`300` 산림지역 · `400` 초지 · `500` 습지 · `600` 나지 · `700` 수역. What does
**not** exist anywhere in the repository or the source is an official
developed-vs-natural designation — `PRODUCTION_REGISTRY` is `None` and the Phase-3
L2 registry is flagged `RESEARCH-ONLY-…-NOT-PRODUCTION-POLICY`, `approved=False`.

**Exposure is near-total (Phase 4 §3.6):** 26,795 of 28,853 then-available cells —
**92.87%** — touch at least one contested class.

| class | name | cells | why contested |
| --- | --- | --- | --- |
| 420 | 인공초지 | 26,066 | managed but not built |
| **620** | **인공나지** | **24,411** | artificial bare ground — often construction sites; arguably the most developed non-`1xx` class, currently classified *not* developed |
| 710 | 내륙수 | 16,685 | excluded from numerator and denominator |
| 230 | 시설재배지 | 16,152 | structures over agricultural use |
| 720 | 해양수 | 408 | as 710 |

**Flipping 620 alone moves 24,411 cells.** This is a primary driver of the
component's values, not a rounding detail.

### Decision 4 — default-run resolution / rollout *(blocker `SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED`)*

**Question.** Once two component models coexist, which is the **default**?

This is a product decision and it is **rollout-critical**: default-run resolution
currently selects the latest succeeded run regardless of component model, so the
first successful successor run would **silently switch every default view and
every un-pinned shared link** to a different model.

Phase 4 §5 already designs the safe sequence, and it only needs approval:

1. model-aware default-run resolution ships with the default **pinned to
   historical**;
2. a successor run is written, reachable **only by explicit run id**;
3. the successor result is reviewed against the historical one on the same grid;
4. the default is moved by an **explicit configuration change**.

Rollback of the default is a configuration change; historical runs are untouched
throughout, so it never needs to restore or recompute anything.

---

## 5. What remains blocked *after* the four decisions — and what does not

Two blockers **do not** close with a decision, because they need data that does
not exist locally:

| Blocker | Why a decision cannot close it |
| --- | --- |
| `AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED` | Root cause is ingestion-level: 99 facility rows (1,907,717.3 t/yr) are ungeocoded, and RCIS reports seven large Gyeonggi cities at CITY grain while `regions` holds only their child 구. Closing it needs **geocoding of the facility addresses or district-grain waste statistics** — neither is available locally. **22 regions and 6,349,306 residents (24.13% of the capital region) stay outside the model** until then. |
| `RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED` | Needs finer-than-SIGUNGU population geography. Not available. |

**These two do not block activation** — they are accepted, documented limitations
carried into the model's published scope. Phase 4 measured their exact cost, and
Option B (CITY-grain projection) was evaluated numerically and rejected because it
recovers **zero eligible candidates**.

Everything else unblocks mechanically once Decisions 1–4 are made:
`SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED`,
`SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED` (already decided in §4.1 —
`BOUNDED_RATIO` where the raw is a bounded ratio, percentile rank elsewhere),
`SUCCESSOR_CRITIC_STABILITY_METHOD_UNVALIDATED` (thresholds need only a reference
vector, i.e. Decision 1).

---

## 6. Model scope after activation — state this publicly

With the STRICT missing-component policy (Phase 4 §3.2, decided — zero-fill
permanently forbidden), the successor model's addressable scope is:

| measure | value |
| --- | --- |
| eligible candidates (strict complete case) | **33,980 / 47,893 — 70.95%** |
| residents represented | **19,958,650 / 26,307,956 — 75.87%** |
| regions in the complete case | **57 / 79** |
| structurally excluded | 22 regions · 6,349,306 residents · **24.13%** |

This is up from 50.25% at Phase 3 — Phase 4's B16 fix recovered **11,653
candidates** for a net eligible gain of **+9,916**, exactly matching the Phase-3
counterfactual prediction of 70.95%.

---

## 7. Recovery instructions — how to resume

```bash
source /Volumes/WASTE_QA2/recovery-env.sh
cd /Volumes/WASTE_QA2/worktrees/backend-phase4-policy   # Phase 4 final, clean
git log --oneline -1                                     # expect 30926eb
```

**Step 1.** Record Decisions 1–4 in the repository, in the form the existing
contract requires:
- weights + per-weight rationale → a new `docs/SUITABILITY_SUCCESSOR_POLICY_V1.md`
  mirroring `docs/SUITABILITY_POLICY_V1.md` §237–240;
- update `docs/ANALYTICAL_METHODS.md` *Weighting Policy* with the new composite;
- the PR must record the reviewer, per that document's requirement 3.

**Step 2.** Encode them in
`backend/src/waste_equity_backend/analysis/suitability/successor/policy.py`:
`SUCCESSOR_WEIGHT_PROFILES`, `PRODUCTION_REGISTRY`, the resident floor, and mint
`SUCCESSOR_POLICY_VERSION` / `SUCCESSOR_DERIVATION_VERSION` (both currently
`None`). Remove only the blockers the decisions actually close;
`validate_successor_policy()` raises if an OPEN decision ever coexists with
activation, so this is self-checking.

**Step 3.** Phase 5 runtime — branch `feat/suitability-v3-phase5-runtime` off
`30926eb`, implement the run write path, ship **model-aware default-run resolution
pinned to historical first** (Decision 4 step 1), then write a successor run
reachable only by explicit run id.

**Step 4.** Only then do Page 4 / Page 5 / Page 6 rebuilds have real V3 output to
render, and only then is a V3 release candidate meaningful.

### Verified environment facts for whoever resumes
- Test database used here: `v3_master_verify` on `backend-test-hygiene-database-1`
  (PostGIS 3.4). A **first** run against a brand-new database produces schema-setup
  errors on any branch; the authoritative totals come from the **second** run.
- macOS has no `timeout(1)` — do not wrap long commands in it.
- Analysis DB (`waste-equity-platform_pgdata`) is at alembic `0021`; successor
  schema `0022`/`0023` is applied on the branch but the analysis snapshot is not
  migrated. Phase 4 changed **no** migration.

---

## 7a. Production Page 4 today — the "before" state

Captured read-only at 1440×900 on `후보지 심층 분석`:

- Weight card reads **`용도지역 호환성(Z) 가중치 35%`** — the historical `baseline`
  profile, confirming the Z/R/E/D model end to end in the UI.
- All five historical profiles are offered (`기본 기준`, `모두 똑같이 반영`,
  `지역 부담을 더 크게 반영`, `도로 근접성을 더 크게 반영`, `데이터 분포 기준`).
- Counts match the API exactly: 17,501 스크리닝 통과 · 18,132 추가 검토 필요 ·
  12,260 프로젝트 스크리닝 제외, `분석 실행 48`.
- Stability is the historical contract — "baseline·equal·critic 상위 10% 모두 포함".
- Integrity labelling is intact: "법적 적합·부적합 판정이 아닙니다" and
  "최적지·추천지 판정이 아닙니다".

**Page 4 is not broken and is not misleading.** It correctly and honestly presents
the model that actually runs. The V3 rebuild is therefore an enhancement gated on
the four decisions, **not** a repair of a defect — there is no pressure to rush it.

One genuine defect was found and fixed separately (branch
`cleanup/map-loading-copy-20260817`): the transient map notice rendered
`후보지 타일을 갱신하는 중… (Refreshing candidate tiles…)`, an English gloss of its
own Korean. Removed; not asserted by any spec; typecheck, lint and the 84 focused
map unit tests pass.

---

## 8. Verdict

> **BLOCKED BEFORE DEPLOYMENT — PRODUCTION UNTOUCHED.**

Phase 4 is verified green and pushed. Production is healthy on the historical
model and was not modified in any way during this session. Phase 5 and everything
after it is gated behind **four human policy decisions** that no amount of
additional local analysis can supply — the repository says so in three independent
places, and Phase 4 closed the last data-derived route to the binding one.

The blocker is not that the answer is hard to compute. It is that the answer is a
judgement about which real communities this platform recommends for waste
facilities, and it must be made — and signed — by a person.
