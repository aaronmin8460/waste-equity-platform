"use client";

/**
 * The source catalog — the controls, the current-condition summary, and the cards.
 *
 * THREE OUTCOMES, KEPT APART. They are different facts and are never merged:
 *
 *   1. the registry served NO records          → `transparency-sources-empty`
 *   2. the registry served records, but the current search/filter matched none
 *                                              → `transparency-empty-results`
 *   3. records to show                         → `transparency-source-list`
 *
 * None of the three is an alert. A registry that answers "no records" has answered;
 * a local search that matches nothing is a filter outcome, not a server failure.
 * (The fourth and fifth outcomes — a request in flight and a genuine failure — belong
 * to the panels that own those requests.)
 *
 * The no-match state no longer carries its own 검색 조건 지우기 button. That control
 * is now permanent in `SourceFilterPanel`, directly above this list, so a second copy
 * here would give two different buttons the same accessible name and make
 * `getByRole("button", { name })` ambiguous for both the suites and a screen reader.
 * The empty state points at the surviving one instead.
 *
 * This component holds no state, no request, and no second copy of the registry. It
 * receives the already-built, already-filtered records and renders them.
 */

import type { DisplaySource, SourceArea } from "../../lib/dataSources";
import EmptyState from "../ui/EmptyState";
import SourceCatalogItem from "./SourceCatalogItem";
import SourceFilterPanel from "./SourceFilterPanel";
import type { FreshnessState } from "./shared";

export interface SourceCatalogProps {
  /** Every record the registry served, in the catalog's fixed order. */
  sources: readonly DisplaySource[];
  /** The subset currently passing the filters, in the same order. */
  visibleSources: readonly DisplaySource[];
  freshnessState: FreshnessState;
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
  filtered: boolean;
}

export default function SourceCatalog({
  sources,
  visibleSources,
  freshnessState,
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
  filtered,
}: SourceCatalogProps) {
  if (sources.length === 0) {
    // The registry answered with no records. That is an answer, not a failure, so it
    // is not an alert and shows no invented rows. The controls are not rendered
    // either — a search box over an empty registry offers a recovery that does not
    // exist.
    return (
      <EmptyState
        testId="transparency-sources-empty"
        title="등록된 출처 기록이 없습니다."
        description="현재 출처 목록을 제공받지 못했습니다. 없는 출처를 임의로 만들어 표시하지 않습니다."
      />
    );
  }

  return (
    <>
      <SourceFilterPanel
        searchId={searchId}
        areaId={areaId}
        frequencyId={frequencyId}
        searchRef={searchRef}
        query={query}
        onQueryChange={onQueryChange}
        onClearQuery={onClearQuery}
        onClearFilters={onClearFilters}
        area={area}
        onAreaChange={onAreaChange}
        areaOptions={areaOptions}
        frequency={frequency}
        onFrequencyChange={onFrequencyChange}
        frequencyOptions={frequencyOptions}
        totalCount={sources.length}
        visibleCount={visibleSources.length}
        filtered={filtered}
      />

      {visibleSources.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            testId="transparency-empty-results"
            title="검색 조건에 맞는 출처가 없습니다."
            description="위의 ‘검색 조건 지우기’를 누르면 등록된 출처를 다시 모두 볼 수 있습니다. 조건에 맞는 출처가 없다고 해서 자료가 없는 것은 아닙니다."
          />
        </div>
      ) : (
        <ul
          // Three columns from 1280 and four from 1536, so the wide desktop targets
          // are not a single narrow column of cards beside empty space. At 1024 the
          // two-column layout keeps every card's metadata readable without clipping.
          className="wep-source-grid mt-3 grid gap-3"
          data-testid="transparency-source-list"
        >
          {visibleSources.map((source) => (
            <SourceCatalogItem
              key={source.sourceId}
              source={source}
              freshnessState={freshnessState}
            />
          ))}
        </ul>
      )}
    </>
  );
}
