import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiBaseUrl, fetchJson } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiBaseUrl", () => {
  it("defaults to the local backend", () => {
    expect(apiBaseUrl()).toBe("http://localhost:8000");
  });
});

describe("fetchJson", () => {
  it("returns the parsed body on success", async () => {
    stubFetch(200, { reference_year: 2024, count: 1, items: [] });
    await expect(fetchJson("/api/v1/population")).resolves.toEqual({
      reference_year: 2024,
      count: 1,
      items: [],
    });
  });

  it("preserves the structured 404 detail from the backend", async () => {
    stubFetch(404, {
      detail: {
        error: "NO_DATA_FOR_PERIOD",
        detail: "No regional population data for reference year 2019.",
        requested_year: 2019,
        available_years: [2024],
      },
    });
    const failure = fetchJson("/api/v1/population?year=2019");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await failure.catch((error: ApiError) => {
      expect(error.status).toBe(404);
      expect(error.detail?.error).toBe("NO_DATA_FOR_PERIOD");
      expect(error.detail?.available_years).toEqual([2024]);
      expect(error.message).toContain("NO_DATA_FOR_PERIOD");
    });
  });

  it("raises a generic ApiError when the body has no structured detail", async () => {
    stubFetch(500, "internal error");
    await expect(fetchJson("/api/v1/regions")).rejects.toMatchObject({
      status: 500,
      detail: null,
    });
  });
});
