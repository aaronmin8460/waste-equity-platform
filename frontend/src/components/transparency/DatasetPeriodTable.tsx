"use client";

/**
 * 자료별 기준 기간과 표시 개수 — the record counts and reference periods for the
 * datasets this application has actually loaded.
 *
 * The refresh changed three things and no value:
 *
 *   1. The hand-rolled provenance pill became `DataStatusBadge`, with the existing
 *      wording passed as its `label`. The distinction between a figure an agency
 *      reported and one this platform calculated is the whole point of this screen,
 *      and it now carries the same teal/blue semantic the rest of the application
 *      uses instead of a locally-invented tint. The strings 직접 보고값 and
 *      공식 자료 기반 계산값 are unchanged.
 *   2. The header cells gained `scope="col"` and the dataset name became a
 *      `<th scope="row">`, so a screen reader announces each figure with the row and
 *      column it belongs to.
 *   3. The minimum width grew from 560 to 720 px to hold the badge without the
 *      cells crushing. It stays inside its own `overflow-x-auto` container, which is
 *      the only place this page ever scrolls sideways.
 */

import { formatCount } from "../../lib/metrics";
import DataStatusBadge from "../ui/DataStatusBadge";
import { VALUE_KIND_LABELS, type DatasetRow } from "./shared";

export default function DatasetPeriodTable({ rows }: { rows: readonly DatasetRow[] }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">자료별 기준 기간과 표시 개수</caption>
          <thead>
            <tr className="border-b border-hairline text-xs text-ink-subtle">
              <th scope="col" className="py-1 pr-3 font-medium">
                자료
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                출처
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                값 구분
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                자료 기준 시점
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                표시 지역·시설 수
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                범위
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-hairline/60 align-top">
                <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                  {row.name}
                  {row.note ? (
                    <span className="mt-0.5 block text-xs font-normal text-ink-subtle">
                      {row.note}
                    </span>
                  ) : null}
                </th>
                <td className="py-2 pr-3 text-ink-muted">
                  {/* A displayed metric always names its source; a derived one names
                      both inputs. `자료 출처 미표기` is only reachable when the
                      response itself carried no source id — never a guess. */}
                  {row.sources.every((source) => source === null) ? (
                    <span className="text-ink-subtle">자료 출처 미표기</span>
                  ) : (
                    row.sources
                      .filter((source): source is string => source !== null)
                      .map((source) => (
                        <span key={source} className="block">
                          {source}
                        </span>
                      ))
                  )}
                </td>
                <td className="py-2 pr-3">
                  {/* Text carries the meaning; the tint is the supporting signal. */}
                  <DataStatusBadge status={row.valueKind} label={VALUE_KIND_LABELS[row.valueKind]} />
                </td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{row.referencePeriod}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{formatCount(row.count)}</td>
                <td className="py-2 pr-3 text-ink-muted">{row.coverage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">
        값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.
      </p>
    </>
  );
}
