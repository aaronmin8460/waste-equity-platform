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
 * WHAT THIS CARD ADDS: coverage honesty, compactly. The picker offers only the
 * regions calculable for the selected waste stream, which is correct but silent — a
 * reader could not tell whether a region was missing because they mistyped it or
 * because the official statistics do not cover it for this stream. One line states
 * both counts and a disclosure names the excluded regions; the reason, and the
 * "0이 아닙니다" statement, are said once each in 계산 방법과 한계, on the map legend,
 * and in the answer to a click on an uncalculable region — not repeated here.
 * No region is invented and no missing quantity is filled in.
 *
 * CHANGING THE WASTE STREAM NO LONGER CLEARS THE SELECTION. It keeps every code
 * the new stream can still calculate and drops only the ones it cannot, and
 * `droppedRegions` is the compact note naming what went — shown only when
 * something actually went.
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
  /**
   * Regions the last waste-stream change had to drop because the new stream has
   * no official data for them, already named. Empty when nothing was dropped —
   * which, since the change to intersection semantics, is the common case.
   */
  droppedRegions: string[];
}

export default function FacilityCostRegionCard({
  regionOptions,
  unavailableRegions,
  selectedCodes,
  onChangeRegions,
  wasteStreamLabel,
  headingRef,
  droppedRegions,
}: FacilityCostRegionCardProps) {
  return (
    <SectionCard
      title="① 비용 계산 희망 지역 선택"
      headingId="fc-step-regions"
      headingRef={headingRef}
      description="공식 폐기물 자료가 있는 지역만 선택할 수 있습니다."
      testId="facility-cost-step-regions"
      className="wep-figma-card wep-numbered-card"
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
            // No `hint`. The merge behaviour it announced ("광역시·도 버튼은 기존
            // 선택에 더해집니다.") is demonstrated by the controls themselves — the
            // chip list and its count grow on a second 광역시·도 click and the
            // 선택 초기화 button beside them is the way back — so the sentence
            // pre-announced something the reader is shown a moment later. The
            // picker's `aria-describedby` is conditional on `hint`, so dropping it
            // leaves no dangling reference.
            regions={regionOptions}
            selectedCodes={selectedCodes}
            onChange={onChangeRegions}
          />

          {/* A compact note when a stream change had to drop part of the
              selection — the only thing that change is allowed to say, and it
              appears only when something was actually dropped. Polite status:
              a narrowed selection is feedback, not an error. */}
          {droppedRegions.length > 0 && (
            <p
              className="mt-2 text-xs text-warn"
              role="status"
              data-testid="facility-cost-dropped-regions"
            >
              {wasteStreamLabel} 자료가 없는 {droppedRegions.length}곳(
              {droppedRegions.join(", ")})은 선택에서 빠졌습니다.
            </p>
          )}

          {/* Coverage, stated rather than left to be inferred from an absence.
              One line of counts; the names and the reason live in the
              disclosure, and the full explanation in 계산 방법과 한계. */}
          <div className="mt-3 border-t border-hairline pt-3" data-testid="facility-cost-coverage">
            <p className="text-xs text-ink-subtle">
              {wasteStreamLabel} 계산 가능 {regionOptions.length}곳
              {unavailableRegions.length > 0 && <> · 자료 없음 {unavailableRegions.length}곳</>}
            </p>
            {unavailableRegions.length > 0 && (
              <details className="mt-1.5" data-testid="facility-cost-unavailable-regions">
                <summary className="cursor-pointer text-xs text-ink-subtle">
                  자료 없는 지역 보기
                </summary>
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
