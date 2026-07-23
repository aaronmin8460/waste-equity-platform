# Suitability Screening — Phase 0 Transparency

`policy_version: unchanged (suitability-policy-v2)` ·
`derivation_version: unchanged (suitability-screening-v3)` ·
`candidate_grid_version: unchanged (capital-grid-500m-v1)`

## Purpose

The 후보지 분석 (suitability) screen is a **regional analytical screening** built from
official spatial data — 용도지역 zoning compatibility, a road-proximity proxy,
existing-facility-burden avoidance (equity), waste-demand context, and the existing
protected/restricted screening layers. Before Phase 0 the wording could be read as a
claim that a passing cell is a *suitable, buildable, permittable site*. It is not.

Phase 0 makes the screen's **scope and limitations visible and understandable** to a
first-time citizen **without changing any analytical result**. It renames misleading
terms to what is actually measured, heads every sub-view with a standing
analytical-screening disclaimer, explains each screening status, discloses the
physical/environmental conditions that are **not** yet evaluated, and carries all of
that into the exports.

## Exact scope

Phase 0 is **presentation- and disclosure-only**. It changes:

- citizen-facing **display** wording (labels, disclaimers, explanations, tooltips);
- the suitability **report/export** metadata (adds disclaimer, status meanings,
  component definitions, limitations, and provenance already available);
- documentation and tests.

It does **not** change scores, weights, rankings, candidate statuses, spatial
calculations, hard-exclusion rules, the road-distance curve, thresholds, the
candidate grid, database records, production data, backend scoring code, API
contracts, or the backend `ELIGIBLE` / `REVIEW_REQUIRED` / `EXCLUDED` enum values.
No migration was added and no `policy_version` / `derivation_version` was bumped.

The following are explicitly **out of scope** for Phase 0 and were not implemented:
DEM/slope, detailed geology/faults, groundwater/hydrogeology, land cover, building
occupancy/density, flood risk, continuous usable-area, parcel/ownership analysis,
truck-route feasibility, candidate clustering, a facility-type selector, and any UI
mock controls or "coming soon" scores for future features.

## Terminology changes (citizen display only)

The single source of truth is
[`frontend/src/lib/glossary.ts`](../frontend/src/lib/glossary.ts). Every surface reads
these constants, so the whole app moves together and the terminology audit stays green.

| Concept | Before | After (Phase 0) | Why |
|---|---|---|---|
| Zoning component (Z) | 토지이용 조건 / (misleading: 토지이용 적합성) | **용도지역 호환성** | It is an administrative zoning **context**, not physical suitability. |
| Road component (R) | 도로 접근성 | **도로 근접성 대리지표** | It is a distance **proxy**, not guaranteed vehicle access. |
| Status `ELIGIBLE` | 1차 분석 통과 | **스크리닝 통과** | It passed the screening, not a legal/eligibility determination. |
| Status `REVIEW_REQUIRED` | 추가 확인 필요 | **추가 검토 필요** | Cannot be auto-classified (missing data / policy-sensitive). |
| Status `EXCLUDED` | 현재 기준에서 제외 | **프로젝트 스크리닝 제외** | It crosses a **project** screening rule, not a final legal prohibition. |
| Eligible passing cells | 적합 후보지 | **스크리닝 통과 후보** | Same reason as above. |
| Component score table (candidate detail) | 토지이용 Zoning / 도로접근 Road … | 용도지역 호환성 / 도로 근접성 대리지표 / 기존 지역 부담 / 폐기물 처리 수요 | Match the renamed component terms. |

The backend enum values (`ELIGIBLE`, `REVIEW_REQUIRED`, `EXCLUDED`), the single-letter
codes (Z/R/E/D), and every version string are **unchanged**; they remain in the
"자세히 보기"/diagnostic detail layers and in API responses. Equity-mode terminology
was not touched.

## Disclaimer text

Rendered once in `DashboardShell` as a neutral `InfoBanner` (tone `info`, never
`role="alert"`) at the top of **every** 후보지 분석 sub-view (score / scenario / cost),
from `SUITABILITY_SCREENING_DISCLAIMER`:

