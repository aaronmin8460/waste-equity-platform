"use client";

/**
 * 지자체별 비교 — the municipal payment comparison, in two responsive forms.
 *
 * ── Why two DOM trees rather than one squeezed table ────────────────────────────
 * The comparison carries five primary fields plus a per-row disclosure. At 1024px+
 * that is a comfortable table; below `md` it is not, and the repository's existing
 * `overflow-x-auto` fallback (`LandfillRegionTable`) is only defensible there
 * because that table has four columns and three rows. This one has 66 rows, so a
 * sideways-scrolling grid would make the primary data unusable on a phone.
 *
 * So the desktop table is `hidden md:block` and the mobile card list is `md:hidden`.
 * Tailwind's `hidden` is `display: none`, which removes a subtree from the
 * accessibility tree entirely — so exactly ONE of the two is ever exposed to a
 * screen reader at a given width, and the content is not announced twice. (An
 * `aria-hidden` toggle would be the wrong tool: it cannot follow a media query.)
 * Both forms disclose the same fields and share `MunicipalCostRowDetail`, so they
 * cannot drift apart.
 *
 * ── Rules both forms carry ─────────────────────────────────────────────────────
 *   - An UNAVAILABLE municipality is NEVER dropped from the list and NEVER shows
 *     ₩0. It keeps its place, shows 자료 없음, and states the served reason.
 *   - Status is carried by a TEXT badge, so it survives grayscale, a colour
 *     deficiency, and a screen reader; colour is only the supporting signal.
 *   - PARTIAL is visually and textually distinct from AVAILABLE, and its served
 *     limitation is shown in the row itself rather than only inside the disclosure.
 *   - Rows are rendered in the SERVED order. No client-side re-sort: the backend
 *     places nulls last, so re-sorting here would let an unavailable municipality
 *     be ordered as if it were the cheapest.
 */

import type { MunicipalCostRow } from "../../lib/api";
import {
  formatPayment,
  formatPaymentPerCapita,
  hasDerivedPopulation,
  primaryLimitation,
  statusBadge,
  statusLabel,
} from "../../lib/municipalCost";
import DataStatusBadge from "../ui/DataStatusBadge";
import MunicipalCostRowDetail from "./MunicipalCostRowDetail";
import {
  MUNICIPAL_COST_PER_CAPITA_LABEL,
  MUNICIPAL_COST_TOTAL_LABEL,
  MUNICIPAL_COST_UNAVAILABLE_LABEL,
} from "./municipalCostShared";

export interface MunicipalCostTableProps {
  rows: MunicipalCostRow[];
}

export default function MunicipalCostTable({ rows }: MunicipalCostTableProps) {
  return (
    <>
      <div className="hidden md:block">
        <MunicipalCostWideTable rows={rows} />
      </div>
      <div className="md:hidden">
        <MunicipalCostCards rows={rows} />
      </div>
    </>
  );
}

/** The unavailable marker. A shared component so the two forms word it identically. */
function UnavailableValue({ testId }: { testId?: string }) {
  return (
    // Neutral gray, not amber: amber cautions about a value that EXISTS, and absence
    // is a different state (docs/ui-refresh/design-tokens.md §"Missing data"). The
    // state is carried by the text, never by the colour.
    <span className="text-ink-subtle" data-testid={testId}>
      {MUNICIPAL_COST_UNAVAILABLE_LABEL}
    </span>
  );
}

/** The 인구 합산 marker for the seven derived Gyeonggi cities. */
function DerivedPopulationMarker() {
  return (
    <span
      className="mt-0.5 block text-[11px] font-normal text-ink-subtle"
      data-testid="municipal-cost-derived-marker"
    >
      인구: 구성 일반구 인구 합산
    </span>
  );
}

