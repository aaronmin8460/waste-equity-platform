# Citizen facility cost lens (full-width dashboard UI)

The citizen-facing front end for the facility cost backend. It is reached **inside
the Suitability experience** as a sub-view — `[적합성 점수] [비용 렌즈]` — but the 비용
렌즈 view now renders as a **full-width dashboard with no map**
(`components/FacilityCostDashboard.tsx`, wired in `app/page.tsx`), replacing the
earlier narrow sidebar panel (`FacilityCostPanel.tsx`).

It is a **decision-support** tool, not propaganda for or against a facility. It
presents the backend's standard-construction-cost **analysis** with its disclaimer
and completeness; it never shows an actual total project cost, an approved subsidy,
a personal tax bill, or a cheapest-site ranking, and it renders unavailable
components as explicitly unavailable — never as `0`. Displayed money is the exact
backend-served decimal string, formatted without changing its value. Numeric
conversion is used **only** for chart proportions, never to reconstruct a displayed
value from an imprecise float.

## Full-width routing (no map)

Selecting 적합성 → 비용 렌즈 triggers a full-width early return in `app/page.tsx`. The
cost view mounts **no `MapView`, no map container, and no floating legend** — the V1
cost model does not vary by map cell, so a map beside it would be dead weight (the
same rationale and full-width shape as the 수도권매립지 flow dashboard). The main mode
switch (형평성 / 적합성 / 수도권매립지) and the 적합성 점수 / 비용 렌즈 sub-view switch stay
reachable above the dashboard (both keep `aria-pressed` and keyboard navigation), and
the selected suitability candidate is passed through so its context card still renders.
Returning to 적합성 점수 restores the sidebar + map. This is asserted by
`e2e/facilityCost.spec.ts` and `e2e/integration.spec.ts` (`map-container` count `0`
in the cost view) and `app/accessibility.test.tsx`.

## Information architecture

`FacilityCostDashboard` lays the existing `/facility-cost/calculate` response out as:

