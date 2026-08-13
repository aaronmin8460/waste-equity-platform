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
 * The second line of the distinction banner: what this indicator IS, the two things
 * it is most likely to be mistaken for, the three axes on which it differs from the
 * official inbound fee, and the one operation a reader must not perform.
 *
 * Stated positively first, because a caveat that only says "this is not X" leaves the
 * reader to guess what it is — and the guess a per-capita won figure invites is "the
 * bill I pay", which is the single most damaging misreading of this dataset.
 */
export const MUNICIPAL_COST_DISTINCTION_NOTE =
  "이 지표는 개별 지자체가 생활폐기물 수집·운반 계약에 지급한 금액을 주민수로 나눈 환산값이며, " +
  "주민이 직접 낸 요금도 수도권매립지 공식 반입수수료도 아닙니다. " +
  "회계 기준·제공기관·공간 단위가 모두 달라 두 값을 더하거나 같은 비용으로 비교할 수 없습니다.";

/**
 * The one reference year this release publishes, as a citizen-facing chip.
 *
 * The screen above this section carries its OWN year control, whose default is the
 * latest complete landfill year — 2025 in the current release. Nothing about that
 * control applies here: the municipal endpoint publishes 2024 and rejects any other
 * year with a 422. Without this said out loud, a reader who has just set the page to
 * 2025 has every reason to read these payments as 2025 figures.
 *
 * The chip itself renders the SERVED `meta.reference_year`; this is the sentence that
 * explains why it differs from the selection above.
 */
export const MUNICIPAL_COST_YEAR_NOTE =
  "위 반입 현황에서 고른 연도와 상관없이, 이 비교는 2024년 자료만 제공합니다.";

/** Suffix for the served reference year, so the chip and the tests word it once. */
export const MUNICIPAL_COST_YEAR_CHIP_SUFFIX = "년 자료";

/** The filter card's heading. Names what the controls scope — not the page's filters. */
export const MUNICIPAL_COST_FILTER_TITLE = "지자체 비교 조건";

export const MUNICIPAL_COST_FILTER_DESCRIPTION =
  "세 가지 조건이 아래 비교표를 함께 결정합니다. 모두 서버에 그대로 전달됩니다.";

/** The comparison card's heading and its unit line, mirroring the Page 2 table card. */
export const MUNICIPAL_COST_TABLE_TITLE = "지자체별 상세 비교";

export const MUNICIPAL_COST_TABLE_UNIT_NOTE = "단위: 원/인, 억원";

/**
 * The notes under the comparison table. Both are statements about how to READ the
 * table, so they stay outside every disclosure.
 */
export const MUNICIPAL_COST_TABLE_FOOTNOTES: readonly string[] = [
  "값이 없는 지자체는 목록에서 빼지 않고 자료 없음으로 표시합니다. 지급액이 0이라는 뜻이 아닙니다.",
  "지자체 이름 아래 줄은 소속 광역자치단체와 기초자치단체 유형입니다(서울 자치구 · 인천 군·구 · 경기 시·군).",
];

/** The per-capita column/metric name. Never an amount a resident actually paid. */
export const MUNICIPAL_COST_PER_CAPITA_LABEL = "주민 1인당 지급액";

/** The numerator column name. */
export const MUNICIPAL_COST_TOTAL_LABEL = "총 지급액";

/**
 * The inline qualifier stamped on a PARTIAL row's own values.
 *
 * The status badge already says 일부 제한, but the badge sits in its own column: a
 * reader scanning the per-capita numbers can compare a limited value against an
 * unlimited one without ever crossing it. This marker travels WITH the number, and
 * `aria-describedby` points from the value to the served limitation sentence, so the
 * qualification reaches a screen-reader user at the value rather than a column away.
 */
export const MUNICIPAL_COST_PARTIAL_INLINE_LABEL = "제한 있음";

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
