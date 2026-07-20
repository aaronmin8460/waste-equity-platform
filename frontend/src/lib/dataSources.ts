/**
 * 데이터와 출처 — presentation helpers for the served source registry.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A pure, display-only layer over two backend responses that Phase 6 renders side
 * by side:
 *   - `GET /api/v1/data-sources`  → {@link DataSourceItem} (the registry itself)
 *   - `GET /api/v1/data-freshness` → {@link DataFreshnessItem} (per-source
 *     reference period and last ingestion outcome, joined by `source_id`)
 *
 * It renames, groups, sorts, and filters. It never invents a source, an owner, a
 * period, a URL, a snapshot date, or a coverage claim, and it never converts an
 * absent value into a zero or a default (repo AGENTS.md; redesign plan §5).
 *
 * WHY THE KOREAN NAMES LIVE HERE
 * ------------------------------
 * The registry's `source_name` / `dataset_name` are, for most rows, English or
 * bilingual strings written for engineers — "Statistics Korea SGIS", "Cadastral,
 * zoning, and structural spatial layers", "통합반입관리_수도권폐기물 반입량
 * (landfill inbound quantity)". Rendering those as a citizen's primary label is the
 * same failure as rendering a raw enum (docs/CITIZEN_LANGUAGE_AND_UX.md).
 *
 * {@link SOURCE_DISPLAY} therefore holds a Korean rendering for each registry row
 * that the repository actually seeds, keyed by its EXACT `source_id`. Every entry is
 * a translation of the served string or of the row's own documented identity — see
 * the per-entry citations below — never an addition. Two rules keep that honest:
 *
 *   1. The served strings are ALWAYS preserved on the result
 *      ({@link DisplaySource.servedSourceName} / `servedDatasetName`) so the
 *      component can show them in a technical disclosure. Nothing is deleted.
 *   2. An unrecognised `source_id` falls back to the served strings verbatim with
 *      `translated: false` and the `unclassified` area. A new source can never
 *      acquire an invented Korean name, owner, or subject by default.
 *
 * WHY `자료 분야` IS DESCRIPTIVE, NOT AN ANALYTICAL CLAIM
 * -------------------------------------------------------
 * {@link SourceArea} describes WHAT A DATASET IS ABOUT, read directly off its own
 * `dataset_name`. It deliberately does NOT claim which dashboard consumes it, or
 * that a dataset feeds any analytical value — the registry carries no such field,
 * so asserting it would be inference presented as metadata.
 *
 * WHY `freshness_status` IS NOT A CITIZEN LABEL
 * ---------------------------------------------
 * `DatasetFreshness.freshness_status` is written as `"FRESH"` by an ingestion job at
 * the moment it succeeds, and nothing in this repository ever demotes it (verified
 * by grep: `STALE` appears only in a model comment). It therefore means "the last
 * ingestion run for this source succeeded" — NOT "this data is current". Rendering
 * it as `최신` would claim a latestness the metadata does not establish, so the
 * primary surface shows the served `기준 기간` and the raw status stays diagnostic.
 */

import type { DataFreshnessItem, DataSourceItem } from "./api";

/**
 * Own-property lookup for a registry keyed by a SERVER-SUPPLIED string.
 *
 * `source_id` and `publication_frequency` come from the database, so a plain
 * `REGISTRY[key]` would resolve inherited `Object.prototype` members: a source
 * registered as `constructor` or `toString` would return a FUNCTION, which then
 * defeats the `?? fallback` (a function is not nullish) and would render as
 * `[object Object]` or a stringified function body. It would also make a row report
 * itself as translated when it is not. This helper makes a miss a genuine
 * `undefined` so the documented fallback path runs.
 */
function lookup<T>(registry: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
}

// --------------------------------------------------------------------------- //
// Subject areas.
// --------------------------------------------------------------------------- //

export type SourceArea =
  "population" | "waste" | "landfill" | "spatial" | "air" | "weather" | "unclassified";

