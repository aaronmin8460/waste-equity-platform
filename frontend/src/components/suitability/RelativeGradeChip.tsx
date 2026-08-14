"use client";

/**
 * The A/B/C 상대 점수 구간 chip and its explanatory panel.
 *
 * Both surfaces exist to make one thing unmistakable: this is a RELATIVE band
 * over the eligible score distribution, not an official screening outcome. See
 * `lib/relativeGrade.ts` for the population and threshold rules.
 *
 * The chip always prints its LETTER. Colour is a supporting signal only, so the
 * band survives a grayscale render or a colour-vision deficiency — the same rule
 * the status badges follow.
 */

import type { GradeDistribution, RelativeGrade } from "../../lib/relativeGrade";
import {
  GRADE_LABELS,
  GRADE_SHARE_LABELS,
  RELATIVE_GRADE_EXPLANATION,
  RELATIVE_GRADE_TITLE,
  relativeGradeBasis,
} from "../../lib/relativeGrade";
import SectionCard from "../ui/SectionCard";

export function RelativeGradeChip({ grade }: { grade: RelativeGrade }) {
  return (
    <span
      className={`wep-grade wep-grade-${grade}`}
      data-testid="relative-grade-chip"
      data-grade={grade}
      // The visible letter alone would read as a bare code, so the accessible
      // name carries the full Korean band name.
      title={GRADE_LABELS[grade]}
    >
      <span aria-hidden>{grade}</span>
      <span className="sr-only">{GRADE_LABELS[grade]}</span>
    </span>
  );
}

/**
 * The legend/explanation panel. Rendered only when a distribution was actually
 * derived from the complete authoritative population; when it could not be, the
 * caller renders {@link RelativeGradeUnavailable} instead of guessing.
 *
 * ── THE FIGMA ROW SHAPE, WITHOUT THE FIGMA MEANING ───────────────────────────────
 * Figma 136:8684 draws three stacked rows in green / amber / red reading
 * "A · 점 이상 → 스크리닝 통과", "B · ~ 점 → 추가 검토 필요", "C · 미만 → 스크리닝
 * 제외". That is the exact misreading these bands exist to prevent: A/B/C is a
 * relative position in the ELIGIBLE score distribution and has no authority over the
 * official screening status, which the backend already decided for every cell.
 *
 * So this panel takes the row LAYOUT — three 36px rows, one line each — and rejects
 * the row CONTENT: the boundary is printed as the served percentile it is (≥ P75 /
 * P25 이상 ~ P75 미만 / < P25) beside the served count, the arrow-to-status text is
 * not rendered at all, and the chips keep their deliberately non-status navy ramp
 * (globals.css `.wep-grade-*`) instead of a traffic light.
 *
 * WHAT THE ROW CARRIES ON ITS LEFT is the band's SHARE (상위 25% · 중간 50% ·
 * 하위 25%). That used to be the opening clause of a three-sentence paragraph above
 * the rows; saying it once per row, beside the band it describes, is both shorter and
 * closer to the thing it explains. The full Korean band name stays the chip's
 * accessible name, so a screen reader still hears 상위 구간(A).
 *
 * `nested` drops the card chrome so the panel can sit inside ③ 종합 점수와 후보 순위
 * as its first block, which is where the Figma hierarchy puts it. The testids, the
 * copy, and every served value are identical in both shapes.
 */
