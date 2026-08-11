/**
 * 데이터와 출처 — copy and pure helpers shared by the transparency components.
 *
 * Everything here is presentation-only. Nothing in this file fetches, classifies a
 * source, computes a freshness age, or invents a value: the served registry
 * (`lib/dataSources.ts`) and the served responses stay the authority, and this file
 * only names things in plain Korean and reshapes what has already been served.
 *
 * It exists for the same reason `landfill/shared.ts` and `facilityCost/shared.ts` do
 * — the constants used to sit at the top of the 1,233-line dashboard file, where a
 * second copy of a label could be added without anyone noticing.
 */

import { organizationLabel } from "../../lib/dataSources";
import type { LoadedData } from "../../app/page";

/** One line under the <h1>, stating exactly what this page documents. */
export const HEADER_SUMMARY =
  "이 서비스가 사용하는 공식 자료와 제공 기관, 자료의 기준 기간, 직접 보고값과 계산값의 구분, " +
  "그리고 현재 제공되지 않는 자료를 정리한 화면입니다.";

/**
 * Section headings and supporting copy, taken verbatim from Figma frame 156:470.
 *
 * ONLY the wording is adopted. Every NUMBER in that frame (9 / 6 / 5 / 2 registered
 * sources, `9건 표시`, `32개 지역`, and the `처리시설 → 자료 없음` row) is prototype
 * placeholder content that contradicts the served registry, and none of it is
 * reproduced anywhere in this feature — the counters and rows are computed from the
 * responses (`lib/dataSources.ts#summarizeSources`, `buildDatasetRows`).
 */
export const OVERVIEW_TITLE = "한눈에 보기";
export const OVERVIEW_SUMMARY = "모두 등록된 기록의 개수입니다. 완성도 점수나 품질 등급이 아닙니다.";
/**
 * Figma's two sentences, plus the third the previous copy carried. That third one
 * is the screen's only statement of how the data reaches the reader — the browser
 * never calls a government API and no personal data is stored — and Figma having no
 * place for it is not a reason to delete a true architectural claim.
 */
export const CATALOG_SUMMARY =
  "자료명·기관명·분야로 검색할 수 있습니다. 등록된 원문 이름은 각 카드의 " +
  "‘기술 정보 보기’에 그대로 남아 있습니다. 브라우저에서 정부 API를 직접 호출하거나 " +
  "개인정보를 저장하지 않습니다.";
/** The modal's closing line. States the preservation rule the cards implement. */
export const CATALOG_PRESERVATION_NOTE =
  "등록된 원문 이름과 식별자는 삭제하지 않고 각 카드의 ‘기술 정보 보기’에 보존합니다.";

/** Page size for the unmapped-facility list. The served response is the authority. */
export const UNMAPPED_PAGE_SIZE = 25;

/**
 * Whether a displayed figure is reported directly by the source, or calculated by
 * this platform from official inputs. These are the plain-Korean names for a
 * distinction the data model already makes — the reporting per-capita response
 * carries BOTH input sources (`waste_source_id`, `population_source_id`) and BOTH
 * reference periods, which is exactly what makes it a derived value.
 *
 * The strings are frozen: `TransparencyDashboard.test.tsx` and
 * `e2e/phase6DataSourcesDashboard.spec.ts` both compare them, and they are handed to
 * `DataStatusBadge` as its `label` override so the badge's semantic role
 * (teal = reported, blue = derived) is adopted WITHOUT changing the wording.
 */
export const VALUE_KIND_LABELS = {
  reported: "직접 보고값",
  derived: "공식 자료 기반 계산값",
} as const;

export type ValueKind = keyof typeof VALUE_KIND_LABELS;

export interface DatasetRow {
  name: string;
  count: number;
  referencePeriod: string;
  coverage: string;
  valueKind: ValueKind;
  /**
   * Where the displayed figures come from — the organisation behind the served
   * `source_id`. Required, not decorative: repo AGENTS.md and §5 rule 9 both say a
   * displayed metric keeps its source, and a derived metric keeps BOTH inputs.
   * `null` only when the response carried no `source_id` at all.
   */
  sources: (string | null)[];
  /** Shown under a derived row: what it was calculated from. */
  note?: string;
}

