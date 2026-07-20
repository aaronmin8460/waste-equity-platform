# Citizen Language & UX

This document describes the plain-language, citizen-facing redesign of the Waste
Equity Platform dashboard (Phase 7). It is the reference for how public-facing text
and UX decisions are made, and the contract that the terminology-audit tests enforce.

## Target public users

The primary UI is written for a **first-time resident of Seoul, Incheon, or
Gyeonggi** with no background in GIS, statistics, waste policy, or software. They
should be able to compare their district's waste burden, browse candidate-area
screening, and understand what public data was used — without a glossary.

Analysts and reviewers are a secondary audience: every technical term, version, and
raw component is preserved, but demoted to a "자세히 보기" (see details) layer,
methodology note, or the developer documentation.

## Plain-language principles

1. A **primary** label is plain Korean and understandable on its own. It never
   contains a bare English word, a raw enum (`ELIGIBLE`,
   `ORIGIN_BASED_TREATMENT_OUTCOME`), a version string (`suitability-policy-v2`), or
   an un-named single-letter code.
2. The technical vocabulary is **kept**, not deleted — it moves to a `detail` string
   surfaced behind a disclosure, or to a diagnostic line.
3. When a code genuinely helps (Z/R/E/D), it is shown **with** its Korean name via
   `codeWithName` → `토지이용 조건(Z)`, never a bare `Z`.
4. **Analytical honesty is unchanged.** Renaming never converts a missing value to
   zero, softens a disclaimer, or claims legal / final / cost-complete status. An
   official measured `0` stays distinct from `자료 없음`.

The single source of truth is [`frontend/src/lib/glossary.ts`](../frontend/src/lib/glossary.ts):
navigation, sub-view, status, profile, component, stability labels, plain error
messages, accounting-basis names, a general term glossary, and
`FORBIDDEN_PRIMARY_TOKENS` (the tokens the audit forbids in primary UI).

## Terminology mapping (primary → detail)

| Concept | Primary (citizen) | Detail (analyst) |
|---|---|---|
| Equity | 지역 부담 | 형평성(Equity) |
| Suitability | 후보지 분석 | 적합성 스크리닝(Suitability screening) |
| candidate | 분석 후보 구역 | 500m 후보 격자 |
| ELIGIBLE | 1차 분석 통과 | 현재 규칙에서 자동 제외·추가검토 사유가 없는 구역 |
| REVIEW_REQUIRED | 추가 확인 필요 | 자료 부족 또는 세부 확인 필요 |
| EXCLUDED | 현재 기준에서 제외 | 1차 분석 제외 규칙 해당 |
| weight profile | 점수 반영 기준 | 항목별 가중치 조합 |
| baseline / equal / equity_focused / access_focused / CRITIC | 기본 기준 / 모두 똑같이 반영 / 지역 부담을 더 크게 반영 / 도로 접근성을 더 크게 반영 / 데이터 분포 기준 | 운영 가정·전문가 AHP 아님 / 25%씩 / … / 값 분포로 자동 계산(CRITIC) |
| Z / R / E / D | 토지이용 조건(Z) / 도로 접근성(R) / 기존 지역 부담(E) / 폐기물 처리 수요(D) | zoning / road / equity / demand |
| STABLE / CONDITIONALLY_STABLE / WEIGHT_SENSITIVE | 세 기준 모두 상위권 / 두 기준에서 상위권 / 기준에 따라 순위 변화 큼 | baseline·equal·critic 상위 10% 포함 여부 |
| provisional score | 참고용 임시 점수 | 일부 항목 결측, 최종 점수 아님 |
| run | 분석 실행 | 같은 자료·규칙으로 한 번 계산한 결과 묶음 |
| MVT / vector tile | (primary에 노출 안 함) | 지도를 빠르게 표시하기 위한 기술 방식 |
| accounting basis | 집계 기준 | 발생지/시설 소재지/수도권 반입 기준 |
| no data / official zero | 자료 없음 / 공식 값 0 | 값 미제공 / 실제 측정된 0 |
| cost lens / scenario lab / transparency | 비용 살펴보기 / 가중치 바꿔보기 / 데이터·출처 | facility cost / weight scenario / data transparency |
| OPERATING_COST / ACTUAL_TRANSPORT_COST / LAND_AND_COMPENSATION / REMAINING_LANDFILL_COST | 운영비 / 실제 운송비 / 토지·보상비 / 잔여 매립비용 | 미포함 비용 항목 코드 |
| OFFICIAL_SOURCE_NOT_INTEGRATED | 이 항목의 공식 자료가 아직 이 분석에 연결되지 않았습니다. | 공식 자료 미연계 |
| ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE | 실제 수집·운반 경로와 계약 단가 자료가 없어 계산할 수 없습니다. | 실 경로·계약 단가 미확보 |
| PARCEL_SPECIFIC_COST_UNAVAILABLE | 부지가 정해져야 알 수 있는 필지별 비용 자료가 없어 계산할 수 없습니다. | 필지별 비용 미확보 |
| FACILITY_MASS_BALANCE_NOT_ESTABLISHED | 시설에서 처리하고 남는 물질의 양이 확정되지 않아 계산할 수 없습니다. | 시설 물질수지 미확립 |
| NO_OFFICIAL_SERVICE_POPULATION / NO_MATCHING_SAME_YEAR_POPULATION / INCOMPATIBLE_POPULATION_DEFINITION | 공식 인구가 제공되지 않아 / 같은 연도의 공식 인구 자료가 없어 / 집계 정의가 달라 1인당 값을 계산할 수 없습니다. | 1인당 지방비 미제공 사유 코드 |
| (an unrecognised reason code) | 현재 공식 계산 자료가 제공되지 않습니다. | 원본 코드는 진단 레이어에 보존 |

