# Waste Equity Frontend

Next.js (App Router) + TypeScript + Tailwind CSS + MapLibre GL map prototype
(Phase 4). Renders the Phase 3 backend datasets for Seoul, Incheon, and
Gyeonggi-do: a SIGUNGU choropleth (regional population or per-stream RCIS
waste generation, served as-is) and a waste-treatment facility point layer.

Phase 7 adds a plain-Korean, citizen-facing redesign (nav **지역 부담 / 후보지 분석 /
매립지 현황 / 데이터·출처**), regional ranking + comparison, shareable validated URL
state, injection-safe CSV export, a print/PNG report (map excluded), and a data
transparency center. Terminology and UX conventions are documented in
[docs/CITIZEN_LANGUAGE_AND_UX.md](../docs/CITIZEN_LANGUAGE_AND_UX.md); the plain-Korean
label registry is `src/lib/glossary.ts`.

## Data rules

- All data comes from the platform backend (`NEXT_PUBLIC_API_BASE_URL`,
  default `http://localhost:8000`). The frontend never calls Korean
  government APIs and holds no credentials.
- Every displayed metric shows its official source, reference period,
  publication frequency (from the backend source registry), and — for waste
  data — the accounting basis. The two accounting bases
  (`ORIGIN_BASED_TREATMENT_OUTCOME` regional statistics vs.
  `FACILITY_LOCATION_BASED_THROUGHPUT` facilities) are never merged.
- Only facilities with backend-served VWorld coordinates are drawn; the
  sidebar reports how many facilities have no coordinates instead of
  inventing locations. Regions without a served value render in an explicit
  no-data color.
- If the backend is unreachable or reports no data, the UI shows an explicit
  error — there is no bundled or fallback dataset.
- The Equity/Suitability mode switch adds a 500 m candidate-grid screen
  (Phase 5.4). Candidate cells are fetched by viewport bbox with a controlled
  limit and stale-request cancellation (never the whole grid at once). Every
  candidate is labelled ELIGIBLE / REVIEW_REQUIRED / EXCLUDED with its score,
  component evidence, sources, and reasons; excluded cells show reasons and no
  score, review cells show a provisional score and no rank. The suitability
  result is analytical screening only — never a legal, permit, or final siting
  determination, and no legal-eligibility flag is shown.
- Policy v2 adds a fifth **`critic`** weight profile (run-specific,
  **data-derived** from the run's candidate score structure — not expert/AHP, not
  a policy-importance judgment) and per-candidate **weight-sensitivity stability**
  (STABLE / CONDITIONALLY_STABLE / WEIGHT_SENSITIVE across baseline/equal/critic).
  The CRITIC option and stability UI appear only when the selected run computed
  them; text-first stability badges, a stable-candidate list, and a stable-only
  map filter (with a distinct outline) never communicate stability by color alone.
  Stable does not mean approved, permitted, developable, or legally eligible. See
  [docs/SUITABILITY_CRITIC_STABILITY.md](../docs/SUITABILITY_CRITIC_STABILITY.md).
- Quantities arrive as exact decimal strings and are formatted without
  changing their value.
- The basemap is OpenStreetMap raster tiles (public, non-government) with
  attribution.

## Develop

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

Requires the backend (and docker compose database) running; see
[backend/README.md](../backend/README.md).

## Checks

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest unit tests (no network)
```

The Playwright smoke test runs only against a live backend, mirroring the
backend's `TEST_DATABASE_URL` convention (no mock backend is substituted):

```bash
npx playwright install chromium   # once
E2E_BACKEND_URL=http://localhost:8000 npm run test:e2e
```

It verifies the map loads with real data, the legend and
source/reference-period metadata render, and that no browser request goes to
any host other than the backend and the basemap tile service.

## Responsive layout

The dashboard is mobile-usable: a vertical stacked layout with a full-width map
and collapsible controls below `md` (768 px), and the original side-by-side
sidebar/map layout at and above it. The map legends **float over the map** (a single
source of truth shared with the map fill, collapsed by default on mobile), and the
facility cost lens (적합성 → 비용 렌즈) renders as a **full-width dashboard with no
map**. See [RESPONSIVE_LAYOUT.md](RESPONSIVE_LAYOUT.md) for the breakpoints, the
floating-legend and full-width-cost-dashboard behavior, the map minimum-height and
MapLibre resize strategy, the `vh`-before-`dvh` viewport-height fallbacks, and the
tested viewport sizes, and [../docs/FACILITY_COST_LENS_UI.md](../docs/FACILITY_COST_LENS_UI.md)
for the cost dashboard's information architecture and terminology rules. The responsive e2e coverage
(`e2e/responsive.spec.ts`) intercepts the backend itself (`e2e/mockBackend.ts`) —
serving genuinely empty collections and the backend's real "no official data"
landfill response, never a synthetic value shown as official — so it runs without
`E2E_BACKEND_URL`:

```bash
npx playwright test responsive.spec.ts
```

Phase 1 (responsive/mobile layout) is **merged into `main`** (PR #27); a Phase 1.1
follow-up corrects two post-merge review findings (the `vh`/`dvh` fallback ordering
and the test's non-official landfill fixture). It is **not deployed** to any
environment, and Phase 2 (accessibility) has **not** been started.

## Suitability sub-views: 적합성 점수 · 가중치 실험실 · 비용 렌즈

Suitability mode has three sub-views (one shared MapView; never a second map):

- **적합성 점수** — the stored-profile candidate screening (baseline / equal /
  equity_focused / access_focused / critic).
- **가중치 실험실 (weight scenario lab)** — a temporary *user-assumption-based*
  experiment (사용자 가정 기반 시나리오). The user edits the four Z/R/E/D weights (0–100 %
  sliders + numeric inputs, total must equal exactly 100 %; an explicit 100 %
  normalization action is provided). A slider edit never calls the API; the explicit
  **시나리오 적용** issues exactly one preview request (AbortController + sequence guard
  prevent duplicate/stale-race responses). The map then shows the custom scenario
  tiles, with the top candidates, comparison-profile rank deltas (shown in text),
  stored stability (labelled as the *stored run's*, not the scenario's), and weighted
  contributions. A draft edit after apply marks the result **stale** until re-applied.
  Weights are canonical 8-dp decimal strings; scenario UI state is persisted in
  **sessionStorage only** (versioned key, run-scoped, revalidated on restore). No
  official run/profile is created and nothing is persisted server-side. See
  `docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md`.
- **비용 렌즈** — the full-width, map-free facility-cost dashboard (unchanged).
