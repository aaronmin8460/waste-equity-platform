import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .test.ts = pure logic (node); .test.tsx = component rendering (jsdom, set
    // per-file via a `@vitest-environment jsdom` docblock).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
