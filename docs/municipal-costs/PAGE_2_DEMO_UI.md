# Page 2 — Municipal cost demo UI pass

Branch: `feat/page2-municipal-cost-demo` (based on `origin/main` @ `fa3b38f`)
Date of the recorded execution: **2026-08-13**
Status: **implemented and validated locally against the live dev backend. Not merged,
not deployed.**

Companion documents: [`STEP_3_FRONTEND_IMPLEMENTATION.md`](STEP_3_FRONTEND_IMPLEMENTATION.md)
(the implementation this refines), [`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md)
(the API), [`METHODOLOGY.md`](METHODOLOGY.md) (semantics).

This is an **incremental pass over the shipped section**, not a second implementation.
Every component named in Step 3 is still the one rendering; no municipal-cost
component was replaced, duplicated, or forked, and no second copy of the filter state
or the fetch exists. No backend file, migration, served value, or methodology was
changed.

---

## 1. What changed, and why

| # | Change | Why |
| --- | --- | --- |
| 1 | The comparison opens on **계산 가능** instead of 전체 | Opening on all 66 rows meant opening on a list that is 41/66 자료 없음. The comparable set was buried under absence and the screen read as "the platform has nothing". |
| 2 | 자료 상태 became a **chip group carrying the served counts** | A `<select>` hides the very thing the default makes load-bearing: how large each scope is, and that widening is one click away. |
| 3 | Each row names its **tier of 기초자치단체** (서울 자치구 / 인천 군·구 / 경기 시·군) | "시·군·구" is correct in aggregate and wrong per row. An 인천 군 is not a 자치구. |
| 4 | A PARTIAL row carries a **제한 있음 marker on the value itself** | The status badge sits a column away; a reader scanning the per-capita numbers could compare a limited value against an unlimited one without ever crossing it. |
| 5 | The **2024 reference year** is stated as a served chip plus an explicit sentence | The screen above has its own year control whose default is the latest complete landfill year (2025). Nothing said the municipal figures do not follow it. |
| 6 | The section is laid out as **조건 → 비교표 → 산출 방법과 한계 sub-cards** | Brings the section into the Page 2 card language (titled card, unit line in the header, `·`-prefixed reading notes under the table). |

### 1.1 The default is a scope, never a curated list

`MUNICIPAL_COST_DEFAULT_STATUS = "AVAILABLE"` (`frontend/src/lib/urlState.ts`) is sent
to the backend as the existing `status` parameter. There is **no municipality
whitelist anywhere in the frontend**, and no count, total, per-capita value, or reason
is hard-coded — a test asserts a served metadata change moves every figure on screen
(`no frontend fallback data`).

The default conceals nothing, because the backend computes
`expected_count` / `available_count` / `partial_count` / `unavailable_count` over the
selected metropolitan **before** the status filter. Those four numbers sit on the four
chips at all times, so the size of what the default excludes is on screen while it is
excluded, and a 지금은 ‘계산 가능’ 지자체만 표시합니다 line names the full scope the
reader can widen to.

### 1.2 The 전체 URL token

`null` (전체) used to be encoded by omission because it was the default. It no longer
is, so it needs a token of its own — otherwise a shared "I widened this" link would
silently re-narrow on open. `mcStatus=all` is a URL-layer sentinel only; it is never
sent to the backend, whose `status` parameter takes the three enum members or nothing.
This mirrors the suitability status filter's existing `none` sentinel.

---

## 2. Files

### Changed

| Path | Change |
| --- | --- |
| `frontend/src/lib/urlState.ts` | `MUNICIPAL_COST_DEFAULT_STATUS`; `mcStatus=all` sentinel in encode/decode |
| `frontend/src/lib/municipalCost.ts` | `unit` on each sido option; `metropolitanUnitLabel`, `municipalityScopeCaption`, `MUNICIPAL_COST_STATUS_CHOICES`, `statusChoiceLabel`, `statusChoiceCount` |
| `frontend/src/app/page.tsx` | `mcStatus` initial state is the released default (2 lines) |
| `frontend/src/components/landfill/municipalCostShared.ts` | Year note/chip suffix, filter + comparison card copy, table footnotes, 제한 있음 label; the distinction note now states what the indicator *is* first |
| `frontend/src/components/landfill/MunicipalCostFilters.tsx` | 조건 card, status chips with served counts, reference-year chip, 현재 선택 조건 restated, narrowed-scope note |
| `frontend/src/components/landfill/MunicipalCostTable.tsx` | Comparison card + unit line, 광역 column → tier caption, 제한 있음 marker + `aria-describedby`, `·` footnotes |
| `frontend/src/components/landfill/MunicipalCostSection.tsx` | Docstring only (layout note) |
| `frontend/src/lib/municipalCost.test.ts` | +9 tests |
| `frontend/src/lib/urlState.test.ts` | Fixture default + 3 tests for the sentinel |
| `frontend/src/components/landfill/MunicipalCostSection.test.tsx` | +24 tests, 5 updated |

### Not changed

`MunicipalCostRowDetail.tsx`, `MunicipalCostStates.tsx`, `MunicipalCostMethodology.tsx`,
`LandfillDashboard.tsx`, `lib/api.ts`, and every official-landfill component. The
official 수도권매립지 반입수수료 metric is untouched in label, card, calculation, table,
and visual hierarchy.

---

## 3. Semantics preserved

These are the Step 2/3 rules the pass had to carry through unchanged, and the tests
that pin them:

- **Absence is never zero.** `formatPayment` / `formatPaymentPerCapita` still return
  `null` for a `null` money field, so a call site cannot render ₩0 from one. An
  UNAVAILABLE row keeps its place and shows 자료 없음, never `0`, `0원`, `0원/인`, or a
  bare `-`. (`shows an UNAVAILABLE municipality as 자료 없음 — never ₩0`)
- **A counted zero is still a zero.** `statusChoiceCount` returns a served `0`; only
  the *absence of a response* renders nothing. (`reports a served zero as zero`)
- **No client-side filtering or re-sorting.** All three controls are backend
  parameters; the backend places nulls last on both value sorts. (`renders rows in the
  SERVED order`, `re-renders the served order a different sort returned`)
- **The two indicators stay apart.** The distinction banner is outside every
  disclosure, renders `meta.difference_from_official_landfill_fee` verbatim, and now
  also states positively what the indicator is — a per-resident conversion of contract
  payments, and neither a resident's own bill nor the official inbound fee.
- **A limitation reaches the value.** PARTIAL values are `aria-describedby` the served
  limitation sentence. UNAVAILABLE values deliberately are **not**: the cell already
  says 자료 없음, and describing absence by its reason as well would double it.
- **An unknown code is not guessed.** `metropolitanUnitLabel` returns `null` outside
  the published three, and the caption drops the tier rather than inventing one.
- **A request failure shows no figures at all** — not the released 66/20/5/41.

## 4. Accessibility

- The status chips are `<button aria-pressed>` inside a `role="group"` named by a
  **visible** `자료 상태` label, following `components/ui/SegmentedControl.tsx` and
  reusing its `.wep-segment` track. Deliberately not a `<fieldset>` of radios:
  `e2e/accessibility.spec.ts` asserts the page has exactly three fieldsets (the equity
  metric groups). Plain Tab order, no roving focus promised.
- Selection is carried by `aria-pressed`, a raised white pill, and a heavier weight —
  never colour alone. 자료 상태, 제한 있음, and 자료 없음 are all text.
- 지역 and 정렬 stay native `<select>`s with wrapping `<label>`s.
- Heading hierarchy: section `h2` → 조건 / 비교표 / 산출 방법과 한계 `h3`. The table keeps
  its `<caption>`, `scope="col"` headers, and a row header per municipality.
- The `role="status"` live region stays outside every collapsed `<details>`.
- 360 px: `document.body.scrollWidth === clientWidth` — nothing overflows sideways.

## 5. Validation

Measured on 2026-08-13 against the dev backend on `localhost:8000`
(66 rows, 20/5/41, `reference_year` 2024).

Run under **Node 22** (`nvm use 22`). Node 20 is not usable here: it cannot
`require()` the ESM-only `std-env` the lockfile pins, so vitest fails to load
`vitest.config.ts` before running anything, and `npm ci` resolves a different tree
(576 packages instead of 487) that omits `@rolldown/binding-darwin-x64`.

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | ✓ compiled, TypeScript ✓, 4/4 static pages |
| `npx vitest run --testTimeout=120000 --maxWorkers=3` | **1225 passed, 0 failed, 7 skipped (52 files)** |
| `npx vitest run` (default 5 s timeout) ×3 | **1225 passed, 0 failed, 7 skipped** each time |

Baseline comparison: the recorded baseline was 1188 passed / 1 failed / 7 skipped.
This branch adds 36 tests and the suite is green.

**Known baseline race — observed, then cleared.** `src/app/page.phase7.test.tsx`
failed once, full-suite only, while three sibling lanes were building and the machine
load average was ~350; it passed 11/11 in isolation immediately afterwards, which is
exactly the recorded baseline behaviour. Once the load dropped it stopped reproducing
across three consecutive default-timeout full runs. No timing hack was added for it.

Under that same ~350 load the default 5 s timeout also failed a *large,
non-reproducing* set of untouched files (18–36 tests across 5–6 files, disjoint
between consecutive runs, including files this branch does not touch). Those were
machine contention, not defects: every one passed in isolation and all are green now.

### Live behaviour verified in the browser

| Selection | URL | Result |
| --- | --- | --- |
| default | *(no `mcStatus`)* | 20 rows, 계산 가능 chip pressed, chips read 20 / 5 / 41 / 66 |
| 일부 제한 | `mcStatus=PARTIAL` | 5 rows, each value carrying 제한 있음 and its served limitation |
| 전체 | `mcStatus=all` | 66 rows, 41 of them 자료 없음 with no zero anywhere |
| 인천 + 전체 | `mcSido=28&mcStatus=all` | 10 군·구 rows, all three statuses visible together |

---

## 6. Not done

- The Page 2 Figma also asks for a scatter plot, a monthly-trend hover, and an Excel
  export **on the official landfill dataset**. Those belong to the official metric,
  which this lane must not modify.
- No e2e spec was added. `e2e/landfill.spec.ts` covers the official view and needs a
  live backend; the municipal section's behaviour is covered by the component suite.
