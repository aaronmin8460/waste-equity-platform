"use client";

/**
 * The facilities whose address could not be resolved to a map coordinate.
 *
 * These records are published as-is, in full: a facility with no usable coordinate
 * is still a facility, it is still counted in every aggregate on this platform, and
 * it is never dropped from this list to make the table tidier.
 *
 * The reason column shows ONLY the recorded `missing_location_reason`. When the
 * ingestion recorded none, the cell says 실패 사유 기록 없음 — never a plausible
 * reason inferred from the other columns.
 *
 * Table semantics: an accessible `<caption>`, `scope="col"` on every header, and the
 * facility name as the row header, so a screen reader announces each cell with the
 * facility it belongs to. The wrapper owns the horizontal scroll, so a wide table
 * never widens the page.
 */

import type { FacilityMappingTransparency } from "../../lib/api";
import { FACILITY_CATEGORY_LABELS } from "../../lib/metrics";
import { labelFor, OWNERSHIP_LABELS, REGION_MAPPING_LABELS } from "./shared";

export default function UnmappedFacilityTable({
  items,
}: {
  items: FacilityMappingTransparency["unmapped"]["items"];
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[680px] text-left text-sm"
        data-testid="unmapped-facility-table"
      >
        <caption className="sr-only">지도에 표시하지 못한 시설 목록</caption>
        <thead>
          <tr className="border-b border-hairline text-xs text-ink-subtle">
            <th scope="col" className="py-1 pr-3 font-medium">
              시설명
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              종류
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              지역
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              지역 배정
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              위치 없는 이유
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((facility) => (
            <tr key={facility.id} className="border-b border-hairline/60">
              <th scope="row" className="py-1 pr-3 text-left font-medium text-ink">
                {facility.facility_name}
              </th>
              <td className="py-1 pr-3 text-ink-muted">
                {labelFor(FACILITY_CATEGORY_LABELS, facility.facility_category)}
                {" · "}
                {labelFor(OWNERSHIP_LABELS, facility.ownership)}
              </td>
              <td className="py-1 pr-3 text-ink-muted">
                {facility.rcis_sido_name} {facility.rcis_sigungu_name}
              </td>
              <td className="py-1 pr-3 text-ink-muted">
                {labelFor(REGION_MAPPING_LABELS, facility.region_mapping_status)}
              </td>
              <td className="py-1 pr-3 text-ink-muted">
                {/* Only ever the RECORDED reason; never a fabricated one. */}
                {facility.missing_location_reason ?? (
                  <span className="text-ink-subtle">실패 사유 기록 없음</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
