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
 *
 * ── THE FIGMA ROW SHAPE, WITHOUT THE FIGMA MEANING ───────────────────────────────
 * Figma 136:8684 draws three stacked rows in green / amber / red reading
 * "A · 점 이상 → 스크리닝 통과", "B · ~ 점 → 추가 검토 필요", "C · 미만 → 스크리닝
 * 제외". That is the exact misreading these bands exist to prevent: A/B/C is a
 * relative position in the ELIGIBLE score distribution and has no authority over the
 * official screening status, which the backend already decided for every cell.
 *
 * So this panel takes the row LAYOUT and rejects the row CONTENT: the boundary is
 * printed as the served percentile it is (≥ P75 / P25 이상 ~ P75 미만 / < P25), the
 * arrow-to-status text is not rendered at all, and the chips keep their deliberately
 * non-status navy ramp (globals.css `.wep-grade-*`) instead of a traffic light.
 *
 * `nested` drops the card chrome so the panel can sit inside ③ 종합 점수와 후보 순위
 * as its first block, which is where the Figma hierarchy puts it. The testids, the
 * copy, and every served value are identical in both shapes.
 */
export function RelativeGradePanel({
  distribution,
  nested = false,
}: {
  distribution: GradeDistribution;
  nested?: boolean;
}) {
  const rows: { grade: RelativeGrade; range: string; band: string; count: number }[] = [
    {
      grade: "A",
      range: `${distribution.p75} 이상`,
      band: "상대점수 상위 구간",
      count: distribution.countA,
    },
    {
      grade: "B",
      range: `${distribution.p25} 이상 ~ ${distribution.p75} 미만`,
      band: "상대점수 중간 구간",
      count: distribution.countB,
    },
    {
      grade: "C",
      range: `${distribution.p25} 미만`,
      band: "상대점수 하위 구간",
      count: distribution.countC,
    },
  ];

  const body = (
    <>
      {/* The disclaimer is NOT collapsible: it is the notice that stops A/B/C
          being read as 적격/부적격, which is a critical analytical limitation
          (spec §9). */}
      <p className="text-xs leading-relaxed text-ink-muted" data-testid="relative-grade-explanation">
        {RELATIVE_GRADE_EXPLANATION}
      </p>
      <dl className="mt-2 flex flex-col gap-1.5" data-testid="relative-grade-bands">
        {rows.map((row) => (
          <div
            key={row.grade}
            className="flex items-center gap-2 rounded-card border border-hairline bg-surface-muted px-2 py-1.5 text-xs"
            data-testid={`relative-grade-row-${row.grade}`}
          >
            <dt className="flex min-w-0 flex-1 items-center gap-1.5">
              <RelativeGradeChip grade={row.grade} />
              <span className="min-w-0">
                <span className="block truncate text-ink">{GRADE_LABELS[row.grade]}</span>
                <span className="block truncate text-[11px] text-ink-subtle">{row.band}</span>
              </span>
            </dt>
            <dd className="flex-none text-right text-ink-muted">
              {/* The numeric range and the exact count, so the band is legible
                  without relying on the swatch at all. */}
              <span className="block tabular-nums" data-testid={`relative-grade-range-${row.grade}`}>
                {row.range}
              </span>
              <span className="block text-[11px] tabular-nums text-ink-subtle">
                {row.count.toLocaleString("ko-KR")}곳
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-subtle" data-testid="relative-grade-basis">
        {relativeGradeBasis(distribution)}
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
export function RelativeGradeUnavailable({ nested = false }: { nested?: boolean }) {
  const body = (
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