/** Plain-Korean subject label. `unclassified` never guesses a subject. */
export const SOURCE_AREA_LABELS: Record<SourceArea, string> = {
  population: "인구",
  waste: "폐기물 발생·처리",
  landfill: "수도권매립지",
  spatial: "공간정보",
  air: "대기질 관측",
  weather: "기상 관측",
  unclassified: "분야 정보 없음",
};

/** Fixed display order, so a filtered list is never re-ordered by the filter. */
export const SOURCE_AREA_ORDER: readonly SourceArea[] = [
  "population",
  "waste",
  "landfill",
  "spatial",
  "air",
  "weather",
  "unclassified",
];

// --------------------------------------------------------------------------- //
// Publication frequency.
// --------------------------------------------------------------------------- //

/**
 * Korean-only frequency label for the Phase 6 primary surface.
 *
 * `lib/metrics.ts` keeps its own bilingual `frequencyLabel` — that one is consumed
 * by the equity provenance panels AND by the CSV/report exports, so changing it here
 * would silently change exported file content. This is a separate, additive helper
 * (redesign plan §6: English may remain in detail layers and exports).
 *
 * An unrecognised code returns `null` rather than a guessed cadence; the caller then
 * shows a neutral label and keeps the raw code in a diagnostic line.
 */
const FREQUENCY_LABELS: Record<string, string> = {
  ANNUAL: "연간",
  MONTHLY: "월간",
  REAL_TIME: "실시간",
  STRUCTURAL: "수시 갱신",
};

export function frequencyLabelKo(publicationFrequency: string): string | null {
  return lookup(FREQUENCY_LABELS, publicationFrequency) ?? null;
}

/** Shown in place of a frequency this registry cannot name. */
export const UNKNOWN_FREQUENCY_LABEL = "갱신 주기 정보 없음";

// --------------------------------------------------------------------------- //
// Korean rendering of the seeded registry rows.
// --------------------------------------------------------------------------- //

interface SourceDisplayEntry {
  /** Korean rendering of the served `source_name`. */
  organization: string;
  /** Korean rendering of the served `dataset_name`. */
  dataset: string;
  area: SourceArea;
}

/**
 * Keyed by the EXACT `source_id` each row is seeded with. Provenance for every entry:
 *
 * | source_id                | seeded in                                          |
 * |--------------------------|----------------------------------------------------|
 * | waste_statistics         | alembic 0001 core_metadata                          |
 * | sgis                     | alembic 0001 core_metadata                          |
 * | airkorea                 | alembic 0001 core_metadata                          |
 * | kma                      | alembic 0001 core_metadata                          |
 * | vworld                   | alembic 0001 core_metadata                          |
 * | vworld_structural        | alembic 0006 structural_zoning                      |
 * | 15064381 / 15064394      | alembic 0013 landfill_inbound_flow                  |
 * | mois_resident_population | ingestion mois_population_contract.SOURCE_ID        |
 *
 * Each `organization` / `dataset` is a translation of that row's own served string.
 * No ministry, division, licence, or coverage area is added that the served string
 * does not already name — e.g. `vworld` becomes `브이월드 국가공간정보`, NOT
 * `국토교통부 브이월드`, because the registry never names the ministry.
 */
