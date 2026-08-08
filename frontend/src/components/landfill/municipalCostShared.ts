/**
 * Fixed product copy for the 시·군·구별 수집·운반 계약 지급액 section.
 *
 * Kept out of the components so the wording that separates this dataset from the
 * official Sudokwon Landfill inbound fee has exactly one home, and so the tests
 * assert against the same constants the UI renders.
 *
 * The section title, the indicator name, and the caveat sentences must NEVER be
 * rewritten into 반입수수료 / 매립지 수수료 / 처리비 / 폐기물 총관리비 wording. Those
 * name a different dataset with a different accounting basis (repo AGENTS.md).
 */

/** The section heading. Names the unit (시·군·구), the subject, and the year. */
export const MUNICIPAL_COST_SECTION_TITLE =
  "시·군·구별 생활폐기물 수집·운반 계약 지급액 — 2024년";

export const MUNICIPAL_COST_SECTION_DESCRIPTION =
  "각 기초지자체가 공개한 2024년 생활폐기물 수집·운반 대행 계약의 지급액을 같은 행정구역의 2024년 인구로 나눈 분석값입니다.";

/**
 * The standing distinction banner's headline. The BODY is the backend's served
 * `meta.difference_from_official_landfill_fee`, rendered verbatim — this heading
 * only names what the reader is about to be told.
 */
export const MUNICIPAL_COST_DISTINCTION_TITLE = "위 수도권매립지 반입수수료와 다른 자료입니다";

/**
 * The second line of the distinction banner. It states the three axes on which the
 * two datasets differ and the one operation a reader must not perform.
 */
export const MUNICIPAL_COST_DISTINCTION_NOTE =
  "회계 기준·제공기관·공간 단위가 모두 달라 두 값을 더하거나 같은 비용으로 비교할 수 없습니다.";

/** The per-capita column/metric name. Never an amount a resident actually paid. */
export const MUNICIPAL_COST_PER_CAPITA_LABEL = "주민 1인당 지급액";

/** The numerator column name. */
export const MUNICIPAL_COST_TOTAL_LABEL = "총 지급액";

/**
 * The absence label. An unavailable municipality shows THIS, never ₩0 — an absent
 * disclosure is not a zero payment (repo AGENTS.md; Step 2 report §9 rule 2).
 */
export const MUNICIPAL_COST_UNAVAILABLE_LABEL = "자료 없음";

/**
 * The empty-FILTER state, deliberately worded so it cannot be confused with the
 * absence label above. "No municipality matches what you asked for" is a statement
 * about the filter; "자료 없음" is a statement about a municipality's data.
 */
export const MUNICIPAL_COST_NO_MATCH_TITLE = "선택한 조건에 해당하는 지자체가 없습니다.";

export const MUNICIPAL_COST_NO_MATCH_DESCRIPTION =
  "지역이나 상태 조건을 바꾸면 다시 표시됩니다. 이는 특정 지자체의 지급액이 0이라는 뜻이 아닙니다.";