> 본 화면은 공식 공간데이터를 이용한 광역 후보지 스크리닝입니다. 결과는 법적 허가, 환경영향평가,
> 토질·지질 조사, 토지 확보 가능성 또는 최종 입지 선정을 의미하지 않습니다.

Where space is limited (the floating map legend), the short persistent label
`SUITABILITY_SCREENING_SHORT_LABEL` is used:

> 광역 분석 스크리닝 · 법적·공학적 적합 판정 아님

The disclaimer appears **only** in 후보지 분석 mode, so it is never shown as a claim
about the equity map's calculations.

## Status meanings (`statusExplanation()`)

Shown in the score-view summary ("상태 설명 보기") and inline in the candidate detail:

- **스크리닝 통과** — 현재 분석정책과 확보된 데이터 기준으로 다음 단계 검토 대상으로 분류되었습니다.
  법적 허가 또는 실제 건설 가능성을 의미하지 않습니다.
- **추가 검토 필요** — 자료 누락, 분류 불확실성 또는 정책상 민감한 조건으로 인해 자동 판정할 수
  없습니다.
- **프로젝트 스크리닝 제외** — 프로젝트에서 정한 분석상 배제 조건과 교차합니다. 법률상 최종 금지
  판정을 의미하지 않습니다.

## Component explanations (`componentExplanation()`)

- **용도지역 호환성 (Z)** — 법정 용도지역 대분류를 이용한 행정적 토지이용 맥락 점수입니다. 현재
  토지피복, 경사, 지질, 지하수, 건축물 현황 또는 토지 소유권을 의미하지 않습니다.
- **도로 근접성 대리지표 (R)** — 후보 격자 중심점과 가장 가까운 도로 사이의 거리 기반 점수입니다.
  대형차량 진입, 도로 폭, 중량 제한, 회전 가능성 또는 실제 운송 경로를 보장하지 않습니다.
- **기존 지역 부담 (E)** — 이미 폐기물 처리시설 부담을 지고 있는 지역을 피하기 위한 형평성 점수이며,
  그 자체로 환경적 입지 적합성을 의미하지는 않습니다.
- **폐기물 처리 수요 (D)** — 1인당 폐기물 발생량 기반의 서비스 수요 맥락 점수이며, 물리적 입지
  조건이 아닙니다.

## Unmodelled environmental and physical conditions

A compact, collapsible "현재 분석에 포함되지 않은 항목" disclosure
(`UNMODELED_SUITABILITY_FACTORS`) appears in the score-view methodology **and** in the
candidate detail panel:

- 경사 및 정밀 지형
- 상세 지질 및 단층
- 지하수위 및 수문지질
- 토지피복과 실제 토지 이용 상태
- 건축물 점유와 철거 필요성
- 홍수·침수 위험
- 연속 사용 가능 부지 규모
- 필지 소유권과 취득 가능성
- 대형차량의 실제 진입 가능성
- 현장조사 및 환경영향평가

with the note:

> 위 항목은 후속 단계에서 공식 데이터와 검증된 분석 기준을 확보한 뒤 추가할 예정입니다. 현재 값이
> 없다는 이유로 0점 또는 안전한 조건으로 간주하지 않습니다.

No fake value, placeholder score, or completion percentage is displayed.

## Explicitly unchanged calculations

- The four **static** weight profiles (`baseline`, `equal`, `equity_focused`,
  `access_focused`) and the run-specific `critic` weights.
- The component-score formulas, the road-distance curve, all normalization and
  thresholds, and the hard-exclusion / review rules.
- Candidate statuses, ranks, scores, per-candidate stability, and every served count.
- The 500 m candidate grid, the vector-tile behaviour, candidate selection, and the
  shareable URL state.
- The equity map, landfill-flow, and facility-cost calculations.

See [SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md) and
[SUITABILITY_CRITIC_STABILITY.md](SUITABILITY_CRITIC_STABILITY.md) for the unchanged
rules.