const SOURCE_DISPLAY: Record<string, SourceDisplayEntry> = {
  waste_statistics: {
    // "Korea Environment Corporation Resource Circulation Information System"
    organization: "한국환경공단 자원순환정보시스템",
    // "전국폐기물발생및처리현황 (waste statistics OpenAPI)"
    dataset: "전국 폐기물 발생 및 처리 현황",
    area: "waste",
  },
  sgis: {
    // "Statistics Korea SGIS"
    organization: "통계청 SGIS",
    // "Population statistics and administrative boundaries"
    dataset: "인구 통계와 행정경계",
    area: "population",
  },
  mois_resident_population: {
    // Already Korean in the registry; kept identical.
    organization: "행정안전부 주민등록 인구통계",
    dataset: "행정동별 주민등록 인구 및 세대현황",
    area: "population",
  },
  airkorea: {
    // "Korea Environment Corporation AirKorea"
    organization: "한국환경공단 에어코리아",
    // "Real-time air-quality observations and stations"
    dataset: "실시간 대기질 측정값과 측정소",
    area: "air",
  },
  kma: {
    // "Korea Meteorological Administration"
    organization: "기상청",
    // "Ultra-short-term observations and short-term forecasts"
    dataset: "초단기 실황과 단기 예보",
    area: "weather",
  },
  vworld: {
    // "VWorld National Spatial Data Infrastructure"
    organization: "브이월드 국가공간정보",
    // "Cadastral, zoning, and structural spatial layers"
    dataset: "지적·용도지역·구조 공간정보",
    area: "spatial",
  },
  vworld_structural: {
    // "VWorld National Spatial Data Infrastructure (structural layers)"
    organization: "브이월드 국가공간정보 (구조 레이어)",
    // "용도지역지구도 및 구조적 공간레이어 (zoning/protected/road bulk files)"
    dataset: "용도지역지구도와 구조 공간레이어",
    area: "spatial",
  },
  "15064381": {
    // "수도권매립지관리공사 (Sudokwon Landfill Site Management Corp.)"
    organization: "수도권매립지관리공사",
    // "통합반입관리_수도권폐기물 반입량 (landfill inbound quantity)"
    dataset: "수도권 폐기물 반입량",
    area: "landfill",
  },
  "15064394": {
    organization: "수도권매립지관리공사",
    // "통합반입관리_폐기물반입수수료 (landfill inbound fee)"
    dataset: "폐기물 반입수수료",
    area: "landfill",
  },
};

// --------------------------------------------------------------------------- //
// The display record.
// --------------------------------------------------------------------------- //

export interface DisplaySource {
  sourceId: string;
  /** Primary citizen-facing dataset name (Korean when known, else the served text). */
  datasetName: string;
  /** Primary citizen-facing organisation (Korean when known, else the served text). */
  organization: string;
  area: SourceArea;
  areaLabel: string;
  /** False when no Korean rendering exists — the served strings are shown as-is. */
  translated: boolean;
  /** Always the served `source_name`, kept for the technical disclosure. */
  servedSourceName: string;
  /** Always the served `dataset_name`, kept for the technical disclosure. */
  servedDatasetName: string;
  /** Served `publication_frequency`, verbatim (diagnostic). */
  frequency: string;
  /** Korean cadence, or {@link UNKNOWN_FREQUENCY_LABEL} when unrecognised. */
  frequencyLabel: string;
  frequencyKnown: boolean;
  /** Served `enabled` flag. */
  enabled: boolean;
  /** Served documentation URL — only an http(s) URL survives {@link safeSourceUrl}. */
  documentationUrl: string | null;
  /** Served endpoint string (diagnostic; never turned into a citizen link). */
  endpoint: string;
  /**
   * `latest_reference_period` from the freshness join, or `null` when this source
   * has no freshness row. `null` means "not served" — never "none" and never zero.
   */
  referencePeriod: string | null;
  /** Served `last_success_at` (ISO timestamp) or null. */
  lastSuccessAt: string | null;
  /** Raw `freshness_status`. Diagnostic only — see the module header. */
  freshnessStatus: string | null;
}

/** Shown when the freshness join served no reference period for a source. */
export const NO_REFERENCE_PERIOD_LABEL = "기준 기간 정보 없음";

/** Shown when no successful collection timestamp was served. */
export const NO_COLLECTION_DATE_LABEL = "수집 기록 없음";

/**
 * Accept a served URL only when it is a syntactically valid absolute http(s) URL.
 *
 * Anything else (empty string, whitespace, a bare path, a `javascript:` scheme, a
 * malformed value) returns `null`, and the caller renders "링크 없음". A URL is never
 * constructed, completed, or guessed from a `source_id` or an endpoint.
 */
export function safeSourceUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return trimmed;
}

