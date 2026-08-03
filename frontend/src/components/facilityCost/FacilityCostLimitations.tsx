"use client";

/**
 * 포함되지 않은 비용 — the cost items this analysis does not include.
 *
 * Every component is stated in plain Korean with a plain reason. The raw backend
 * component/reason codes are NOT discarded — they sit in the diagnostic disclosure
 * at the end, which is also the only place they may appear (redesign plan §9 Phase
 * 3 AC6/AC7). An unavailable component is never described as 0.
 *
 * WHAT THE REFRESH CHANGED: the per-item state was the bare amber word 미포함.
 * Amber means "be careful with a number that exists"; an analytical exclusion is a
 * different state, so each row now carries a `DataStatusBadge status="excluded"`
 * — a text label plus the neutral excluded styling, never colour alone. The list
 * itself, its order, its explanations, its test ids, and the diagnostic disclosure
 * are unchanged.
 *
 * The list stays inside the collapsed disclosure the caller renders; the count and
 * the "this is not zero" sentence stay OUTSIDE it, so the mandatory caveat is
 * readable without expanding anything.
 */

import DataStatusBadge from "../ui/DataStatusBadge";
import type { ExcludedRow } from "./shared";

export default function FacilityCostLimitations({ rows }: { rows: ExcludedRow[] }) {
  const served = rows.filter((r) => r.servedReason !== null);
  return (
    <div data-testid="facility-cost-missing">
      <p className="text-xs text-ink-subtle">
        아래 항목은 이 계산에 포함되지 않았습니다. 자료가 없어 계산하지 못한 것이며, 비용이 0이라는 뜻이
        아닙니다.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="text-sm" data-testid="facility-cost-missing-row">
            <span className="font-medium text-ink">{row.label}</span>{" "}
            <DataStatusBadge status="excluded" label="미포함" reason={row.explanation} />
            <span className="mt-0.5 block text-xs text-ink-muted">{row.explanation}</span>
          </li>
        ))}
      </ul>
      {served.length > 0 && (
        <details className="mt-3" data-diagnostic="true" data-testid="facility-cost-missing-diagnostic">
          <summary className="cursor-pointer text-xs text-ink-subtle">
            서버가 보낸 항목 코드 자세히 보기
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 break-words text-xs text-ink-subtle">
            {served.map((row) => (
              <li key={row.code}>
                {row.code}: {row.servedReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
