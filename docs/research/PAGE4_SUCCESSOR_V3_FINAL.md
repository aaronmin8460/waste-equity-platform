# Page 4 — Successor V3 final lane

**A. FIGMA / UI — substantially complete.**
**B. BACKEND DATA WIRING — pending (handoff never published).**
**C. FOCUSED TEST MIGRATION — outstanding, 24 specs.**

Page 4 is **not** final until B and C land.

| | |
|---|---|
| Base SHA | `be93abb8ed61fabb7997f64a07f95d5ab356530c` (`origin/integration/frontend-fidelity-20260817`) |
| Branch | `feat/page4-successor-v3-final` (prior commit `b6381b7`) |
| Backend handoff SHA | **NONE — `origin/release/backend-v3-ready-20260817` never appeared** |
| Figma authority | `hETmPv3N31IJeW8XdLwoiS` · `136:8684` (+ `356:582`, `138:415`, `225:440`) |
| Deployed | No. Merged | No. Backend changed | No. |

---

## A. FIGMA / UI — what is now complete

### Geometry (verified already exact at ≥1440)
Left `396 = 20 inset + 360 card + 16 gutter` · right `376` · map `668` by `flex: 1 1 0%`,
never hard-coded. Body inset 20, column gap 16, card rhythm 20. Grid top at y=99.

### The four Successor-V3 factor cards — **built**
`SuitabilityV3FactorCards.tsx` renders the frame's card at full fidelity: `이름 : NN/100`
title line, the `가중치 설정 [ ] %` control, the one-line description, and the
`계산 모델 설명 펼치기` disclosure — for 기존시설 부담지수 · 대기영향 지수 ·
용도변경 가능지수 · 주민영향 지수, with the frame's accents
`#C9433C` `#188A52` `#D6A419` `#6E4FE0` at r=14 / 1.6px.

**No Z/R/E/D value was placed in a V3 slot.** V3 is not a rename: `existing_burden`
and `air_impact_proxy` reframe `equity`/`demand`, but `land_conversion`
(distance-to-core) and `resident_impact` (population weighted by distance) are new
computations and `road` has no successor. Values arrive as `null` and render `—/100`.

The weight input is rendered but **disabled**: Page 4's map and ranking are a STORED
run, so an editable weight would imply a recomputation that does not happen. Whether
it becomes editable is decided by the served scenario contract.

### Figma strike list (기술 참고사항 225:440) — applied
| Struck | Where it went |
|---|---|
| 상단 소제목 후보지 심층 분석 + 설명 | `sr-only` — hidden from canvas, kept as the document `<h1>` and landmark |
| ① 하단 작은 글씨 | into `분석 범위 자세히 보기` |
| ② 안정 후보 설명 | removed; the map legend already carries the outline and rule |
| 후보 상태 요약 | struck from the workspace (kept in the single-column shape) |
| 자료 공백 안내 / 계산 방법과 가정 | struck from the workspace |
| 4 right-column supporting cards | struck |
| 선택한 후보 구역 | **not deleted** — moved INSIDE ③ under the ranking, renders only when a row is selected |
| 순위보기 small print | reduced to the frame's one line; the two descriptive sentences moved into `자세히 보기` |
| ① 지역 선택 rename | done |
| rail titles 분석 조건 / 후보지 결과 | visually struck, still announced; the collapse control kept |
| ④ weight recap | demoted to `저장되는 가중치 보기` |

### The readiness-sentinel migration (what unblocked the strike)
`suitability-summary` was the load gate for **nine e2e specs across five other pages**
and lived on a struck card. It is migrated to a wrapper around card ②, present and
visible for the whole life of the view. Exactly one element carries the id in any
shape — the wrapper is workspace-only, the old card is single-column-only — so
`transparencyDashboard`'s count-of-1 assertion holds. It is a real `div`, not
`display: contents`, because a contents box has no rect and `toBeVisible()` needs one.

### Two Figma instructions deliberately NOT followed
1. **A/B/C wording.** The frame writes `점 이상 → 스크리닝 통과` / `미만 → 스크리닝 제외`.
   The frame's *shape* is adopted (filled tinted rows, circular letter badge, white
   value slot); the *labels* are not. A/B/C is a relative position in the current
   population — the top quarter of a scope can be entirely ineligible — so those words
   would convert a distribution into a screening verdict the analysis never made.
