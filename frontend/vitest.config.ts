import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .test.ts = pure logic (node); .test.tsx = component rendering (jsdom, set
    // per-file via a `@vitest-environment jsdom` docblock).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // Reset the jsdom URL before each test so a shareable-URL replaceState never
    // leaks into the next test's one-time URL restore (see vitest.setup.ts).
    setupFiles: ["./vitest.setup.ts"],
  },
});
