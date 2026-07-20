import { describe, expect, it } from "vitest";

import type { DataFreshnessItem, DataSourceItem } from "./api";
import {
  availableAreas,
  availableFrequencies,
  buildDisplaySources,
  collectionDate,
  filterDisplaySources,
  frequencyLabelKo,
  organizationLabel,
  safeSourceUrl,
  sourceSearchText,
  summarizeSources,
  SOURCE_AREA_LABELS,
  UNKNOWN_FREQUENCY_LABEL,
} from "./dataSources";

/**
 * `lib/dataSources.ts` is the display layer over the served source registry. These
 * tests pin the two things a redesign must not quietly break: the ordering /
 * filtering behaviour the catalog depends on, and the honesty rules — an unknown
 * source keeps its served text, an absent field stays absent, and a URL is never
 * constructed.
 */

function source(overrides: Partial<DataSourceItem> & { source_id: string }): DataSourceItem {
  return {
    source_name: "Served Name",
    dataset_name: "Served Dataset",
    endpoint: "https://example.invalid/api",
    publication_frequency: "ANNUAL",
    enabled: true,
    documentation_url: null,
    ...overrides,
  };
}

function fresh(overrides: Partial<DataFreshnessItem> & { source_id: string }): DataFreshnessItem {
  return {
    source_name: "Served Name",
    publication_frequency: "ANNUAL",
    latest_reference_period: null,
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: null,
    next_scheduled_at: null,
    freshness_status: "UNKNOWN",
    ...overrides,
  };
}

describe("frequencyLabelKo", () => {
  it("names the four documented cadences in Korean only", () => {
    expect(frequencyLabelKo("ANNUAL")).toBe("연간");
    expect(frequencyLabelKo("MONTHLY")).toBe("월간");
    expect(frequencyLabelKo("REAL_TIME")).toBe("실시간");
    expect(frequencyLabelKo("STRUCTURAL")).toBe("수시 갱신");
  });

  it("returns null for an unknown code rather than guessing a cadence", () => {
    expect(frequencyLabelKo("WEEKLY")).toBeNull();
    expect(frequencyLabelKo("")).toBeNull();
  });
});

