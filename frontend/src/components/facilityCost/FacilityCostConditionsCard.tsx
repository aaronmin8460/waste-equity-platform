"use client";

/**
 * ② 계산 조건 — the second card of the Figma three-step workflow (129:5709, card ②).
 *
 * 폐기물 종류 · 처리 비율 · 시설 종류, then the analytical assumptions behind a
 * collapsed 고급 설정 whose summary states whether any of them has been moved off
 * the API-served default.
 *
 * ── 처리 비율: shortcuts WITHOUT losing the free numeric entry ────────────────────
 * Figma offers three segmented shortcuts (50 / 80 / 100). Those are ADDED here; the
 * validated numeric field is kept beside them, because the shipped product accepts
 * any share in 0–100 and a redesign must not quietly remove a capability. The pills
 * write the same `processingSharePercent` string the field always wrote, so:
 *   - the request payload is byte-identical for a given share;
 *   - `validateScenario` is still the ONLY bound, so 150 is rejected exactly as
 *     before — from the field, and unreachable from a pill;
 *   - no cost formula, rounding rule, or unit changed because a control changed.
 * A pill is `aria-pressed` when the current value equals it numerically, so typing
 * 50 into the field lights the 50% pill rather than leaving the two disagreeing.
 *
 * ── 시설 종류 ────────────────────────────────────────────────────────────────────
 * The Figma frame draws a select field, so the radio cards became a `<select>`. It
 * is still built ENTIRELY from `options.facility_types` as served — the count is
 * never assumed and no type is invented, so a third facility type would appear with
 * no code change. An empty list is an explicit failure state, not an empty dropdown.
 *
 * PRESENTATIONAL AND CONTROLLED. `scenario`, `update`, and `validationMessage` come
 * from `FacilityCostDashboard`, which stays the single owner of the form state.
 */

import { useRef } from "react";

import type { FacilityCostOptions } from "../../lib/api";
import Accordion from "../ui/Accordion";
import EmptyState from "../ui/EmptyState";
import SectionCard from "../ui/SectionCard";
import SegmentedControl from "../ui/SegmentedControl";
import {
  captionClass,
  fieldClass,
  labelClass,
  matchedSharePreset,
  PROCESSING_SHARE_PRESETS,
  SUBSIDY_RATE_FORM_NOTE,
  WASTE_STREAMS,
  type ScenarioState,
} from "./shared";

/** The small field label used by the Figma card (12px, secondary ink). */
const fieldLabelClass = "block text-xs font-medium text-ink-secondary";

export interface FacilityCostConditionsCardProps {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  validationMessage: string | null;
  /** Whether any advanced value has been moved off its served default. */
  advancedChanged: boolean;
}

