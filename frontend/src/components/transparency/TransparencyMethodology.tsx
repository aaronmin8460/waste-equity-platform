"use client";

/**
 * 계산 방법과 기술 정보 — the interpretation limits, the reading guide for this
 * screen's own labels, and the raw version identifiers.
 *
 * The identifiers (`suitability-policy-v2`, `suitability-screening-v3`,
 * `capital-grid-500m-v1`, `capex-standard-v2022dec`) live HERE, behind a disclosure
 * and marked `[data-diagnostic]`, instead of on the primary surface — they are on
 * `FORBIDDEN_PRIMARY_TOKENS`. They are demoted, never deleted: a reader who needs to
 * reproduce a result must still be able to read exactly which analysis version
 * produced it.
 *
 * The 표시 용어 안내 disclosure is new. It states what this screen's own labels mean —
 * 직접 보고값 versus 계산값, an absent reference period versus a failed lookup, what a
 * collection time is and is not — because a reader who has just met 기준 기간 정보 없음
 * on a card should not have to infer whether it means zero.
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
      <Accordion label="이 자료로 말할 수 있는 것과 없는 것" testId="transparency-limits">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
          <li>
            후보지 분석은 공공자료를 이용한 1차 비교이며, 실제 입지 결정·허가·법적 적격성을 의미하지
            않습니다.
          </li>
          <li>
            비용은 표준공사비 기준의 참고용 설치비 계산이며, 실제 총사업비나 확정 사업비가 아닙니다.
          </li>
          <li>
            1인당 값은 공식 자료로 계산한 비교용 값이며, 개인이 실제로 내는 금액이 아닙니다.
          </li>
          <li>
            매립지 반입 자료는 광역지자체 단위이며, 시·군·구별 이동 경로나 실제 운송 경로를 의미하지
            않습니다.
          </li>
          <li>
            자료마다 기준 기간과 집계 기준이 다르므로, 서로 다른 기준의 값을 하나로 합치지 않습니다.
          </li>
          <li>
            이 목록은 이 서비스가 현재 연계한 자료이며, 같은 주제의 공공자료를 모두 담고 있다는 뜻은
            아닙니다. 원문의 현재 제공 여부는 각 기관 안내 페이지에서 확인해야 합니다.
          </li>
        </ul>
      </Accordion>

      <Accordion label="표시 용어 안내 (상태 표시의 뜻)" testId="transparency-status-guide">
        <dl className="flex flex-col gap-2 text-sm text-ink-muted">
          <div>
            <dt className="font-medium text-ink">직접 보고값</dt>
            <dd>출처 기관이 그 값을 그대로 보고한 경우입니다.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">공식 자료 기반 계산값</dt>
            <dd>
              이 서비스가 공식 자료 두 가지 이상을 이용해 계산한 값이며, 기관이 발표한 공식 통계가
              아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">기준 기간 정보 없음</dt>
            <dd>
              그 출처의 기준 기간을 함께 받지 못했다는 뜻입니다. 자료가 없다는 뜻도, 값이 0이라는
              뜻도 아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">기준 기간을 불러오지 못했습니다</dt>
            <dd>
              기준 기간을 확인하는 요청 자체가 실패한 경우입니다. 기준 기간이 없는 것과는 다른
              상태입니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">수집 시점</dt>
            <dd>
              이 서비스가 그 자료를 마지막으로 성공적으로 받아온 시각(세계표준시)입니다. 그 자료가
              현재 시점의 값이라는 뜻은 아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">사용 안 함</dt>
            <dd>목록에는 등록되어 있으나 현재 이 서비스가 사용하지 않는 출처입니다.</dd>
          </div>
        </dl>
      </Accordion>

      <Accordion label="가중치 바꿔보기 결과의 저장 여부" testId="transparency-scenario">
        <p className="text-sm text-ink-muted">
          &lsquo;가중치 바꿔보기&rsquo;에서 만든 결과는 화면에서만 계산하는 임시 결과이며 저장되지
          않습니다. 공식 분석 실행이나 저장된 점수를 바꾸지 않습니다.
        </p>
      </Accordion>

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
        <p className="mt-2 text-xs text-ink-subtle">
          점수 반영 기준(가중치)은 여러 가지를 제공하며, &lsquo;데이터 분포 기준&rsquo;은 값의 차이와
          중복 정도로 자동 계산됩니다. 안정성은 기본·균등·데이터 분포 기준의 상위 10% 포함 여부로
          판단하며, 최종 입지·허가·법적 적격성을 의미하지 않습니다.
        </p>
      </Accordion>
    </div>
  );
}
