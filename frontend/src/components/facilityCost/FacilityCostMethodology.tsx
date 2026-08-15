"use client";

/**
 * 계산 기준·출처·버전 — the assumptions the calculation made, the sources and
 * reference periods behind every official input, and the exact backend-served
 * values.
 *
 * All three blocks moved here unchanged in substance. Korean-first labels stay
 * first; technical identifiers (derivation version, cost version, annualization
 * method, accounting-basis code, reference year, included-component codes) stay
 * demoted to the `data-diagnostic` disclosure at the end, never used as primary
 * labels.
 *
 * NUMBER CONTRACT. Every figure in `FacilityCostExactValues` is the ORIGINAL API
 * decimal string passed through `formatQuantity` (comma grouping only —
 * value-preserving). None is reconstructed from the approximation shown in the
 * headline cards, and none is parsed to a JavaScript Number on the way to the
 * screen.
 */

import type { FacilityCostCalculate } from "../../lib/api";
import { accountingBasisLabel, perCapitaUnavailableExplanation } from "../../lib/glossary";
import { formatQuantity } from "../../lib/metrics";
import DataStatusBadge from "../ui/DataStatusBadge";
import { formatBn, formatWon, matchedBandLabel, wasteStreamLabel } from "./shared";

/**
 * What the calculation assumed, in Korean-first labels.
 */
