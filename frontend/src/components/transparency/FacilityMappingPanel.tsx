"use client";

/**
 * 시설 지도 표시 현황 — the facility-mapping panel and the only `role="alert"` on
 * this screen.
 *
 * FOUR OUTCOMES, KEPT APART:
 *
 *   - **request in flight** — a `role="status"` sentence plus an `aria-hidden`
 *     skeleton. The skeleton renders no digits and no names, so it can never be
 *     mistaken for data, and it is never the announcement.
 *   - **counts served** — four `KpiCard`s. A served `0` (e.g. `without_address: 0`)
 *     is an OFFICIAL MEASUREMENT and renders as `0`; it is never converted into a
 *     missing badge. That is why no card on this row carries one.
 *   - **the list is empty** — an `EmptyState`, with no zeros and no `role`.
 *   - **the request failed** — `InfoBanner tone="error"` + `role="alert"`, the raw
 *     backend code demoted to a `[data-diagnostic]` line, no stale rows, no stale
 *     counts, and the pager still operable so a reader who failed while paging can
 *     go back instead of being stranded.
 *
 * The panel holds no state: the page owns `page`, the request, and the last served
 * total, and hands the already-classified result down.
 */

import type { FacilityMappingTransparency } from "../../lib/api";
import { FACILITY_CATEGORY_LABELS, formatCount } from "../../lib/metrics";
import Accordion from "../ui/Accordion";
import EmptyState from "../ui/EmptyState";
import InfoBanner from "../ui/InfoBanner";
import KpiCard from "../ui/KpiCard";
import Skeleton from "../ui/Skeleton";
import UnmappedFacilityTable from "./UnmappedFacilityTable";
import UnmappedPagination from "./UnmappedPagination";
import { labelFor, UNMAPPED_PAGE_SIZE } from "./shared";

export interface FacilityMappingPanelProps {
  mapping: FacilityMappingTransparency | null;
  error: { message: string; detail: string } | null;
  page: number;
  onPageChange: (page: number) => void;
  /** The last served `unmapped.total`, kept across a failed page request. */
  knownUnmappedTotal: number | null;
}

export default function FacilityMappingPanel({
  mapping,
  error,
  page,
  onPageChange,
  knownUnmappedTotal,
}: FacilityMappingPanelProps) {
  const totalPages =
    knownUnmappedTotal !== null
      ? Math.max(1, Math.ceil(knownUnmappedTotal / UNMAPPED_PAGE_SIZE))
      : 1;
  const showPager = knownUnmappedTotal !== null && knownUnmappedTotal > UNMAPPED_PAGE_SIZE;
  /**
   * Whether the rows in hand actually describe the page that is currently selected.
   *
   * `page` changes synchronously on click while the refetch is still in flight, so
   * without this gate the previous page's facilities render under the new page's
   * label — the same "stale outcome under a changed request" defect the landfill
   * milestone fixed by keying its result to its filters. The served `unmapped.page`
   * is the authority, so the label and the rows can never disagree.
   */
  const rowsAreCurrent = mapping !== null && mapping.unmapped.page === page;

  if (error) {
    // A genuine request failure the reader can retry — the only alert here.
    return (
      <InfoBanner
        tone="error"
        role="alert"
        title="자료를 불러오지 못했습니다"
        testId="transparency-mapping-error"
      >
        <p className="font-medium text-ink">{error.message}</p>
        <p className="mt-1 text-xs">
          불러오지 못한 값은 표시하지 않습니다. 0으로 채우거나 이전 값을 그대로 두지 않습니다.
        </p>
        {error.detail && (
          <p
            className="mt-1 text-xs text-ink-subtle"
            data-diagnostic
            data-testid="transparency-mapping-error-detail"
          >
            기술 정보: {error.detail}
          </p>
        )}
        {/* The reader may have failed while paging. Keeping the controls operable
            lets them go back instead of being stranded on a page whose contents
            will never load. */}
        {showPager && (
          <UnmappedPagination
            page={page}
            totalPages={totalPages}
            total={knownUnmappedTotal}
            onChange={onPageChange}
          />
        )}
      </InfoBanner>
    );
  }

  if (!mapping) {
    return (
      <>
        {/* The announcement and the decorative placeholder are separate: the
            Skeleton is aria-hidden, this line is the only thing AT reads. */}
        <p className="text-sm text-ink-muted" data-testid="transparency-mapping-loading" role="status">
          시설 지도 표시 현황을 불러오는 중입니다.
        </p>
        <div
          aria-hidden
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="transparency-mapping-skeleton"
        >
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="wep-card">
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="facility-mapping-counts">
        <KpiCard label="전체 시설" value={formatCount(mapping.total)} />
        <KpiCard label="지도 표시" value={formatCount(mapping.with_map_location)} />
        <KpiCard label="지도 위치 없음" value={formatCount(mapping.without_map_location)} />
        {/* A served 0 here is a counted, official measurement — it stays a 0. */}
        <KpiCard label="주소 없음" value={formatCount(mapping.without_address)} />
      </dl>
      <p className="mt-2 text-xs text-ink-subtle">{mapping.disclaimer}</p>

      <div className="mt-3 flex flex-col gap-3">
        <Accordion label="시설 종류별 지도 표시 현황" testId="transparency-mapping-category">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <caption className="sr-only">시설 종류별 지도 표시 현황</caption>
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-subtle">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    종류
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    전체
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    지도 표시
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    위치 없음
                  </th>
                </tr>
              </thead>
              <tbody>
                {mapping.category_breakdown.map((row) => (
                  <tr key={row.category} className="border-b border-hairline/60">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-muted">
                      {labelFor(FACILITY_CATEGORY_LABELS, row.category)}
                    </th>
                    <td className="py-1 pr-3 tabular-nums">{formatCount(row.total)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatCount(row.with_map_location)}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      {formatCount(row.without_map_location)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>

        <div>
          <h3 className="mb-1 text-sm font-semibold text-ink">지도에 표시하지 못한 시설</h3>
          {!rowsAreCurrent ? (
            // The rows in hand describe a DIFFERENT page than the one now selected.
            // Rendering them under the new page's label would misattribute
            // facilities to a page they are not on, so nothing is shown until the
            // matching response arrives.
            <p
              className="text-sm text-ink-muted"
              role="status"
              data-testid="transparency-unmapped-paging"
            >
              선택한 페이지를 불러오는 중입니다.
            </p>
          ) : mapping.unmapped.items.length === 0 ? (
            <EmptyState
              testId="transparency-unmapped-empty"
              title="지도에 표시하지 못한 시설이 없습니다."
              description="현재 기준으로 모든 시설의 지도 위치를 확인했습니다."
            />
          ) : (
            <UnmappedFacilityTable items={mapping.unmapped.items} />
          )}

          {showPager && (
            <UnmappedPagination
              page={page}
              totalPages={totalPages}
              total={knownUnmappedTotal}
              onChange={onPageChange}
            />
          )}
        </div>
      </div>
    </>
  );
}
