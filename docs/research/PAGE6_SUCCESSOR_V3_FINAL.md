# Page 6 — 데이터·출처 — Successor-V3 methodology / provenance lane

Status of this document: **PART 1 COMPLETE (Figma fidelity + copy reduction),
PART 2 BLOCKED (Successor-V3 methodology content) pending the backend handoff.**

Nothing in this lane was deployed. No backend file was modified.

---

## 1. Base and identity

| | |
|---|---|
| Frontend base branch | `origin/integration/frontend-fidelity-20260817` |
| Base SHA | `be93abb8ed61fabb7997f64a07f95d5ab356530c` |
| Working branch | `feat/page6-successor-v3-methodology-final` |
| Worktree | `/Volumes/WASTE_QA2/worktrees/page6-v3-final` |
| Final SHA (this report's state) | `8c6bb140683bf84b3f97aa21caee0b9d07b19153` |
| Backend handoff SHA | **NONE — not yet published** (see §9) |
| Figma frame | `156:470` in `hETmPv3N31IJeW8XdLwoiS` |

Environment: `/Volumes/WASTE_QA2` only, `source /Volumes/WASTE_QA2/recovery-env.sh`.
`/Users/byeongilmin/dev/waste-equity-platform` was not modified.

### 1.1 Environment note (relevant to reproducing this lane)

`:3000` and `:3100` — the only two origins in the backend's `CORS_ALLOW_ORIGINS` —
were both held by concurrent lanes (`page4-v3-final` and
`frontend-page1-page2-figma-remediation`). This lane therefore ran its dev server on
`:3200` behind a local CORS passthrough on `:8100`
(`/Volumes/WASTE_QA2/tmp/p6-cors-proxy.mjs`, outside the repo). It forwards verbatim
to `:8000` and relaxes only `Access-Control-*`. No shared container, repo file, or
other lane was touched.

---

## 2. The finding that drove the visual work

Figma frame `156:470` is **scaled**. It reports `strokeWeight = 1.354807734489441`
where the unscaled sibling artboards report `1.0`:

| Frame | Width | `strokeWeight` |
|---|---|---|
| `74:1992` page-1 | 1440 | 1.0 |
| `221:441` modal1 | 1180 | 1.0 |
| **`156:470` Page 6** | **1409** | **1.354807734489441** |

Confirmed independently through the Figma MCP: every 1px divider inside the frame
(`rounded-rectangle` node heights — the card hairlines, the table row rules, the
footer rule) renders at exactly `1.354807734489441`.

Dividing the frame by that factor turns essentially every value into an exact
integer — **1040** wide, 976 content, 32 gutter, 22 section gap, 14 radius, 8/12/16
spacing — and lands its type on the same scale the unscaled sibling modal uses
(title 20, card title 13, body 12, small 11). Under the alternative reading
(÷1.0838 → 1300 base) only about six of nineteen values are integers.

**The design width is 1040, not 1300.** The app's dialog is 1088
(`.wep-dialog` `max-width: 68rem`), a ratio of 1.046, so the frame's px apply ~1:1.

A previous pass had inferred 1.0838 and rendered the screen ~25% oversized
throughout. That is what this lane corrected.

---

## 3. Files changed

All frontend, all presentation. `git diff --stat be93abb..8c6bb14`:

```
 frontend/src/app/globals.css                                  | 34 +++++++--
 frontend/src/components/TransparencyDashboard.tsx             | 15 ++--
 frontend/src/components/transparency/DatasetPeriodTable.tsx   | 32 ++++-----
 frontend/src/components/transparency/KnownDataGaps.tsx        | 12 ++--
 frontend/src/components/transparency/SourceCatalog.tsx        |  2 +-
 frontend/src/components/transparency/SourceCatalogItem.tsx    | 29 ++++----
 frontend/src/components/transparency/SourceFilterPanel.tsx    | 21 ++++--
 frontend/src/components/transparency/SourceOverview.tsx       | 62 ++++++++++------
 frontend/src/components/transparency/TransparencyDefinitions.tsx |  8 +--
 frontend/src/components/transparency/TransparencyMethodology.tsx |  4 +-
 frontend/src/components/transparency/TransparencySection.tsx  | 22 ++++--
 11 files changed, 161 insertions(+), 80 deletions(-)
```

**No backend file was touched. No endpoint, request parameter, response field, count,
reference period, snapshot, availability rule, filter option, ordering, link, or
analytical value changed.**

---

## 4. Figma comparison — measured, not eyeballed

Rendered at **1440×900**; the dialog measures 1088. Every figure below is
`getComputedStyle` off the live DOM, compared against the frame ÷1.354808.

### 4.1 Corrected (delta now 0)

| Element | Figma | Before | After |
|---|---|---|---|
| section `h2` | 16 / 700 | 20 | **16** |
| section description | 12.5 | 14 | **13** |
| tile label / figure / unit | 12 / 22 / 12 | 14 / 30 / 14 | **12 / 22 / 12** |
| tile radius / padding / gutter | 14 / 14×16 / 14 | 16 / 16×20 / 16 | **14 / 14×16 / 14** |
| card radius / padding | 14 / 14 | 16 / 16 | **14 / 14** |
| card title / organisation | 13.5 / 12 | 16 / 14 | **14 / 12** |
| card chip fs / pad / radius | 10.5 / 4×9 / 8 | 12 / 4×12 / 10 | **11 / 4×10 / 8** |
| card rows / disclosure | 11.5 / 11 | 14 / 12 | **12 / 11** |
| card gutter | 12 | 16 | **12** |
| section rhythm | 22 | 24 | **22** |
| table cells / header / row name | 12 / 11 / 13 | 14 / 12 / 16 | **12 / 11 / 13** |
| control radius / text / row gap | 10 / 12.5 / 8 | 12 / 14 / 10 | **10 / 13 / 8** |
| modal head padding | 26 / 32 | 16 / 20 | **26 / 32** |
| modal head title | 21 | 17 | **21** |
| modal head rule | none | 1px | **none** |
| close control shape | circle, filled, no border | square, outlined | **circle, filled, no border** |
| left gutter (all 9 elements) | 32 | head 20 / body 24 | **32** |

The four half-pixel Figma values (12.5 / 13.5 / 10.5 / 11.5) round up to whole px;
the 1088-vs-1040 dialog width justifies rounding up in any case.

The nine left edges — dialog title, supporting line, banner, both `h2`s, first tile,
first card, closing note — now all measure exactly **32**. They previously did not
(head 20, body 24).

### 4.2 Deliberately NOT adopted — and why

| Figma | Kept instead | Reason |
|---|---|---|
| controls 33px tall | **44px** | the application's minimum target |
| close control 36px | **44px** (shape/fill adopted) | same |
| no visible field labels | **labels kept** | a placeholder is not an accessible name, disappears on input, and a `<select>` cannot carry one |
| no 알림 banner | **banner kept** | it carries "제공되지 않는 값은 0이 아니라 '자료 없음'" — the missing≠zero rule |
| no 현재 조건 summary; count only | **summary kept** | its default-state wording is contracted by 5 assertions across 2 suites, and it was a deliberate prior decision |
| link styled bold, not underlined | **underline kept** | otherwise link identity is colour-only (WCAG 1.4.1) |
| tile captions absent | **1 of 4 kept** | see §5 |
| frame's `9 / 6 / 5 / 2`, `9건 표시`, `32개 지역`, `처리시설 → 자료 없음` | **served values** | prototype placeholders that contradict production; pre-existing rule, unchanged |

---

## 5. Copy reduction

Removed (permanently-visible prose, ~90 characters):

- `이 서비스에 등록된 출처 기록 수입니다.` — restated its own label
- `등록된 자료가 다루는 주제의 수입니다.` — restated its own label
- `기관이 제공한 안내 주소가 등록된 자료입니다.` — restated its own label
- `나머지는 기준 기간이 제공되지 않은 자료입니다.` — arithmetic the reader can do
  from two figures already on screen

**Kept:** the period tile's *unresolved* caption
`기준 기간 정보를 아직 확인하지 못했습니다. 0건이라는 뜻이 아닙니다.` — it is the only
place on the screen that can tell a reader an un-fetched count is not a zero (there
is no badge and no definition that says it), and `TransparencyDashboard.test.tsx`
asserts it. `OverviewTile`'s `caption` prop became optional to express this.

Density effect at 1440×900: the first viewport went from one partial row of source
cards to **two full rows**.

---

## 6. Preserved Page-6 contract

Every item on the lane's preserve-list was verified present and unchanged:

canonical methodology role · provenance · source definitions · known data gaps ·
failed lookup ≠ zero · missing ≠ zero · official vs derived · differing periods ·
per-capita semantics · accounting incompatibility · screening ≠ legal/final siting
decision · ranking denominator disclosure · wetland provenance · land-cover
provenance · bordered / hairline / low-shadow treatment (this view still renders no
`.wep-figma-card` elevation, and a unit test asserts it).

The five distinct outcome states (loading · catalog · registry served no sources ·
search matched nothing · genuine failure, only the last an `alert`) are untouched.

---

## 7. Verification

| Check | Result |
|---|---|
| `TransparencyDashboard.test.tsx` + `dataSources` + wetland + land-cover | **132 passed** |
| `TransparencyDashboard` + `page.dataDialog` + `accessibility` + `shell` | **139 passed** |
| `tsc --noEmit` | **0 errors** |
| `eslint` (Page-6 surface) | **0 errors** |
| Browser QA @1440×900 | 3 passes, all measured deltas 0 |
| Horizontal overflow | none |
| Card width / columns | 333px / 3 (e2e floor is >300 and ≥2) |

Full Playwright was **not** run — the Backend Master owns final heavy QA, per the
lane brief.

**Flake note:** a 4-file parallel run produced 4 timeouts (5000ms) in
`shell.test.tsx` and `accessibility.test.tsx`. Both files pass **17/17 in isolation**
on this branch. This is the documented multi-lane vitest contention signature (three
other lanes were running vitest concurrently), not a regression.

### 7.1 Accessibility

- Every section remains a `<section aria-labelledby>` pointing at a **visible** `<h2>`.
- Field labels retained against Figma (§4.2).
- Link underline retained against Figma (§4.2).
- 44px targets retained for all five controls against Figma (§4.2).
- The single `role="status"` live region and the `sr-only` freshness status are
  unchanged and still outside any collapsed disclosure.
- Type floor after the reduction: 11px, used only for chips and the technical
  disclosure — both secondary, both alongside 12–13px body copy.

---

## 8. Figma MCP

The lane brief made MCP inspection mandatory before visual sign-off.

- At the start of the session **no Figma MCP tool existed** — `ToolSearch` for
  `+figma` returned nothing, and `plugin:product-management:figma` was listed as
  requiring authentication in a non-interactive session. This was stated plainly
  rather than worked around, and the interim analysis used the Figma **REST** API on
  the identical file and node (`GET /v1/files/…/nodes?ids=156:470`, HTTP 200).
- The MCP server connected later in the session. `whoami` → `Aaron Min`.
  `get_metadata` and `get_screenshot` were then run against `156:470`.
- **The MCP reproduced the REST geometry exactly** and independently confirmed the
  1.354808 scale via the 1px-divider heights.
- The MCP **screenshot** surfaced two mismatches the node tree had not made obvious
  (no head rule; circular close control), both fixed in `8c6bb14`.

---

## 9. PART 2 — Successor-V3 methodology content: BLOCKED

Neither handoff branch exists on `origin` as of this report:

- `release/backend-v3-ready-20260817` — **absent**
- `integration/backend-v3-contract-preview-20260817` — **absent**

Both are being polled. The related `docs/suitability-v3-phase5-activation-decision`
(`a21e907`) **does** exist but carries neither `SUITABILITY_V3_FINAL_POLICY.md` nor
`SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md`; it holds a
`PHASE5_ACTIVATION_DECISION_REQUEST`. It was inspected read-only and **no policy was
adopted from it** — it is not the named handoff and the lane brief forbids inventing
policy.

Accordingly the following remain **unwritten**, and no placeholder for any of them
appears in user-visible production code:

policy version · model version · scenario version · the four component definitions
(`existing_burden`, `air_impact_proxy`, `resident_impact`, `land_conversion`) ·
component orientation · final weights · missing-component policy · air-impact grain ·
resident distance floor · land registry version · ambiguous-class treatment ·
normalization · CRITIC status · stability definition · persistence/version behaviour ·
historical Z/R/E/D coexistence · coverage statistics.

### 9.1 The slot is already built

`SUCCESSOR_METHODOLOGY_SLOT` (`components/transparency/shared.ts`, rendered by
`TransparencyDefinitions` at `transparency-def-successor`) currently states only that
the next screening methodology is **not settled**, and publishes no weight, threshold,
distance, numerator, direction, or stability rule. That is the correct pre-handoff
state and is what Part 2 will replace.

The historical model (Z / R / E / D) and the Successor V3 components will be
presented as **coexisting**, so no reader concludes stored historical runs were
rewritten.

### 9.2 On the preview branch

Per the scheduling-acceleration instruction: if
`integration/backend-v3-contract-preview-20260817` appears with a frozen
model/policy/scenario version plus implemented request/response schemas, API wiring
begins against it, treated as **non-production and provisional**, and is diffed
against `release/backend-v3-ready-20260817` when that appears — updating to the
authoritative contract before final tests and push. Nothing is deployed from the
preview.

---

## 10. Not done, by instruction

- No deployment.
- No `main` merge.
- No backend change.
- No Page 1–5 logic change. The only shared file touched is `globals.css`, and every
  rule added there is scoped to `[data-testid="data-sources-dialog"]`, so the four
  other `Dialog` call sites (Pages 3, 4, 5) are unaffected.
- Full Playwright not run (Backend Master owns final heavy QA).
