"use client";

/**
 * 근거와 한계 — provenance, methodology, comparability, and limitations.
 *
 * Four collapsed disclosures, unchanged in content. Every source id, snapshot date,
 * reference period, definition version, derivation formula, accounting basis, and
 * served caveat still renders; raw enums stay, each beside its plain-Korean name,
 * inside a `[data-diagnostic]` line rather than as a citizen-facing label.
 *
 * The refresh gives the group a `SectionCard` so it reads as one addressable region
 * with a stated purpose instead of four loose `<details>` after the values. It
 * contains NO live region: a collapsed `<details>` is hidden from the accessibility
 * tree, so nothing that must announce may live in here
 * (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §5 rule 9).
 */

import type { LandfillSummary } from "../../lib/api";
import { accountingBasisLabel } from "../../lib/glossary";
import Accordion from "../ui/Accordion";
import SectionCard from "../ui/SectionCard";
import {
  EFFECTIVE_FEE_LABEL,
  LIMITATION_NOTICE,
  MOIS_SOURCE_ID,
  PER_CAPITA_LABEL,
} from "./shared";

export interface LandfillMethodologyProps {
  summary: LandfillSummary;
}

export default function LandfillMethodology({ summary }: LandfillMethodologyProps) {
  const perCapita = summary.fee_per_capita;
  return (
    <SectionCard
      title="근거와 한계"
      description="화면의 모든 값이 어느 자료의 어느 기간에서 왔는지, 무엇을 계산한 값인지, 무엇을 뜻하지 않는지."
      testId="landfill-evidence"
    >
      <div className="flex flex-col gap-2 text-xs text-ink-muted">
        <Accordion label="자료와 기준 기간" testId="landfill-evidence-sources">
          {/* break-words: the served identifiers (e.g. the definition version
              MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS) are long
              unbreakable ASCII tokens that would otherwise force the page to scroll
              sideways on a phone. */}
          <dl className="space-y-1 break-words">
            {summary.sources.map((source) => (
              <div key={source.dataset_id}>
                <dt className="inline font-medium">출처 {source.dataset_id}: </dt>
                <dd className="inline">
                  {source.official_dataset_name} · 스냅샷{" "}
                  <span data-testid="reference-period">{source.snapshot_date ?? "—"}</span>
                </dd>
              </div>
            ))}
            <div>
              <dt className="inline font-medium">수수료 기준 기간: </dt>
              <dd className="inline" data-testid="landfill-fee-period">
                {perCapita.fee_reference_period}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">인구 출처: </dt>
              <dd className="inline" data-testid="landfill-population-source">
                행정안전부 주민등록 인구통계 (행정동별 주민등록 인구 및 세대현황) ·{" "}
                {perCapita.population_source_id ?? MOIS_SOURCE_ID} · 기준 기간{" "}
                <span data-testid="landfill-population-period">
                  {perCapita.population_reference_period ?? "해당 기간 자료 없음"}
                </span>
                {perCapita.population_temporal_granularity && (
                  <> · {perCapita.population_temporal_granularity === "MONTHLY" ? "월간" : "연간"}</>
                )}
              </dd>
            </div>
            {perCapita.population_source_administrative_code && (
              <div>
                <dt className="inline font-medium">인구 행정구역 코드: </dt>
                <dd className="inline" data-testid="landfill-population-admin-code">
                  {perCapita.population_source_administrative_code}
                </dd>
              </div>
            )}
            <div>
              <dt className="inline font-medium">인구 정의: </dt>
              <dd className="inline">
                {perCapita.population_definition ?? "—"}
                {perCapita.population_definition_version && (
                  <> · {perCapita.population_definition_version}</>
                )}
              </dd>
            </div>
          </dl>
        </Accordion>

        <Accordion label="비교 가능성" testId="landfill-evidence-comparability">
          {/* The MOIS total-population definition changed twice inside the 2008–2026
              window, so a long-run comparison is not like-for-like. Disclosed with
              the data rather than only in the docs. */}
          <p data-testid="landfill-comparability-note">
            <strong className="text-ink">인구 정의 변경 안내:</strong> 주민등록 총인구의 정의는
            2010-10(거주불명자 포함)과 2015-01(재외국민 포함)에 변경되었습니다. 서로 다른 시기의 값을
            비교할 때는 정의 차이를 고려해야 하며, 완전히 동일한 기준의 시계열이 아닙니다. (외국인은
            모든 시기에서 제외됩니다.)
            {perCapita.population_comparability_note && (
              <span className="mt-1 block">{perCapita.population_comparability_note}</span>
            )}
          </p>
          <p className="mt-2">
            집계 기준:{" "}
            <span className="font-medium text-ink">
              {accountingBasisLabel(summary.accounting_basis)}
            </span>
            . 이 기준의 값은 발생지 기준·시설 소재지 기준 자료와 합치거나 비교할 수 없습니다.
          </p>
          <p className="mt-1" data-diagnostic data-testid="landfill-accounting-basis-code">
            기술 코드: {summary.accounting_basis}
          </p>
        </Accordion>

        <Accordion label="계산 방법" testId="landfill-evidence-method">
          <p className="font-medium text-ink">공식 보고값</p>
          <ul className="list-disc pl-4">
            <li>반입량</li>
            <li>반입수수료</li>
            <li>주민등록 인구 (행정안전부 · 월말 기준)</li>
          </ul>
          <p className="mt-2 font-medium text-ink">공식자료를 바탕으로 계산한 값</p>
          <ul className="list-disc pl-4">
            <li>월·연 집계 · 비중</li>
            <li>{EFFECTIVE_FEE_LABEL}</li>
            <li>{PER_CAPITA_LABEL}</li>
          </ul>
          <dl className="mt-2 space-y-1 break-words">
            <div>
              <dt className="inline font-medium">산출식: </dt>
              <dd className="inline">{perCapita.derivation_formula}</dd>
            </div>
            <div>
              <dt className="inline font-medium">계산 방식 버전: </dt>
              <dd className="inline" data-diagnostic data-testid="landfill-derivation-version">
                {perCapita.derivation_version}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">반입 지표 계산 방식 버전: </dt>
              <dd className="inline" data-diagnostic>
                {summary.derivation_version}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">근거 표기: </dt>
              <dd className="inline" data-diagnostic>
                공식 보고값 {summary.evidence.quantity_status} · 계산값{" "}
                {summary.evidence.derived_status}
              </dd>
            </div>
          </dl>
        </Accordion>

        <Accordion label="한계와 주의사항" testId="landfill-limitation-details">
          <p>{LIMITATION_NOTICE}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4" data-testid="landfill-caveats">
            {summary.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </Accordion>
      </div>
    </SectionCard>
  );
}
