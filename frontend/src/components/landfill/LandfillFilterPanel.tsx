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

import type { LandfillOrigin } from "../../lib/api";
import DataStatusBadge from "../ui/DataStatusBadge";
import SectionCard from "../ui/SectionCard";
import { monthOptions, ORIGIN_OPTIONS, originLabel, yearOptions } from "./shared";

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
  return (
    <SectionCard
      title="조건 선택"
      description="네 가지 조건이 아래 모든 값을 함께 결정합니다."
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
              setYear(event.target.value === "" ? null : Number(event.target.value));
              // A month from the previous year may not exist in the new one.
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
            onChange={(event) =>
              setMonth(event.target.value === "" ? null : Number(event.target.value))
            }
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
            onChange={(event) =>
              setOrigin(event.target.value === "" ? null : (event.target.value as LandfillOrigin))
            }
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
            onChange={(event) => setWaste(event.target.value === "" ? null : event.target.value)}
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

      <LandfillSelectionSummary
        year={year}
        month={month}
        origin={origin}
        waste={waste}
        outcome={outcome}
      />
    </SectionCard>
  );
}

/**
 * 현재 선택 — the four asked-for conditions restated as text, plus one sentence
 * saying what the platform currently holds for them.
 *
 * It reports STATE, never a result: no count, no total, no share, and no number the
 * backend did not serve. Before a response arrives it says so rather than showing a
 * zero, and a no-data answer is the neutral 자료 없음 gray — not amber, which would
 * caution about a value that exists (docs/ui-refresh/design-tokens.md §"Missing data").
 *
 * It duplicates no control: the four selects above are the only way to change any
 * of this.
 */
function LandfillSelectionSummary({
  year,
  month,
  origin,
  waste,
  outcome,
}: {
  year: number | null;
  month: number | null;
  origin: LandfillOrigin | null;
  waste: string | null;
  outcome: LandfillSelectionOutcome;
}) {
  const items: { term: string; value: string }[] = [
    // The bare year, exactly as the `<option>` spells it — deliberately NOT
    // `2024년`. `기준 기간 …년` is the SERVED period, and several specs wait for it
    // to prove new values have arrived; echoing it from filter state would satisfy
    // that wait while the previous period's numbers were still on screen.
    { term: "연도", value: year != null ? String(year) : "최신 완결연도" },
    { term: "기간", value: month != null ? `${month}월` : "연간" },
    { term: "출발 지역", value: originLabel(origin) },
    { term: "폐기물 종류", value: waste ?? "전체" },
  ];
  return (
    <div
      className="mt-3 border-t border-hairline pt-3"
      data-testid="landfill-selection"
    >
      <p className="text-xs font-medium text-ink-subtle">현재 선택</p>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="inline text-ink-subtle">{item.term} </dt>
            <dd className="inline font-medium text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p
        className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle"
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
          <span>
            기준 기간 {outcome.periodLabel}의 공식 반입 자료를 표시합니다. 계산으로 얻은 값은 카드마다
            따로 표시합니다.
          </span>
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
