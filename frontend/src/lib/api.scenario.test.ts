import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  fetchUserScenarioCandidateDetail,
  previewUserWeightScenario,
  userScenarioTileUrl,
  type UserScenarioPreview,
  type UserScenarioWeights,
} from "./api";

const WEIGHTS: UserScenarioWeights = {
  zoning: "0.35000000",
  road: "0.25000000",
  equity: "0.25000000",
  demand: "0.15000000",
};

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("previewUserWeightScenario", () => {
  it("POSTs canonical weights to the preview endpoint", async () => {
    const preview = { scenario_hash: "abc", run_id: 48 } as unknown as UserScenarioPreview;
    const fetchMock = stubFetch(200, preview);
    const result = await previewUserWeightScenario({
      run_id: 48,
      weights: WEIGHTS,
      compare_profile: "baseline",
      top_n: 10,
    });
    expect(result.scenario_hash).toBe("abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/suitability/scenarios/preview");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent.weights).toEqual(WEIGHTS);
    expect(sent.compare_profile).toBe("baseline");
  });

  it("preserves the structured INVALID_SCENARIO_WEIGHTS error including fields", async () => {
    stubFetch(422, {
      detail: {
        error: "INVALID_SCENARIO_WEIGHTS",
        detail: "Scenario weights must sum exactly to 1.00000000.",
        fields: { sum: "0.99000000" },
      },
    });
    await expect(
      previewUserWeightScenario({ weights: WEIGHTS, compare_profile: "baseline" }),
    ).rejects.toMatchObject({ status: 422 });
    try {
      await previewUserWeightScenario({ weights: WEIGHTS, compare_profile: "baseline" });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const detail = (err as ApiError).detail;
      expect(detail?.error).toBe("INVALID_SCENARIO_WEIGHTS");
      expect(detail?.fields?.sum).toBe("0.99000000");
    }
  });

  it("forwards an AbortSignal", async () => {
    const fetchMock = stubFetch(200, {} as UserScenarioPreview);
    const controller = new AbortController();
    await previewUserWeightScenario(
      { weights: WEIGHTS, compare_profile: "baseline" },
      controller.signal,
    );
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe("fetchUserScenarioCandidateDetail", () => {
  it("POSTs to the candidate endpoint with the candidate id in the path", async () => {
    const fetchMock = stubFetch(200, { candidate_id: 7 });
    await fetchUserScenarioCandidateDetail(7, { weights: WEIGHTS, compare_profile: "equal" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/suitability/scenarios/candidates/7");
    expect(init.method).toBe("POST");
  });
});

describe("userScenarioTileUrl", () => {
  it("embeds canonical weights + scenario hash and MapLibre placeholders", () => {
    const url = userScenarioTileUrl(48, WEIGHTS, "deadbeefcafe");
    expect(url).toContain("/api/v1/suitability/scenarios/tiles/48/{z}/{x}/{y}.mvt");
    expect(url).toContain("wz=0.35000000");
    expect(url).toContain("wr=0.25000000");
    expect(url).toContain("we=0.25000000");
    expect(url).toContain("wd=0.15000000");
    expect(url).toContain("scenario_hash=deadbeefcafe");
  });
});
