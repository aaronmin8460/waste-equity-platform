/**
 * 결과 안정성 등급 — the three-bucket rank-variability band for Page 5.
 *
 * Figma authority: the page-5 기술 참고사항 sheet `167:11209`, image `167-11232`
 * ("6. 결과 안정성 등급"), which specifies:
 *
 *   순위 변화 ±4 이하  → 안정성 높음 → 초록
 *   순위 변화 ±5~9     → 보통        → 노랑
 *   순위 변화 ±10 이상 → 변동성 높음 → 빨강
 *
 * ── THESE ARE UI CONSTANTS, NOT POLICY THRESHOLDS ────────────────────────────────
 * The source says so in as many words: *"단, ±4 / ±5~9 / ±10 기준은 정책적으로 정해진
 * 공식 기준이 아니라 UI용 내부 기준이므로 개발 시 별도 상수로 관리하는 게 좋습니다"*,
 * and names the two constants below. They are therefore kept here, named exactly as
 * the source names them, and {@link RANK_VARIABILITY_SOURCE_NOTE} repeats the
 * qualification in the UI. Nothing in the backend knows these numbers: no score, no
 * rank, no stability class and no screening status is derived from them, and the
 * run's own frozen `stability_class` is a DIFFERENT quantity that this must never
 * overwrite or be confused with.
 *
 * ── WHAT THE MEASURED QUANTITY IS ────────────────────────────────────────────────
 * `movement` = |B안 순위 − A안 순위| for one candidate, which is exactly the
 * two-point form the same spec sanctions: *"또는 A/B 두 안만 비교한다면:
 * 순위 변동성 = |A안 순위 - B안 순위|"* (image `167-11235`). It is NOT a
 * multi-scenario perturbation spread — see `ScenarioRankMovementScatter` for why the
 * card that shows it is titled 순위 변동 분포 rather than 가중치 민감도.
 *
 * ── COLOUR IS NEVER THE ONLY SIGNAL ──────────────────────────────────────────────
 * Every surface using these buckets prints {@link RankVariabilityMeta.label} and the
 * measured 계단 count beside the marker, so the band survives grayscale and a colour
 * vision deficiency. The marker is a circle beside the region name, which is the
 * shape `359:1384` asks for ("변동성에 따라 3가지 색 구분 (지역명 옆에 동그라미
 * 아이콘)").
 */

/** ±4 이하 → 안정성 높음. Named exactly as the design source names it. */
export const STABLE_THRESHOLD = 4;

/** ±5~9 → 보통; anything above this is 변동성 높음. */
export const MEDIUM_THRESHOLD = 9;

export type RankVariabilityLevel = "STABLE" | "MEDIUM" | "VOLATILE";

export interface RankVariabilityMeta {
  level: RankVariabilityLevel;
  /** The band name the design specifies, verbatim. */
  label: string;
  /** The band's range, in 계단, for the legend. */
  detail: string;
  /** The circular marker's fill. */
  dot: string;
  /** Text colour for the band name where it is printed as a word. */
  text: string;
}

/**
 * The three bands, most stable first.
 *
 * Colours are the shared semantic tokens (success / warn / danger) rather than raw
 * hex, so the traffic light matches every other status surface in the product and
 * inherits its contrast guarantees.
 */
export const RANK_VARIABILITY_META: Record<RankVariabilityLevel, RankVariabilityMeta> = {
  STABLE: {
    level: "STABLE",
    label: "안정성 높음",
    detail: `${STABLE_THRESHOLD}계단 이하`,
    dot: "var(--color-success)",
    text: "var(--color-success)",
  },
  MEDIUM: {
    level: "MEDIUM",
    label: "보통",
    detail: `${STABLE_THRESHOLD + 1}~${MEDIUM_THRESHOLD}계단`,
    dot: "var(--color-warn)",
    text: "var(--color-warn)",
  },
  VOLATILE: {
    level: "VOLATILE",
    label: "변동성 높음",
    detail: `${MEDIUM_THRESHOLD + 1}계단 이상`,
    dot: "var(--color-danger)",
    text: "var(--color-danger)",
  },
};

/** The three bands in legend order (most stable first). */
export const RANK_VARIABILITY_ORDER: readonly RankVariabilityLevel[] = [
  "STABLE",
  "MEDIUM",
  "VOLATILE",
];

/**
 * The band for one candidate's measured A→B movement, or `null` when there is no
 * exact movement.
 *
 * `null` — never 안정성 높음 — for an absent movement. A candidate whose rank is
 * missing on one side has not been shown to be stable; calling it stable would be
 * the single most misleading thing this module could do, because "no data" and "did
 * not move" look identical once they share a green dot.
 */
export function rankVariabilityLevel(
  movement: number | null | undefined,
): RankVariabilityLevel | null {
  if (movement === null || movement === undefined) return null;
  if (!Number.isFinite(movement)) return null;
  const magnitude = Math.abs(movement);
  if (magnitude <= STABLE_THRESHOLD) return "STABLE";
  if (magnitude <= MEDIUM_THRESHOLD) return "MEDIUM";
  return "VOLATILE";
}

/** The band's presentation metadata, or `null` with the level. */
export function rankVariabilityMeta(
  movement: number | null | undefined,
): RankVariabilityMeta | null {
  const level = rankVariabilityLevel(movement);
  return level === null ? null : RANK_VARIABILITY_META[level];
}

/**
 * The qualification the design source itself insists on, shown wherever the three
 * colours are explained.
 */
export const RANK_VARIABILITY_SOURCE_NOTE =
  `${STABLE_THRESHOLD}계단 · ${MEDIUM_THRESHOLD}계단 경계는 결과를 읽기 쉽게 나누기 위한 ` +
  "화면 표시 기준이며, 정책으로 정해진 공식 기준이 아닙니다. 분석 실행이 미리 계산해 둔 " +
  "실행 안정성과는 다른 값입니다.";
