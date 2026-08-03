"use client";

/**
 * The source catalog's controls, plus the 현재 조건 summary that states what they
 * are currently set to.
 *
 * ── WHAT IS PRESERVED EXACTLY ───────────────────────────────────────────────────
 * A native `<input type="search">` and two native `<select>`s, with the same labels,
 * the same option sets (derived from the served records only), the same defaults,
 * the same test ids, and the same Tab order: search → 검색어 지우기 → 자료 분야 →
 * 갱신 주기. `e2e/phase6DataSourcesDashboard.spec.ts` walks exactly that order, so
 * nothing focusable may be inserted between them — which is why the 현재 조건 summary
 * below the controls is built from `Chip` (a `<span>`), never `FilterChip` (a
 * `<button aria-pressed>`).
 *
 * ── WHAT IS NEW ────────────────────────────────────────────────────────────────
 * The 현재 조건 row. Before the refresh the only statement of the active filters was
 * `(검색·필터 적용)` appended to the result count — it said that filtering was on,
 * never WHAT was filtered, and the reader had to scroll back to the controls to find
 * out. It REPORTS state and is never a second way to change it: it contains zero
 * `input`, `select`, and `button` elements (asserted in both suites).
 *
 * The result count keeps its exact previous wording and its `role="status"`, and it
 * stays in the section body — never inside a disclosure, which would hide it from
 * assistive technology while collapsed.
 */

import { SOURCE_AREA_LABELS, type SourceArea } from "../../lib/dataSources";
import { formatCount } from "../../lib/metrics";
import Chip from "../ui/Chip";

export interface SourceFilterPanelProps {
  searchId: string;
  areaId: string;
  frequencyId: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  area: SourceArea | "all";
  onAreaChange: (value: SourceArea | "all") => void;
  areaOptions: readonly SourceArea[];
  frequency: string;
  onFrequencyChange: (value: string) => void;
  frequencyOptions: readonly { code: string; label: string }[];
  /** Records the registry served, before filtering. */
  totalCount: number;
  /** Records currently rendered. */
  visibleCount: number;
  /** True when any of the three controls is away from its default. */
  filtered: boolean;
}

export default function SourceFilterPanel({
  searchId,
  areaId,
  frequencyId,
  searchRef,
  query,
  onQueryChange,
  onClearQuery,
  area,
  onAreaChange,
  areaOptions,
  frequency,
  onFrequencyChange,
  frequencyOptions,
  totalCount,
  visibleCount,
  filtered,
}: SourceFilterPanelProps) {
  // Read off the SAME state the controls are bound to, so the summary can never
  // disagree with them. The frequency label comes from the option list rather than
  // being re-derived, so an unrecognised cadence keeps its neutral label here too.
  const conditions: string[] = [];
  if (query.trim() !== "") conditions.push(`검색어 · ${query.trim()}`);
  if (area !== "all") conditions.push(`자료 분야 · ${SOURCE_AREA_LABELS[area]}`);
  if (frequency !== "all") {
    const option = frequencyOptions.find((candidate) => candidate.code === frequency);
    if (option) conditions.push(`갱신 주기 · ${option.label}`);
  }

  return (
    <>
      {/* Native input + native selects: no combobox library, no third-party table,
          and the platform's own keyboard behaviour is preserved. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end" data-testid="transparency-controls">
        <div className="flex-1">
          <label htmlFor={searchId} className="block text-xs font-medium text-ink-muted">
            출처 검색
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={searchId}
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="자료 이름, 제공 기관, 자료 번호"
              className="w-full rounded-control border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink"
              data-testid="transparency-search"
            />
            {query !== "" && (
              <button
                type="button"
                className="wep-btn-quiet"
                onClick={onClearQuery}
                data-testid="transparency-search-clear"
              >
                검색어 지우기
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div>
            <label htmlFor={areaId} className="block text-xs font-medium text-ink-muted">
              자료 분야
            </label>
            <select
              id={areaId}
              value={area}
              onChange={(event) => onAreaChange(event.target.value as SourceArea | "all")}
              className="mt-1 w-full rounded-control border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink sm:w-auto"
              data-testid="transparency-filter-category"
            >
              <option value="all">전체</option>
              {/* Options come from the served records only, so a filter can never
                  offer a category that would always return nothing. */}
              {areaOptions.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_AREA_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={frequencyId} className="block text-xs font-medium text-ink-muted">
              갱신 주기
            </label>
            <select
              id={frequencyId}
              value={frequency}
              onChange={(event) => onFrequencyChange(event.target.value)}
              className="mt-1 w-full rounded-control border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink sm:w-auto"
              data-testid="transparency-filter-frequency"
            >
              <option value="all">전체</option>
              {frequencyOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div
        className="mt-3 flex flex-col gap-2 rounded-card border border-hairline bg-surface-muted px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
        data-testid="transparency-filter-summary"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-ink-subtle">현재 조건</span>
          {conditions.length === 0 ? (
            <span className="text-xs text-ink-muted">
              검색어와 필터를 적용하지 않았습니다. 등록된 출처를 모두 표시합니다.
            </span>
          ) : (
            conditions.map((condition) => <Chip key={condition} label={condition} />)
          )}
        </div>
        {/* Polite result count. Lives directly in the section — never inside a
            disclosure, which would hide it from AT while collapsed. */}
        <p
          role="status"
          className="flex-none text-xs text-ink-subtle"
          data-testid="transparency-result-count"
        >
          {`전체 ${formatCount(totalCount)}건 중 ${formatCount(visibleCount)}건 표시`}
          {filtered ? " (검색·필터 적용)" : ""}
        </p>
      </div>
    </>
  );
}
