import { beforeEach } from "vitest";

/**
 * Reset the jsdom URL before every test.
 *
 * The dashboard mirrors its state into the URL via `history.replaceState` (shareable
 * links). In jsdom the `window.location` object persists across a file's tests, so
 * without this reset one test's written URL would leak into the next test's one-time
 * URL restore (the app would "restore" a stale mode/metric). A real browser never has
 * this problem — each page load starts at its own URL — so this only restores that
 * per-load isolation for the test environment. Guarded for the node environment
 * (pure-logic `.test.ts` files) where `window` is undefined.
 */
beforeEach(() => {
  if (typeof window !== "undefined" && window.history?.replaceState) {
    window.history.replaceState(null, "", "/");
  }
});
