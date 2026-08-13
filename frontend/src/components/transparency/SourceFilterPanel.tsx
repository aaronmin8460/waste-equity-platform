"use client";

/**
 * The source catalog's controls, plus the 현재 조건 summary that states what they
 * are currently set to.
 *
 * ── WHAT IS PRESERVED EXACTLY ───────────────────────────────────────────────────
 * A native `<input type="search">` and two native `<select>`s, with the same test
 * ids, the same option sets (derived from the served records only), the same
 * defaults, and the same Tab order: search → 검색어 지우기 → 자료 분야 → 갱신 주기.
 * `e2e/phase6DataSourcesDashboard.spec.ts` walks exactly that order, so nothing
 * focusable may be inserted between them — which is why 검색 조건 지우기 is placed
 * AFTER 갱신 주기 (its position in Figma too) and why the 현재 조건 summary below
 * the controls is built from `Chip` (a `<span>`), never `FilterChip`
 * (a `<button aria-pressed>`).
 *
 * ── WHAT FIGMA FRAME 156:470 CHANGED ───────────────────────────────────────────
 *   1. One control ROW: search grows, the two selects and the clear-all button
 *      keep their intrinsic width. Previously the selects wrapped under the search
 *      field on anything narrower than `lg`.
 *   2. 검색 조건 지우기 became a PERSISTENT control instead of an action that
 *      existed only inside the no-match empty state. Clearing all three filters at
 *      once was previously unreachable unless the reader first filtered the list
 *      down to nothing. It is `disabled` while nothing is active, so the row's
 *      shape never changes under the pointer and the control's availability is
 *      exposed to assistive technology rather than implied by its absence.
 *      Exactly ONE control carries this name (the empty state now points at it),
 *      so `getByRole("button", { name: "검색 조건 지우기" })` stays unambiguous.
 *   3. The selects' default options read 모든 분야 / 모든 갱신 주기 rather than a
 *      bare 전체, so a collapsed select still says what it is showing everything of.
 *   4. Figma drops the visible field labels and leans on the placeholder. They are
 *      KEPT: a placeholder is not an accessible name, it disappears on input, and
 *      a `<select>` has nowhere to put one at all. Pixel parity is not worth an
 *      unlabelled control (brief §3).
 */

import { SOURCE_AREA_LABELS, type SourceArea } from "../../lib/dataSources";
import { formatCount } from "../../lib/metrics";
import Chip from "../ui/Chip";

/** Shared geometry for the four controls: 44px tall, 12px radius, hairline. */
const CONTROL =
  "min-h-11 rounded-xl border border-hairline-strong bg-surface px-4 text-sm text-ink";

export interface SourceFilterPanelProps {
  searchId: string;
  areaId: string;
  frequencyId: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onClearFilters: () => void;
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
  onClearFilters,
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
      <div
        className="flex flex-col gap-2.5 lg:flex-row lg:items-end"
        data-testid="transparency-controls"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={searchId} className="block text-xs font-medium text-ink-secondary">
            출처 검색
          </label>
          <div className="mt-1 flex gap-2.5">
            <input
              id={searchId}
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="자료명, 기관명, 식별자로 검색"
              className={`w-full ${CONTROL}`}
              data-testid="transparency-search"
            />
            {query !== "" && (
              <button
                type="button"
                className="wep-btn-quiet min-h-11 flex-none rounded-xl"
                onClick={onClearQuery}
                data-testid="transparency-search-clear"
              >
                검색어 지우기
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <div>
            <label htmlFor={areaId} className="block text-xs font-medium text-ink-secondary">
              자료 분야
            </label>
            <select
              id={areaId}
              value={area}
              onChange={(event) => onAreaChange(event.target.value as SourceArea | "all")}
              className={`mt-1 w-full sm:w-auto ${CONTROL}`}
              data-testid="transparency-filter-category"
            >
              <option value="all">모든 분야</option>
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
            <label htmlFor={frequencyId} className="block text-xs font-medium text-ink-secondary">
              갱신 주기
            </label>
            <select
              id={frequencyId}
              value={frequency}
              onChange={(event) => onFrequencyChange(event.target.value)}
              className={`mt-1 w-full sm:w-auto ${CONTROL}`}
              data-testid="transparency-filter-frequency"
            >
              <option value="all">모든 갱신 주기</option>
              {frequencyOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {/* Clears all three at once, in place — it never reloads the view or
              touches the URL, so nothing else the reader has open is disturbed.
              Disabled rather than hidden while nothing is active: a control that
              appears and vanishes shifts the row under the pointer, and its
              unavailability would be inferable only by sighted readers. */}
          <button
            type="button"
            onClick={onClearFilters}
            disabled={!filtered}
            className="min-h-11 flex-none rounded-xl bg-surface-muted px-4 text-sm font-medium text-ink-secondary hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-surface-muted"
            data-testid="transparency-clear-filters"
          >
            검색 조건 지우기
          </button>
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
            disclosure, which would hide it from AT while collapsed. Figma shows
            only `9건 표시`; the served total is kept alongside it because
            "9 shown" alone cannot tell the reader whether anything was filtered
            out. */}
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