/**
 * Own-property lookup for a registry keyed by a SERVER-SUPPLIED string.
 *
 * Without this, a `region_mapping_status` of `constructor` (or an `ownership` of
 * `toString`) resolves an inherited `Object.prototype` FUNCTION, which is not
 * nullish — so the `?? raw` fallback never runs and React throws
 * "Functions are not valid as a React child". Mirrors `lib/dataSources.ts`.
 */
export function labelFor(registry: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : key;
}

/** Plain names for the region-mapping status codes (detail table only). */
export const REGION_MAPPING_LABELS: Record<string, string> = {
  EXACT_MATCH: "이름 정확히 일치",
  GEOCODED_MATCH: "좌표 변환 후 일치",
  REQUIRES_GEOCODE: "좌표 변환 필요",
  UNMATCHED: "지역 미배정",
  AMBIGUOUS: "지역 판단 불가",
};

export const OWNERSHIP_LABELS: Record<string, string> = {
  PUBLIC: "공공",
  PRIVATE: "민간",
};

/** How the freshness join resolved. Loading, failure, and "not served" are distinct. */
export type FreshnessState = "loading" | "ready" | "error";

/**
 * The two REQUEST states of the reference-period lookup.
 *
 * They are separate sentences, and separate from the third outcome
 * (`NO_REFERENCE_PERIOD_LABEL` in `lib/dataSources.ts`), because "we have not asked
 * yet", "we asked and failed", and "the registry served no period for this source"
 * are three different facts. Only the third is an absence of data, so only the third
 * is rendered as a `missing` status; a failed request says nothing at all about
 * whether a period exists.
 */
export const REFERENCE_PERIOD_LOADING_LABEL = "기준 기간 확인 중";
export const REFERENCE_PERIOD_ERROR_LABEL = "기준 기간을 불러오지 못했습니다";

/**
 * The record counts and reference periods for the datasets this application has
 * already loaded. Accurate and served — no count, period, or coverage string here is
 * computed, rounded, or defaulted.
 *
 * Row-level source attribution reads the FIRST served item of each dataset.
 * `/population` is query-scoped to a single `source_id` on the backend, so that row
 * cannot borrow. `/facilities` and the reporting endpoints apply no such filter —
 * they are single-sourced today only because the current ingestion writers share one
 * constant. If a second facility or waste-statistics source were ingested, these rows
 * would attribute every record to whichever item came first. Fixing that properly
 * means the READ path declaring its sources, which is a backend change and outside
 * this milestone; it is recorded in the plan's Phase 6 delivery notes.
 */
export function buildDatasetRows(data: LoadedData): DatasetRow[] {
  const perCapitaItem = data.reportingPerCapita.items[0];
  return [
    {
      name: "인구",
      count: data.population.count,
      referencePeriod:
        data.population.items[0]?.reference_period ?? String(data.population.reference_year),
      coverage: "서울·인천·경기 시군구",
      valueKind: "reported",
      // Read off the served row rather than hardcoded, so the attribution cannot
      // drift from the data (the two population series are not interchangeable).
      sources: [organizationLabel(data.population.items[0]?.source_id)],
    },
    {
      name: "폐기물 발생량",
      count: data.reportingStats.count,
      referencePeriod:
        data.reportingStats.items[0]?.reference_period ??
        String(data.reportingStats.reference_year),
      coverage: "수도권 보고 지역",
      valueKind: "reported",
      sources: [organizationLabel(data.reportingStats.items[0]?.source_id)],
    },
    {
      name: "1인당 발생량",
      count: data.reportingPerCapita.count,
      referencePeriod: String(data.reportingPerCapita.reference_year),
      coverage: "수도권 보고 지역",
      valueKind: "derived",
      // A derived metric keeps BOTH inputs (§5 rule 9) — the response names them.
      sources: [
        organizationLabel(perCapitaItem?.waste_source_id),
        organizationLabel(perCapitaItem?.population_source_id),
      ],
      note: "공식 폐기물 발생량을 같은 기준의 공식 인구로 나눈 값입니다. 기관이 직접 보고한 수치가 아닙니다.",
    },
    {
      name: "처리시설",
      count: data.facilities.count,
      referencePeriod:
        data.facilities.items[0]?.reference_period ?? String(data.facilities.reference_year),
      coverage: "수도권 처리시설",
      valueKind: "reported",
      sources: [organizationLabel(data.facilities.items[0]?.source_id)],
    },
  ];
}
