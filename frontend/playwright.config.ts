import { defineConfig } from "@playwright/test";

/**
 * E2E smoke tests run only against a live backend (mirroring the backend's
 * TEST_DATABASE_URL convention): set E2E_BACKEND_URL to the platform backend,
 * for example http://localhost:8000. No mock backend is ever substituted.
 */
const backendUrl = process.env.E2E_BACKEND_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    // Port 3000 matches the backend's default CORS allowlist.
    baseURL: "http://localhost:3000",
  },
  webServer: backendUrl
    ? {
        command: "npm run dev -- --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { NEXT_PUBLIC_API_BASE_URL: backendUrl },
      }
    : undefined,
});