describe("safeSourceUrl", () => {
  it("accepts an absolute http(s) URL verbatim", () => {
    expect(safeSourceUrl("https://www.data.go.kr/data/15064381/fileData.do")).toBe(
      "https://www.data.go.kr/data/15064381/fileData.do",
    );
    expect(safeSourceUrl("http://example.gov/x")).toBe("http://example.gov/x");
  });

  it("rejects absent, empty, relative, and non-http values instead of repairing them", () => {
    expect(safeSourceUrl(null)).toBeNull();
    expect(safeSourceUrl(undefined)).toBeNull();
    expect(safeSourceUrl("")).toBeNull();
    expect(safeSourceUrl("   ")).toBeNull();
    expect(safeSourceUrl("/api/v1/data-sources")).toBeNull();
    expect(safeSourceUrl("www.data.go.kr")).toBeNull();
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("collectionDate", () => {
  it("takes the date component from the served string without building a Date", () => {
    // A late-evening UTC timestamp must not shift to the next/previous day.
    expect(collectionDate("2026-07-15T23:45:00+00:00")).toBe("2026-07-15");
    expect(collectionDate("2026-01-02T00:10:00Z")).toBe("2026-01-02");
  });

  it("returns null for an absent or unparseable timestamp", () => {
    expect(collectionDate(null)).toBeNull();
    expect(collectionDate(undefined)).toBeNull();
    expect(collectionDate("어제")).toBeNull();
  });
});

describe("buildDisplaySources", () => {
  it("renders a seeded registry row in Korean while keeping the served strings", () => {
    const [row] = buildDisplaySources(
      [
        source({
          source_id: "sgis",
          source_name: "Statistics Korea SGIS",
          dataset_name: "Population statistics and administrative boundaries",
        }),
      ],
      [],
    );
    expect(row.organization).toBe("통계청 SGIS");
    expect(row.datasetName).toBe("인구 통계와 행정경계");
    expect(row.area).toBe("population");
    expect(row.translated).toBe(true);
    // Nothing is deleted — the served text stays available for the disclosure.
    expect(row.servedSourceName).toBe("Statistics Korea SGIS");
    expect(row.servedDatasetName).toBe("Population statistics and administrative boundaries");
  });

  it("falls back to the served text for an unknown source id and invents nothing", () => {
    const [row] = buildDisplaySources(
      [
        source({
          source_id: "some_future_source",
          source_name: "Future Agency",
          dataset_name: "Future Dataset",
          publication_frequency: "WEEKLY",
        }),
      ],
      [],
    );
    expect(row.datasetName).toBe("Future Dataset");
    expect(row.organization).toBe("Future Agency");
    expect(row.translated).toBe(false);
    expect(row.area).toBe("unclassified");
    expect(row.areaLabel).toBe(SOURCE_AREA_LABELS.unclassified);
    expect(row.frequencyLabel).toBe(UNKNOWN_FREQUENCY_LABEL);
    expect(row.frequencyKnown).toBe(false);
    // The raw code survives for the diagnostic line.
    expect(row.frequency).toBe("WEEKLY");
  });

  it("does not resolve a source id or frequency against Object.prototype", () => {
    // `source_id` and `publication_frequency` are server-supplied. A plain
    // `REGISTRY[key]` would return a FUNCTION for these, defeating the `?? fallback`.
    for (const id of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const [row] = buildDisplaySources(
        [
          source({
            source_id: id,
            source_name: "Served Name",
            dataset_name: "Served Dataset",
            publication_frequency: "valueOf",
          }),
        ],
        [],
      );
      expect(row.datasetName).toBe("Served Dataset");
      expect(row.organization).toBe("Served Name");
      expect(row.translated).toBe(false);
      expect(row.area).toBe("unclassified");
      expect(row.frequencyLabel).toBe(UNKNOWN_FREQUENCY_LABEL);
      expect(row.frequencyKnown).toBe(false);
    }
    expect(frequencyLabelKo("constructor")).toBeNull();
    expect(frequencyLabelKo("toString")).toBeNull();
  });

  it("joins freshness by source id and keeps a missing period null, never a default", () => {
    const rows = buildDisplaySources(
      [source({ source_id: "sgis" }), source({ source_id: "kma" })],
      [
        fresh({
          source_id: "sgis",
          latest_reference_period: "2024",
          last_success_at: "2026-07-15T09:00:00+00:00",
          freshness_status: "FRESH",
        }),
      ],
    );
    const sgis = rows.find((row) => row.sourceId === "sgis")!;
    const kma = rows.find((row) => row.sourceId === "kma")!;
    expect(sgis.referencePeriod).toBe("2024");
    expect(sgis.lastSuccessAt).toBe("2026-07-15T09:00:00+00:00");
    expect(sgis.freshnessStatus).toBe("FRESH");
    // No freshness row → not served. Not zero, not an empty string, not "없음".
    expect(kma.referencePeriod).toBeNull();
    expect(kma.lastSuccessAt).toBeNull();
    expect(kma.freshnessStatus).toBeNull();
  });

  it("treats a null freshness list as 'not loaded' without inventing periods", () => {
    const [row] = buildDisplaySources([source({ source_id: "sgis" })], null);
    expect(row.referencePeriod).toBeNull();
  });

  it("orders by subject area, then Korean name, then source id — independent of input order", () => {
    const ids = [
      "15064381",
      "kma",
      "sgis",
      "waste_statistics",
      "vworld",
      "mois_resident_population",
    ];
    const forwards = buildDisplaySources(
      ids.map((id) => source({ source_id: id })),
      [],
    );
    const backwards = buildDisplaySources(
      [...ids].reverse().map((id) => source({ source_id: id })),
      [],
    );
    expect(forwards.map((row) => row.sourceId)).toEqual(backwards.map((row) => row.sourceId));
    // population → waste → landfill → spatial → weather (fixed area order).
    expect(forwards.map((row) => row.area)).toEqual([
      "population",
      "population",
      "waste",
      "landfill",
      "spatial",
      "weather",
    ]);
  });

  it("only keeps a documentation URL the registry actually served and validated", () => {
    const rows = buildDisplaySources(
      [
        source({ source_id: "a", documentation_url: "https://ok.example/doc" }),
        source({ source_id: "b", documentation_url: null }),
        source({ source_id: "c", documentation_url: "not-a-url" }),
      ],
      [],
    );
    expect(rows.find((row) => row.sourceId === "a")!.documentationUrl).toBe(
      "https://ok.example/doc",
    );
    expect(rows.find((row) => row.sourceId === "b")!.documentationUrl).toBeNull();
    expect(rows.find((row) => row.sourceId === "c")!.documentationUrl).toBeNull();
  });
});

describe("filterDisplaySources", () => {
  const rows = buildDisplaySources(
    [
      source({ source_id: "sgis", publication_frequency: "MONTHLY" }),
      source({
        source_id: "waste_statistics",
        publication_frequency: "ANNUAL",
      }),
      source({ source_id: "15064381", publication_frequency: "MONTHLY" }),
      source({ source_id: "kma", publication_frequency: "REAL_TIME" }),
    ],
    [],
  );

  it("matches the Korean dataset name", () => {
    const hits = filterDisplaySources(rows, { query: "반입량" });
    expect(hits.map((row) => row.sourceId)).toEqual(["15064381"]);
  });

  it("matches the Korean organisation name", () => {
    const hits = filterDisplaySources(rows, { query: "기상청" });
    expect(hits.map((row) => row.sourceId)).toEqual(["kma"]);
  });

  it("matches a dataset identifier without that identifier becoming the label", () => {
    const hits = filterDisplaySources(rows, { query: "15064381" });
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceId).toBe("15064381");
    // The card still leads with the plain-Korean name, not the number.
    expect(hits[0].datasetName).toBe("수도권 폐기물 반입량");
  });

  it("matches the served English text so an engineer's search term still works", () => {
    const englishRows = buildDisplaySources(
      [source({ source_id: "sgis", source_name: "Statistics Korea SGIS" })],
      [],
    );
    expect(filterDisplaySources(englishRows, { query: "statistics korea" })).toHaveLength(1);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(filterDisplaySources(rows, { query: "  SGIS  " })).toHaveLength(1);
  });

  it("returns every record for an empty or whitespace query", () => {
    expect(filterDisplaySources(rows, { query: "" })).toHaveLength(rows.length);
    expect(filterDisplaySources(rows, { query: "   " })).toHaveLength(rows.length);
    expect(filterDisplaySources(rows, {})).toHaveLength(rows.length);
  });

  it("returns nothing — not everything — when a query matches no record", () => {
    expect(filterDisplaySources(rows, { query: "존재하지않는자료명" })).toHaveLength(0);
  });

  it("filters by subject area and by frequency, and combines them with the query", () => {
    expect(filterDisplaySources(rows, { area: "landfill" }).map((r) => r.sourceId)).toEqual([
      "15064381",
    ]);
    expect(filterDisplaySources(rows, { frequency: "REAL_TIME" }).map((r) => r.sourceId)).toEqual([
      "kma",
    ]);
    // MONTHLY holds sgis + 15064381; the query narrows it to one.
    expect(
      filterDisplaySources(rows, { frequency: "MONTHLY", query: "인구" }).map((r) => r.sourceId),
    ).toEqual(["sgis"]);
  });

  it("preserves the catalog ordering — filtering never reshuffles the list", () => {
    const all = rows.map((row) => row.sourceId);
    const monthly = filterDisplaySources(rows, { frequency: "MONTHLY" }).map((row) => row.sourceId);
    expect(monthly).toEqual(all.filter((id) => monthly.includes(id)));
  });

  it("is deterministic across repeated calls", () => {
    const first = filterDisplaySources(rows, { query: "수도권" }).map((r) => r.sourceId);
    const second = filterDisplaySources(rows, { query: "수도권" }).map((r) => r.sourceId);
    expect(first).toEqual(second);
  });
});

describe("sourceSearchText", () => {
  it("includes the plain name, organisation, id, and the served strings", () => {
    const [row] = buildDisplaySources(
      [source({ source_id: "sgis", source_name: "Statistics Korea SGIS" })],
      [],
    );
    const text = sourceSearchText(row);
    expect(text).toContain("인구 통계와 행정경계");
    expect(text).toContain("통계청 sgis");
    expect(text).toContain("statistics korea sgis");
  });
});

describe("availableAreas / availableFrequencies", () => {
  const rows = buildDisplaySources(
    [
      source({ source_id: "sgis", publication_frequency: "MONTHLY" }),
      source({ source_id: "kma", publication_frequency: "REAL_TIME" }),
      source({
        source_id: "mois_resident_population",
        publication_frequency: "MONTHLY",
      }),
    ],
    [],
  );

  it("offers only the areas actually present in the served records", () => {
    expect(availableAreas(rows)).toEqual(["population", "weather"]);
    // Never the full label registry — an option that matches nothing is not offered.
    expect(availableAreas(rows)).not.toContain("landfill");
  });

  it("de-duplicates frequencies and returns their display labels", () => {
    expect(availableFrequencies(rows)).toEqual([
      { code: "REAL_TIME", label: "실시간" },
      { code: "MONTHLY", label: "월간" },
    ]);
  });

  it("offers nothing when no record was served", () => {
    expect(availableAreas([])).toEqual([]);
    expect(availableFrequencies([])).toEqual([]);
  });
});

describe("summarizeSources", () => {
  it("counts served records only — no completeness, freshness, or quality score", () => {
    const rows = buildDisplaySources(
      [
        source({
          source_id: "sgis",
          documentation_url: "https://ok.example/a",
        }),
        source({ source_id: "kma", documentation_url: null }),
        source({
          source_id: "waste_statistics",
          documentation_url: "https://ok.example/c",
        }),
      ],
      [fresh({ source_id: "sgis", latest_reference_period: "2024" })],
    );
    expect(summarizeSources(rows)).toEqual({
      total: 3,
      areaCount: 3,
      withReferencePeriod: 1,
      withLink: 2,
    });
  });

  it("does not count 'no subject information' as a subject", () => {
    // Three unrecognised sources know nothing about their own subject. Reporting
    // "자료 분야 1개" would be a count of knowledge the platform does not have.
    const unknown = buildDisplaySources(
      [source({ source_id: "a" }), source({ source_id: "b" }), source({ source_id: "c" })],
      [],
    );
    expect(unknown.every((row) => row.area === "unclassified")).toBe(true);
    expect(summarizeSources(unknown).areaCount).toBe(0);
    // …but it stays a filter option, because "show me the unclassified ones" is a
    // legitimate request.
    expect(availableAreas(unknown)).toEqual(["unclassified"]);

    // A mix counts only the named subjects.
    const mixed = buildDisplaySources(
      [source({ source_id: "sgis" }), source({ source_id: "unknown_one" })],
      [],
    );
    expect(summarizeSources(mixed).areaCount).toBe(1);
  });

  it("reports zeros for an empty registry without implying data exists", () => {
    expect(summarizeSources([])).toEqual({
      total: 0,
      areaCount: 0,
      withReferencePeriod: 0,
      withLink: 0,
    });
  });
});

describe("organizationLabel", () => {
  it("names the organisation in Korean for a known source id", () => {
    expect(organizationLabel("sgis")).toBe("통계청 SGIS");
    expect(organizationLabel("mois_resident_population")).toBe("행정안전부 주민등록 인구통계");
    expect(organizationLabel("waste_statistics")).toBe("한국환경공단 자원순환정보시스템");
  });

  it("falls back to the raw id rather than leaving a metric unattributed", () => {
    // An unattributed displayed metric would violate repo AGENTS.md; the raw id is
    // what the registry actually holds, so it is shown rather than invented over.
    expect(organizationLabel("some_future_source")).toBe("some_future_source");
  });

  it("returns null only when no source id was served at all", () => {
    expect(organizationLabel(null)).toBeNull();
    expect(organizationLabel(undefined)).toBeNull();
    expect(organizationLabel("   ")).toBeNull();
  });

  it("does not resolve a source id against Object.prototype", () => {
    expect(organizationLabel("constructor")).toBe("constructor");
    expect(organizationLabel("toString")).toBe("toString");
  });
});
