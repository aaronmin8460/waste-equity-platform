"use client";

/**
 * One municipality's expandable detail — the progressive-disclosure layer.
 *
 * The default comparison view carries only the five fields a reader compares on
 * (지자체 / 1인당 지급액 / 총 지급액 / 상태 / 데이터 참고). Everything technical lives
 * here, behind a native `<details>` so the expanded state, the keyboard operation,
 * and the AT announcement are the browser's rather than ours.
 *
 * Shared by the desktop table and the mobile card list so the two can never drift
 * apart in what they disclose.
 *
 * Two data-integrity rules it carries:
 *
 *   - A DERIVED population is labelled as one, with its constituent 일반구 listed.
 *     The seven Gyeonggi cities' denominators are computed ward sums, not figures
 *     any source reported at city level, and the UI must say so wherever it shows
 *     the population (Step 2 report §9 rule 5).
 *   - Reason codes are shown as the backend's plain-Korean SENTENCE; the raw code
 *     is kept only in a `[data-diagnostic]` line so it stays recoverable from the
 *     page without becoming citizen-facing text.
 */

import type { MunicipalCostRow } from "../../lib/api";
import {
  formatPopulation,
  hasDerivedPopulation,
  populationMethodCode,
  populationMethodLabel,
  reasonEntries,
} from "../../lib/municipalCost";

export interface MunicipalCostRowDetailProps {
  row: MunicipalCostRow;
}

export default function MunicipalCostRowDetail({ row }: MunicipalCostRowDetailProps) {
  const reasons = reasonEntries(row);
  const derived = hasDerivedPopulation(row);
  const coverage = row.quantity_coverage;
  return (
    <details className="wep-accordion" data-testid="municipal-cost-detail">
      <summary data-testid="municipal-cost-detail-summary">
        <span>{row.display_name} 산출 근거와 출처</span>
        <span aria-hidden className="wep-accordion-chevron text-xs text-ink-subtle">
          ▾
        </span>
      </summary>
      <div className="wep-accordion-body text-xs text-ink-muted">
        <dl className="space-y-1 break-words">
          <div>
            <dt className="inline font-medium">인구(분모): </dt>
            <dd className="inline" data-testid="municipal-cost-detail-population">
              {formatPopulation(row.population) ?? "자료 없음"}
              {" · "}
              <span
                className={derived ? "font-medium text-ink" : undefined}
                data-testid={derived ? "municipal-cost-derived-population" : undefined}
              >
                {populationMethodLabel(row.population_method)}
              </span>
            </dd>
          </div>
          {/* The computed ward sum, itemised. Without this the reader has a
              city-level number and no way to see it was assembled. */}
          {derived && row.population_components.length > 0 && (
            <div>
              <dt className="inline font-medium">구성 일반구: </dt>
              <dd className="inline" data-testid="municipal-cost-population-components">
                {row.population_components
                  .map(
                    (component) =>
                      `${component.region_name} ${component.population.toLocaleString("en-US")}명`,
                  )
                  .join(" + ")}
              </dd>
            </div>
          )}
          {row.population_definition && (
            <div>
              <dt className="inline font-medium">인구 정의: </dt>
              <dd className="inline" data-diagnostic>
                {row.population_definition}
              </dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">계산에 포함된 계약: </dt>
            <dd className="inline tabular-nums" data-testid="municipal-cost-contract-count">
              {row.eligible_contract_count}건
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">행정구역 기준 연도: </dt>
            <dd className="inline">{row.boundary_vintage}년</dd>
          </div>
          <div>
            <dt className="inline font-medium">근거 표기: </dt>
            <dd className="inline" data-diagnostic data-testid="municipal-cost-evidence-status">
              {row.evidence_status}
            </dd>
          </div>
          {populationMethodCode(row.population_method) && (
            <div>
              <dt className="inline font-medium">인구 산출 코드: </dt>
              <dd className="inline" data-diagnostic>
                {populationMethodCode(row.population_method)}
              </dd>
            </div>
          )}
        </dl>

        {reasons.length > 0 && (
          <>
            <p className="mt-2 font-medium text-ink">자료 한계</p>
            <ul className="mt-1 list-disc space-y-1 pl-4" data-testid="municipal-cost-limitations">
              {reasons.map((reason) => (
                <li key={reason.code}>
                  {/* The served sentence is the explanation. A code with no served
                      sentence keeps the code and gets no invented text. */}
                  {reason.text ?? "이 항목에 대한 설명이 제공되지 않았습니다."}
                  <span className="ml-1 text-ink-subtle" data-diagnostic>
                    ({reason.code})
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-2 font-medium text-ink">원자료 파일</p>
        {row.source_files.length === 0 ? (
          <p className="mt-1" data-testid="municipal-cost-no-source-file">
            이 지자체의 2024년 원자료 파일이 없습니다.
          </p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-4" data-testid="municipal-cost-source-files">
            {row.source_files.map((file) => (
              <li key={`${file.dataset_role}-${file.sha256}`}>
                {file.filename}
                <span className="ml-1 text-ink-subtle" data-diagnostic>
                  ({file.dataset_role} · {file.layout_family} · {file.resolution_basis})
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Tonnage evidence is REPORTED, never an input to the payment indicator —
            a municipality is not downgraded for missing quantity data. Stated here
            so the reader can see the difference rather than infer it. */}
        {coverage.observation_count > 0 && (
          <p className="mt-2" data-testid="municipal-cost-quantity-coverage">
            반출량 관측 {coverage.observation_count}건 (측정 {coverage.measured_count}건 · 미기재{" "}
            {coverage.missing_count}건) · 포함 월 {coverage.months_covered}개월. 반출량은 지급액
            지표의 계산에 사용하지 않습니다.
          </p>
        )}
      </div>
    </details>
  );
}
