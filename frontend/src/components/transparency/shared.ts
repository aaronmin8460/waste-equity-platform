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
// exact failure this screen exists to prevent. The successor methodology below is
// transcribed from an approved contract, not inferred — see SUCCESSOR_STATUS.
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

// --------------------------------------------------------------------------- //
// 후속 판정 기준 (Successor V3)
//
// SOURCE OF EVERY VALUE BELOW
// ---------------------------
// `docs/research/SUITABILITY_V3_FINAL_POLICY.md` and
// `docs/research/SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md`, as published on
// `integration/backend-v3-contract-preview-20260817` (b93393a). Nothing here is
// inferred, rounded, or filled in: every version string, weight, floor, class code,
// threshold and count is transcribed from those two documents.
//
// The branch is PROVISIONAL and non-production. If the authoritative
// `release/backend-v3-ready-20260817` publishes different values, this block is what
// has to be re-checked against it — which is why the numbers live here as data
// rather than being scattered through JSX.
//
// WHAT THIS BLOCK MUST NOT IMPLY
// ------------------------------
// That the figures on this screen were produced by it. They were not. `/policies`
// reports the HISTORICAL model, the default run is pinned to the historical model,
// and the successor run is reachable only by explicit run id. The successor is an
// approved and activated model that is not the default — see {@link SUCCESSOR_STATUS}.
// --------------------------------------------------------------------------- //

/** Version identifiers. Technical strings, shown only in the disclosure. */
export const SUCCESSOR_VERSIONS = {
  policy: "suitability-successor-policy-v1",
  derivation: "suitability-successor-derivation-v1",
  componentModel: "suitability-components-successor-v1",
  historicalComponentModel: "suitability-components-zred-v1",
  landCoverRegistry: "successor-land-cover-l2-v1",
  grid: "capital-grid-500m-v1",
} as const;

/**
 * What the reader most needs to know first: this is not the model behind the numbers
 * they are looking at. Stated before any component, weight, or score.
 */
export const SUCCESSOR_STATUS = {
  title: "후속 판정 기준 (후보지 분석 후속 모형)",
  body:
    "후보지 판정 기준의 다음 버전이 확정되어 사용할 수 있는 상태가 되었습니다. 다만 아직 " +
    "기본값이 아닙니다. 이 화면과 다른 화면에 지금 보이는 후보지 수치는 여전히 기존 모형이 " +
    "계산한 값이며, 후속 모형의 결과는 분석 실행을 직접 지정할 때만 볼 수 있습니다.",
  /** The coexistence rule. The single most misreadable fact in the whole change. */
  coexistence:
    "후속 모형은 점수를 다시 매길 뿐 통과·검토·제외 판정을 다시 하지 않으며, 이미 저장된 기존 " +
    "분석 결과를 고쳐 쓰지 않습니다. 기존 결과와 후속 결과는 각각 어느 모형이 만든 값인지 " +
    "표시된 채로 함께 보관됩니다.",
} as const;

export interface SuccessorComponent {
  /** The citizen-facing name. */
  name: string;
  /** The stored identifier. Secondary, and never the primary label. */
  technical: string;
  /** Share of the composite. */
  weight: string;
  /** One sentence: what it measures, and what it is not. */
  meaning: string;
}

/**
 * The four components, in the contract's own `component_order`.
 *
 * The Korean names lead and the stored identifiers follow as technical labels: a
 * reader of a public analytical product should not have to know the string
 * `air_impact_proxy` to find out what the model weighed.
 */
export const SUCCESSOR_COMPONENTS: readonly SuccessorComponent[] = [
  {
    name: "기존 처리 부담",
    technical: "existing_burden",
    weight: "25%",
    meaning:
      "그 지역이 주민 수에 견주어 이미 감당하고 있는 폐기물 처리량입니다. 이미 많이 감당하고 있는 지역에 또 부담을 얹지 않기 위한 항목입니다.",
  },
  {
    name: "대기 영향 대리지표",
    technical: "air_impact_proxy",
    weight: "25%",
    meaning:
      "그 지역의 공식 폐기물 발생량에서 추정한 대기 영향 대리값입니다. 실제로 측정한 배출 농도나 확산 결과가 아니며, 그래서 다른 항목보다 더 무겁게 두지 않았습니다.",
  },
  {
    name: "주민 근접 영향",
    technical: "resident_impact",
    weight: "25%",
    meaning:
      "후보 구역 주변 인구를 거리로 가중해 계산한 비교용 지표입니다. 특정 개인이 받게 될 피해의 크기가 아닙니다.",
  },
  {
    name: "토지 전환 부담",
    technical: "land_conversion",
    weight: "25%",
    meaning:
      "후보 구역에서 아직 개발되지 않아 새로 전환해야 하는 면적의 비율입니다. 이미 개발된 땅을 쓰는 쪽이 전환이 적어 더 나은 결과로 봅니다.",
  },
];

/**
 * Why the weights are equal.
 *
 * The policy is explicit that equal weighting was chosen for the property of
 * asserting no preference ordering — NOT because it scored well — and that no
 * data-derived vector is available. Both halves are kept: dropping the second turns
 * a documented refusal to rank the four considerations into an apparent default.
 */
