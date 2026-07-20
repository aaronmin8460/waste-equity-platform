"use client";

/**
 * 지역 비교 — searchable 2–3 region comparison for the 지역 부담 view.
 *
 * A keyboard-accessible ARIA combobox (search by Korean name or region code) adds
 * up to three regions as removable chips; a compact table then shows each region's
 * exact served value under the active metric. Selecting a chip also selects that
 * region on the map (the one canonical selected-region state), so map and text
 * comparison stay in sync.
 *
 * Analytical honesty: an official measured 0 renders as "0" (distinct from 자료
 * 없음), a region with no served value shows 자료 없음 — never a fabricated 0. The
 * exact value text is always present; the proportional bar is a decorative aid
 * only (aria-hidden), never the sole signal, and is drawn only when every compared
 * region has a value.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComparisonValue {
  code: string;
  name: string;
  /** Exact display string (e.g. "142,000", "0", or the availability text). */
  display: string;
  /** True when an official value was served (distinguishes official 0 from 자료 없음). */
  hasValue: boolean;
  /** Numeric value for the optional proportional bar; undefined when unavailable. */
  numeric?: number;
}

interface RegionComparisonProps {
  regionOptions: { code: string; name: string }[];
  resolveValue: (code: string) => ComparisonValue | null;
  metricLabel: string;
  unit: string;
  selected: string[];
  setSelected: (codes: string[]) => void;
  onSelectRegionOnMap: (code: string) => void;
  maxCompare?: number;
}

export default function RegionComparison({
  regionOptions,
  resolveValue,
  metricLabel,
  unit,
  selected,
  setSelected,
  onSelectRegionOnMap,
  maxCompare = 3,
}: RegionComparisonProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const atMax = selected.length >= maxCompare;

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listboxRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${listboxId}-opt-${activeIndex}`)}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  // Filter by Korean name OR region code, excluding already-selected regions.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = regionOptions.filter((o) => !selected.includes(o.code));
    if (q === "") return available.slice(0, 8);
    return available
      .filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, regionOptions, selected]);

  const rows = useMemo(
    () => selected.map((code) => resolveValue(code)).filter((v): v is ComparisonValue => v !== null),
    [selected, resolveValue],
  );

  const maxNumeric = useMemo(() => {
    const nums = rows.filter((r) => r.hasValue && r.numeric !== undefined).map((r) => r.numeric!);
    return nums.length ? Math.max(...nums) : 0;
  }, [rows]);
  const allHaveValue = rows.length > 0 && rows.every((r) => r.hasValue && r.numeric !== undefined);

  function addRegion(code: string) {
    if (atMax || selected.includes(code)) return;
    setSelected([...selected, code]);
    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeRegion(code: string) {
    setSelected(selected.filter((c) => c !== code));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault();
        addRegion(matches[activeIndex].code);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    // Phase 4: the Phase 1 shared card language. The combobox behaviour, the
    // comparison maximum, the computed values, and the CSV/report inputs are all
    // untouched — this is presentation only.
    <section
      aria-label="지역 비교"
      data-testid="region-comparison"
      className="wep-card p-4 text-xs text-ink-muted"
    >
      <h2 className="mb-1 text-sm font-semibold text-ink">지역 비교</h2>
      <p className="mb-2 text-[11px] text-ink-subtle">
        최대 {maxCompare}개 지역을 골라 {metricLabel} 값을 나란히 비교합니다.
      </p>

      {/* Combobox */}
      <div className="relative">
        <label htmlFor={`${listboxId}-input`} className="sr-only">
          지역 검색
        </label>
        <input
          id={`${listboxId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          disabled={atMax}
          value={query}
          placeholder={atMax ? `최대 ${maxCompare}개까지 선택했습니다` : "지역 이름 또는 코드 검색"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="min-h-[32px] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm disabled:bg-surface-sunken disabled:text-ink-subtle"
          data-testid="comparison-search"
        />
        {open && matches.length > 0 && !atMax && (
          <ul
            id={listboxId}
            ref={listboxRef}
            role="listbox"
            aria-label="검색 결과"
            className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-slate-200 bg-white shadow-lg"
            data-testid="comparison-options"
          >
            {matches.map((o, i) => (
              <li
                key={o.code}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addRegion(o.code);
                }}
                className={`cursor-pointer px-2 py-1.5 text-sm ${
                  i === activeIndex ? "bg-sky-100" : "hover:bg-slate-50"
                }`}
              >
                {o.name} <span className="text-[11px] text-slate-400">{o.code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="선택한 비교 지역" data-testid="comparison-chips">
          {rows.map((r) => (
            <li key={r.code}>
              <span className="wep-chip">
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => onSelectRegionOnMap(r.code)}
                  title="지도에서 보기"
                >
                  {r.name}
                </button>
                <button
                  type="button"
                  aria-label={`${r.name} 비교에서 제거`}
                  onClick={() => removeRegion(r.code)}
                  className="-mr-1 ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-primary-hover hover:bg-white"
                  data-testid="comparison-chip-remove"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Comparison table */}
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="comparison-table">
            <caption className="sr-only">
              {metricLabel} 지역 비교 표{unit ? ` (단위 ${unit})` : ""}
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-2 font-medium">지역</th>
                <th className="py-1 pr-2 text-right font-medium">값{unit ? ` (${unit})` : ""}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-800">{r.name}</td>
                  <td className="py-1 pr-2 text-right">
                    <span
                      className={`tabular-nums font-medium ${
                        r.hasValue ? "text-slate-900" : "text-amber-700"
                      }`}
                    >
                      {r.hasValue ? r.display : "자료 없음"}
                    </span>
                    {allHaveValue && (
                      <span aria-hidden className="mt-0.5 block h-1 rounded bg-slate-100">
                        <span
                          className="block h-1 rounded bg-sky-500"
                          style={{
                            width: `${maxNumeric > 0 ? Math.round(((r.numeric ?? 0) / maxNumeric) * 100) : 0}%`,
                          }}
                        />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
