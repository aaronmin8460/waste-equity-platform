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
 *
 * ── DEFAULT VISITOR STATE: RETURNING, NOT FIRST-TIME ─────────────────────────────
 * The shell mounts a first-visit navigation guide (ui/NavigationOnboarding) that
 * covers the whole viewport until it is dismissed, and remembers the dismissal in
 * `localStorage` under `NAV_ONBOARDING_STORAGE_KEY`. Playwright gives every test a
 * FRESH context, so without this every test is a first visit and the guide sits on
 * top of the surface under test — intercepting the first click and holding focus.
 *
 * Every spec here except `navigationOnboarding.spec.ts` is about what the app does
 * for a reader who is already past the guide, so the returning-visitor state is the
 * honest default: it is the state a real reader is in for all but their first page
 * load. It seeds ONE key and nothing else, so no spec's own fixtures, routes, or
 * assertions change meaning.
 *
 * The first-visit behaviour itself is NOT skipped by this — `navigationOnboarding
 * .spec.ts` opts back out with an empty `storageState` and owns that contract.
 */
const backendUrl = process.env.E2E_BACKEND_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    // Port 3000 matches the backend's default CORS allowlist.
    baseURL: "http://localhost:3000",
    storageState: "./e2e/storageState.returningVisitor.json",
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: backendUrl ? { NEXT_PUBLIC_API_BASE_URL: backendUrl } : {},
  },
});