/**
 * Render a served ISO timestamp as a plain `YYYY-MM-DD` date **in the timezone the
 * backend recorded it in**, which is UTC.
 *
 * Every ingestion writes `last_success_at` as `datetime.now(tz=UTC)` and the API
 * serves it unconverted, so the leading date component is a UTC date. A collection
 * that ran at 08:45 KST is stored as the previous day 23:45 UTC — so rendering this
 * as a bare Korean date would be off by one for any run between 15:00 and 24:00 UTC.
 * Callers must therefore label the value as UTC ({@link COLLECTION_DATE_SUFFIX});
 * this function does not convert, because converting would require assuming a
 * display timezone the backend never stated.
 *
 * It formats the leading date component of the STRING and never constructs a `Date`,
 * so the rendered day cannot drift with the runner's or reader's local timezone. An
 * unparseable value returns `null` and the caller shows
 * {@link NO_COLLECTION_DATE_LABEL} rather than a guess.
 */
export function collectionDate(timestamp: string | null | undefined): string | null {
  if (typeof timestamp !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp.trim());
  return match ? match[1] : null;
}

/**
 * Timezone qualifier appended to a {@link collectionDate}.
 *
 * Korean rather than a bare "(UTC)": this is a citizen primary surface, and an
 * untranslated Latin acronym is exactly the kind of token
 * docs/CITIZEN_LANGUAGE_AND_UX.md exists to keep out of it. The qualifier is not
 * optional — without it the date is ambiguous by one day against KST.
 */
export const COLLECTION_DATE_SUFFIX = "(세계표준시)";

/**
 * Plain-Korean organisation name for a `source_id`, for attributing a displayed
 * dataset to its source (repo AGENTS.md: "every displayed analytical metric must
 * include its source and reference period"; redesign plan §5 rule 9).
 *
 * An unknown id returns the id itself rather than nothing: an unattributed metric
 * would break the rule, and the raw id is what the registry actually holds. Returns
 * `null` only when no id was served at all, so the caller can say so explicitly.
 */
export function organizationLabel(sourceId: string | null | undefined): string | null {
  if (typeof sourceId !== "string" || sourceId.trim() === "") return null;
  return lookup(SOURCE_DISPLAY, sourceId)?.organization ?? sourceId;
}

/**
 * Join the registry to the freshness list and produce the display records.
 *
 * Ordering is fully deterministic and independent of any later filtering: subject
 * area (fixed order), then dataset name (Korean collation), then `source_id` as the
 * final tiebreaker. Two sources that render the same name therefore keep a stable
 * relative position instead of depending on the server's row order.
 */
export function buildDisplaySources(
  sources: readonly DataSourceItem[],
  freshness: readonly DataFreshnessItem[] | null,
): DisplaySource[] {
  const byId = new Map<string, DataFreshnessItem>();
  for (const item of freshness ?? []) byId.set(item.source_id, item);

  const rows = sources.map((source): DisplaySource => {
    const display = lookup(SOURCE_DISPLAY, source.source_id);
    const fresh = byId.get(source.source_id) ?? null;
    const area: SourceArea = display?.area ?? "unclassified";
    const label = frequencyLabelKo(source.publication_frequency);
    return {
      sourceId: source.source_id,
      datasetName: display?.dataset ?? source.dataset_name,
      organization: display?.organization ?? source.source_name,
      area,
      areaLabel: SOURCE_AREA_LABELS[area],
      translated: display !== undefined,
      servedSourceName: source.source_name,
      servedDatasetName: source.dataset_name,
      frequency: source.publication_frequency,
      frequencyLabel: label ?? UNKNOWN_FREQUENCY_LABEL,
      frequencyKnown: label !== null,
      enabled: source.enabled,
      documentationUrl: safeSourceUrl(source.documentation_url),
      endpoint: source.endpoint,
      referencePeriod: fresh?.latest_reference_period ?? null,
      lastSuccessAt: fresh?.last_success_at ?? null,
      freshnessStatus: fresh?.freshness_status ?? null,
    };
  });

  return rows.sort((a, b) => {
    const areaDelta = SOURCE_AREA_ORDER.indexOf(a.area) - SOURCE_AREA_ORDER.indexOf(b.area);
    if (areaDelta !== 0) return areaDelta;
    const nameDelta = a.datasetName.localeCompare(b.datasetName, "ko");
    if (nameDelta !== 0) return nameDelta;
    return a.sourceId.localeCompare(b.sourceId);
  });
}

