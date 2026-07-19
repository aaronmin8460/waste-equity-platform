import { defineConfig } from "@playwright/test";

/**
 * Two kinds of e2e specs live here:
 *
 * - Live smoke specs (map/regressions/landfill) run only against a real backend
 *   (mirroring the backend's TEST_DATABASE_URL convention): set E2E_BACKEND_URL
 *   to the platform backend, e.g. http://localhost:8000. They `test.skip`
 *   themselves when it is unset. No mock backend is ever substituted for them —
 *   they assert against real official data.
 * - The responsive-layout spec (responsive.spec.ts) intercepts every backend
 *   request itself (`page.route`), so it drives the real app UI at real viewport
 *   sizes without any backend and never asserts on data values.
 *
 * The dev server therefore always runs. When E2E_BACKEND_URL is set it is passed
 * through so the live specs reach real data; the responsive spec is unaffected
 * either way because it mocks at the network layer.
 */
const backendUrl = process.env.E2E_BACKEND_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    // Port 3000 matches the backend's default CORS allowlist.
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: backendUrl ? { NEXT_PUBLIC_API_BASE_URL: backendUrl } : {},
  },
});
