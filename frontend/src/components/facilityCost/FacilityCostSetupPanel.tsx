"use client";

/**
 * 계산 설정 — the three setup steps, in workflow order.
 *
 *   1. 처리할 지역   the service regions the calculation is run for
 *   2. 처리 조건     waste stream · processing share · facility type
 *   3. 계산 가정     the analytical assumptions (collapsed 고급 설정)
 *
 * PRESENTATIONAL AND CONTROLLED. It owns no scenario state, issues no request, and
 * performs no validation of its own: `scenario`, `update`, and `validationMessage`
 * all come from `FacilityCostDashboard`, which remains the single owner (there is
 * no second form representation anywhere in this folder).
 *
 * WHAT THE REFRESH CHANGED, AND WHAT DID NOT
 *   - Before there were two numbered steps and one unnumbered 고급 설정 accordion
 *     floating below them, so the analytical assumptions read as an optional
 *     appendix rather than a stage of the calculation. They are now step 3, inside
 *     a titled card that states what those values are for. The accordion itself,
 *     its test id, its collapsed-by-default behaviour, and every control inside it
 *     are unchanged.
 *   - Each input keeps its exact label, unit, help text, default, constraint,
 *     validation behaviour, test id, and payload mapping. No field was added,
 *     removed, renamed, re-seeded, or re-bounded.
 *   - The subsidy-rate source stays immediately beside the subsidy selector, as
 *     docs/FACILITY_COST_LENS_UI.md requires — it moves with the control.
 */

import type { RefObject } from "react";

import type { FacilityCostOptions, RegionBoundaryCollection } from "../../lib/api";
import Accordion from "../ui/Accordion";
import EmptyState from "../ui/EmptyState";
import SearchableRegionPicker from "../ui/SearchableRegionPicker";
import FacilityCostRegionMap from "./FacilityCostRegionMap";
import SectionCard from "../ui/SectionCard";
import {
  captionClass,
  fieldClass,
  labelClass,
  SUBSIDY_RATE_FORM_NOTE,
  SUBSIDY_RATE_SOURCE_NOTE,
  WASTE_STREAMS,
  type ScenarioState,
} from "./shared";

/**
 * Facility type as selection cards instead of a dropdown.
 *
 * Native `<input type="radio">` inside a `<fieldset>`/`<legend>`, one per option
 * SERVED BY THE API — the count is never assumed, so a third facility type would
 * lay out correctly with no code change. The visible text is exactly the served
 * label: no capacity, cost, approval, or engineering description is invented here,
 * because the options endpoint does not provide one.
 *
 * Selection is signalled by the native radio dot, a border change, AND a heavier
 * font weight — three signals, so it never depends on color alone.
 */
