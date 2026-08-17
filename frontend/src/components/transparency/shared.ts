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
/**
 * The overview's accessible name.
 *
 * No longer rendered as a visible `<h2>`: the four tiles are self-describing (each
 * carries its own label and unit) and the heading plus its supporting line were two
 * lines of chrome above them. `SourceOverview` now passes this string as the
 * section's `aria-label`, so the region keeps its name in the screen-reader outline
 * even though nothing is drawn.
 *
 * The supporting line it used to sit above (`OVERVIEW_SUMMARY`,
 * "모두 등록된 기록의 개수입니다. 완성도 점수나 품질 등급이 아닙니다.") is gone with it.
 * Its disclaimer survives structurally rather than as prose: this section still shows
 * no percentage, score, or grade anywhere, and a unit test asserts that.
 */
export const OVERVIEW_TITLE = "한눈에 보기";
/**
 * How to search this list, and what the list is not.
 *
 * TWO claims were appended here at different times and neither belonged. The
 * architectural one (the browser never calls a government API and stores no personal
 * data) is now a 공통 해석 기준 entry — see `DATA_HANDLING_NOTE`. The preservation one
 * ("the registered original names survive in each card's 기술 정보 보기") is the same
 * sentence the modal already closes with, so it is stated once, there — see
 * {@link CATALOG_PRESERVATION_NOTE}.
 *
 * The SCOPE claim, however, arrived here from the standing banner when that banner
 * was removed, and it belongs: it is a fact about the catalog rendered directly
 * below, and this was the banner's ONLY copy of it. Without it the catalog reads as
 * an exhaustive index of Korean public data, which it is not.
 */
export const CATALOG_SUMMARY =
  "자료명·기관명·분야로 검색할 수 있습니다. 이 목록은 이 서비스가 현재 연계한 자료이며, " +
  "관련 공공자료 전체를 담고 있다는 뜻은 아닙니다.";

/**
 * How the data reaches the reader. Stated once, on the methodology surface.
 *
 * Kept verbatim from the copy that previously sat in {@link CATALOG_SUMMARY}: it is a
 * true and load-bearing claim (repo AGENTS.md — the frontend never calls Korean
 * government APIs directly), and relocating it must not weaken it.
 */
export const DATA_HANDLING_NOTE =
  "브라우저에서 정부 API를 직접 호출하거나 개인정보를 저장하지 않습니다. 모든 공식 자료는 " +
  "이 서비스의 서버가 받아 정리한 뒤 전달합니다.";

// --------------------------------------------------------------------------- //
// 공통 해석 기준 — the ONE formal home for every rule that applies to more than one
// screen.
//
// WHY THIS BLOCK EXISTS
// ---------------------
// Before it, six of these rules were written out three or four times each: in the
// standing banner, in an overview tile caption, in a gap block, in the methodology
// disclosure, and again on a dataset card. A permanent caveat repeated five times
// stops being read, and five copies of one sentence drift apart the moment one of
// them is edited. Each rule is now stated ONCE, here; every other surface either
// carries the stateful badge (`ui/DataStatusBadge`) or a short, genuinely
// record-specific sentence, and points here for the general rule.
//
// WHAT MAY GO IN
// --------------
// Only a rule this application ALREADY applies, phrased in plain Korean. Nothing
// here is a decision, a threshold, a weight, or a policy: those belong to the
// backend that serves them, and inventing one on a transparency screen would be the
// exact failure this screen exists to prevent. See {@link SUCCESSOR_METHODOLOGY_SLOT}.
// --------------------------------------------------------------------------- //

export interface GlobalDefinition {
  /** The term as a reader meets it on the other screens. */
  term: string;
  /** One sentence — what it means, and what it does NOT mean. */
  meaning: string;
}

/**
 * Rules for reading two different datasets side by side.
 *
 * The first two are the reason this platform never sums across sources; the last two
 * are the standing caveats that used to live on the Page-1 map insight strip (the
 * relative-class statement) and beside every ranking (the denominator statement).
 */