2. **Rank score format.** The frame shows `94.8`. Production keeps the served 4-decimal
   value: run 47's top-50 genuinely tie, and rounding would render distinct candidates
   identical. A display choice that destroys ordering information is not a visual fix.

> The strike list also reports a bug: selecting 서울 makes the ABC criteria vanish so
> no ranking shows. Run 47 genuinely has **zero** 서울 candidates — real absence, not a
> defect. The fix is an explicit empty state, never a fabricated ranking.

### Visual passes
**PASS 1** — 20 mismatches inventoried against the frame.
**PASS 2** — header prose gone, ① compact, **V3 cards live**, radios compacted, 안정 후보 struck.
**PASS 3** — rail titles gone, ③ reduced to the frame's single closing line, ④ demoted
and now reaching the fold.

### Remaining UI divergence
- ③ shows the `상대 점수 구간` unavailable paragraph because the **mock** serves no
  distribution; the A/B/C rows render when one is served. Data-driven, not layout.
- ③ has no scope pill row (the frame draws 수도권 전체/서울/인천/경기 in ③ as well as ①).
  Deliberately deferred: the code keeps ONE scope driving ranking, A/B/C population, map
  filter and selection together, and a second scope control risks two surfaces disagreeing.
- Map legend is still the large checkbox panel, not the frame's compact 110×118
  four-row 스크리닝 내역. `MapLegendOverlay` is shared with the equity map, so
  compacting it is a cross-page change this lane did not take unilaterally.
- The `해석·주의·출처 보기` map control and the layer dropdowns are not in the frame.
- Rank-row accent is not yet tied to the row's A/B/C grade (needs the distribution
  threaded to the row).

---

## B. BACKEND DATA WIRING — pending

Polled `origin/release/backend-v3-ready-20260817` throughout; never published, so
`SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md` and `SUITABILITY_V3_FINAL_POLICY.md`
were never readable. Still unknown: model/policy/scenario version, component keys,
weights, normalization, resident floor, eligibility, missing reasons, stability.

`lib/suitabilityV3.ts` is the seam. It carries the vocabulary, the Figma-sourced
labels/descriptions/accents, `V3FactorView`, `pendingV3Factors()` and a **positive**
V3 detection check so a Z/R/E/D run falls through rather than being relabelled. It
carries **no** weights, thresholds, floor, versions or eligibility rule — all
backend-owned. When the handoff lands, one line in `SuitabilityScoringBasis` changes:
build the views from the served components instead of `pendingV3Factors()`.

The frame's per-index formulas (356:582) are deliberately **not** transcribed — one
states its coordinates are `실제 위경도가 아닌 SVG 캔버스 좌표`, so printing it beside a
real served score would mis-describe how that score was produced. The disclosure slot
is built; its body comes from the served policy.

---

## C. FOCUSED TEST MIGRATION — outstanding

Applying the strike list and the V3 swap invalidates **24 focused tests** that encode
the superseded design. Measured with `--maxWorkers=1`; a `--maxWorkers=2` run reported
29, and 5 of those were cross-lane contention, so **always confirm in isolation**
(see `vitest-parallel-lane-contention`).

| File | n | Cause |
|---|---|---|
| `page.page4a.test.tsx` | 10 | asserts Z/R/E/D factor cards, the struck ② stability row, the moved ranking sentence |
| `page.suitabilityDashboard.test.tsx` | 8 | asserts 후보 상태 요약 and Z/R/E/D weights on the factor cards |
| `page.page4PrimaryCopy.test.tsx` | 4 | pins the Z/R/E/D card set and the stability row as primary copy |
| `page.phase0.test.tsx` | 2 | reads status labels off the struck 후보 상태 요약 |

Three need checking for a **genuine** regression rather than a contract update before
being rewritten: `keeps the map mounted … across both panel collapses`,
`candidate list and selection selects from the list`, and
`no raw enum on the primary surface`.

## Verification

`tsc --noEmit` **exit 0** · `eslint src/` **exit 0** (one pre-existing unused-import
warning in `page.phase0.test.tsx`) · Playwright capture passed at 1440×900 ·
global suite **not run** (Backend Master owns heavy regression).

Environment: `/Volumes/WASTE_QA2` is a disk image that may be unmounted. Shell node is
20; the toolchain needs **node 22**. The volume is slow enough that Playwright's 120 s
`webServer` timeout expires — start `next dev` separately and pass `--timeout=240000`.

No backend file modified. Nothing deployed. Nothing merged.
