/**
 * Constants and pure helpers shared by the 매립지 현황 presentational components.
 *
 * Everything here was lifted VERBATIM out of `components/LandfillDashboard.tsx`
 * during the civic-dashboard refresh. No string was rewritten, no threshold was
 * introduced, and no value is computed here that was not computed there — the only
 * arithmetic in this file is `barRatio`, which scales a decorative CSS width and
 * never reconstructs a displayed figure.
 *
 * Formatting stays in `lib/landfill.ts`. This file holds copy and layout helpers
 * only, so a future change to a served value's presentation has exactly one home.
 */

import type { LandfillOrigin, LandfillPeriod } from "../../lib/api";

/**
 * Korean-only primary labels (Phase 5): the English parentheticals that used to
 * ride along — 서울시 (Seoul), 연도 (Year), 출발 광역지자체 (Origin) — were the
 * duplication documented as defect G3. The English terms are not lost; they remain
 * in the served payload, in the evidence disclosures, and in the test ids.
 */
export const ORIGIN_OPTIONS: { code: LandfillOrigin; label: string }[] = [
  { code: "11", label: "서울시" },
  { code: "28", label: "인천시" },
  { code: "41", label: "경기도" },
];

/** The plain Korean name of a served origin code, for the selection summary. */
export function originLabel(origin: LandfillOrigin | null): string {
  if (origin == null) return "전체";
  return ORIGIN_OPTIONS.find((option) => option.code === origin)?.label ?? origin;
}

/**
 * The metric name is fixed product copy: it must never read as an amount a
 * resident actually paid or was taxed.
 */
export const PER_CAPITA_LABEL = "주민 1인당 환산 반입수수료";

/**
 * 톤당 환산 수수료 — the official fee divided by the official tonnage.
 *
 * The Figma design names it 환산 (converted), matching its sibling
 * {@link PER_CAPITA_LABEL}; the platform previously called it 실효 (effective). It is
 * one derived quantity, so it gets ONE name everywhere it appears — the KPI, the
 * regional table, the methodology list, and the export column headers — rather than
 * a Figma-matching label on the card and a different word two sections down.
 */
export const EFFECTIVE_FEE_LABEL = "톤당 환산 수수료";

/**
 * Why the two Figma headline totals carry no number.
 *
 * Short enough to read as a value substitute in a KPI card; the card's caption
 * carries the full explanation. It states the absence of an official TOTAL, not the
 * absence of the data — the per-region series are published and are on this page.
 */
export const UNBOUND_TOTAL_REASON = "합산 공식값 없음";

/**
 * The population basis, stated where the per-resident conversion is read.
 *
 * 지역 지표 divides by the SGIS ANNUAL population instead, so the same phrase
 * "1인당" means a different denominator on the two screens. A reader who carries a
 * number across without knowing that is comparing two different quantities.
 */
export const POPULATION_BASIS_NOTE =
  "인구 기준: 행정안전부 주민등록 인구(월말). 지역 지표 화면의 1인당 값은 통계청 SGIS 연간 인구를 " +
  "쓰므로 두 화면의 1인당 값은 같은 기준이 아닙니다.";

export const PER_CAPITA_DESCRIPTION =
  "선택 기간의 공식 반입수수료를 동일 기간 기준의 해당 지역 인구로 나눈 분석용 환산값입니다. " +
  "개인의 실제 납부액이 아닙니다.";

export const LIMITATION_NOTICE =
  "광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.";

/** Fallback label only; the served population_source_id is authoritative. */
export const MOIS_SOURCE_ID = "mois_resident_population";

export const FEE_CAVEAT =
  "반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가 아닙니다.";

/**
 * The orientation sentence under the <h1>. It states the scope precisely and
 * claims nothing the dataset cannot support: no real-time figure, no resident
 * bill, and no waste flow outside what the corporation reports as inbound.
 */
export const HEADER_SUMMARY =
  "서울 · 인천 · 경기에서 수도권매립지로 반입된 공식 반입량과 반입수수료를 선택한 기간과 조건으로 보여줍니다.";

/**
 * The standing banner's second line. It states the four things a reader has to
 * know before reading any number, and it is deliberately NOT role="alert": a
 * permanent disclaimer that interrupts a screen reader on every render stops
 * being read (components/ui/InfoBanner.tsx).
 */
export const PERIOD_NOTICE =
  "공식 자료가 있는 기간만 표시하며 일부 연도는 부분 자료입니다. " +
  "수수료와 1인당 환산값은 같은 기간의 공식 자료가 있을 때만 계산되고, " +
  "자료가 없는 값은 0이 아니라 자료 없음으로 표시합니다.";

/**
 * The served period, as a citizen reads it. Unchanged from the pre-refresh
 * expression: a month-scoped answer names the month, otherwise the year is
 * labelled 연간 — never "전체" (which would imply the whole dataset).
 */
export function periodLabelOf(period: LandfillPeriod): string {
  return `${period.year}년${period.month ? ` ${Number(period.month.slice(5, 7))}월` : " 연간"}`;
}

/**
 * The 연도 options, newest first.
 *
 * The currently selected year is always included even when the served list does not
 * contain it. A native `<select>` whose `value` matches no `<option>` renders
 * **blank**, so selecting a year the backend then reports as empty would silently
 * erase the control's own state — the reader could no longer see what they had
 * asked for while being told to ask for something else. Including it reports the
 * user's own selection back to them; it asserts nothing about the data, and the
 * no-data panel alongside states plainly which years do have records.
 */
export function yearOptions(availableYears: number[], selected: number | null): number[] {
  const years = new Set(availableYears);
  if (selected != null) years.add(selected);
  return [...years].sort((a, b) => b - a);
}

/**
 * The 기간 options: every month the selected year covers, plus the reader's own
 * selection if a narrower bound has since arrived. Same blank-select reasoning as
 * {@link yearOptions} — the control must never silently lose its own value.
 */
export function monthOptions(maxMonth: number, selected: number | null): number[] {
  const months = new Set(Array.from({ length: maxMonth }, (_, index) => index + 1));
  if (selected != null) months.add(selected);
  return [...months].sort((a, b) => a - b);
}

/**
 * The bar's share of the widest row currently on screen, or `null` when there is
 * nothing honest to draw.
 *
 * This is a REDUNDANT VISUAL ENCODING of a value already printed as exact text
 * beside it — not a score, not a ranking, and not a new analytical output. It is
 * normalised only within the rows displayed, so it never implies a national or
 * historical reference point.
 *
 * `null` (no bar at all) when the value is unparseable or the set has no positive
 * maximum: drawing a zero-width bar there would assert an official zero the data
 * does not claim. A genuine `0` returns `0` and draws a genuinely empty track.
 */
export function barRatio(tons: string, max: number): number | null {
  const value = Number(tons);
  if (!Number.isFinite(value) || value < 0) return null;
  // `max` must be guarded for finiteness too, not just sign: a single unparseable
  // row makes `Math.max(...)` NaN, and `NaN <= 0` is false. That would return NaN,
  // emit `width: NaN%`, be rejected by the CSSOM, and leave the bar at its `auto`
  // width — painting EVERY row full-width, the exact misreading this returns null
  // to avoid.
  if (!Number.isFinite(max) || max <= 0) return null;
  return value / max;
}
