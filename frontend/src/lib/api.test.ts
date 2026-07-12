import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  apiBaseUrl,
  fetchJson,
  fetchSuitabilityCandidateDetail,
  fetchSuitabilityCandidates,
  fetchSuitabilityPolicy,
} from "./api";

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

describe("suitability client", () => {
  it("fetches the policy from the backend", async () => {
    stubFetch(200, { policy_version: "suitability-policy-v1", statuses: ["ELIGIBLE"] });
    await expect(fetchSuitabilityPolicy()).resolves.toMatchObject({
      policy_version: "suitability-policy-v1",
    });
  });

  it("builds the candidate query and forwards the abort signal to fetch", async () => {
    const fetchMock = stubFetch(200, { type: "FeatureCollection", features: [] });
    const controller = new AbortController();
    await fetchSuitabilityCandidates(
      { profile: "equity_focused", bbox: "1,2,3,4", top: 5, limit: 2000 },
      controller.signal,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/suitability/candidates?");
    expect(url).toContain("profile=equity_focused");
    expect(url).toContain("bbox=1%2C2%2C3%2C4");
    expect(url).toContain("top=5");
    expect(url).toContain("limit=2000");
    expect(init.signal).toBe(controller.signal);
  });

  it("surfaces a structured 404 for a candidate detail", async () => {
    stubFetch(404, { detail: { error: "CANDIDATE_NOT_FOUND", detail: "x" } });
    const failure = fetchSuitabilityCandidateDetail(1, "baseline");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await failure.catch((error: ApiError) => {
      expect(error.status).toBe(404);
      expect(error.detail?.error).toBe("CANDIDATE_NOT_FOUND");
    });
  });

  it("propagates an abort error without swallowing it", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(abortError),
    );
    const controller = new AbortController();
    await expect(
      fetchSuitabilityCandidates({ profile: "baseline" }, controller.signal),
    ).rejects.toBe(abortError);
  });
});
