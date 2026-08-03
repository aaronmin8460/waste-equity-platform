"use client";

/**
 * 후보 상태 요약 — how many candidate cells fall into each screening status, which
 * of them the map is currently drawing, and what each status means.
 *
 * Split out of the former `SuitabilityPanel`. Every number is read verbatim from
 * the served `SuitabilitySummary`; nothing is summed, inferred, or defaulted here.
 * A count that was not served renders 자료 없음, never a fabricated `0` (repo
 * AGENTS.md) — which is why each row goes through `countText` instead of `?? 0`.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 *   - Before: one dense `전체 N · 스크리닝 통과 N · …` sentence. Now: one row per
 *     status carrying the map's own swatch color, the plain status name, the count,
 *     and — new — whether that status is currently VISIBLE on the map. The counts,
 *     the labels, and the `candidate-counts` test id are unchanged, so the
 *     terminology audit still reads the same string.
 *   - The swatch colors are PASSED IN from the page's `CANDIDATE_*` constants (the
 *     same ones the MapLibre fill and `MapLegendOverlay` use). This component
 *     hard-codes no color, so the summary, the legend, and the map can never drift.
 *   - Status is never carried by color alone: every row states its name and its
 *     display state as text.
 *
 * The status VISIBILITY CONTROL is deliberately not duplicated here — it lives once,
 * in the floating legend, driving the page's one canonical `statusVisibility` state
 * (docs/ui-refresh/suitability-dashboard.md §4). This card reports that state and
 * says where to change it.
 */

import type { SuitabilityStatus, SuitabilitySummary, SuitabilityPolicy, SuitabilityRun } from "../../lib/api";
import type { StatusVisibility } from "../MapView";
import { statusExplanation, statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import SectionCard from "../ui/SectionCard";
import { STATUS_LABELS, STATUS_ORDER } from "./shared";

export interface SuitabilityStatusSummaryProps {
  summary: SuitabilitySummary;
  policy: SuitabilityPolicy;
  run: SuitabilityRun;
  /** The canonical page state the map filter reads — reported, never owned here. */
  statusVisibility: StatusVisibility;
  /** Whether the stable-only map restriction is active. */
  stableOnly: boolean;
  /** Whether the run carries stability results at all. */
  stabilityAvailable: boolean;
  /** Status swatch colors, from the page's candidate constants. */
  statusColors: Record<SuitabilityStatus, string>;
}

/** A served count as text, or the explicit no-data word — never a substituted 0. */
function countText(value: number | null | undefined): string {
  return value == null ? "자료 없음" : `${formatCount(value)}개`;
}

export default function SuitabilityStatusSummary({
  summary,
  policy,
  run,
  statusVisibility,
  stableOnly,
  stabilityAvailable,
  statusColors,
}: SuitabilityStatusSummaryProps) {
  const counts: Record<SuitabilityStatus, number | null> = {
    ELIGIBLE: summary.candidate_count_eligible,
    REVIEW_REQUIRED: summary.candidate_count_review,
    EXCLUDED: summary.candidate_count_excluded,
  };
  const hiddenStatuses = STATUS_ORDER.filter((status) => !statusVisibility[status]);

  return (
    <SectionCard
      title="후보 상태 요약"
      description={`분석 후보 구역 전체 ${countText(summary.candidate_count_total)}`}
      testId="suitability-summary"
    >
      <p className="mb-2 text-xs font-medium text-warn">
        이 결과는 공공자료를 이용한 1차 비교이며 실제 입지 결정이 아닙니다. &apos;통과&apos;는 법적
        적격을 의미하지 않습니다.
      </p>

      {/* One row per status: swatch (decorative) + plain name + served count +
          current map display state. The list itself carries `candidate-counts`,
          which the terminology audit and the Phase 0 tests scan — it still holds
          the three plain status names and no raw enum, now as visible rows rather
          than one dense sentence. */}
      <dl className="flex flex-col gap-1" data-testid="candidate-counts">
        <div
          className="flex items-center gap-2 px-2 text-xs text-ink-muted"
          data-testid="status-summary-total"
        >
          <dt className="min-w-0 flex-1">전체 후보 구역</dt>
          <dd className="flex-none font-semibold tabular-nums text-ink">
            {countText(summary.candidate_count_total)}
          </dd>
        </div>
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex items-center gap-2 rounded-card border border-hairline bg-surface-muted px-2 py-1.5"
            data-testid={`status-summary-row-${status}`}
          >
            <span
              aria-hidden
              className="inline-block h-3.5 w-5 flex-none rounded-sm border border-hairline-strong"
              style={{ backgroundColor: statusColors[status] }}
            />
            <dt className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
              {statusLabel(status)}
            </dt>
            <dd className="flex flex-none items-center gap-2 text-xs">
              <span className="font-semibold tabular-nums text-ink">{countText(counts[status])}</span>
              <span
                className={
                  statusVisibility[status]
                    ? "text-[11px] font-medium text-primary-hover"
                    : "text-[11px] text-ink-subtle"
                }
                data-testid={`status-display-state-${status}`}
              >
                {statusVisibility[status] ? "지도 표시 중" : "지도에서 숨김"}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[11px] text-ink-subtle" data-testid="status-visibility-note">
        {hiddenStatuses.length === 0
          ? "세 상태 모두 지도에 표시하고 있습니다."
          : `${hiddenStatuses.map((status) => STATUS_LABELS[status]).join(" · ")} 상태는 현재 지도에서 숨겨져 있습니다.`}{" "}
        {stabilityAvailable && stableOnly
          ? "또한 안정 후보만 보기가 켜져 있어 스크리닝 통과 후보 중 안정 후보만 표시합니다. "
          : ""}
        지도 표시 여부는 지도 왼쪽 아래 범례에서 바꿀 수 있으며, 표시 설정은 후보 수와 점수를 바꾸지
        않습니다.
      </p>

      {/* What each screening status means, from the shared glossary. A compact,
          keyboard-reachable <details> in the same place the counts appear; the
          labels themselves are already plain, so nothing required is hidden. */}
      <details className="mt-2" data-testid="status-explanations">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted">상태 설명 보기</summary>
        <dl className="mt-1 space-y-1 text-[11px] text-ink-muted">
          {STATUS_ORDER.map((status) => (
            <div key={status} data-testid={`status-explanation-${status}`}>
              <dt className="inline font-semibold">{statusLabel(status)}: </dt>
              <dd className="inline">{statusExplanation(status)}</dd>
            </div>
          ))}
        </dl>
      </details>

      {/* Technical run/version provenance behind a disclosure: the citizen reads the
          counts first, the analyst opens this. Unchanged content. */}
      <details className="mt-2" data-testid="suitability-run-context">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted">
          분석 정보 자세히 보기
        </summary>
        <dl className="mt-1 space-y-1 text-[11px] text-ink-subtle">
          <div>
            <dt className="inline font-medium">분석 실행: </dt>
            <dd className="inline">
              #{run.id} · 기준연도 {run.reference_year} · 경계 {run.boundary_vintage}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">버전: </dt>
            <dd className="inline">
              분석 규칙 {policy.policy_version} · 계산 방식 {policy.derivation_version} · 분석 구역{" "}
              {policy.candidate_grid_version}
            </dd>
          </div>
        </dl>
      </details>
    </SectionCard>
  );
}