export function FacilityCostAssumptions({ result }: { result: FacilityCostCalculate }) {
  const { scenario, capacity, annualization, standard_cost, official_input } = result;
  const rows: { label: string; value: string; testId?: string }[] = [
    { label: "폐기물 종류", value: wasteStreamLabel(official_input.waste_stream) },
    { label: "시설 종류", value: scenario.facility_type_label },
    { label: "지역 처리 비율", value: `${scenario.processing_share_percent}%` },
    { label: "연간 가동일수", value: `${capacity.operating_days_per_year}일` },
    {
      label: "지하화 배수",
      value: `${scenario.underground_multiplier} · ${scenario.underground_multiplier_note}`,
    },
    {
      label: "보조 시나리오",
      value: `${scenario.subsidy_scheme_label} · 명목 보조율 ${scenario.subsidy_rate}`,
    },
    { label: "적용 공사비 기준", value: standard_cost.term_ko },
    {
      label: "적용 표준공사비 구간",
      value: `${matchedBandLabel(standard_cost.matched_band)} · 단가 ${formatQuantity(
        standard_cost.matched_band.cost_per_capacity_bn,
      )} ${standard_cost.matched_band.cost_per_capacity_unit}`,
      testId: "fc-matched-band",
    },
    {
      label: "연간 환산 기준",
      value: `내용연수 ${annualization.facility_lifetime_years}년 · ${annualization.lifetime_basis}`,
    },
  ];

  return (
    <div className="text-xs text-ink-muted">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="inline font-medium text-ink">{row.label}: </dt>
            <dd className="inline" data-testid={row.testId}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-4" data-testid="fc-assumption-list">
        {result.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

/** Sources and reference periods for every official input behind the result. */
export function FacilityCostEvidence({ result }: { result: FacilityCostCalculate }) {
  const p = result.provenance;
  const basis = result.official_input.accounting_basis;
  return (
    <section aria-label="출처와 방법" className="text-xs text-ink-muted" data-testid="facility-cost-methodology">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-ink">공사비 출처: </dt>
          <dd className="inline" data-testid="fc-source">
            {p.source_document} · {p.source_page} · 기준일 {p.price_base_date}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">보조율 출처: </dt>
          <dd className="inline">
            {p.subsidy_rate_source} · {p.subsidy_rate_reference_period}
          </dd>
        </div>
        {/* Source + reference period for every official input behind the derived
            metrics (AGENTS.md), not just the periods. */}
        <div data-testid="fc-waste-source">
          <dt className="inline font-medium text-ink">발생량 출처: </dt>
          <dd className="inline">
            {result.official_input.waste_official_dataset_name} (
            {result.official_input.waste_source_id}) · 집계 {accountingBasisLabel(basis)} · 기준{" "}
            {result.official_input.waste_reference_period}
          </dd>
        </div>
        <div data-testid="fc-population-source">
          <dt className="inline font-medium text-ink">인구 출처: </dt>
          <dd className="inline">
            {result.official_input.population_source_id
              ? `${result.official_input.population_source_id} · 정의 ${
                  result.official_input.population_definition ?? "—"
                } · 기준 ${result.official_input.population_reference_period ?? "—"}`
              : "동일 기간 공식 인구 미확정 (1인당 지방비 계산 불가)"}
          </dd>
        </div>
      </dl>
      <p className="mt-2 font-medium text-warn">{result.disclaimer}</p>
    </section>
  );
}

/** The exact backend-served values, unchanged. */
export function FacilityCostExactValues({ result }: { result: FacilityCostCalculate }) {
  const { official_input, capacity, standard_cost, annualization, subsidy, per_capita } = result;
  const rows: { label: string; value: string; testId: string }[] = [
    {
      label: "공식 연간 폐기물 발생량",
      value: `${formatQuantity(official_input.official_annual_quantity_ton)} ${official_input.quantity_unit}`,
      testId: "fc-official-quantity",
    },
    {
      label: "시나리오 처리량",
      value: `${formatQuantity(capacity.annual_service_quantity_ton)} 톤/년`,
      testId: "fc-scenario-quantity",
    },
    {
      label: "필요한 시설 규모",
      value: `${formatQuantity(capacity.facility_capacity_ton_per_day)} ${capacity.capacity_unit}`,
      testId: "fc-exact-capacity",
    },
    {
      label: standard_cost.term_ko,
      value: formatBn(standard_cost.standard_construction_cost_bn),
      testId: "fc-exact-standard-cost",
    },
    {
      label: annualization.term_ko,
      value: `${formatQuantity(annualization.annualized_construction_cost_bn)} ${annualization.unit}`,
      testId: "fc-exact-annualized",
    },
    {
      label: "명목 국고보조 추정액",
      value: formatBn(subsidy.estimated_national_subsidy_bn),
      testId: "fc-exact-subsidy",
    },
    {
      label: "단순 지방비 추정액",
      value: formatBn(subsidy.simplified_local_government_share_bn),
      testId: "fc-exact-local-share",
    },
  ];

  return (
    <div className="text-xs text-ink-muted">
      <p className="text-xs text-ink-subtle">
        위쪽 카드의 값은 읽기 쉽도록 반올림한 표시용 근삿값입니다. 아래는 서버가 계산한 값 그대로입니다.
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.testId}>
            <dt className="inline font-medium text-ink">{row.label}: </dt>
            <dd className="inline tabular-nums" data-testid={row.testId}>
              {row.value}
            </dd>
          </div>
        ))}
        <div>
          <dt className="inline font-medium text-ink">{per_capita.term_ko}: </dt>
          {per_capita.per_capita_local_share_won !== null ? (
            <dd className="inline tabular-nums" data-testid="fc-exact-per-capita">
              {formatWon(per_capita.per_capita_local_share_won)}
            </dd>
          ) : (
            // Unavailable stays unavailable here too — never a fabricated 0원. It is
            // a neutral missing state, not a caution about a value that exists.
            <dd className="inline" data-testid="fc-exact-per-capita-unavailable">
              <DataStatusBadge
                status="missing"
                label="계산 불가"
                reason={perCapitaUnavailableExplanation(per_capita.unavailable_reason)}
              />{" "}
              {perCapitaUnavailableExplanation(per_capita.unavailable_reason)}
            </dd>
          )}
        </div>
      </dl>

      {/* The SERVED per-capita caveat. It used to sit under the figures in card ③;
          the Figma technical note (221:3443) asks for every 문구 in ③ except the
          footnote to go, so it moved to the per-capita's home in the detail surface
          rather than being deleted. It is still the backend's own string, rendered
          verbatim — both the derivation ("동일 연도의 공식 인구로 나눈 환산값") and
          the non-claim ("개인의 실제 세금 청구액이 아닙니다") — and the non-claim is
          additionally listed in 이 계산의 범위 (`NON_CLAIM_NOTICES`). */}
      <p className="mt-2 text-xs text-ink-subtle" data-testid="facility-cost-per-capita-caveat">
        <span className="font-medium text-ink">{per_capita.term_ko}: </span>
        {per_capita.caveat}
      </p>

      <details className="mt-3" data-diagnostic="true" data-testid="facility-cost-diagnostics">
        <summary className="cursor-pointer text-xs text-ink-subtle">기술 정보 자세히 보기</summary>
        <ul className="mt-1 flex flex-col gap-0.5 break-words text-xs text-ink-subtle">
          <li>계산 방식 버전: {result.provenance.derivation_version}</li>
          <li>공사비 버전: {result.provenance.cost_version}</li>
          <li>연간 환산 방식: {annualization.method}</li>
          <li>집계 기준 코드: {official_input.accounting_basis}</li>
          <li>기준 연도: {official_input.reference_year}</li>
          <li>
            포함된 항목 코드: {result.completeness.included_components.join(", ") || "—"}
          </li>
          {per_capita.unavailable_reason && (
            <li>1인당 지방비 미제공 사유 코드: {per_capita.unavailable_reason}</li>
          )}
        </ul>
      </details>
    </div>
  );
}
