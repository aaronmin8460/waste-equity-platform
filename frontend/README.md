# Waste Equity Frontend

Next.js (App Router) + TypeScript + Tailwind CSS + MapLibre GL map prototype
(Phase 4). Renders the Phase 3 backend datasets for Seoul, Incheon, and
Gyeonggi-do: a SIGUNGU choropleth (regional population or per-stream RCIS
waste generation, served as-is) and a waste-treatment facility point layer.

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