function FacilityTypeCards({
  facilityTypes,
  value,
  onChange,
}: {
  facilityTypes: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (facilityTypes.length === 0) {
    return (
      <EmptyState
        title="시설 종류를 불러오지 못했습니다."
        description="서버가 시설 종류를 제공하지 않아 계산할 수 없습니다."
        testId="facility-cost-facility-type-empty"
      />
    );
  }
  return (
    <fieldset data-testid="facility-cost-facility-type">
      <legend className="text-sm font-medium text-ink">시설 종류</legend>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {facilityTypes.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              data-testid="facility-cost-facility-type-card"
              data-selected={selected || undefined}
              className={`flex cursor-pointer items-start gap-2 rounded-card border p-3 text-sm ${
                selected
                  ? "border-primary bg-primary-soft font-semibold text-ink"
                  : "border-hairline bg-surface text-ink-muted"
              }`}
            >
              <input
                type="radio"
                name="facility-cost-facility-type"
                className="mt-0.5"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface FacilityCostSetupPanelProps {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  regionOptions: { code: string; name: string }[];
  /**
   * Geometry for the administrative-region selection map, in the SAME code space
   * as `regionOptions`. Optional: without it the picker alone is shown, which is
   * the accessible path anyway, so a missing boundary payload degrades to "no
   * map" rather than to a broken screen.
   */
  regionBoundaries?: RegionBoundaryCollection | null;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  validationMessage: string | null;
  /** Focus target used when returning from the results view. */
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export default function FacilityCostSetupPanel({
  options,
  scenario,
  regionOptions,
  regionBoundaries,
  update,
  validationMessage,
  headingRef,
}: FacilityCostSetupPanelProps) {
  const subsidyLabel =
    options.subsidy_schemes.find((s) => s.value === scenario.subsidyScheme)?.label ??
    scenario.subsidyScheme;

  return (
    <div className="flex flex-col gap-3">
      <SectionCard
        title="1. 처리할 지역"
        headingId="fc-step-regions"
        headingRef={headingRef}
        description="공식 폐기물 자료가 있는 지역만 선택할 수 있습니다. 선택한 지역의 공식 발생량이 계산의 출발점입니다."
      >
        {regionOptions.length === 0 ? (
          <EmptyState
            title="이 폐기물 종류로 계산 가능한 지역이 없습니다."
            description="공식 폐기물 자료가 있는 지역이 없어 계산할 수 없습니다. 폐기물 종류를 바꿔 보세요."
            testId="facility-cost-regions-empty"
          />
        ) : (
          <>
            <SearchableRegionPicker
              label="지역 이름 검색"
              hint="이름을 입력하거나 아래 버튼으로 광역시·도 전체를 선택할 수 있습니다."
              regions={regionOptions}
              selectedCodes={scenario.regionCodes}
              onChange={(codes) => update("regionCodes", codes)}
            />
            {regionBoundaries && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-ink-subtle" data-testid="facility-cost-map-note">
                  지도에서 행정구역을 눌러 처리 대상 지역을 고를 수도 있습니다. 이 지도는 처리 대상
                  행정구역을 고르는 용도이며, 지역별 공사비나 땅값을 나타내지 않습니다.
                </p>
                <FacilityCostRegionMap
                  boundaries={regionBoundaries}
                  selectedCodes={scenario.regionCodes}
                  selectableCodes={regionOptions.map((region) => region.code)}
                  onToggleRegion={(code) =>
                    update(
                      "regionCodes",
                      scenario.regionCodes.includes(code)
                        ? scenario.regionCodes.filter((c) => c !== code)
                        : [...scenario.regionCodes, code],
                    )
                  }
                />
              </div>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="2. 처리 조건"
        description="어떤 폐기물을, 얼마나, 어떤 시설에서 처리한다고 볼지 정합니다."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            폐기물 종류
            <select
              className={fieldClass}
              data-testid="facility-cost-waste-stream"
              value={scenario.wasteStream}
              onChange={(e) => update("wasteStream", e.target.value)}
            >
              {WASTE_STREAMS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className={captionClass}>
              종류를 바꾸면 계산 가능한 지역이 달라져 선택한 지역이 초기화됩니다.
            </span>
          </label>

          <label className={labelClass}>
            지역 처리 비율 (%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className={fieldClass}
              data-testid="facility-cost-processing-share"
              value={scenario.processingSharePercent}
              onChange={(e) => update("processingSharePercent", e.target.value)}
            />
            <span className={captionClass}>
              선택한 지역의 발생량 중 이 시설에서 처리할 비율입니다. 0–100 사이의 값만 계산할 수 있습니다.
            </span>
          </label>
        </div>

        <div className="mt-4">
          <FacilityTypeCards
            facilityTypes={options.facility_types}
            value={scenario.facilityType}
            onChange={(value) => update("facilityType", value)}
          />
        </div>
      </SectionCard>

      {/* Step 3 states the assumptions in the open, then keeps the controls that
          change them in the collapsed accordion they have always been in. The
          accordion opens automatically when a value inside is out of range, so an
          invalid input is never hidden — and the setup summary repeats the reason
          next to the calculate button.

          The values are listed HERE, beside the controls that set them, rather than
          in the right rail: the rail has to stay short enough that the primary
          action is on screen without scrolling (e2e/facilityCost.spec.ts measures
          exactly that), and an assumption belongs next to its own control. */}
      <SectionCard
        title="3. 계산 가정"
        description="아래 값을 가정하고 계산합니다. 필요하면 고급 설정에서 바꿀 수 있습니다."
      >
        <dl
          className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2"
          data-testid="facility-cost-current-assumptions"
        >
          <div>
            <dt className="inline font-medium text-ink">연간 가동일수: </dt>
            <dd className="inline text-ink-muted">{scenario.operatingDays}일</dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">지하화 배수: </dt>
            <dd className="inline text-ink-muted">{scenario.undergroundMultiplier}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">보조 시나리오: </dt>
            <dd className="inline text-ink-muted">{subsidyLabel}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">공사비 기준: </dt>
            <dd className="inline text-ink-muted">{scenario.costVersion}</dd>
          </div>
        </dl>
        {/* The subsidy rate's provenance travels with the rate wherever it is
            shown, here as well as beside the selector inside the accordion. */}
        <p className="mt-2 text-xs text-ink-subtle">{SUBSIDY_RATE_SOURCE_NOTE}</p>

        <div className="mt-3">
          <Accordion
            label="고급 설정"
            defaultOpen={validationMessage !== null}
            testId="facility-cost-advanced-settings"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              연간 가동일수
              <input
                type="number"
                min={1}
                max={366}
                step={1}
                className={fieldClass}
                data-testid="facility-cost-operating-days"
                value={scenario.operatingDays}
                onChange={(e) => update("operatingDays", Number(e.target.value))}
              />
              <span className={captionClass}>
                시설이 1년에 며칠 가동한다고 볼지에 대한 분석용 가정입니다. 필요한 시설 규모(톤/일)
                계산에 사용됩니다. 1–366 사이의 값만 계산할 수 있습니다.
              </span>
            </label>

            <label className={labelClass}>
              지하화 배수 ({options.underground_multiplier.min}–
              {options.underground_multiplier.max})
              <input
                type="number"
                min={Number(options.underground_multiplier.min)}
                max={Number(options.underground_multiplier.max)}
                step={0.05}
                className={fieldClass}
                data-testid="facility-cost-underground"
                value={scenario.undergroundMultiplier}
                onChange={(e) => update("undergroundMultiplier", e.target.value)}
              />
              <span className={captionClass}>{options.underground_multiplier.note}</span>
            </label>

            <label className={labelClass}>
              보조 시나리오
              <select
                className={fieldClass}
                data-testid="facility-cost-subsidy-scheme"
                value={scenario.subsidyScheme}
                onChange={(e) => update("subsidyScheme", e.target.value)}
              >
                {options.subsidy_schemes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* The subsidy rate's source + reference period, kept immediately
                  beside its selector in every state (docs/FACILITY_COST_LENS_UI.md).
                  It moves with the control; it is never separated from it. */}
              <span className={captionClass} data-testid="facility-cost-subsidy-note">
                {SUBSIDY_RATE_FORM_NOTE}
              </span>
            </label>

            {options.cost_versions.length > 1 ? (
              <label className={labelClass}>
                공사비 버전
                <select
                  className={fieldClass}
                  data-testid="facility-cost-version"
                  value={scenario.costVersion}
                  onChange={(e) => update("costVersion", e.target.value)}
                >
                  {options.cost_versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              // Exactly one version exists, so the API exposes no choice. It is
              // shown read-only rather than as a one-option select that pretends
              // to be editable.
              <div className={labelClass}>
                공사비 버전
                <p className="mt-1 text-sm text-ink-muted" data-testid="facility-cost-version-fixed">
                  {scenario.costVersion}
                </p>
                <span className={captionClass}>현재 적용 중인 기준 한 가지만 제공됩니다.</span>
              </div>
            )}
          </div>

            {/* Validation stays inside the accordion beside the field it refers
                to, AND is summarised next to the calculate button, so a closed
                accordion never becomes the only home for an active error. */}
            {validationMessage && (
              <p
                className="mt-3 text-sm text-warn"
                role="alert"
                data-testid="facility-cost-validation"
              >
                {validationMessage}
              </p>
            )}
          </Accordion>
        </div>
      </SectionCard>
    </div>
  );
}