export function RelativeGradePanel({
  distribution,
  scopeName,
  nested = false,
}: {
  distribution: GradeDistribution;
  /**
   * The active ① 분석 범위. The bands are relative to THIS population, so the basis
   * line names it — "상위 25%" of 인천 is a different score from 상위 25% of the
   * capital region, and a band shown without its population is unreadable.
   */
  scopeName?: string;
  nested?: boolean;
}) {
  const rows: { grade: RelativeGrade; range: string; count: number }[] = [
    { grade: "A", range: `${distribution.p75} 이상`, count: distribution.countA },
    {
      grade: "B",
      range: `${distribution.p25} 이상 ~ ${distribution.p75} 미만`,
      count: distribution.countB,
    },
    { grade: "C", range: `${distribution.p25} 미만`, count: distribution.countC },
  ];

  const body = (
    <>
      {/* THREE 36px ROWS, the Figma shape — one line each, chip and name on the
          left, the served boundary and the served count on the right. The band's
          share (상위 25% · 중간 50% · 하위 25%) rides in the row instead of in a
          paragraph above it, which is what let the paragraph shrink to the single
          caveat line below. */}
      <dl className="flex flex-col gap-2" data-testid="relative-grade-bands">
        {rows.map((row) => (
          <div
            key={row.grade}
            className="flex h-9 items-center gap-2 rounded-control border border-hairline bg-surface-muted px-2.5 text-xs"
            data-testid={`relative-grade-row-${row.grade}`}
          >
            {/* The band's SHARE is the left-hand identity — "상위 25%" is what the
                letter means, and it is short enough to sit on the 36px row beside
                the served boundary. The full Korean name (상위 구간(A)) stays the
                chip's accessible name, so nothing is lost to a screen reader. */}
            <dt className="flex flex-none items-center gap-2 text-ink">
              <RelativeGradeChip grade={row.grade} />
              <span className="whitespace-nowrap">{GRADE_SHARE_LABELS[row.grade]}</span>
            </dt>
            {/* The numeric boundary and the exact count, so the band is legible
                without relying on the chip's fill at all. */}
            <dd className="flex min-w-0 flex-1 items-baseline justify-end gap-1.5 text-right text-ink-muted">
              <span
                className="min-w-0 truncate tabular-nums"
                data-testid={`relative-grade-range-${row.grade}`}
              >
                {row.range}
              </span>
              <span className="flex-none text-[11px] tabular-nums text-ink-subtle">
                {row.count.toLocaleString("ko-KR")}곳
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {/* The one caveat no row can carry, and NOT collapsible: it is what stops
          A/B/C being read as 적격/부적격 (spec §9). */}
      <p
        className="mt-2 text-[11px] leading-snug text-ink-muted"
        data-testid="relative-grade-explanation"
      >
        {RELATIVE_GRADE_EXPLANATION}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-ink-subtle" data-testid="relative-grade-basis">
        {relativeGradeBasis(distribution, scopeName)}
      </p>
    </>
  );

  if (nested) {
    return (
      <section aria-label={RELATIVE_GRADE_TITLE} data-testid="relative-grade-panel">
        <h3 className="text-xs font-semibold text-ink">{RELATIVE_GRADE_TITLE}</h3>
        <div className="mt-1.5">{body}</div>
      </section>
    );
  }
  return (
    <SectionCard title={RELATIVE_GRADE_TITLE} testId="relative-grade-panel">
      {body}
    </SectionCard>
  );
}

/**
 * Shown when the complete authoritative population could not be established.
 *
 * It states the absence plainly rather than falling back to an approximation
 * computed from whatever happened to be loaded — the "insufficient population"
 * rule in spec §6.4.
 */
export function RelativeGradeUnavailable({
  nested = false,
  /**
   * The active ① 분석 범위, when it is narrower than 수도권 전체.
   *
   * WHY THIS MATTERS. Before the scope control existed, the population was always
   * the whole run, so a missing distribution could only mean a failed read — and the
   * copy said so. Under a scope it has a second, entirely different cause: the range
   * genuinely holds too few scored 구역 to divide into quartiles (서울 holds ZERO
   * eligible cells in run 47). Calling that "불러오지 못해" would report a real
   * analytical answer as a malfunction, which is the very confusion the scoped empty
   * state exists to prevent. So the reason is named, not guessed at.
   */
  scopeName,
  emptyScope = false,
}: {
  nested?: boolean;
  scopeName?: string;
  /** True when the scoped ELIGIBLE population is genuinely too small to band. */
  emptyScope?: boolean;
}) {
  const body = emptyScope ? (
    <p className="text-xs leading-relaxed text-ink-muted" data-testid="relative-grade-empty-scope">
      {scopeName ?? "선택한 범위"} 안에는 점수가 계산된 스크리닝 통과 구역이 상대 구간을 나눌 만큼
      있지 않아 상대 점수 구간을 표시하지 않습니다. 자료를 불러오지 못한 것이 아니라, 이 범위의 실제
      결과입니다.
    </p>
  ) : (
    <p className="text-xs leading-relaxed text-ink-muted">
      전체 스크리닝 통과 구역의 점수 분포를 불러오지 못해 상대 점수 구간을 표시하지 않습니다.
      일부만으로 구간을 계산하면 실제 분포와 달라지므로 추정값을 대신 표시하지 않습니다.
    </p>
  );
  if (nested) {
    return (
      <section aria-label={RELATIVE_GRADE_TITLE} data-testid="relative-grade-unavailable">
        <h3 className="text-xs font-semibold text-ink">{RELATIVE_GRADE_TITLE}</h3>
        <div className="mt-1.5">{body}</div>
      </section>
    );
  }
  return (
    <SectionCard title={RELATIVE_GRADE_TITLE} testId="relative-grade-unavailable">
      {body}
    </SectionCard>
  );
}