The facility-cost reason codes above are the Phase 3 addition. They follow the same rule
as every other row: the code is **demoted, never deleted** — it stays in the API
response, the TypeScript types, the tests, and a `data-diagnostic` disclosure. An
unrecognised code falls back to the safe generic sentence rather than an invented claim
about which specific dataset is missing. All eleven codes are in
`FORBIDDEN_PRIMARY_TOKENS`, and the cost results surface is scanned against that list in
`FacilityCostDashboard.test.tsx`. See
[FACILITY_COST_LENS_UI.md](FACILITY_COST_LENS_UI.md) for the registries.

**Phase 4 (지역 부담 map).** The remaining English duplications on the equity surface were
removed from primary labels: `범례 (Legend)` → `범례` (and `범례 (Legend) — persons` →
`범례 — persons`), `파생 지표 (Derived indicator)` → `파생 지표`, and
`지표 출처 (Metric source)` → `지표 출처`. The metric group legends
(`총량 지표` / `1인당 형평성 지표` / `시설 부담 지표`) were already Korean-only in
`lib/metrics.ts` and are unchanged.

Nothing technical was deleted — the same rule as every other row applies:

- the classification method note under the legend heading still carries the technical
  description (including its English phrasing), and the class rows, class numbers,
  ranges, unit, and the explicit `데이터 없음 (no served value)` row are untouched. That
  parenthetical is the analytical **no-data wording**, not a gloss on a primary label,
  so it is deliberately kept;
- the derivation version, formula, assumptions, source ids, and reference periods all
  still render in the 출처와 계산 방법 disclosure beneath the renamed headings;
- the equity control column remains an `<aside>`, and `terminology.audit.test.tsx` plus
  the new `app/page.phase4.test.tsx` both scan its full text against
  `FORBIDDEN_PRIMARY_TOKENS`.

The active metric is now the first thing the column says — its plain-Korean name, then
its unit, then its source and reference period — so the answer precedes the controls.

## Navigation model

Four citizen-facing top-level areas (no English in the primary nav):

- **지역 부담** — 지역별 폐기물 발생량과 처리시설 부담을 비교합니다. (choropleth map)
- **후보지 분석** — 현재 확보된 공공자료로 500m 구역을 1차 비교합니다. (map). Sub-views:
  **후보지 점수** / **가중치 바꿔보기** / **비용 살펴보기**.
- **매립지 현황** — 수도권매립지 반입량과 지역별 흐름을 확인합니다. (full-width, no map)
- **데이터·출처** — 어떤 자료를 사용했고 무엇이 부족한지 확인합니다. (full-width, no map)

Each area opens with a one-line orientation strip. There is exactly one `MapView`
(never duplicated); the 매립지 현황, 비용 살펴보기, and 데이터·출처 views mount no map.

## Progressive disclosure

- **Candidate list rows** show only 순위 · 지역 · 점수 · 안정성 배지. The raw Z/R/E/D
  component scores and the technical grid key live in the detail panel that opens on
  click.
- **Score summary** shows the counts first; the run id, policy/derivation/grid
  versions sit behind "분석 정보 자세히 보기".
- **Map popup** is concise: region + plain status + main value + a short pointer to
  the sidebar detail. The full disclaimer, versions, and provenance stay in the
  sidebar.
- **Method / CRITIC / raw provenance** stay in methodology notes and disclosures.

## First-time user flows

Covered by `e2e/citizenFlows.spec.ts` (driven by visible Korean labels):

- **A 지역 부담**: pick a metric → read 값이 높은/낮은 지역 → compare two regions → select
  one (map + summary sync).
