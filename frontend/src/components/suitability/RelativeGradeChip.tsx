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
 */
export function RelativeGradePanel({ distribution }: { distribution: GradeDistribution }) {
  const rows: { grade: RelativeGrade; range: string; count: number }[] = [
    { grade: "A", range: `${distribution.p75} 이상`, count: distribution.countA },
    { grade: "B", range: `${distribution.p25} – ${distribution.p75}`, count: distribution.countB },
    { grade: "C", range: `${distribution.p25} 미만`, count: distribution.countC },
  ];

  return (
    <SectionCard title={RELATIVE_GRADE_TITLE} testId="relative-grade-panel">
      {/* The disclaimer is NOT collapsible: it is the notice that stops A/B/C
          being read as 적격/부적격, which is a critical analytical limitation
          (spec §9). */}
      <p className="text-xs leading-relaxed text-ink-muted" data-testid="relative-grade-explanation">
        {RELATIVE_GRADE_EXPLANATION}
      </p>
      <dl className="mt-2 flex flex-col gap-1.5" data-testid="relative-grade-bands">
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-2 text-xs">
            <dt className="flex flex-none items-center gap-1.5">
              <RelativeGradeChip grade={row.grade} />
              <span className="text-ink">{GRADE_LABELS[row.grade]}</span>
            </dt>
            <dd className="ml-auto text-right text-ink-muted">
              {/* The numeric range and the exact count, so the band is legible
                  without relying on the swatch at all. */}
              <span data-testid={`relative-grade-range-${row.grade}`}>{row.range}</span>
              <span className="ml-2 text-ink-subtle">
                {row.count.toLocaleString("ko-KR")}곳
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-subtle" data-testid="relative-grade-basis">
        {relativeGradeBasis(distribution)}
      </p>
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
export function RelativeGradeUnavailable() {
  return (
    <SectionCard title={RELATIVE_GRADE_TITLE} testId="relative-grade-unavailable">
      <p className="text-xs leading-relaxed text-ink-muted">
        전체 스크리닝 통과 구역의 점수 분포를 불러오지 못해 상대 점수 구간을 표시하지 않습니다.
        일부만으로 구간을 계산하면 실제 분포와 달라지므로 추정값을 대신 표시하지 않습니다.
      </p>
    </SectionCard>
  );
}