export const SUCCESSOR_WEIGHT_NOTE = {
  summary: "네 항목에 각각 25%씩, 동일한 비중을 둡니다.",
  body:
    "동일 비중은 버전이 붙은 정책적 선택이며 객관적으로 옳은 값이 아닙니다. 네 항목 사이의 " +
    "우선순위를 어느 쪽으로도 주장하지 않기 위해 고른 값이고, 점수가 잘 나와서 고른 값이 " +
    "아닙니다. 자료에서 가중치를 자동으로 끌어내는 방법도 검토했으나, 순위를 바꾸지 못하고 " +
    "값을 고르게 펴는 방식만 반영한다는 점이 확인되어 점수 계산에는 쓰지 않습니다.",
} as const;

/** The detailed rules. One disclosure, so the section stays scannable. */
export const SUCCESSOR_RULES: readonly GlobalDefinition[] = [
  {
    term: "값이 하나라도 없으면 점수를 내지 않음",
    meaning:
      "네 항목이 모두 있어야 점수를 계산합니다. 없는 값을 0으로 채우거나 추정해 넣지 않으며, 항목을 확인하지 못한 사유(시설 위치 미확인, 폐기물 자료 없음, 평가 가능 면적 없음, 토지 피복 자료 없음)를 그대로 남깁니다.",
  },
  {
    term: "순위를 매기는 대상",
    meaning:
      "기존 제약 스크리닝에서 ‘통과’로 남은 후보 가운데 네 항목이 모두 있는 후보만 순위를 매깁니다. 후속 모형은 점수만 다시 매기며 통과·추가 검토·제외 판정을 다시 하지 않습니다.",
  },
  {
    term: "거리 하한 500m",
    meaning:
      "주민 근접 영향은 500m보다 가까운 거리를 구분하지 않습니다. 500m는 후보 구역 한 칸의 크기이며, 모형이 스스로 재는 단위보다 더 촘촘한 거리를 구분하는 척하지 않기 위한 하한입니다. 아주 가까운 거리에서 점수가 과장되는 것을 막습니다.",
  },
  {
    term: "토지 분류 기준",
    meaning:
      "환경부 토지피복 중분류를 사용하며, 출처 분류가 스스로 ‘시가화건조지역’으로 묶은 1xx 6개 항목만 개발된 지역으로 봅니다. 나머지 16개 항목은 미개발로 두고 어떤 항목도 계산에서 빼지 않습니다. 이 구분은 이 프로젝트의 해석이며 법적 입지 제한을 뜻하지 않습니다.",
  },
  {
    term: "애매한 토지 항목",
    meaning:
      "시설재배지·인공초지·인공나지·내륙수·해양수 다섯 항목은 판단이 갈립니다. 모두 ‘미개발’로 처리해 애매함이 후보지 점수를 좋게 만들지 않도록 했고, 애매한 항목이라는 표시는 결과와 함께 남깁니다.",
  },
  {
    term: "점수로 바꾸는 방법",
    meaning:
      "토지 전환 부담은 면적 비율을 그대로 0~1로 쓰고, 나머지 세 항목은 후보들 사이의 백분위 순위로 바꿉니다.",
  },
  {
    term: "안정성 판정",
    meaning:
      "네 항목에 각각 같은 폭(0.06)을 더하고 나머지에서 고르게 덜어낸 네 가지 경우를 계산해, 상위 10%를 모두 유지하면 ‘안정’, 2~3개에서 유지하면 ‘조건부’, 1개 이하이면 ‘민감’으로 표시합니다. 안정은 가중치를 조금 바꿔도 순위가 버틴다는 뜻일 뿐, 법적으로 적합하다는 뜻이 아닙니다.",
  },
];

/**
 * Scope and limitations. Counts are run-47 measurements from the Phase 5 document.
 *
 * The ranking figure (16 regions / 5,736,197 residents) is deliberately the one
 * carried, because §5 of that document says explicitly that a reader of the RANKING
 * needs it and that the wider 57-region figure answers a different question.
 */
export const SUCCESSOR_LIMITS: readonly GlobalDefinition[] = [
  {
    term: "순위 대상의 범위",
    meaning:
      "기준 분석(47,893개 후보) 가운데 네 항목이 모두 있는 후보는 33,980개(70.95%)이고, 실제로 순위를 매긴 후보는 13,734개입니다. 이 순위가 걸쳐 있는 지역은 79곳 가운데 16곳(주민 5,736,197명)뿐입니다.",
  },
  {
    term: "구조적으로 빠진 지역",
    meaning:
      "시설 위치를 확인하지 못한 자료와 시·군 단위로만 제공되는 폐기물 통계 때문에 22개 지역·주민 6,349,306명(24.13%)이 이 모형의 계산 밖에 있습니다. 값이 0이어서가 아니라 계산에 넣을 자료가 없어서입니다.",
  },
  {
    term: "인구 위치의 정밀도",
    meaning:
      "인구는 시·군·구마다 하나의 대표 지점으로만 주어집니다. 거리 하한을 열 배로 늘려도 같은 지역 안의 점수 차이는 크게 줄지 않아, 이 한계는 해결된 것이 아니라 남아 있는 한계로 공개합니다.",
  },
  {
    term: "특정 지역 쏠림",
    meaning:
      "현재 기준으로 상위 50개 후보 가운데 49개가 한 개 군(경기도 양평군)에 몰려 있습니다. 동점 처리 때문에 생긴 착시가 아니라 실제 점수 결과이며, 쏠림을 깨기 위해 가중치를 고르는 것은 결과를 먼저 정해 놓는 일이 되므로 하지 않았습니다. 순위는 후보 하나하나보다 지역 단위로 읽는 편이 안전합니다.",
  },
];
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
