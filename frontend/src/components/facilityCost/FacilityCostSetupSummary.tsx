"use client";

/**
 * 현재 설정 — the compact setup summary that carries the primary action.
 *
 * Sticky at `lg`+ so the action stays on screen; a plain block below that, where
 * the columns stack. Sticky is safe here specifically because the cost branch is
 * map-free: it mounts no `.map-pane`, so nothing depends on this subtree's height
 * (frontend/RESPONSIVE_LAYOUT.md "Sticky positioning").
 *
 * WHAT THE REFRESH CHANGED
 *   - A 준비 상태 checklist was added. It reports EXISTING state only — how many
 *     regions are selected, whether official waste data exists for the chosen
 *     stream, whether the facility types loaded, whether the numeric inputs are in
 *     range, and whether a previous result will be replaced. It introduces no
 *     validation rule, and it never enables an action the existing logic disables.
 *   - The rows are laid out label-left / value-right so the card stays compact.
 *
 * WHY THE ANALYTICAL ASSUMPTIONS ARE NOT LISTED HERE. They were, in a first pass,
 * and it pushed the calculate button off the first viewport at 1280×800 — which
 * `e2e/facilityCost.spec.ts` measures directly, and which is the whole point of a
 * sticky action rail. They are listed in setup step 3 instead, beside the controls
 * that set them, which is also where they belong. The 기본값 / 기본값에서 변경됨 row
 * stays here, unchanged, as the statement that they still hold.
 *
 * The button, its disabled logic, its test id, and the polite `role="status"` line
 * beneath it are unchanged. `role="alert"` is not used here: an unmet prerequisite
 * is a state of the form, not an error event (the out-of-range numeric message
 * keeps its own alert beside the field it refers to).
 *
 * Deliberately a `<section>`, not an `<aside>`: in this codebase `<aside>` marks the
 * equity map sidebar specifically (e2e/desktopNavigation.spec.ts asserts the
 * map-free pages have none, and terminology.audit.test.tsx queries for it), so a
 * second one here would blur a landmark other checks rely on. `SectionCard`
 * renders a `<section>`.
 */

import { useMemo } from "react";

import type { FacilityCostOptions } from "../../lib/api";
import { regionDisplayName } from "../../lib/regionDisplay";
import SectionCard from "../ui/SectionCard";
import {
  advancedChanged,
  summariseRegions,
  wasteStreamLabel,
  type AdvancedDefaults,
  type ScenarioState,
} from "./shared";

export interface FacilityCostSetupSummaryProps {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  onCalculate: () => void;
  calculating: boolean;
  disabled: boolean;
  blockedReason: string;
  validationMessage: string | null;
  /** Whether a previous result is being held, so recalculating would replace it. */
  hasPreviousResult: boolean;
}

/** One row of the readiness checklist: state in words, never a colour alone. */
function ReadinessRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex gap-1.5 text-xs">
      <span className={`flex-none font-semibold ${ok ? "text-primary" : "text-warn"}`}>
        {ok ? "✓" : "!"}
      </span>
      <span className="min-w-0 text-ink-muted">
        <span className="font-medium text-ink">{label}</span> · {detail}
      </span>
    </li>
  );
}

function SummaryRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex-none text-xs text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function FacilityCostSetupSummary({
  options,
  scenario,
  advancedDefaults,
  regionOptions,
  onCalculate,
  calculating,
  disabled,
  blockedReason,
  validationMessage,
  hasPreviousResult,
}: FacilityCostSetupSummaryProps) {
  const selectedLabels = useMemo(() => {
    const byCode = new Map(regionOptions.map((r) => [r.code, r]));
    return scenario.regionCodes
      .map((code) => {
        const region = byCode.get(code);
        return region ? regionDisplayName(region.code, region.name) : null;
      })
      .filter((label): label is string => label !== null);
  }, [regionOptions, scenario.regionCodes]);

  const facilityLabel =
    options.facility_types.find((f) => f.value === scenario.facilityType)?.label ?? "선택 안 함";
  const changed = advancedChanged(scenario, advancedDefaults);

  return (
    <SectionCard
      title="현재 설정"
      className="lg:sticky lg:top-6 lg:self-start"
      testId="facility-cost-setup-summary"
    >
      <dl className="flex flex-col gap-1.5">
        <SummaryRow
          label="선택 지역"
          value={`${scenario.regionCodes.length}개 · ${summariseRegions(selectedLabels)}`}
          testId="facility-cost-summary-regions"
        />
        <SummaryRow label="폐기물" value={wasteStreamLabel(scenario.wasteStream)} />
        <SummaryRow
          label="처리 비율"
          value={
            scenario.processingSharePercent === ""
              ? "미입력"
              : `${scenario.processingSharePercent}%`
          }
        />
        <SummaryRow label="시설 종류" value={facilityLabel} />
        {/* The analytical assumptions themselves are listed in step 3, beside the
            controls that set them; this row states whether any of them has moved
            off the API-served default. */}
        <SummaryRow
          label="계산 가정"
          value={changed ? "기본값에서 변경됨" : "기본값"}
          testId="facility-cost-summary-advanced"
        />
      </dl>

      {/* Readiness: existing state only, stated in words. */}
      <div className="mt-3 border-t border-hairline pt-3">
        <p className="text-xs font-semibold text-ink">계산 준비 상태</p>
        <ul className="mt-1 flex flex-col gap-1" data-testid="facility-cost-readiness">
          <ReadinessRow
            ok={scenario.regionCodes.length > 0}
            label="처리할 지역"
            detail={
              scenario.regionCodes.length > 0
                ? `${scenario.regionCodes.length}개 선택됨`
                : "한 곳 이상 선택하세요"
            }
          />
          <ReadinessRow
            ok={regionOptions.length > 0}
            label="공식 폐기물 자료"
            detail={
              regionOptions.length > 0
                ? `계산 가능한 지역 ${regionOptions.length}곳`
                : "이 폐기물 종류로 계산 가능한 지역이 없습니다"
            }
          />
          <ReadinessRow
            ok={options.facility_types.length > 0}
            label="시설 종류"
            detail={options.facility_types.length > 0 ? "불러옴" : "불러오지 못했습니다"}
          />
          <ReadinessRow
            ok={validationMessage === null}
            label="입력값 범위"
            detail={validationMessage ?? "허용 범위 안"}
          />
        </ul>
        {hasPreviousResult && (
          <p className="mt-2 text-xs text-ink-subtle" data-testid="facility-cost-replace-notice">
            다시 계산하면 이전 결과가 새 결과로 바뀝니다.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onCalculate}
        disabled={disabled}
        className="wep-btn-primary mt-4 w-full"
        data-testid="facility-cost-calculate"
      >
        {calculating ? "계산 중…" : "비용 계산하기"}
      </button>

      {/* Polite guidance for the ordinary "not ready yet" states. An out-of-range
          advanced input is ALSO surfaced here, so a collapsed accordion can never
          be the only place an active validation error is stated. */}
      <p
        className="mt-2 text-xs text-ink-muted"
        role="status"
        data-testid="facility-cost-calculate-status"
      >
        {validationMessage ?? blockedReason}
      </p>
    </SectionCard>
  );
}
