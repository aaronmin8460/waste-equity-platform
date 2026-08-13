"use client";

/**
 * ① 비용 계산 희망 지역 선택 — the first card of the Figma three-step workflow
 * (129:5709, card ①).
 *
 * The control inside it is the EXISTING `SearchableRegionPicker`, unchanged: name
 * search, the 서울 / 인천 / 경기 bulk buttons, 선택 초기화, removable chips, and the
 * "선택한 지역 N개" count are the same component and the same behaviour that was
 * already browser-verified across metropolitan combinations. The Figma note's claim
 * that choosing one metropolitan area blocks the others is stale — bulk selection
 * MERGES into the existing selection (`selectScope`), and nothing here narrows it.
 *
 * WHAT THIS CARD ADDS: coverage honesty. The picker offers only the regions
 * calculable for the selected waste stream, which is correct but silent — a reader
 * could not tell whether a region was missing because they mistyped it or because
 * the official statistics do not cover it for this stream. The coverage line states
 * both counts, and the excluded regions are listed by name in a disclosure. No
 * region is invented and no missing quantity is filled in: an absent region is
 * reported as absent, with "0이 아닙니다" said explicitly.
 *
 * PRESENTATIONAL AND CONTROLLED — it owns no scenario state and validates nothing.
 */

import type { RefObject } from "react";

import EmptyState from "../ui/EmptyState";
import SearchableRegionPicker from "../ui/SearchableRegionPicker";
import SectionCard from "../ui/SectionCard";

export interface FacilityCostRegionCardProps {
  /** The regions calculable for the CURRENT waste stream. */
  regionOptions: { code: string; name: string }[];
  /**
   * Regions that exist on the map but have no official waste statistics for the
   * current stream, already named for display.
   */
  unavailableRegions: { code: string; label: string }[];
  selectedCodes: string[];
  onChangeRegions: (codes: string[]) => void;
  /** Plain-Korean name of the current stream, for the coverage wording. */
  wasteStreamLabel: string;
  /** Focus target for the workflow's first step. */
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export default function FacilityCostRegionCard({
  regionOptions,
  unavailableRegions,
  selectedCodes,
  onChangeRegions,
  wasteStreamLabel,
  headingRef,
}: FacilityCostRegionCardProps) {
  return (
    <SectionCard
      title="① 비용 계산 희망 지역 선택"
      headingId="fc-step-regions"
      headingRef={headingRef}
      description="공식 폐기물 자료가 있는 지역만 선택할 수 있습니다. 선택한 지역의 공식 발생량이 계산의 출발점입니다."
      testId="facility-cost-step-regions"
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
            hint="이름을 입력하거나 아래 버튼으로 광역시·도 전체를 선택할 수 있습니다. 광역시·도 버튼은 이미 선택한 지역에 더해집니다."
            regions={regionOptions}
            selectedCodes={selectedCodes}
            onChange={onChangeRegions}
          />

          {/* Coverage, stated rather than left to be inferred from an absence. */}
          <div className="mt-3 border-t border-hairline pt-3" data-testid="facility-cost-coverage">
            <p className="text-xs text-ink-subtle">
              {wasteStreamLabel} 자료가 있어 계산할 수 있는 지역은 {regionOptions.length}곳입니다.
              {unavailableRegions.length > 0 && (
                <> 자료가 없어 선택할 수 없는 지역은 {unavailableRegions.length}곳입니다.</>
              )}
            </p>
            {unavailableRegions.length > 0 && (
              <details className="mt-1.5" data-testid="facility-cost-unavailable-regions">
                <summary className="cursor-pointer text-xs text-ink-subtle">
                  선택할 수 없는 지역 {unavailableRegions.length}곳 보기
                </summary>
                <p className="mt-1 text-xs text-ink-muted">
                  아래 지역은 {wasteStreamLabel}의 공식 발생량이 제공되지 않아 계산에서 빠집니다.
                  발생량이 0이라는 뜻이 아니며, 지도에서도 옅은 색으로 구분됩니다.
                </p>
                <p className="mt-1 break-words text-xs text-ink-muted">
                  {unavailableRegions.map((r) => r.label).join(" · ")}
                </p>
              </details>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}
