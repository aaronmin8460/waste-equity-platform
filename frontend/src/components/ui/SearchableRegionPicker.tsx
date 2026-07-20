"use client";

/**
 * SearchableRegionPicker — the service-region chooser for the facility-cost setup
 * workflow (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §9, Phase 2).
 *
 * It replaces a native `<select multiple size={6}>` whose options read
 * "중구 (KR-SGIS-11140)" — a citizen had to decode an internal region code to tell
 * Seoul's 중구 from Incheon's, and picking several of 60+ districts meant
 * ctrl-clicking inside a six-row scroll box. Here the same choice is made by typing
 * a Korean name, by keyboard, or by one metropolitan bulk button, and every visible
 * label is a plain name ("서울 중구"). The code survives only as the option VALUE,
 * the chip key, and the `data-region-code` test hook — never as visible text.
 *
 * PRESENTATIONAL AND CONTROLLED. It fetches nothing and knows nothing about waste
 * streams: `regions` is the already-filtered set of CALCULABLE regions for the
 * caller's current stream, and `selectedCodes` is owned by the caller. So the
 * picker can never offer a region the calculation endpoint cannot serve, and a
 * stream change is a plain prop change (FacilityCostDashboard clears the selection).
 *
 * Accessibility — the ARIA 1.2 combobox pattern with a listbox popup:
 *   - the input is `role="combobox"` with `aria-expanded`, `aria-controls`,
 *     `aria-autocomplete="list"`, and `aria-activedescendant` for the keyboard-active
 *     option (focus itself never leaves the input, so there is no keyboard trap);
 *   - ArrowDown/ArrowUp move the active option, Enter selects it, Escape closes;
 *   - selection state is conveyed by `aria-selected` AND a visible "선택됨" word, so
 *     it never depends on color alone;
 *   - each chip's remove button is named "<지역 이름> 제거" (via the shared Chip), so
 *     a screen-reader user knows which region a given button removes;
 *   - selection changes go to a POLITE status region. They are ordinary feedback,
 *     not errors, so `role="alert"` is deliberately not used here.
 */

import { useCallback, useId, useMemo, useState } from "react";

import { compareRegionsForDisplay, regionDisplayName } from "../../lib/regionDisplay";
import { regionScope, SCOPE_LABELS, type RegionScope } from "../../lib/ranking";
import Chip from "./Chip";

export interface PickerRegion {
  /** Internal region code — the option value, never visible text. */
  code: string;
  /** The served sigungu name, e.g. "중구". */
  name: string;
}

export interface SearchableRegionPickerProps {
  /**
   * The regions that are actually calculable right now, in any order. The picker
   * sorts them deterministically (서울 → 인천 → 경기 → name) and dedupes by code.
   */
  regions: PickerRegion[];
  /** Currently selected region codes (caller-owned). */
  selectedCodes: string[];
  /** Receives the next selection, already deduped and deterministically ordered. */
  onChange: (codes: string[]) => void;
  /** Visible label for the search input. */
  label: string;
  /** Optional help text rendered under the input and wired up via aria-describedby. */
  hint?: string;
}

/** The metropolitan bulk-selection buttons, in the same order as the sort. */
const BULK_SCOPES: { scope: RegionScope; testId: string }[] = [
  { scope: "11", testId: "facility-cost-regions-seoul" },
  { scope: "23", testId: "facility-cost-regions-incheon" },
  { scope: "31", testId: "facility-cost-regions-gyeonggi" },
];

