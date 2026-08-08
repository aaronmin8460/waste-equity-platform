"use client";

/**
 * 산출 방법과 한계 — the methodology layer for the municipal payment section.
 *
 * Everything a reader needs in order not to misread the indicator, in four
 * collapsed disclosures. All of it is SERVED prose, rendered verbatim: the geography
 * policy, the population policy, the numerator definition, the caveats, the source
 * coverage, and the two rejected workbooks with the reasons they were rejected. This
 * component states nothing the backend did not.
 *
 * The indicator code, the unit, the evidence class, and the methodology version are
 * shown as `[data-diagnostic]` lines — recoverable from the page without becoming
 * citizen-facing labels (redesign plan §5 rule 12).
 *
 * It contains NO live region: a collapsed `<details>` is hidden from the
 * accessibility tree, so nothing that must announce may live in here (redesign plan
 * §5 rule 9).
 */

import type { MunicipalCostMeta } from "../../lib/api";
import Accordion from "../ui/Accordion";
import SectionCard from "../ui/SectionCard";
import { MUNICIPAL_COST_PER_CAPITA_LABEL } from "./municipalCostShared";

export interface MunicipalCostMethodologyProps {
  meta: MunicipalCostMeta;
}

export default function MunicipalCostMethodology({ meta }: MunicipalCostMethodologyProps) {
  const coverage = meta.source_coverage;
  return (
    <SectionCard
      title="산출 방법과 한계"
      headingLevel={3}
      description="이 값이 무엇을 계산한 것인지, 무엇을 포함하지 않는지, 어떤 원자료에서 왔는지."
      testId="municipal-cost-methodology"
    >
      <div className="flex flex-col gap-2 text-xs text-ink-muted">
        <Accordion label="지표 정의" testId="municipal-cost-method-definition">
          <p data-testid="municipal-cost-indicator-description">{meta.description}</p>
          <dl className="mt-2 space-y-1 break-words">
            <div>
              <dt className="inline font-medium">지표 이름: </dt>
              <dd className="inline" data-testid="municipal-cost-indicator-name">
                {meta.display_name}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">단위: </dt>
              <dd className="inline" data-testid="municipal-cost-unit">
                {meta.unit}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">기준 연도: </dt>
              <dd className="inline">{meta.reference_year}년</dd>
            </div>
            <div>
              <dt className="inline font-medium">분자 정의: </dt>
              <dd className="inline" data-testid="municipal-cost-numerator">
                {meta.numerator_definition}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">지표 코드: </dt>
              <dd className="inline" data-diagnostic data-testid="municipal-cost-indicator-code">
                {meta.indicator_code}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">근거 표기: </dt>
              <dd className="inline" data-diagnostic data-testid="municipal-cost-evidence-class">
                LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">집계 기준: </dt>
              <dd className="inline" data-diagnostic>
                {meta.accounting_basis}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">계산 방식 버전: </dt>
              <dd className="inline" data-diagnostic data-testid="municipal-cost-method-version">
                {meta.methodology_version}
              </dd>
            </div>
          </dl>
          <p className="mt-2">
            {MUNICIPAL_COST_PER_CAPITA_LABEL}은 주민 개인이 실제로 납부한 금액이 아니라 분석을 위한
            환산값입니다.
          </p>
        </Accordion>

        <Accordion label="행정구역과 인구 기준" testId="municipal-cost-method-geography">
          <p data-testid="municipal-cost-geography-policy">{meta.geography_policy}</p>
          <p className="mt-2" data-testid="municipal-cost-population-policy">
            {meta.population_policy}
          </p>
        </Accordion>

        <Accordion label="원자료 범위" testId="municipal-cost-method-sources">
          <dl className="space-y-1">
            <div>
              <dt className="inline font-medium">확인한 파일: </dt>
              <dd className="inline tabular-nums" data-testid="municipal-cost-files-discovered">
                {coverage.discovered_file_count}개
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">사용한 파일: </dt>
              <dd className="inline tabular-nums" data-testid="municipal-cost-files-accepted">
                {coverage.accepted_file_count}개
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">사용하지 않은 파일: </dt>
              <dd className="inline tabular-nums" data-testid="municipal-cost-files-rejected">
                {coverage.rejected_file_count}개
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">원자료가 없는 지자체: </dt>
              <dd className="inline tabular-nums">
                {coverage.municipalities_with_no_source_file}곳
              </dd>
            </div>
          </dl>
          {meta.rejected_source_files.length > 0 && (
            <>
              <p className="mt-2 font-medium text-ink">사용하지 않은 파일과 그 이유</p>
              <ul
                className="mt-1 list-disc space-y-1 pl-4"
                data-testid="municipal-cost-rejected-files"
              >
                {meta.rejected_source_files.map((file) => (
                  <li key={file.filename}>
                    <span className="font-medium text-ink">{file.filename}</span>
                    {file.explanation && <span className="block">{file.explanation}</span>}
                    <span className="block text-ink-subtle" data-diagnostic>
                      ({file.reason_codes.join(", ")})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Accordion>

        <Accordion label="한계와 주의사항" testId="municipal-cost-method-caveats">
          <ul className="list-disc space-y-1 pl-4" data-testid="municipal-cost-caveats">
            {meta.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </Accordion>
      </div>
    </SectionCard>
  );
}
