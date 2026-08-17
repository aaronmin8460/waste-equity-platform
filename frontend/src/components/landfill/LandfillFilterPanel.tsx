"use client";

/**
 * 조건 선택 — the four landfill filters and the summary of what they currently ask
 * for.
 *
 * The controls are UNCHANGED: four native `<select>`s with the same options, the
 * same order, the same defaults, the same test ids, and the same setters. Native
 * throughout, because they already give keyboard operation, type-ahead, and the
 * platform picker on touch; the refresh restyles the ROW, never the control.
 *
 * The panel holds NO state. Every value and every setter is owned by
 * `app/page.tsx` (which also owns the request lifecycle and the URL mirroring), so
 * there is no second filter representation anywhere in this directory.
 *
 * ── Why the current-selection summary lives INSIDE this card ────────────────────
 * `e2e/phase5LandfillDashboard.spec.ts` measures that `landfill-limitation`,
 * `landfill-filters`, and `landfill-kpi-quantity` are ALL fully inside the first
 * viewport at 1280×800 before any scrolling. A separate summary card between the
 * filters and the KPI row costs a card plus a grid gap and eats into that budget
 * for no informational gain — the summary describes the controls directly above
 * it. It is a footer row of this card instead, and the served period + the
 * partial-year statement stay with the values they qualify (`LandfillHeadlineResults`).
 */

import { useState } from "react";

import type { LandfillOrigin } from "../../lib/api";
import DataStatusBadge from "../ui/DataStatusBadge";
import SectionCard from "../ui/SectionCard";
import { monthOptions, ORIGIN_OPTIONS, PAGE2_CARD_CLASS, yearOptions } from "./shared";

/**
 * What the dashboard currently holds for the selected filters. Passed in rather
 * than derived here: this component must never learn how to classify a response.
 */
export type LandfillSelectionOutcome =
  | { kind: "loading" }
  | { kind: "data"; periodLabel: string }
  | { kind: "no-data" }
  | { kind: "error" };

export interface LandfillFilterPanelProps {
  availableYears: number[];
  year: number | null;
  setYear: (y: number | null) => void;
  month: number | null;
  setMonth: (m: number | null) => void;
  maxMonth: number;
  origin: LandfillOrigin | null;
  setOrigin: (o: LandfillOrigin | null) => void;
  waste: string | null;
  setWaste: (w: string | null) => void;
  wasteOptions: string[];
  outcome: LandfillSelectionOutcome;
}