- **B 후보지 분석**: see the three statuses → choose a 점수 반영 기준 → inspect a candidate.
- **C 가중치 바꿔보기**: choose a preset → change % → apply → see rank movement → the
  result is temporary and not saved.
- **D 비용 살펴보기**: pick inputs → calculate → see included vs missing costs.
- **E 데이터·출처**: source periods → missing data → the unmapped-facility table.

## Status wording

The three screening statuses are always the plain labels (1차 분석 통과 / 추가 확인 필요 /
현재 기준에서 제외), with the raw code available only in the detail layer. Stability is a
short plain sentence (세 기준 모두 상위권 등) plus a text-first badge — never color alone.

## Disclaimer hierarchy

The primary disclaimer is short:
> 이 결과는 공공자료를 이용한 1차 비교이며 실제 입지 결정이 아닙니다.

Longer analytical disclaimers (legal non-eligibility, cost incompleteness, scenario
non-persistence, missing-vs-zero) remain but are phrased plainly and, where verbose,
expandable. No legally or analytically important disclaimer was removed.

## Accessibility behavior

- Logical heading hierarchy; exactly one `<h1>` per view.
- Mode/sub-view toggles are a labelled `role="group"` of native buttons with
  `aria-pressed`; the region search is an ARIA combobox (`role="combobox"` +
  `role="listbox"`/`option`, `aria-activedescendant`, keyboard arrows/Enter/Escape).
- `role="status"` for progress/selection announcements; `role="alert"` for
  actionable errors; copy/PNG feedback is a live region.
- Status is never conveyed by color alone (always text + badge).
- Report preview is a `role="dialog"` `aria-modal` with Escape/backdrop close and
  focus moved into it.
- Tables carry captions and header cells.

## Responsive behavior

Single `md` (768px) breakpoint: stacked mobile column vs. side-by-side desktop. The
map pane uses the dedicated `.map-pane` sizing (vh→dvh `@supports`); the cost,
landfill, and transparency views are full-width and map-free. Comparison chips wrap;
tables scroll inside their own `overflow-x-auto`. See
[`frontend/RESPONSIVE_LAYOUT.md`](../frontend/RESPONSIVE_LAYOUT.md).

## Design tokens

`frontend/src/app/globals.css` defines semantic tokens (surface / ink / hairline,
one dominant primary action, warn/danger/success/info, radii, shadows, control
height, focus ring) plus a few component classes (`.wep-card`, `.wep-btn-primary`,
`.wep-btn-quiet`, `.wep-chip`, `.wep-orient`). Values match the existing light
slate/blue identity — a naming layer, not a re-skin. The analytical map/legend
palette stays the single source of truth in `lib/metrics.ts` and is intentionally
not tokenised.

## Original UI — not Toss / Karrot

The redesign borrows only **high-level product principles** common to simple Korean
consumer apps (one task per section, one dominant action, plain labels, generous
spacing, progressive disclosure, large touch targets, color as support). It uses the
platform's own slate/ColorBrewer-blue identity, its own layout, its own icons
(emoji/none), and its own wording. **No** Toss/Karrot brand asset, illustration,
exact layout, icon set, color palette, wording, or trade dress is copied.

## Known limitations

- A full dark theme remains out of scope (the app is pinned light — see globals.css).
- The PNG report is a text/table summary and **excludes the interactive map** by
  design (stated in the UI and here); it never captures the MapLibre canvas.
- Scenario weights carried in a shared URL are re-validated by the preview API on
  use; the selected-candidate URL field is best-effort.
- Scope filtering uses SGIS sido codes (Seoul 11 / Incheon 23 / Gyeonggi 31); the
  seven RCIS derived Gyeonggi cities map to Gyeonggi.

## Test coverage

- `lib/glossary.test.ts` — registries are plain and self-consistent; error mapping.
- `app/terminology.audit.test.tsx` — primary nav/status/sub-view are plain; the
  equity view carries no forbidden token.
- `app/page.equity.test.tsx` — ranking, comparison, share/report, URL restore.
- `components/TransparencyDashboard.test.tsx` — sources, counts, recorded vs
  "실패 사유 기록 없음".
- `e2e/citizenFlows.spec.ts` — the five first-time flows via visible Korean labels.
- `app/page.phase4.test.tsx` — Korean-only metric group legends and legend heading, the
  active-metric hierarchy, and a forbidden-token scan of the equity `<aside>`.
- `e2e/phase4EquityMap.spec.ts` — the same Korean-only headings at real desktop and
  mobile viewports.
- Existing `page` / `accessibility` / `responsive` tests updated in lockstep.