// --------------------------------------------------------------------------- //
// Search and filtering (client-side only — no new endpoint, no URL parameter).
// --------------------------------------------------------------------------- //

/**
 * The text a search query is matched against.
 *
 * Includes the technical identifiers (`source_id`, the served English strings) so a
 * reader who arrived with a dataset ID can still find the record — but the ID is
 * never PROMOTED to the card's title by matching it; the card always leads with the
 * plain-Korean name.
 */
export function sourceSearchText(source: DisplaySource): string {
  return [
    source.datasetName,
    source.organization,
    source.sourceId,
    source.areaLabel,
    source.frequencyLabel,
    source.servedDatasetName,
    source.servedSourceName,
  ]
    .join(" ")
    .toLowerCase();
}

export interface SourceFilters {
  /** Free-text query. Empty/whitespace matches everything. */
  query?: string;
  /** `"all"` or one {@link SourceArea}. */
  area?: SourceArea | "all";
  /** `"all"` or a raw `publication_frequency` code. */
  frequency?: string | "all";
}

/**
 * Filter without re-sorting: the input order (from {@link buildDisplaySources}) is
 * preserved exactly, so applying or clearing a filter never shuffles the catalog.
 */
export function filterDisplaySources(
  sources: readonly DisplaySource[],
  filters: SourceFilters,
): DisplaySource[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  const area = filters.area ?? "all";
  const frequency = filters.frequency ?? "all";
  return sources.filter((source) => {
    if (area !== "all" && source.area !== area) return false;
    if (frequency !== "all" && source.frequency !== frequency) return false;
    if (query !== "" && !sourceSearchText(source).includes(query)) return false;
    return true;
  });
}

/**
 * The subject-area options actually represented in the served records.
 *
 * Derived from the records themselves — never from {@link SOURCE_AREA_LABELS} — so a
 * filter can never offer a category that would always return nothing.
 */
export function availableAreas(sources: readonly DisplaySource[]): SourceArea[] {
  const present = new Set(sources.map((source) => source.area));
  return SOURCE_AREA_ORDER.filter((area) => present.has(area));
}

/** The frequency options actually represented, each with its display label. */
export function availableFrequencies(
  sources: readonly DisplaySource[],
): { code: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const source of sources) {
    if (!seen.has(source.frequency)) seen.set(source.frequency, source.frequencyLabel);
  }
  return [...seen.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

// --------------------------------------------------------------------------- //
// Overview counts.
//
// Every figure below is a COUNT OF SERVED RECORDS. None of them is a completeness
// percentage, a freshness score, or a quality grade — the redesign plan's non-goals
// forbid all three, and the registry carries nothing that could honestly support
// one.
// --------------------------------------------------------------------------- //

export interface SourceOverview {
  /** Number of source records the registry served. */
  total: number;
  /**
   * Number of distinct NAMED subject areas represented.
   *
   * `unclassified` is excluded on purpose: it is the absence of a subject, not a
   * subject. Counting it would let a registry of three unrecognised sources report
   * "자료 분야 1개" whose only member is 분야 정보 없음 — a count of knowledge the
   * platform does not have. It remains a filter option, because filtering to
   * "the ones we cannot classify" is a legitimate thing to ask for.
   */
  areaCount: number;
  /** Number of records for which a reference period was actually served. */
  withReferencePeriod: number;
  /** Number of records with a usable served documentation link. */
  withLink: number;
}

export function summarizeSources(sources: readonly DisplaySource[]): SourceOverview {
  return {
    total: sources.length,
    areaCount: availableAreas(sources).filter((area) => area !== "unclassified").length,
    withReferencePeriod: sources.filter((source) => source.referencePeriod !== null).length,
    withLink: sources.filter((source) => source.documentationUrl !== null).length,
  };
}
