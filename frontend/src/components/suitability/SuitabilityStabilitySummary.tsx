"use client";

/**
 * 기준을 바꿔도 상위권을 유지하는 정도 — the weight-sensitivity stability summary.
 *
 * Split out of the former `SuitabilityPanel` with its content unchanged: the three
 * served counts, the top-10% cutoff rank, the three compared profiles, and the
 * sensitivity caveat. It computes nothing.
 *
 * The meaning of stability is unchanged and stated in words, never by the map's
 * outline color alone: a candidate is 안정 when it lands in the top 10% under ALL
 * THREE compared weight profiles. It is a sensitivity property of this comparison —
 * NOT 안전성, 시공 가능성, 법적 안정성, or 정책 확정성 — and the closing sentence
 * says so explicitly (docs/SUITABILITY_CRITIC_STABILITY.md).
 */

import type { SuitabilitySummary } from "../../lib/api";
import { formatCount } from "../../lib/metrics";
import SectionCard from "../ui/SectionCard";
import { OLD_RUN_NO_CRITIC_MESSAGE } from "./shared";

const TITLE = "기준을 바꿔도 상위권을 유지하는 정도";

export interface SuitabilityStabilitySummaryProps {
  summary: SuitabilitySummary;
  /** Whether the run computed CRITIC + stability at all. */
  available: boolean;
}

export default function SuitabilityStabilitySummary({
  summary,
  available,
}: SuitabilityStabilitySummaryProps) {
  if (!available) {
    return (
      <SectionCard title={TITLE} testId="stability-unavailable">
        <p className="text-xs text-ink-muted">{OLD_RUN_NO_CRITIC_MESSAGE}</p>
      </SectionCard>
    );
  }
  const rows: { label: string; value: string }[] = [
    { label: "안정 후보", value: `${formatCount(summary.candidate_count_stable)}개` },
    {
      label: "조건부 안정 후보",
      value: `${formatCount(summary.candidate_count_conditionally_stable)}개`,
    },
    {
      label: "가중치 민감 후보",
      value: `${formatCount(summary.candidate_count_weight_sensitive)}개`,
    },
  ];
  return (
    <SectionCard title={TITLE} testId="stability-summary">
      <dl className="flex flex-col gap-1" data-testid="stability-counts">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2 text-xs">
            <dt className="min-w-0 truncate text-ink-muted">{row.label}</dt>
            <dd className="flex-none font-semibold tabular-nums text-ink">{row.value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <dt className="min-w-0 truncate text-ink-muted">상위 기준</dt>
          <dd className="flex-none tabular-nums text-ink">
            상위 10%, rank ≤ {summary.stability_top_cutoff_rank ?? "-"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <dt className="min-w-0 truncate text-ink-muted">비교 방식</dt>
          <dd className="flex-none text-ink">baseline / equal / critic</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-ink-subtle">
        안정 후보는 세 비교 방식 모두에서 상위 10%에 포함된 후보입니다. 가중치 변화에 덜 민감하다는
        뜻이며 최종 입지, 허가 가능성 또는 법적 적격성을 의미하지 않습니다.
      </p>
    </SectionCard>
  );
}