## Files changed

Frontend (single source of truth + surfaces):

- `frontend/src/lib/glossary.ts` — new disclaimer constants
  (`SUITABILITY_SCREENING_DISCLAIMER`, `SUITABILITY_SCREENING_SHORT_LABEL`), revised
  status labels + `statusExplanation()`, revised component labels +
  `componentExplanation()`, and `UNMODELED_SUITABILITY_*` / `SUITABILITY_SCOPE_STATEMENTS`.
- `frontend/src/lib/scenario.ts` — component labels/explanations now derive from the
  glossary (no second copy).
- `frontend/src/components/DashboardShell.tsx` — renders the standing screening
  disclaimer for every suitability sub-view.
- `frontend/src/app/page.tsx` — candidate-detail component labels, per-status
  explanation, status-explanations disclosure, the "not yet included" disclosure
  (score view + candidate detail), and contextual wording (road proxy, "스크리닝 통과
  후보", aria description, legend short label).
- `frontend/src/components/MapLegendOverlay.tsx` — "스크리닝 통과 셀" wording + short
  persistent label via the disclaimer prop.
- `frontend/src/components/SuitabilityScenarioLab.tsx` — status distribution, empty
  state, and detail status use the shared labels.
- `frontend/src/lib/exports.ts`, `frontend/src/lib/report.ts` — suitability CSV and
  print/PNG report carry the disclaimer, revised status labels + explanations, current
  component definitions, unmodelled limitations, the three scope statements, and the
  policy/derivation/grid/method provenance.

Docs: this file, `README.md`, `docs/CITIZEN_LANGUAGE_AND_UX.md`,
`docs/SUITABILITY_POLICY_V1.md`.

## Tests added / updated

- `frontend/src/app/page.phase0.test.tsx` (new) — the disclaimer appears in all three
  sub-views and is absent over the equity map; it is a neutral notice with a text
  severity label inside an accessible landmark; revised status labels + meanings;
  `용도지역 호환성` / `도로 근접성 대리지표` used (misleading terms gone); the "not yet
  included" disclosure in the score view and the candidate detail.
- `frontend/src/lib/glossary.test.ts` — revised status/component labels, the new
  `statusExplanation` / `componentExplanation`, and the disclaimer / unmodelled / scope
  constants (all free of forbidden tokens).
- `frontend/src/lib/exports.test.ts`, `frontend/src/lib/report.test.ts` — the exported
  scope & limitations block and provenance.
- `frontend/src/app/terminology.audit.test.tsx`,
  `frontend/src/components/FacilityCostDashboard.test.tsx` — follow the shared labels.
- `frontend/e2e/citizenFlows.spec.ts` (self-mocking) — revised candidate-count labels +
  the disclaimer; `frontend/e2e/map.spec.ts` (live-backend smoke) — revised labels.

## Future Phase 1 boundary

Phase 1 (not part of Phase 0) is where the unmodelled factors are actually *added* to
the analysis — only after their official data and a validated analytical method exist.
Adding any of DEM/slope, geology, groundwater, land cover, buildings, flood risk,
usable-area, parcel/ownership, or truck-route feasibility to the **scoring** is a Phase
1 change that would carry its own `policy_version` / `derivation_version` bump, a
candidate rebuild, and its own review — none of which Phase 0 performs.

## Release and rollback notes

- **Release:** frontend-only presentation change; no migration, no ingestion, no
  backend deploy required. The app is rebuilt and served as usual.
- **Verification gate:** `npm run lint`, `npx tsc --noEmit`, `npm test` (vitest), and
  `npm run build` in `frontend/`. Self-mocking Playwright specs cover the citizen flow;
  the live-backend smoke specs (`map.spec.ts`) require `E2E_BACKEND_URL`.
- **Rollback:** because nothing analytical changed, reverting this branch restores the
  prior wording with **no data or schema impact** — no records, versions, tiles, or
  runs are affected either way.
