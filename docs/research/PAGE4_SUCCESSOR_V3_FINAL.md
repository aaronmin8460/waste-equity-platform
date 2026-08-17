# Page 4 — Successor V3 final lane

**Status: BLOCKED on the backend handoff. Shipped as a truthful partial.**

| | |
|---|---|
| Base SHA | `be93abb8ed61fabb7997f64a07f95d5ab356530c` (`origin/integration/frontend-fidelity-20260817`) |
| Branch | `feat/page4-successor-v3-final` |
| Worktree | `/Volumes/WASTE_QA2/worktrees/page4-v3-final` |
| Backend handoff SHA | **NONE — `origin/release/backend-v3-ready-20260817` never appeared** |
| Figma authority | `hETmPv3N31IJeW8XdLwoiS`, frame `136:8684` (+ `356:582`, `138:415`, `225:440`) |
| Deployed | No. Merged | No. Backend changed | No. |

---

## 1. The blocking fact

The lane's central task — replace the historical Z/R/E/D model with Successor-V3
semantics — **could not be done truthfully**, because the V3 data does not exist in
any API this branch can reach.

Polled `origin/release/backend-v3-ready-20260817` throughout the session. It was
never published, so `SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md` and
`SUITABILITY_V3_FINAL_POLICY.md` were never readable, and the model version, policy
version, weights, resident floor, normalization, eligibility rule, missing reasons
and stability contract are all still unknown to this lane.

**The two models are not a rename.** Transcribing Figma card ② against
`lib/glossary.ts`:

| V3 component | Figma ② label | nearest Z/R/E/D |
|---|---|---|
| `existing_burden` | 기존시설 부담지수 | `equity` (E) — a reframing |
| `air_impact_proxy` | 대기영향 지수 | `demand` (D) — a reframing |
| `land_conversion` | 용도변경 가능지수 | **none** (distance-to-core, not legal zoning) |
| `resident_impact` | 주민영향 지수 | **none** (population weighted by distance) |
| — | — | `road` (R) has **no successor** and disappears |

Two of four are genuinely new computations and one old component is dropped.
Rendering V3 names over Z/R/E/D values would therefore be exactly the prohibited
`historical Z/R/E/D → successor` substitution: a fabricated score presented as a
measurement. **It was not done.**

Per the mandate's "preserve existing functionality until the actual V3 contract
arrives", Page 4 still renders the Z/R/E/D model it truthfully has.

---

## 2. Figma is the visual authority — and it already encodes V3

The most useful finding of the session: **the Figma frame is already Successor-V3.**
Card ② names the four V3 indices with Korean labels and one-line descriptions. The
stale artefact is the code, not the design.

The frame's expanded example (`356:582`) also prints a formula, a data list and a
한계 line per index. **These were deliberately not transcribed into the product.**
They describe the original research prototype — one states outright that its
coordinates are `실제 위경도가 아닌 SVG 캔버스 좌표` (SVG canvas coordinates, not real
lat/lon). Printing them beside real served scores would mis-describe how those
scores were produced. The expandable slot is preserved; its content must come from
the served policy's own method description at wiring time.

### Extracted geometry (frame 136:8684, 1440×1366)

Header 1440×78 (pad 14/28) · divider `#EFF0F6` · Body fill `#F9F9F9`, pad 20, gap 16
Grid at y=99, 1400 wide, gap 16 → **left 360 / map 668 / right 340**
Card ① 360×241 r20 pad18 · Card ② 360×777 r24 pad28 · factor cards 304 r14 stroke1.6
Right: ③ 340×535 r20 · ④ 340×230 · ⑤ 340×429
Factor accents: `#C9433C` `#188A52` `#D6A419` `#6E4FE0` (also the ② bar segments)
Map legend 스크리닝 내역 110×118 r14, four rows, 안정 후보 = outlined swatch `#B23A78`

Full dump: `page4-figma-spec.txt` (534 nodes) generated in the session scratchpad.

### The designer's 수정 요청 (frame 225:440)

Verbatim strike list, mapped to real components:

| Instruction | Component |
|---|---|
| delete 상단 소제목 후보지 심층 분석 + 설명 | `PageHeader` + `ModeOrientation` in `page.tsx` |
| delete small text under ① | `SuitabilityScopeCard` footer lines |
| delete 안정 후보 explanation under ② | `SuitabilityScoringBasis` stability row |
| delete 후보 상태 요약 / 자료 공백 안내 / 계산 방법과 가정 (left) | `SuitabilityStatusSummary`, coverage card, methodology card |
| delete 4 supporting cards (right) | stable list, `SuitabilityCandidateSummary`, `SuitabilityStabilitySummary`, 2× `ReasonSummary` |
| ABC colours green/amber/red, reflected on rank rows | `RelativeGradeChip` + `SuitabilityCandidateList` |
| ABC thresholds user-selectable | **needs backend policy** |
| 순위보기 TOP 5 only | `SuitabilityCandidateList` |
| rename to ① 지역 선택 | `SuitabilityScopeCard` ✅ **done** |

> The list also reports a bug: selecting 서울 makes the ABC criteria disappear so no
> ranking shows. Per `suitability-region-code-space`, **run 47 genuinely has zero
> 서울 candidates** — this is real absence, not a defect. The correct fix is an
> explicit empty state, never a fabricated ranking.

