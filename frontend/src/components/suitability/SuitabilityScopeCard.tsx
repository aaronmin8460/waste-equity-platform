"use client";

/**
 * ① 분석 범위 — the first card of the Page-4 Figma hierarchy (136:8684).
 *
 * ── WHY IT IS NOT A REGION PICKER ────────────────────────────────────────────────
 * The Figma frame opens with a 지역 선택 card: a search box, 서울 / 인천 / 경기
 * buttons, and removable 시·군·구 chips ("부평구 ×", "선택한 지역 4개"). This screen
 * cannot do that yet. The stored run scores the WHOLE capital region in one pass and
 * `/suitability/summary` serves one set of totals for it; narrowing the ranking and
 * the summary to a chosen set of 시·군·구 needs the scope/sort API work scheduled for
 * Page 4B. Rendering the picker now would be a control that either does nothing or
 * silently filters only the list while the map, the counts, and the A/B/C population
 * kept describing the whole region.
 *
 * So this card occupies the ① slot in the Figma hierarchy and states, from served
 * data only, what the analysis actually covers: the 시·도 breakdown the summary
 * already carries (`sido_distribution`), and an explicit sentence that this view
 * cannot yet be narrowed. An absent breakdown says so rather than inventing rows —
 * and it never prints a status count the run did not serve.
 */

import type { SuitabilityStatus, SuitabilitySummary } from "../../lib/api";
import { statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import SectionCard from "../ui/SectionCard";
import { STATUS_ORDER } from "./shared";

/** The backend's fallback key for a candidate with no 시·도 name attached. */
const UNKNOWN_SIDO_KEY = "UNKNOWN";
const UNKNOWN_SIDO_LABEL = "(시·도 미배정)";

export interface SuitabilityScopeCardProps {
  summary: SuitabilitySummary;
}

export default function SuitabilityScopeCard({ summary }: SuitabilityScopeCardProps) {
  // The served breakdown, in the summary's own key order. Only the (시·도, 상태)
  // pairs the run actually counted appear: a pair the query returned no row for is
  // omitted, never rendered as a 0 this component invented.
  const rows = Object.entries(summary.sido_distribution ?? {}).map(([sido, counts]) => ({
    sido,
    label: sido === UNKNOWN_SIDO_KEY ? UNKNOWN_SIDO_LABEL : sido,
    served: STATUS_ORDER.filter((status) => counts[status] != null).map((status) => ({
      status: status as SuitabilityStatus,
      count: counts[status] as number,
    })),
  }));

  return (
    <SectionCard title="① 분석 범위" testId="suitability-scope" className="wep-figma-card">
      {/* COMPACT BY CONTRACT. The controls column must still show the active
          scoring basis without scrolling at the 1024×768 minimum
          (e2e/suitabilityDashboard.spec.ts), so the card leads with the scope in
          one line and one sentence, and the per-시·도 counts sit in a disclosure
          rather than a five-row block that would push card ② below the fold. */}
      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink-muted" data-testid="suitability-scope-empty">
          이 분석 실행은 시·도별 후보 구역 분포를 제공하지 않았습니다. 분포를 알 수 없으므로 지역별
          내역을 표시하지 않습니다.
        </p>
      ) : (
        <p className="text-xs leading-snug text-ink" data-testid="suitability-scope-summary">
          <span className="font-medium">{rows.map((row) => row.label).join(" · ")}</span>
          <span className="text-ink-muted">
            {" "}
            · 후보 구역 {formatCount(summary.candidate_count_total)}개
          </span>
        </p>
      )}

      {/* The honest limitation, stated where a reader would otherwise look for the
          Figma picker. This is a statement about THIS view, not a promise. */}
      <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="suitability-scope-note">
        아직 시·군·구를 직접 골라 범위를 좁힐 수 없으며, 아래 결과는 모두 이 범위 전체 기준입니다.
      </p>

      {rows.length > 0 && (
        <details className="mt-1" data-testid="suitability-scope-detail">
          <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
            시·도별 후보 구역 수 보기
          </summary>
          <dl className="mt-1 flex flex-col gap-1" data-testid="suitability-scope-rows">
            {rows.map((row) => (
              // Stacked, not a single row: the three Korean status names plus their
              // counts do not fit beside a 시·도 name at this column width, and a
              // truncated count is a number a reader cannot check.
              <div
                key={row.sido}
                className="rounded-card border border-hairline bg-surface-muted px-2 py-1.5"
                data-testid="suitability-scope-row"
              >
                <dt className="truncate text-xs font-medium text-ink">{row.label}</dt>
                <dd className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-ink-muted">
                  {row.served.map((entry) => (
                    <span key={entry.status} className="whitespace-nowrap">
                      {statusLabel(entry.status)} {formatCount(entry.count)}개
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </SectionCard>
  );
}
