"use client";

/**
 * 비용 구성 — how the ONE-TIME 표준공사비 기반 설치비 산정액 splits into its nominal
 * national subsidy and its simplified local share.
 *
 * WHAT THE REFRESH CHANGED: this was the collapsed 국비·지방비 구성 disclosure. It is
 * now a visible section, because it is the only decomposition of the headline cost
 * on the screen and a citizen should not have to open a disclosure to see what the
 * number is made of. The amounts, their order, their exact served strings, the
 * decorative bar, the rate, the rate basis, and the served note are unchanged.
 *
 * Every displayed money value is the exact backend string through `formatBn`
 * (comma grouping only). `Number()` is used ONLY for the decorative bar's widths —
 * never to produce a value described as exact, and never to re-derive a total.
 *
 * Rules preserved from docs/FACILITY_COST_LENS_UI.md:
 *   - the annualized cost is NOT mixed into this total (it is the same one-time
 *     cost restated per year, not an additional cost);
 *   - it does NOT imply subsidy approval;
 *   - missing components are NOT drawn as zero-width categories — missing is not
 *     zero, so they appear only in 포함되지 않은 비용.
 */

import type { FacilityCostCalculate } from "../../lib/api";
import { formatBn } from "./shared";

/** One composition row: the term, what kind of cost it is, and the exact amount. */
function FundingRow({
  swatch,
  label,
  nature,
  amount,
  testId,
}: {
  swatch: string;
  label: string;
  nature: string;
  amount: string;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden className={`mt-1 inline-block h-3 w-3 flex-none rounded-sm ${swatch}`} />
      <div className="min-w-0">
        <dt className="text-xs text-ink-subtle">
          {label}
          <span className="mt-0.5 block">{nature}</span>
        </dt>
        <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink" data-testid={testId}>
          {amount}
        </dd>
      </div>
    </div>
  );
}

export default function FacilityCostBreakdown({ result }: { result: FacilityCostCalculate }) {
  const total = Number(result.standard_cost.standard_construction_cost_bn);
  const subsidyN = Number(result.subsidy.estimated_national_subsidy_bn);
  const localN = Number(result.subsidy.simplified_local_government_share_bn);
  const subsidyPct = total > 0 ? Math.max(0, Math.min(100, (subsidyN / total) * 100)) : 0;
  const localPct = total > 0 ? Math.max(0, Math.min(100, (localN / total) * 100)) : 0;

  return (
    <section aria-label="설치비 재원 구성" data-testid="facility-cost-funding">
      <p className="text-xs text-ink-subtle">
        일회성 설치비 산정액을 명목 국고보조 추정액과 단순 지방비 추정액으로 나눈 분석용 구성입니다. 보조금
        승인을 의미하지 않으며, 연간 환산 설치비와 합산하지 않습니다.
      </p>
      {/* The stacked bar is decorative; every value is available as text below. */}
      <div
        aria-hidden
        className="mt-3 flex h-5 w-full overflow-hidden rounded border border-hairline-strong"
      >
        <div className="h-full bg-primary" style={{ width: `${subsidyPct}%` }} />
        <div className="h-full bg-hairline-strong" style={{ width: `${localPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FundingRow
          swatch="bg-primary"
          label="명목 국고보조 추정액"
          nature="일회성 · 설치비 산정액의 일부"
          amount={formatBn(result.subsidy.estimated_national_subsidy_bn)}
          testId="fc-funding-subsidy"
        />
        <FundingRow
          swatch="bg-hairline-strong"
          label="단순 지방비 추정액"
          nature="일회성 · 설치비 산정액의 일부"
          amount={formatBn(result.subsidy.simplified_local_government_share_bn)}
          testId="fc-funding-local"
        />
        <FundingRow
          swatch="border border-hairline-strong"
          label="합계 (설치비 산정액)"
          nature="일회성 합계"
          amount={formatBn(result.standard_cost.standard_construction_cost_bn)}
          testId="fc-funding-total"
        />
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        명목 국고보조 추정액과 단순 지방비 추정액을 더하면 설치비 산정액이 됩니다. 두 값은 같은 일회성
        금액을 나눈 것이며, 위의 연간 환산 설치비는 같은 설치비를 내용연수로 나누어 연 단위로 표시한
        값이므로 더하지 않습니다.
      </p>
      <dl className="mt-3 flex flex-col gap-1 text-xs text-ink-muted">
        <div>
          <dt className="inline font-medium">적용 보조 시나리오: </dt>
          <dd className="inline" data-testid="fc-funding-scheme">
            {result.subsidy.subsidy_scheme_label} · 명목 보조율 {result.subsidy.subsidy_rate}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">보조율 근거: </dt>
          <dd className="inline" data-testid="fc-funding-rate-basis">
            {result.subsidy.rate_basis} · 출처 {result.subsidy.rate_source} · 기준{" "}
            {result.subsidy.rate_reference_period}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs font-medium text-warn">{result.subsidy.note}</p>
    </section>
  );
}