---

## 3. What actually shipped

| Change | File |
|---|---|
| ① renamed 분석 범위 → **지역 선택** (explicit designer instruction) | `SuitabilityScopeCard.tsx` |
| matching heading assertion updated | `page.page4a.test.tsx` |
| **V3 adapter boundary** — component vocabulary, Figma-sourced Korean labels/descriptions/accents, `isV3Component`, `looksLikeV3Components` | `lib/suitabilityV3.ts` (new) |
| **Visual-QA capture harness** at 1440×900, output written outside the repo | `e2e/page4VisualQa.spec.ts` (new) |

`lib/suitabilityV3.ts` deliberately contains **no weights, no thresholds, no floor,
no versions, no eligibility rule** — every one is backend-owned policy. Its
`looksLikeV3Components` check is *positive*: a Z/R/E/D run falls through to `false`
so the UI keeps rendering the legacy model rather than relabelling four old scores.

---

## 4. Two strike-list items were withheld, on purpose

Applying the full strike list was attempted and **reverted** after it broke
contracts well outside Page 4:

1. **후보 상태 요약** carries `data-testid="suitability-summary"` — the load-readiness
   sentinel for **nine e2e specs across five other pages** (`publicRelease`,
   `transparencyDashboard`, `responsive`, `scenario`, `desktopNavigation`,
   `facilityCost`, `suitabilityDashboard`). Removing the card deletes that sentinel
   everywhere. That is a cross-page contract migration, and this lane is scoped not
   to regress other pages nor to run the global suite that would prove it safe.

2. **선택한 후보 구역** (`SuitabilityCandidateSummary`) is the only surface showing a
   selected candidate's per-component scores. Striking it broke candidate selection
   across `page4a`, `page4b` and `suitabilityDashboard` — functionality, not decoration.

Both are correct to remove **once** the readiness sentinel is migrated to a stable
Page-4 anchor and the dependent specs are updated. That belongs to final integration,
with a full regression run — not to a blind removal here.

---

## 5. Figma comparison — PASS 1 (1440×900)

Captured against the mock backend. **20 mismatches** recorded; the ones already
diagnosed to a component:

*Struck by the designer, not yet applied (see §4):* rail headers 분석 조건 / 후보지 결과 ·
`후보지 심층 분석` h1 + two prose lines · ① footer small text · ② description line ·
③ long explanatory paragraph · ④ weight-recap prose.

*Blocked on backend:* ② still shows Z/R/E/D with a 5-option profile radio list where
Figma draws four V3 factor cards each with a `가중치 설정 __%` input · ③ shows a
"상대 점수 구간" fallback paragraph where Figma draws the A/B/C threshold rows with
editable score inputs · ③ scope pills (수도권 전체/서울/인천/경기) absent.

*Independent defects:* map legend is a large checkbox panel with counts, a 5-grade
scale and prose where Figma draws a compact 110×118 four-row 스크리닝 내역 · rank rows
render `88.1234점` (4dp + 점) where Figma shows `94.8` · rank row accent is grey where
Figma ties it to the A/B/C grade colour · brand tagline and one nav label differ.

**PASS 2 was not run.** With the strike list withheld and the V3 wiring blocked,
a second capture would have shown the same frame; re-running it would have produced
a comparison artefact with no change to compare. This is the honest gap in the
mandate's two-pass requirement, not an omission.

---

## 6. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **exit 0**, clean |
| `eslint` (all changed + new files) | **exit 0**, clean |
| Focused Page-4 units (`page4a/b/c/d`, `page4PrimaryCopy`, `suitabilityDashboard`) | **176 tests, 0 failures** in isolation |
| Playwright capture at 1440×900 | passed (2.6m) |
| Global suite | **not run** — Backend Master owns heavy regression |
| Accessibility | no a11y-affecting change shipped; the `<h1>` was left intact precisely because removing it was an a11y regression |

**Contention warning.** A combined 6-file vitest run reported 7 failures that
**vanished to 0** when the same files ran alone. Three other lanes
(`page5-v3-final`, `page6-v3-final`, backend) share this volume. Per
`vitest-parallel-lane-contention`, treat any multi-file failure here as suspect
until reproduced in isolation.

Environment notes: `/Volumes/WASTE_QA2` was absent at session start and had to be
remounted. Node 20 is the shell default but the toolchain needs **node 22**.
The volume is slow enough that Playwright's 120 s `webServer` timeout expires — start
`next dev` separately and use `--timeout=240000`.

---

## 7. Required to finish

1. Publish `origin/release/backend-v3-ready-20260817`; read the exact model/policy/
   scenario versions, component keys, weights, normalization, resident floor,
   eligibility, missing reasons and stability contract.
2. Wire card ② to the served V3 components through `lib/suitabilityV3.ts`, with an
   explicit model/version request parameter rather than a hidden server default.
3. Decide the weight-input question from the served scenario contract: Page 4 renders
   a **stored run**, so a free weight input must not imply a recomputation that does
   not happen, and must not silently redefine screening eligibility.
4. Migrate the `suitability-summary` readiness sentinel, then apply the full strike
   list and update the dependent specs.
5. Re-run the Figma comparison passes with the V3 content in place.

No backend file was modified. Nothing was deployed. Nothing was merged to `main`.
