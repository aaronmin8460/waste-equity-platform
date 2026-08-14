"use client";

/**
 * The map column of the Figma frame (129:5709, "Main / Map Area").
 *
 * It is a thin, presentational frame around `FacilityCostRegionMap`: the canvas
 * fills the column, a hint pill floats at the top-left, and the three-state legend
 * sits at the bottom-left. Everything a reader must be able to understand is real
 * DOM outside the (aria-hidden) canvas:
 *
 *   - the LEGEND names all three states in words and takes its swatch colours from
 *     the map module's own constants, so a swatch can never describe a colour the
 *     polygons do not use;
 *   - the NO-DATA FEEDBACK is a polite `role="status"` line. Clicking a region with
 *     no official waste data used to do nothing whatsoever; it now names the region
 *     and says why it cannot be selected, for pointer and screen-reader users
 *     alike. It is polite, never `role="alert"` — declining an impossible selection
 *     is ordinary feedback, not an error event.
 *
 * The keyboard path is not this map: it is the `SearchableRegionPicker` in card ①,
 * which offers only calculable regions and whose coverage line states how many
 * regions are excluded and why. The same meaning therefore reaches a keyboard user
 * without them ever touching the canvas.
 *
 * Nothing here reads a cost, a score, or any per-region value. The map is a
 * selection control (docs/YEOGIDA_UI_REDESIGN_SPEC.md §5).
 */

import type { RegionBoundaryCollection } from "../../lib/api";
import FacilityCostRegionMap, {
  NO_DATA_FILL,
  SELECTED_FILL,
  UNSELECTED_FILL,
} from "./FacilityCostRegionMap";

export const MAP_HINT = "지도에서 지역을 누르면 선택/해제됩니다.";

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="h-4 w-4 flex-none rounded-[5px] border border-hairline"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-ink">{label}</span>
    </li>
  );
}

export interface FacilityCostMapPanelProps {
  boundaries: RegionBoundaryCollection;
  selectedCodes: string[];
  selectableCodes: string[];
  onToggleRegion: (regionCode: string) => void;
  /** Plain-Korean name of the stream, used in the no-data legend row. */
  wasteStreamLabel: string;
  /** The current no-data feedback line, owned by the dashboard. */
  unavailableNotice: string;
  onUnavailableRegion: (regionName: string, regionCode: string) => void;
}

export default function FacilityCostMapPanel({
  boundaries,
  selectedCodes,
  selectableCodes,
  onToggleRegion,
  wasteStreamLabel,
  unavailableNotice,
  onUnavailableRegion,
}: FacilityCostMapPanelProps) {
  return (
    <div
      // Bounded and STICKY at `lg`: the map is a control, so it has to stay with
      // the controls rather than growing to the height of the workflow column
      // beside it — at which point its own legend would sit hundreds of pixels
      // below the fold, which is exactly where it was found in review.
      // Bounded so the panel ENDS at the fold rather than just past it: the
      // offset is the shell header + page heading + orientation strip above it,
      // so its own legend (bottom-left) stays on screen at the 1440×900 desktop
      // target without scrolling.
      className="relative h-[22rem] overflow-hidden rounded-card border border-hairline bg-surface-muted lg:sticky lg:top-4 lg:h-[calc(100vh-10.5rem)] lg:max-h-[47.5rem] lg:min-h-[30rem]"
      data-testid="facility-cost-map-panel"
    >
      <FacilityCostRegionMap
        boundaries={boundaries}
        selectedCodes={selectedCodes}
        selectableCodes={selectableCodes}
        onToggleRegion={onToggleRegion}
        onUnavailableRegion={onUnavailableRegion}
      />

      {/* Floating hint, top-left (Figma "Hint"). Pointer-events off so it can
          never swallow a click meant for the region underneath it. */}
      <p
        className="pointer-events-none absolute left-4 top-4 rounded-control bg-surface/95 px-4 py-2.5 text-sm text-ink-subtle shadow-card"
        data-testid="facility-cost-map-hint"
      >
        {MAP_HINT}
      </p>

      {/* The no-data answer to a click. Always mounted so the live region exists
          before it has anything to say (an inserted live region is not reliably
          announced), and empty until a region actually reports itself. */}
      <p
        className="absolute left-4 right-4 top-16 rounded-control bg-surface/95 px-4 py-2.5 text-sm text-ink shadow-card empty:hidden sm:right-auto sm:max-w-md"
        role="status"
        data-testid="facility-cost-map-unavailable"
      >
        {unavailableNotice}
      </p>

      {/* The three-state legend (Figma "Map Legend Popover"), bottom-left. */}
      <div
        className="absolute bottom-4 left-4 max-w-[calc(100%-2rem)] rounded-card bg-surface p-3.5 shadow-card"
        data-testid="facility-cost-map-legend"
      >
        <h3 className="sr-only">지도 표시 기준</h3>
        <ul className="flex flex-col gap-2.5">
          <LegendRow color={SELECTED_FILL} label="선택한 지역" />
          <LegendRow color={UNSELECTED_FILL} label="선택 안 함" />
          <LegendRow
            color={NO_DATA_FILL}
            label={`${wasteStreamLabel} 자료 없음 (0이 아님 · 계산 제외)`}
          />
        </ul>
      </div>
    </div>
  );
}