/** Desktop: a real table with column headers and a row header per municipality. */
function MunicipalCostWideTable({ rows }: { rows: MunicipalCostRow[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-hairline">
      <table className="w-full min-w-[44rem] border-collapse text-sm" data-testid="municipal-cost-table">
        <caption className="sr-only">
          2024년 시·군·구별 생활폐기물 수집·운반 계약 지급액. 값이 없는 지자체는 0이 아니라 자료
          없음으로 표시하며 목록에서 제외하지 않습니다.
        </caption>
        <thead>
          <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              지자체
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              광역
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {MUNICIPAL_COST_PER_CAPITA_LABEL}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {MUNICIPAL_COST_TOTAL_LABEL}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              자료 상태
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              데이터 참고
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const perCapita = formatPaymentPerCapita(row.payment_per_capita_krw);
            const total = formatPayment(row.total_eligible_payment_krw);
            const limitation = primaryLimitation(row);
            return (
              <tr
                key={row.municipality_key}
                className="border-b border-hairline align-top last:border-0"
                data-testid="municipal-cost-row"
                data-municipality={row.display_name}
                data-status={row.status}
              >
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                  {row.display_name}
                  {hasDerivedPopulation(row) && <DerivedPopulationMarker />}
                </th>
                <td className="px-3 py-2 text-ink-muted">{row.metropolitan_name}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {perCapita ?? <UnavailableValue testId="municipal-cost-per-capita-unavailable" />}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {total ?? <UnavailableValue testId="municipal-cost-total-unavailable" />}
                </td>
                <td className="px-3 py-2">
                  <DataStatusBadge
                    status={statusBadge(row.status)}
                    label={statusLabel(row.status)}
                    testId="municipal-cost-status-badge"
                  />
                </td>
                <td className="px-3 py-2 text-xs text-ink-subtle">
                  {/* The determining limitation is shown in the row itself, not only
                      inside the disclosure: a PARTIAL value that looks like an
                      ordinary number until someone expands a details element is a
                      value presented without its qualifier. */}
                  {limitation ? (
                    <span data-testid="municipal-cost-row-limitation">{limitation}</span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                  <div className="mt-1">
                    <MunicipalCostRowDetail row={row} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mobile: one card per municipality.
 *
 * A `<ul>` of cards rather than a scrolling table. It preserves every primary
 * field — 지자체, 상태, 1인당 지급액, 총 지급액, and the essential limitation — with
 * the technical detail behind the same disclosure the table uses. Nothing overflows
 * horizontally.
 */
function MunicipalCostCards({ rows }: { rows: MunicipalCostRow[] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="municipal-cost-cards">
      {rows.map((row) => {
        const perCapita = formatPaymentPerCapita(row.payment_per_capita_krw);
        const total = formatPayment(row.total_eligible_payment_krw);
        const limitation = primaryLimitation(row);
        return (
          <li
            key={row.municipality_key}
            className="wep-card"
            data-testid="municipal-cost-card"
            data-municipality={row.display_name}
            data-status={row.status}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold text-ink">
                {row.display_name}
                <span className="ml-1 text-xs font-normal text-ink-subtle">
                  {row.metropolitan_name}
                </span>
                {hasDerivedPopulation(row) && <DerivedPopulationMarker />}
              </p>
              <span className="flex-none">
                <DataStatusBadge
                  status={statusBadge(row.status)}
                  label={statusLabel(row.status)}
                  testId="municipal-cost-card-status-badge"
                />
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-ink-subtle">{MUNICIPAL_COST_PER_CAPITA_LABEL}</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {perCapita ?? (
                    <UnavailableValue testId="municipal-cost-card-per-capita-unavailable" />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">{MUNICIPAL_COST_TOTAL_LABEL}</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {total ?? <UnavailableValue testId="municipal-cost-card-total-unavailable" />}
                </dd>
              </div>
            </dl>
            {limitation && (
              <p
                className="mt-2 text-xs text-ink-subtle"
                data-testid="municipal-cost-card-limitation"
              >
                {limitation}
              </p>
            )}
            <div className="mt-2">
              <MunicipalCostRowDetail row={row} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
