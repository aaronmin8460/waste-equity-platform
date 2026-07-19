# Citizen facility cost lens (Phase 5 UI)

The citizen-facing front end for the Phase 4 facility cost backend, placed **inside
the Suitability experience** as a sub-view — `[적합성 점수] [비용 렌즈]` — not a new
top-level mode (`components/FacilityCostPanel.tsx`, wired in `app/page.tsx`).

It is a **decision-support** tool, not propaganda for or against a facility. It
presents the backend's standard-construction-cost **analysis** with its disclaimer
and completeness; it never shows an actual total project cost, an approved subsidy,
or a personal tax bill, and it renders unavailable components as explicitly
unavailable — never as `0`. Displayed money is the exact backend-served decimal
string, formatted without changing its value.

## Framing

- Title: **우리 지역에 시설이 생긴다면**, with the six explanatory questions
  (current handling → scenario share → required size → standard cost → what can't
  be costed → what conditions citizens need).
- Fixed disclaimer: this page does not recommend for or against construction; it is
  a citizen decision-support tool to review necessity, cost, siting conditions, and
  uncertainty together with official data.

## Scenario controls (accessible, mobile single-column)

facility type · waste stream · **service regions** · processing share (%) ·
operating days · underground multiplier (1.00–1.40) · subsidy scheme · cost version
(shown only when more than one exists). Every control has an associated `<label>`;
calculate is disabled until at least one service region is chosen.

The service-region picker is derived from **calculable coverage** — the regions
that actually have `RegionalWasteStatistics` for the *selected* waste stream (which
the backend joins by `region_code`) — so a citizen can never pick a code that
always returns `OFFICIAL_WASTE_UNAVAILABLE` (notably the SGIS districts of the
seven RCIS city-level cities). Each option shows its `region_code`, so duplicate
municipality names (e.g. Seoul 중구 vs Incheon 중구) are unambiguous. Changing the
waste stream re-derives the choices and clears the (possibly now-invalid) selection.
This uses `/waste-statistics`' single latest ingested year, which matches the
current RCIS ingestion where every stream shares one reference year (see the
`page.tsx` comment for the future per-stream-year caveat).

The **numeric inputs are validated** before calculate is enabled (processing share
0–100, operating days 1–366, underground multiplier within its bounds), with an
`role="alert"` message — no avoidable backend 422. The **subsidy-rate source** (the
국고보조금 업무처리지침 nominal rates, an analytical assumption) is shown beside the
subsidy selector in every state, not only after a calculation.

## Results (aria-live)

official annual quantity · scenario quantity · required capacity · matched
standard-cost band + unit cost · **표준공사비 기반 설치비 산정액** · lifetime (labelled
an assumption) + **연간 환산 설치비** (억원/년) · nominal subsidy rate + basis ·
estimated national subsidy · simplified local share · **주민 1인당 환산 지방비** (or its
served reason, never 0원) · source document/page/price-base-date · calc version ·
waste & population reference periods · assumptions. The results block is a
`role="status"` region so a screen reader announces a new calculation.

## Completeness & warnings

Prominent: "현재 결과는 표준공사비 기반 설치비 분석입니다.", plus the fixed list —
운영비 미포함 / 실제 운송비 미포함 / 토지·보상비 미포함 / 후보지별 토목조건 미포함 /
실제 총사업비가 아님 / 실제 승인된 국고보조금이 아님 / 주민 개인의 실제 세금 청구액이 아님 —
and the backend's structured `missing_components`. No misleading 총비용 value.

## Candidate integration

When a suitability candidate is selected, its `candidate_id` is passed to the
backend and the result shows the candidate key/region/analytical status/run+profile
with the note that the standard cost does not vary meaningfully by candidate cell
and the suitability disclaimer. It never claims cheapest / approved / final /
actual-budget.

## Citizen deliberation (client-only)

A conditions checklist (실시간 배출정보 공개, 완충구역, 운행경로 관리, 상시 측정, …) and a
stance (검토 가능 now / 조건 충족 시 / 추가 정보 필요 / 반대). **Client-only and
non-persistent**: selections live only in component state — nothing is stored, sent,
or aggregated, and no personal information is collected.

## Tests

- `components/FacilityCostPanel.test.tsx` — controls, validation, exact values from
  controlled contract fixtures, completeness (never 0), null per-capita, candidate
  integration, citizen guide/disclaimer, client-only conditions, aria-live.
- `app/accessibility.test.tsx` — the suitability sub-view switch (score ↔ cost).
- `e2e/facilityCost.spec.ts` — the full scenario→results flow at mobile + desktop,
  no horizontal overflow, back to the score view.

The e2e/vitest fixtures are controlled contract fixtures clearly in the test
environment; the cost result is analytical standard-cost data shown only with its
disclaimer + completeness, never labelled as official metric data.