export default function SearchableRegionPicker({
  regions,
  selectedCodes,
  onChange,
  label,
  hint,
}: SearchableRegionPickerProps) {
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const hintId = `${reactId}-hint`;
  const optionId = (index: number) => `${reactId}-option-${index}`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  /** Deduped by code and deterministically ordered, with the visible label baked in. */
  const allRegions = useMemo(() => {
    const seen = new Set<string>();
    return regions
      .filter((r) => !seen.has(r.code) && seen.add(r.code))
      .map((r) => ({ ...r, label: regionDisplayName(r.code, r.name) }))
      .sort(compareRegionsForDisplay);
  }, [regions]);

  // The identity of the offered set. When the caller swaps the waste stream the
  // whole list changes, so a half-typed query for the old stream is stale — reset
  // it rather than leaving the user staring at "검색 결과 없음".
  //
  // This is the "adjust state when a prop changes" pattern (react.dev), done during
  // render rather than in an effect: React re-renders this component immediately
  // with no wasted paint, and no cascading-render effect is introduced.
  const regionsKey = useMemo(() => allRegions.map((r) => r.code).join(","), [allRegions]);
  const [lastRegionsKey, setLastRegionsKey] = useState(regionsKey);
  if (regionsKey !== lastRegionsKey) {
    setLastRegionsKey(regionsKey);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  /** Name search. Both the plain name and the prefixed label match, so a citizen can
      type "중구" or "인천 중구". Codes are deliberately NOT searchable text here —
      they are not shown, so searching them would surface an invisible field. */
  const results = useMemo(() => {
    const q = query.trim();
    if (q === "") return allRegions;
    return allRegions.filter((r) => r.name.includes(q) || r.label.includes(q));
  }, [allRegions, query]);

  // Keep the active option inside the current result set at all times.
  const clampedActive = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  /** Selected chips, in the same deterministic order as the options. */
  const selectedRegions = useMemo(
    () => allRegions.filter((r) => selectedSet.has(r.code)),
    [allRegions, selectedSet],
  );

  /** Apply a new selection: deduped, and ordered by the shared display comparator. */
  const commit = useCallback(
    (codes: Set<string>, message: string) => {
      const next = allRegions.filter((r) => codes.has(r.code)).map((r) => r.code);
      onChange(next);
      setAnnouncement(`${message} 선택한 지역 ${next.length}개.`);
    },
    [allRegions, onChange],
  );

  /** Adding an already-selected region is a no-op — a Set cannot duplicate it. */
  const selectRegion = useCallback(
    (region: { code: string; label: string }) => {
      if (selectedSet.has(region.code)) {
        setAnnouncement(`${region.label}은(는) 이미 선택되어 있습니다. 선택한 지역 ${selectedCodes.length}개.`);
        return;
      }
      commit(new Set([...selectedCodes, region.code]), `${region.label} 선택됨.`);
    },
    [commit, selectedCodes, selectedSet],
  );

  const removeRegion = useCallback(
    (region: { code: string; label: string }) => {
      const next = new Set(selectedCodes);
      next.delete(region.code);
      commit(next, `${region.label} 제거됨.`);
    },
    [commit, selectedCodes],
  );

  /** Bulk-select one metropolitan area — only from `regions`, i.e. only calculable
      ones, merged with (never replacing) the existing selection. */
  const selectScope = useCallback(
    (scope: RegionScope) => {
      const inScope = allRegions.filter((r) => regionScope(r.code) === scope);
      const next = new Set([...selectedCodes, ...inScope.map((r) => r.code)]);
      commit(next, `${SCOPE_LABELS[scope]} 지역 ${inScope.length}개를 선택했습니다.`);
    },
    [allRegions, commit, selectedCodes],
  );

  const clearAll = useCallback(() => {
    onChange([]);
    setAnnouncement("선택한 지역을 모두 해제했습니다. 선택한 지역 0개.");
  }, [onChange]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length > 0) setActiveIndex((i) => (i + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length > 0) {
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      }
      return;
    }
    if (event.key === "Enter") {
      // Only swallow Enter when it actually selects something, so the key stays
      // available to the surrounding form in every other state.
      if (open && clampedActive >= 0) {
        event.preventDefault();
        selectRegion(results[clampedActive]);
      }
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  const scopeCounts = useMemo(() => {
    const counts = new Map<RegionScope, number>();
    for (const r of allRegions) {
      const scope = regionScope(r.code);
      if (scope !== null) counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }
    return counts;
  }, [allRegions]);

  return (
    <div>
      <label className="block text-sm font-medium text-ink" htmlFor={`${reactId}-input`}>
        {label}
      </label>

      <div className="relative mt-1">
        <input
          id={`${reactId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && clampedActive >= 0 ? optionId(clampedActive) : undefined}
          aria-describedby={hint ? hintId : undefined}
          autoComplete="off"
          className="w-full rounded-control border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink"
          placeholder="지역 이름 검색"
          value={query}
          data-testid="facility-cost-region-search"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            // Keep the popup open while focus moves INTO it (a click on an option
            // blurs the input first); close it for any other focus destination.
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
              setOpen(false);
            }
          }}
        />

        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-card border border-hairline bg-surface shadow-card">
            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-64 overflow-y-auto py-1"
              data-testid="facility-cost-region-options"
            >
              {results.map((region, index) => {
                const isSelected = selectedSet.has(region.code);
                const isActive = index === clampedActive;
                return (
                  <li
                    key={region.code}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    data-testid="facility-cost-region-option"
                    // The code is a TEST/diagnostic hook, not visible text.
                    data-region-code={region.code}
                    data-active={isActive || undefined}
                    className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                      isActive ? "bg-primary-soft text-primary-hover" : "text-ink"
                    } ${isSelected ? "font-semibold" : ""}`}
                    // Select on mousedown-then-click without letting the blur that
                    // precedes click tear the list down first.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectRegion(region)}
                  >
                    <span>{region.label}</span>
                    {/* Selection is stated in words, not by color alone. */}
                    {isSelected && <span className="text-xs text-primary-hover">선택됨</span>}
                  </li>
                );
              })}
            </ul>
            {results.length === 0 && (
              <p className="px-3 py-3 text-sm text-ink-muted" data-testid="facility-cost-region-empty">
                {allRegions.length === 0
                  ? "지금 선택한 폐기물 종류로 계산할 수 있는 지역이 없습니다."
                  : `“${query.trim()}”과(와) 이름이 일치하는 지역이 없습니다.`}
              </p>
            )}
          </div>
        )}
      </div>

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      )}

      {/* Metropolitan bulk actions. Each adds only the CALCULABLE regions of its
          area (they come from `regions`), so a bulk click can never select a region
          the endpoint would reject. A scope with no calculable region is disabled
          rather than silently doing nothing. */}
      <div className="mt-2 flex flex-wrap gap-2">
        {BULK_SCOPES.map(({ scope, testId }) => {
          const count = scopeCounts.get(scope) ?? 0;
          return (
            <button
              key={scope}
              type="button"
              className="wep-btn-quiet"
              data-testid={testId}
              disabled={count === 0}
              onClick={() => selectScope(scope)}
            >
              {SCOPE_LABELS[scope]} 전체
            </button>
          );
        })}
        <button
          type="button"
          className="wep-btn-quiet"
          data-testid="facility-cost-regions-clear"
          disabled={selectedCodes.length === 0}
          onClick={clearAll}
        >
          선택 초기화
        </button>
      </div>

      {/* Selected regions. The container is always rendered so its testid is a
          stable contract, and an empty selection says so in words. */}
      <div className="mt-3" data-testid="facility-cost-selected-regions">
        <p className="text-xs text-ink-subtle">선택한 지역 {selectedRegions.length}개</p>
        {selectedRegions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">아직 선택한 지역이 없습니다.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {selectedRegions.map((region) => (
              <li key={region.code} data-region-code={region.code}>
                <Chip
                  label={region.label}
                  onRemove={() => removeRegion(region)}
                  testId="facility-cost-region-chip"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Ordinary selection feedback — polite, never an alert. */}
      <p className="sr-only" role="status" data-testid="facility-cost-region-status">
        {announcement}
      </p>
    </div>
  );
}