export default function LandfillFilterPanel({
  availableYears,
  year,
  setYear,
  month,
  setMonth,
  maxMonth,
  origin,
  setOrigin,
  waste,
  setWaste,
  wasteOptions,
  outcome,
}: LandfillFilterPanelProps) {
  const selectClass =
    "mt-1 min-h-[2.25rem] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
  const labelClass = "text-xs font-medium text-ink-muted";

  /**
   * The one piece of state this panel owns, and it is FEEDBACK, not data.
   *
   * Changing the year clears the month, because a month picked in one year may not
   * exist in another. That reset is correct and is kept — but it used to happen in
   * silence, so a reader who had asked for 3월 got a full-year answer with no
   * indication that their narrower question had been dropped.
   *
   * It is held here rather than lifted into the page because it describes an action
   * this control just took; it is not a filter, it is not requested, and no served
   * value depends on it. Deliberately NOT a global toast framework for one message.
   * The wording claims only what is actually known: the month was cleared BECAUSE the
   * new year's coverage is unverified, not because the month was checked and missing.
   */
  const [periodReset, setPeriodReset] = useState<{ month: number; year: string } | null>(null);

  return (
    <SectionCard
      title="조회 조건"
      // No description. Figma's 조회 조건 card (125:5064) carries none, and "네 가지
      // 조건이 아래 모든 값을 함께 결정합니다" restated what a filter panel is. The one
      // line that survives below the controls reports the SERVED outcome, which is the
      // only thing here a reader cannot read off the controls themselves.
      className={PAGE2_CARD_CLASS}
      testId="landfill-filters"
    >
      {/* One desktop row from lg up (the four controls fit comfortably at 1280 and
          1440); two columns on tablets; stacked on phones. Nothing overflows the
          page — the row wraps rather than scrolling sideways. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}>
          연도
          <select
            className={selectClass}
            data-testid="landfill-year-select"
            value={year ?? ""}
            onChange={(event) => {
              const nextYear = event.target.value === "" ? null : Number(event.target.value);
              setYear(nextYear);
              // A month from the previous year may not exist in the new one. The
              // reset is announced only when something was actually dropped.
              if (month != null) {
                setPeriodReset({
                  month,
                  year: nextYear != null ? `${nextYear}년` : "최신 완결연도",
                });
              }
              setMonth(null);
            }}
          >
            <option value="">최신 완결연도</option>
            {yearOptions(availableYears, year).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          기간
          <select
            className={selectClass}
            data-testid="landfill-month-select"
            value={month ?? ""}
            onChange={(event) => {
              // The reader has answered the notice by choosing a period themselves.
              setPeriodReset(null);
              setMonth(event.target.value === "" ? null : Number(event.target.value));
            }}
          >
            <option value="">연간</option>
            {monthOptions(maxMonth, month).map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          출발 지역
          <select
            className={selectClass}
            data-testid="landfill-origin-select"
            value={origin ?? ""}
            onChange={(event) => {
              setPeriodReset(null);
              setOrigin(event.target.value === "" ? null : (event.target.value as LandfillOrigin));
            }}
          >
            <option value="">전체</option>
            {ORIGIN_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          폐기물 종류
          <select
            className={selectClass}
            data-testid="landfill-waste-select"
            value={waste ?? ""}
            onChange={(event) => {
              setPeriodReset(null);
              setWaste(event.target.value === "" ? null : event.target.value);
            }}
          >
            <option value="">전체</option>
            {/* Same reasoning as the year options: a selected type missing from the
                served list would blank the control rather than show the selection. */}
            {(waste != null && !wasteOptions.includes(waste)
              ? [waste, ...wasteOptions]
              : wasteOptions
            ).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* A polite, in-place status. `role="status"` waits for a pause rather than
          interrupting, which is the right register for "we changed one of your
          choices for you". It sits directly under the controls it describes. */}
      {periodReset && (
        <p
          role="status"
          className="mt-2 rounded-control border border-warn-border bg-warn-surface px-3 py-2 text-xs text-warn"
          data-testid="landfill-period-reset"
        >
          기간을 <strong>연간</strong>으로 되돌렸습니다 — {periodReset.year}에 {periodReset.month}
          월이 있는지 확인되지 않았습니다.
        </p>
      )}

      <LandfillSelectionSummary outcome={outcome} />
    </SectionCard>
  );
}

/**
 * What the platform currently holds for the asked-for conditions — ONE line.
 *
 * ── What this used to be, and why the echo is gone ────────────────────────────
 * It was a `현재 선택` label followed by the four chosen values — 2025 · 연간 · 전체 ·
 * 전체 — sitting immediately below the four labelled `<select>`s that were already
 * displaying exactly those four values, unobscured, 40px higher. A summary that
 * restates controls the reader can see is not a summary; it is the same row twice, and
 * it cost this card ~37px of the fold on a screen the Figma frame gives 139px in total.
 * The Figma 조회 조건 card carries no such strip.
 *
 * ── What is KEPT, and why it is not redundant ─────────────────────────────────
 * The OUTCOME sentence stays. It is the one thing on this card that is not readable
 * from the controls: whether the request is in flight, whether the backend actually
 * holds an official record for this combination, and — when it does — the SERVED
 * period, which is not the same string as the 연도 `<option>` (a "최신 완결연도"
 * selection resolves to a concrete year only in the response). With the KPI row's
 * former `수도권매립지 기준 기간:` strip removed as a duplicate, this is now the single
 * place the served period is stated in prose, so it carries a real fact rather than an
 * echo.
 *
 * It reports STATE, never a result: no count, no total, no share, and no number the
 * backend did not serve. Before a response arrives it says so rather than showing a
 * zero, and a no-data answer is the neutral 자료 없음 gray — not amber, which would
 * caution about a value that exists (docs/ui-refresh/design-tokens.md §"Missing data").
 */
function LandfillSelectionSummary({ outcome }: { outcome: LandfillSelectionOutcome }) {
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline pt-2.5"
      data-testid="landfill-selection"
    >
      <p
        className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle"
        data-testid="landfill-selection-status"
      >
        <LandfillSelectionOutcomeText outcome={outcome} />
      </p>
    </div>
  );
}

function LandfillSelectionOutcomeText({ outcome }: { outcome: LandfillSelectionOutcome }) {
  switch (outcome.kind) {
    case "loading":
      // No live region here: the results area already owns the `role="status"`
      // announcement, and two regions would double every filter change.
      return <span>선택한 조건의 공식 자료를 불러오는 중입니다.</span>;
    case "data":
      return (
        <>
          <DataStatusBadge status="reported" testId="landfill-selection-badge" />
          {/* The SERVED period only. The second sentence — "계산으로 얻은 값은 카드마다
              따로 표시합니다" — described the 계산값 badge scheme in general, on a screen
              where every derived figure already wears that badge beside its own value.
              The scheme itself is defined once, in 근거와 한계. */}
          <span>기준 기간 {outcome.periodLabel}의 공식 반입 자료를 표시합니다.</span>
        </>
      );
    case "no-data":
      return (
        <>
          <DataStatusBadge status="missing" testId="landfill-selection-badge" />
          <span>선택한 조건의 공식 반입 자료가 없습니다. 값이 0이라는 뜻이 아닙니다.</span>
        </>
      );
    case "error":
      // Deliberately not a badge: nothing is known about the data, only about the
      // request. The actionable statement is the alert below the filters.
      return <span>자료를 불러오지 못해 값을 표시하지 않습니다.</span>;
  }
}
