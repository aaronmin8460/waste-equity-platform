/**
 * 지수 점수 라벨 — the ABSOLUTE per-factor 0–100 band (Figma 225:440 + image 352:1255).
 *
 * The page-4 기술 참고사항 states: "각 계산 모델의 만점은 100점이고, 라벨은 다음과
 * 같음 (라벨링 기준은 하단에 '점수 기준 자세히 보기' 누르면 나오도록)", and the image
 * beside it gives the table this module encodes. The expanded weight panel (356:582)
 * renders it inline as "기존시설 부담지수 : 87/100  우수" and "대기영향 지수 : 20/100
 * 미흡".
 *
 * ── THIS IS NOT THE A/B/C RELATIVE BAND ──────────────────────────────────────────
 * Two different claims share a screen and must never be conflated:
 *
 *   - THIS band is ABSOLUTE and PER FACTOR. It reads one component's own 0–100
 *     score against fixed cut points. It says nothing about other candidates.
 *   - `lib/relativeGrade.ts`'s A/B/C is RELATIVE and applies to the TOTAL score. It
 *     reads a candidate's position in the eligible population's distribution and its
 *     thresholds move with the population and the scope.
 *
 * So the two use different words (우수/양호/보통/미흡/부적합 here; 상위/중간/하위 구간
 * there), different surfaces, and different colour treatments. A 우수 factor does not
 * make an A candidate, and neither is a screening verdict.
 *
 * ── WHY FIXED CUT POINTS ARE HONEST HERE ─────────────────────────────────────────
 * Every component score this product serves is already a 0–100 percentile-normalised
 * value (see `docs/SUITABILITY_CRITIC_STABILITY.md` and the per-factor formulas:
 * `점수 = 100 - percentile_rank(...)`). A fixed cut over an already-normalised 0–100
 * scale re-states the served number in words; it derives no new quantity, changes no
 * ranking, and is never fed back into a score.
 *
 * ── BOUNDARIES ───────────────────────────────────────────────────────────────────
 * The source table is written with integer ranges (80~100, 60~79, …), which for a
 * continuous served score means the cut is `>= 80`, `>= 60`, `>= 40`, `>= 20`, else
 * 부적합 — so 79.5 is 양호, exactly as the integer table reads once rounded down. The
 * thresholds are DESIGN-SPECIFIED presentation constants, not a policy threshold the
 * backend knows about, and {@link FACTOR_SCORE_BAND_SOURCE_NOTE} says so wherever the
 * table is shown.
 */

/** The five bands, worst-last, in the order the source table lists them. */
export type FactorScoreBandKey = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "UNSUITABLE";

export interface FactorScoreBand {
  key: FactorScoreBandKey;
  /** The label the design specifies, verbatim. */
  label: string;
  /** Inclusive lower cut on the served 0–100 score. */
  min: number;
  /** The range exactly as the source table writes it, for the reference table. */
  range: string;
}

/**
 * The band table, highest first — the iteration order {@link factorScoreBand} relies
 * on, and the order the 점수 기준 자세히 보기 reference renders.
 */
export const FACTOR_SCORE_BANDS: readonly FactorScoreBand[] = [
  { key: "EXCELLENT", label: "우수", min: 80, range: "80~100" },
  { key: "GOOD", label: "양호", min: 60, range: "60~79" },
  { key: "FAIR", label: "보통", min: 40, range: "40~59" },
  { key: "POOR", label: "미흡", min: 20, range: "20~39" },
  { key: "UNSUITABLE", label: "부적합", min: 0, range: "0~19" },
];

/**
 * The band for one served component score, or `null` when there is no score to band.
 *
 * `null` is returned for an absent, empty, unparseable, or out-of-range value — a
 * missing score is NOT a low score, and banding one as 부적합 would turn a data gap
 * into an adverse finding. Out-of-range is refused rather than clamped: a value
 * outside 0–100 means the score is not the normalised quantity this table describes,
 * and silently clamping it would hide that.
 */
export function factorScoreBand(
  score: number | string | null | undefined,
): FactorScoreBand | null {
  if (score === null || score === undefined || score === "") return null;
  const value = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return FACTOR_SCORE_BANDS.find((band) => value >= band.min) ?? null;
}

/** The band's label, or `null` — the string form every card prints. */
export function factorScoreBandLabel(score: number | string | null | undefined): string | null {
  return factorScoreBand(score)?.label ?? null;
}

/** The heading of the reference table behind 점수 기준 자세히 보기. */
export const FACTOR_SCORE_BAND_TITLE = "지수 점수 라벨 기준";

/**
 * The sentence that must accompany the table, so a reader is never left thinking the
 * five words are an official determination or a pass/fail line.
 */
export const FACTOR_SCORE_BAND_SOURCE_NOTE =
  "각 지수는 100점 만점이며, 위 라벨은 그 점수를 읽기 쉽게 표시하기 위한 화면 표기 기준입니다. " +
  "법적 적합·부적합 판정이나 스크리닝 통과 여부와는 관계가 없습니다.";