export default function FacilityCostConditionsCard({
  options,
  scenario,
  update,
  validationMessage,
  advancedChanged,
}: FacilityCostConditionsCardProps) {
  const shareInputRef = useRef<HTMLInputElement>(null);
  const preset = matchedSharePreset(scenario.processingSharePercent);

  return (
    <SectionCard
      title="② 계산 조건"
      // No `description`. The one it carried ("폐기물 종류와 처리 비율, 시설 종류를
      // 정합니다.") named the three fields that are drawn, labelled, in the
      // 40 pixels directly beneath it.
      testId="facility-cost-step-conditions"
      className="wep-figma-card wep-numbered-card"
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className={fieldLabelClass} htmlFor="fc-waste-stream">
            폐기물 종류
          </label>
          <select
            id="fc-waste-stream"
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
          {/* No standing caption here. The behaviour it pre-announced ("종류를
              바꿔도 선택 지역은 유지되며, 자료가 없는 곳만 빠집니다.") is REPORTED
              when it happens: a stream change that drops regions names every one
              of them in card ①'s `facility-cost-dropped-regions` note, and a
              change that drops none needs no announcement at all. The behaviour
              is unchanged — only its pre-announcement is gone. */}
        </div>

        <div>
          <p className={fieldLabelClass} id="fc-share-label">
            처리 비율
          </p>
          <div className="mt-1">
            <SegmentedControl
              ariaLabel="처리 비율 빠른 선택"
              testId="facility-cost-share-presets"
              // `direct` is not a share value — it only moves focus to the field
              // below, so the pills can never write an unvalidated number.
              value={preset ?? "direct"}
              options={[
                ...PROCESSING_SHARE_PRESETS.map((p) => ({
                  key: p,
                  label: `${p}%`,
                  testId: `facility-cost-share-${p}`,
                })),
                { key: "direct", label: "직접 입력", testId: "facility-cost-share-direct" },
              ]}
              onChange={(value) => {
                if (value === "direct") {
                  shareInputRef.current?.focus();
                  shareInputRef.current?.select();
                  return;
                }
                update("processingSharePercent", value);
              }}
            />
          </div>
          {/* The direct entry path, unchanged in bounds, validation, and test id.
              It stays visible rather than hiding behind the 직접 입력 pill, so the
              exact share in force is always readable. */}
          <div className="mt-2 flex items-center gap-2">
            <label className="flex-none text-xs text-ink-subtle" htmlFor="fc-share-input">
              직접 입력
            </label>
            <input
              id="fc-share-input"
              ref={shareInputRef}
              type="number"
              min={0}
              max={100}
              step={1}
              className="w-24 rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink"
              data-testid="facility-cost-processing-share"
              value={scenario.processingSharePercent}
              onChange={(e) => update("processingSharePercent", e.target.value)}
            />
            <span className="flex-none text-xs text-ink-subtle">%</span>
          </div>
          {/* The BOUND, compactly. What the share is OF is already carried by the
              field's own label and by 선택 지역 in card ③'s condition summary; what
              a reader cannot see from the control is the accepted range, so that
              is what stays. `validateScenario` is untouched and remains the single
              place the 0–100 rule is enforced. */}
          <span className={captionClass}>0–100 %</span>
        </div>

        <div>
          <label className={fieldLabelClass} htmlFor="fc-facility-type">
            시설 종류
          </label>
          {options.facility_types.length === 0 ? (
            <EmptyState
              title="시설 종류를 불러오지 못했습니다."
              description="서버가 시설 종류를 제공하지 않아 계산할 수 없습니다."
              testId="facility-cost-facility-type-empty"
            />
          ) : (
            <select
              id="fc-facility-type"
              className={fieldClass}
              data-testid="facility-cost-facility-type"
              value={scenario.facilityType}
              onChange={(e) => update("facilityType", e.target.value)}
            >
              {options.facility_types.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 고급 설정 — the analytical assumptions. Collapsed, as in Figma, with the
          accordion's own label stating whether any of them has been moved off the
          served default, so a closed accordion never hides THAT something was
          changed. It opens automatically when a value inside is out of range, and
          the calculate card repeats the reason, so an invalid input can never be
          hidden behind it.

          WHAT WAS REMOVED, AND WHY IT IS NOT A LOSS OF DISCLOSURE: a four-row
          `<dl>` used to restate 연간 가동일수 / 지하화 배수 / 보조 시나리오 /
          공사비 기준 immediately above the four controls that hold those exact
          values. It sat INSIDE the accordion, so it was never the closed-state
          summary its comment claimed — it was visible only when the controls it
          duplicated were visible too. Every value it printed is still on screen,
          in the control that owns it, and card ③'s 고급 설정 row still reports
          기본값 / 기본값에서 변경됨 without opening anything. The subsidy rate's
          provenance line that followed it went with it: it was the SOURCE half of
          the fuller note that stays beside the 보조 시나리오 selector below
          (`SUBSIDY_RATE_FORM_NOTE` = the same source string + the non-claim), so
          the shorter copy was strictly contained in the longer one. */}
      <div className="mt-3">
        <Accordion
          label={`고급 설정 — ${advancedChanged ? "기본값에서 변경됨" : "기본값 사용 중"}`}
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

          {/* Validation stays inside the accordion beside the field it refers to,
              AND is summarised in card ③ next to the calculate button, so a closed
              accordion never becomes the only home for an active error. */}
          {validationMessage && (
            <p className="mt-3 text-sm text-warn" role="alert" data-testid="facility-cost-validation">
              {validationMessage}
            </p>
          )}
        </Accordion>
      </div>
    </SectionCard>
  );
}
