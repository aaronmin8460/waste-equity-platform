"use client";

/**
 * 기술 정보 — the raw version identifiers behind this screen's figures.
 *
 * The identifiers (`suitability-policy-v2`, `suitability-screening-v3`,
 * `capital-grid-500m-v1`, `capex-standard-v2022dec`) live HERE, behind a disclosure
 * and marked `[data-diagnostic]`, instead of on the primary surface — they are on
 * `FORBIDDEN_PRIMARY_TOKENS`. They are demoted, never deleted: a reader who needs to
 * reproduce a result must still be able to read exactly which analysis version
 * produced it.
 *
 * ── WHAT MOVED OUT, AND WHERE IT WENT ──────────────────────────────────────────
 * This component used to carry three more disclosures, and all three stated rules
 * that apply to every screen rather than to this one:
 *
 *   - 이 자료로 말할 수 있는 것과 없는 것 → `TransparencyDefinitions`
 *     (`transparency-def-analysis`). Its bullets were the global interpretation
 *     limits — screening is not a siting decision, a cost figure is not a total
 *     project cost, a per-capita value is not a personal bill — each of which was
 *     also written out somewhere else on this same screen.
 *   - 표시 용어 안내 → `TransparencyDefinitions`, unchanged and still a `<details>`.
 *   - 가중치 바꿔보기 결과의 저장 여부 → `ANALYSIS_DEFINITIONS`, which keeps its
 *     `transparency-scenario` test id and now also states the part that was only
 *     implied: changing a weight never changes a screening verdict.
 *
 * Nothing was deleted in the move. What is left here is the one thing that really is
 * specific to this block: which analysis run and which rule versions produced the
 * numbers, and the note describing how the weight presets themselves are formed.
 */

import type { FacilityCostOptions, SuitabilityPolicy, SuitabilityRun } from "../../lib/api";
import { formatCount } from "../../lib/metrics";
import Accordion from "../ui/Accordion";

export interface TransparencyMethodologyProps {
  policy: SuitabilityPolicy | null;
  run: SuitabilityRun | null;
  costOptions: FacilityCostOptions | null;
}

export default function TransparencyMethodology({
  policy,
  run,
  costOptions,
}: TransparencyMethodologyProps) {
  return (
    <div className="flex flex-col gap-3">
      <Accordion label="기술 정보 (분석 버전과 식별자)" testId="transparency-technical">
        {run && policy ? (
          <dl
            className="grid grid-cols-1 gap-2 text-sm text-ink-muted sm:grid-cols-2"
            data-testid="transparency-suitability"
          >
            <div>
              <dt className="inline font-medium text-ink">분석 실행: </dt>
              <dd className="inline tabular-nums">
                #{run.id} · 기준연도 {run.reference_year}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink">후보 구역 수: </dt>
              <dd className="inline tabular-nums">{formatCount(run.candidate_count_total)}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink">분석 규칙 버전: </dt>
              {/* `break-all` so a long identifier wraps inside its cell instead of
                  widening the page (no horizontal overflow at any width). */}
              <dd className="inline break-all" data-diagnostic>
                {policy.policy_version}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink">계산 방식 버전: </dt>
              <dd className="inline break-all" data-diagnostic>
                {policy.derivation_version}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink">분석 구역 버전: </dt>
              <dd className="inline break-all" data-diagnostic>
                {policy.candidate_grid_version}
              </dd>
            </div>
            {costOptions && (
              <div>
                <dt className="inline font-medium text-ink">표준공사비 기준 자료: </dt>
                <dd
                  className="inline break-all"
                  data-diagnostic
                  data-testid="transparency-cost-version"
                >
                  {costOptions.active_cost_version}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-ink-muted" data-testid="transparency-suitability">
            아직 표시할 후보지 분석 결과가 없습니다.
          </p>
        )}
        {/* How the served presets are formed — specific to the run above, so it
            stays here. The clause that used to close this sentence ("최종 입지·허가
            ·법적 적격성을 의미하지 않습니다") was the fourth copy of that rule on this
            screen and now lives once, in 공통 해석 기준. */}
        <p className="mt-2 text-xs text-ink-subtle">
          점수 반영 기준(가중치)은 여러 가지를 제공하며, &lsquo;데이터 분포 기준&rsquo;은 값의 차이와
          중복 정도로 자동 계산됩니다. 안정성은 기본·균등·데이터 분포 기준의 상위 10% 포함 여부로
          판단합니다.
        </p>
      </Accordion>
    </div>
  );
}