export const COMPARISON_DEFINITIONS: readonly GlobalDefinition[] = [
  {
    term: "기준 기간이 다른 값",
    meaning:
      "자료마다 기준 기간이 다릅니다. 기준 기간이 다른 값은 같은 시점의 값처럼 비교하거나 하나로 묶지 않습니다.",
  },
  {
    term: "집계 기준이 다른 값",
    meaning:
      "발생지 기준·시설 소재지 기준·수도권 반입 기준은 세는 대상이 서로 다릅니다. 집계 기준이 다른 값은 더하거나 빼거나 나누지 않습니다.",
  },
  {
    term: "1인당 값",
    meaning:
      "공식 발생량을 같은 기준의 공식 인구로 나눈 비교용 환산값입니다. 개인이 실제로 버린 양이나 개인이 내는 금액이 아닙니다.",
  },
  {
    term: "순위와 비교 대상(분모)",
    meaning:
      "순위와 상·하위 표시는 각 화면이 밝힌 ‘순위 대상’ 개수를 분모로 계산합니다. 값을 확인하지 못한 지역·구역은 순위 대상에서 빼며, 0으로 채워 순위를 매기지 않습니다.",
  },
  {
    term: "지도 색 구간",
    meaning:
      "지도 색은 표시된 지역 사이의 상대적 구간(급)이며 절대 기준이나 합격선이 아닙니다. 적용된 분류 방식(분위수·로그 간격)과 구간 값은 각 지도의 범례에 표시합니다.",
  },
];

/**
 * Rules for reading a figure this platform produced, rather than received.
 *
 * `scenario` keeps the `transparency-scenario` test id it carried as a disclosure:
 * the sentence is the same commitment, and it now also states the part that was
 * previously only implied — changing a weight never changes a screening verdict.
 */
export const ANALYSIS_DEFINITIONS: readonly (GlobalDefinition & { testId?: string })[] = [
  {
    term: "후보지 분석의 성격",
    meaning:
      "공공자료를 이용한 1차 비교이며, 실제 입지 결정·허가·법적 적격성을 의미하지 않습니다.",
  },
  {
    term: "가중치 바꿔보기",
    meaning:
      "점수 반영 기준(가중치)을 바꾸면 점수와 순위는 달라지지만, 스크리닝 통과·추가 검토·제외 판정 자체는 바뀌지 않습니다. 바꾼 결과는 화면에서만 계산하는 임시 결과이며 저장되지 않습니다.",
    testId: "transparency-scenario",
  },
  {
    term: "설치비",
    meaning:
      "표준공사비 기준의 참고용 설치비 계산이며, 실제 총사업비가 아닙니다. 확정 사업비나 예산 승인 금액도 아닙니다.",
  },
  {
    term: "매립지 반입 자료",
    meaning:
      "광역지자체 단위이며, 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.",
  },
  {
    term: "원문의 현재 제공 여부",
    meaning: "원문 자료가 지금도 제공되는지는 각 기관 안내 페이지에서 확인해야 합니다.",
  },
  {
    term: "자료 전달 경로",
    meaning: DATA_HANDLING_NOTE,
  },
];

/**
 * The structural slot for the NEXT screening methodology.
 *
 * It is deliberately empty of decisions. The successor policy is not final on the
 * backend, so there is no weight, no missing-component rule, no distance floor, no
 * numerator, no direction, and no stability definition to publish — and a
 * transparency screen that guessed at one would be publishing a decision nobody
 * made. What the slot DOES do is make the absence legible, so a reader who has heard
 * a new version is coming is told plainly that it is not what this screen documents.
 */
export const SUCCESSOR_METHODOLOGY_SLOT = {
  title: "다음 판정 기준 (아직 확정되지 않음)",
  body:
    "후보지 판정 기준의 다음 버전은 아직 확정되지 않았습니다. 확정되기 전까지 이 화면은 현재 " +
    "적용 중인 기준만 설명하며, 확정되지 않은 가중치나 판정 규칙을 미리 적어 두지 않습니다. " +
    "기준이 확정되면 그 내용과 적용 시점을 이 자리에 정리합니다.",
} as const;
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