1. **Header** — `<h1>` **우리 지역에 시설이 생긴다면** + supporting explanation
   ("선택한 지역의 공식 폐기물 발생량을 바탕으로 필요한 시설 규모와 정부 표준공사비 기준
   설치비를 분석합니다."). It is the single logical `h1` of the full-width view.
2. **Warning notice** (always visible) — the fixed disclaimer that this page does not
   recommend for or against construction, plus the non-claims list (see below). When a
   result is present it also lists the backend's structured `missing_components`.
3. **Filter bar** — primary inputs in a responsive grid, advanced inputs in a
   disclosure, and an explicit calculate button (see below).
4. **KPI grid** — the eight indicators (see below), responsive 1→2→4 columns.
5. **Funding breakdown** — a stacked bar splitting the one-time installation cost into
   nominal subsidy + simplified local share.
6. **Official-input region table** — per-region generation, population, derived share.
7. **Missing components** — backend `missing_components` with Korean labels + reasons.
8. **Candidate context** — when entered from a selected candidate.
9. **Provenance / evidence** — sources, versions, assumptions, disclaimer.
10. **Citizen deliberation** — client-only conditions + stance.

## KPI definitions and units (exact backend units)

| # | Card | Backend field | Unit |
| - | ---- | ------------- | ---- |
| 1 | 공식 연간 폐기물 발생량 | `official_input.official_annual_quantity_ton` | 톤/년 |
| 2 | 시나리오 처리량 | `capacity.annual_service_quantity_ton` | 톤/년 |
| 3 | 필요 시설 규모 | `capacity.facility_capacity_ton_per_day` | 톤/일 |
| 4 | 표준공사비 기반 설치비 산정액 | `standard_cost.standard_construction_cost_bn` | 억원 |
| 5 | 연간 환산 설치비 | `annualization.annualized_construction_cost_bn` | 억원/년 |
| 6 | 명목 국고보조 추정액 | `subsidy.estimated_national_subsidy_bn` | 억원 |
| 7 | 단순 지방비 추정액 | `subsidy.simplified_local_government_share_bn` | 억원 |
| 8 | 주민 1인당 환산 지방비 | `per_capita.per_capita_local_share_won` | 원 |

The KPI grid section is a labelled group (`aria-label="핵심 지표"`), and the results
container is a `role="status"` region so a screen reader announces a new calculation.

## Permitted vs prohibited terminology

- **Permitted (honest):** 표준공사비 기반 설치비 산정액, 연간 환산 설치비, 명목 국고보조
  추정액, 단순 지방비 추정액, 주민 1인당 환산 지방비. Every monetary card is a
  standard-cost **analysis / estimate**, and the caveats state what it is **not**.
- **Prohibited (never used as an affirmative label):** 총비용, 실제 총사업비, 확정
  사업비, 확정 보조금, 실제 세금, 주민 부담 청구액, "최저 비용" / cheapest-site ranking.
  (The honest caveats legitimately contain "…이 아닙니다" phrasings such as "실제
  총사업비가 아님"; these negations are required and are distinct from an affirmative
  claim. `total`-cost wording — 총비용 — never appears at all.)

The always-visible warning lists the non-claims: 운영비 미포함 · 실제 운송비 미포함 ·
토지·보상비 미포함 · 잔여 매립비용 미포함 · 후보지별 토목조건 미포함 · 실제 총사업비가 아님 ·
실제 승인된 국고보조금이 아님 · 주민 개인의 실제 세금 청구액이 아님.

## Funding-breakdown interpretation

A stacked horizontal bar (decorative, `aria-hidden`) splits the **one-time**
표준공사비 기반 설치비 산정액 into 명목 국고보조 추정액 + 단순 지방비 추정액; all three
amounts are also shown as exact text. The bar widths use `Number()` conversion for
proportion only. Rules:

- It does **not** mix the annualized cost into the same total.
- It does **not** imply subsidy approval — the caption states "보조금 승인을 의미하지
  않으며 …".
- Missing components are **not** drawn as zero-width categories; missing is not zero,
  so they appear only in the warning/missing sections.

## Per-capita caveat

`per_capita.per_capita_local_share_won` is a simplified per-resident conversion of the
local share, **not** an individual tax bill; the card always shows its caveat. When the
backend cannot compute it (no compatible official population), the card stays visible
and shows the served `unavailable_reason` — **never a fabricated `0원`**.

## No regional cost allocation

The official-input region table shows each service region's official generation,
population, and its **share of the official total generation** — a share explicitly
labelled a display-only derived value ("표시용 파생값"). The dashboard does **not**
split subsidy or local-government cost across regions by population, waste, equal
split, or any assumed agreement — regional cost allocation is a non-goal. A region
with no official population shows explicit unavailable text, never `0명`.

## Filter bar

Primary inputs (multi-column: 1 → 2 → 3): facility type · waste stream · processing
share (%) · **service regions** (full-width native multi-select). Advanced inputs, in
an accessible disclosure: operating days · underground multiplier · subsidy scheme ·
cost version (shown only when more than one exists). Every control has an associated
`<label>`; a keystroke never sends a request — the explicit calculate button is the
only submit path, and it is disabled while no region is chosen, while an input is out
of range, or while a request is active (no duplicate submission).

The service-region picker is derived from **calculable coverage** — the regions that
actually have `RegionalWasteStatistics` for the *selected* waste stream — so a citizen
can never pick a code that always returns `OFFICIAL_WASTE_UNAVAILABLE`. Each option
shows its `region_code`, disambiguating duplicate names (Seoul 중구 vs Incheon 중구).
Changing the waste stream re-derives the choices and clears the now-invalid selection.
Numeric inputs are validated (processing share 0–100, operating days 1–366, underground
multiplier within bounds) with a `role="alert"` message. The subsidy-rate source (the
국고보조금 업무처리지침 nominal rates, an analytical assumption) is shown beside the
subsidy selector in every state. The service-region selector remains a native
multi-select in this phase; a searchable combobox is a later phase.

## Stale-result handling

Results/errors are shown **only** while they still match the live inputs: a control
change (or a new map candidate) changes the input signature, so an out-of-date result
disappears and a "입력이 변경되었습니다. 다시 계산하세요." notice is shown until the user
recalculates. A superseded in-flight response (inputs changed while it was pending) is
discarded by a monotonic request id and never rendered.

## Candidate integration

When a suitability candidate is selected, its `candidate_id` is passed to the backend
and the result shows the candidate key/region/analytical status/run+profile with the
note that the standard cost does not vary meaningfully by candidate cell, plus the
suitability screening disclaimer and the candidate's own reference year + versions. An
`ELIGIBLE` screening status is never reinterpreted as legally eligible / permitted /
approved / developable, and the dashboard never claims the candidate changes land,
transport, or site-specific cost (unavailable in V1).

## Citizen deliberation (client-only)

A conditions checklist (실시간 배출정보 공개, 완충구역, 운행경로 관리, 상시 측정, …) and a
stance (검토 가능 now / 조건 충족 시 / 추가 정보 필요 / 반대). **Client-only and
non-persistent**: selections live only in component state — nothing is stored, sent,
or aggregated, and no personal information is collected.

## Accessibility

One logical `h1`; section headings in order; every input has an associated label; the
KPI group and each section carry accessible names; the results block is `role="status"`
(polite announcement); validation and calculation errors use `role="alert"`; the
funding chart is decorative (`aria-hidden`) with full text equivalents; no meaning is
conveyed by color alone. Native form controls throughout.

## Tested viewports

390 × 844, 430 × 932, 768 × 1024, 1024 × 768, 1280 × 800, 1440 × 900 — the dashboard is
full width, mounts no map, its KPI/filter/table layouts stay usable, tables scroll
inside their own `overflow-x-auto` container, and the page never scrolls horizontally.

## Tests

- `components/FacilityCostDashboard.test.tsx` — controls, validation, the eight KPI
  values, the funding breakdown (subsidy + local = installation cost, no approval
  claim), the official-input region table (no invented allocation, never `0명`), the
  missing-components list (Korean labels + retained reasons, never a `0` cost), the
  null per-capita path, candidate integration, one `h1`, exact monetary strings,
  stale/late-response hiding, structured errors, and duplicate-submit prevention —
  from controlled contract fixtures clearly in the test environment.
- `app/accessibility.test.tsx` — the suitability sub-view switch (score ↔ cost),
  the full-width cost view mounting no map, and the neutral framing.
- `e2e/facilityCost.spec.ts`, `e2e/integration.spec.ts` — the full scenario→results
  flow at mobile + desktop, zero map containers in the cost view, no horizontal
  overflow, and the round-trip back to the score view (which restores the map).

The e2e/vitest fixtures are controlled contract fixtures clearly in the test
environment; the cost result is analytical standard-cost data shown only with its
disclaimer + completeness, never labelled as official metric data.

## Deployment status

Implemented on the `feat/floating-legends-and-cost-dashboard` branch and merged to
`main`. **Not deployed** to any environment (AWS or OCI).
