"use client";

/**
 * 지자체별 상세 비교 — the municipal payment comparison, in two responsive forms.
 *
 * ── Why two DOM trees rather than one squeezed table ────────────────────────────
 * The comparison carries four primary fields plus a per-row disclosure. At 1024px+
 * that is a comfortable table; below `md` it is not, and the repository's existing
 * `overflow-x-auto` fallback (`LandfillRegionTable`) is only defensible there
 * because that table has four columns and three rows. This one has up to 66 rows, so
 * a sideways-scrolling grid would make the primary data unusable on a phone.
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
 *   - PARTIAL is distinct from AVAILABLE in three independent ways: a different
 *     badge, a 제한 있음 marker ON the value itself, and the served limitation shown
 *     in the row — and the value is `aria-describedby` the limitation, so the
 *     qualification reaches a screen-reader user at the number rather than a column
 *     away.
 *   - The tier of 기초자치단체 is named per row (서울 자치구 / 인천 군·구 / 경기 시·군)
 *     rather than collapsed into one "시·군·구" label that is only true in aggregate.
 *   - Rows are rendered in the SERVED order. No client-side re-sort: the backend
 *     places nulls last, so re-sorting here would let an unavailable municipality
 *     be ordered as if it were the cheapest.
 */

import { useId } from "react";

import type { MunicipalCostRow } from "../../lib/api";
import {
  formatPayment,
  formatPaymentPerCapita,
  hasDerivedPopulation,
  municipalityScopeCaption,
  primaryLimitation,
  statusBadge,
  statusLabel,
} from "../../lib/municipalCost";
import DataStatusBadge from "../ui/DataStatusBadge";
import SectionCard from "../ui/SectionCard";
import MunicipalCostRowDetail from "./MunicipalCostRowDetail";
import {
  MUNICIPAL_COST_PARTIAL_INLINE_LABEL,
  MUNICIPAL_COST_PER_CAPITA_LABEL,
  MUNICIPAL_COST_TABLE_FOOTNOTES,
  MUNICIPAL_COST_TABLE_TITLE,
  MUNICIPAL_COST_TABLE_UNIT_NOTE,
  MUNICIPAL_COST_TOTAL_LABEL,
  MUNICIPAL_COST_UNAVAILABLE_LABEL,
} from "./municipalCostShared";

export interface MunicipalCostTableProps {
  rows: MunicipalCostRow[];
}

export default function MunicipalCostTable({ rows }: MunicipalCostTableProps) {
  // One id namespace for the whole comparison, so a PARTIAL value can point at its
  // own row's limitation sentence without either form inventing global ids.
  const idPrefix = useId();
  return (
    <SectionCard
      title={MUNICIPAL_COST_TABLE_TITLE}
      headingLevel={3}
      description={MUNICIPAL_COST_TABLE_UNIT_NOTE}
      // Edge-to-edge: the table supplies its own cell padding, and a second layer of
      // card padding around it wastes the width the value columns need.
      flush
      testId="municipal-cost-comparison"
    >
      <div className="hidden md:block">
        <MunicipalCostWideTable rows={rows} idPrefix={idPrefix} />
      </div>
      <div className="p-4 pt-0 md:hidden">
        <MunicipalCostCards rows={rows} idPrefix={`${idPrefix}m`} />
      </div>
      <MunicipalCostTableNotes />
    </SectionCard>
  );
}

/** The reading notes under the comparison. Outside every disclosure, on purpose. */
function MunicipalCostTableNotes() {
  return (
    <ul
      className="flex flex-col gap-1 px-4 pt-3 pb-4 text-xs text-ink-subtle"
      data-testid="municipal-cost-table-notes"
    >
      {MUNICIPAL_COST_TABLE_FOOTNOTES.map((note) => (
        <li key={note}>· {note}</li>
      ))}
    </ul>
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

/**
 * The 제한 있음 marker, stamped on a PARTIAL row's own values.
 *
 * The existing `--color-warn` role, because it qualifies a number that EXISTS — the
 * opposite claim from the neutral gray above. Deliberately quiet TEXT rather than a
 * second `.wep-badge-caveat` pill: the row already carries one amber pill in the
 * 자료 상태 column, and two would be the amber sprawl `components/ui/InfoBanner.tsx`
 * documents rationing away. It is text, so it survives grayscale and a screen reader.
 */
function PartialMarker({ testId }: { testId?: string }) {
  return (
    <span className="ml-1 text-[11px] font-medium text-warn" data-testid={testId}>
      {MUNICIPAL_COST_PARTIAL_INLINE_LABEL}
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

/**
 * 소속 광역자치단체 · 기초자치단체 유형, under the municipality's name.
 *
 * Replaces the former standalone 광역 column: the same fact, in the place a reader
 * looks for it, and with the tier the old column could not carry.
 */
function ScopeCaption({ row }: { row: MunicipalCostRow }) {
  return (
    <span
      className="mt-0.5 block text-[11px] font-normal text-ink-subtle"
      data-testid="municipal-cost-scope-caption"
    >
      {municipalityScopeCaption(row)}
    </span>
  );
}

/** Desktop: a real table with column headers and a row header per municipality. */
function MunicipalCostWideTable({ rows, idPrefix }: { rows: MunicipalCostRow[]; idPrefix: string }) {
  return (
    <div className="overflow-x-auto border-y border-hairline">
      <table className="w-full min-w-[40rem] border-collapse text-sm" data-testid="municipal-cost-table">
        <caption className="sr-only">
          2024년 시·군·구별 생활폐기물 수집·운반 계약 지급액. 값이 없는 지자체는 0이 아니라 자료
          없음으로 표시하며 목록에서 제외하지 않습니다.
        </caption>
        <thead>
          <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              지자체
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
          {rows.map((row, index) => {
            const perCapita = formatPaymentPerCapita(row.payment_per_capita_krw);
            const total = formatPayment(row.total_eligible_payment_krw);
            const limitation = primaryLimitation(row);
            const partial = row.status === "PARTIAL";
            // Only a PARTIAL row's values point at the limitation; an UNAVAILABLE row
            // already says 자료 없음 in the cell itself, and describing "no value" with
            // its reason twice would double the announcement.
            const limitationId = `${idPrefix}-limit-${index}`;
            const describedBy = partial && limitation ? limitationId : undefined;
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
                  <ScopeCaption row={row} />
                  {hasDerivedPopulation(row) && <DerivedPopulationMarker />}
                </th>
                <td
                  className="px-3 py-2 text-right tabular-nums text-ink-muted"
                  aria-describedby={describedBy}
                >
                  {perCapita ?? <UnavailableValue testId="municipal-cost-per-capita-unavailable" />}
                  {partial && perCapita !== null && (
                    <PartialMarker testId="municipal-cost-partial-marker" />
                  )}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-ink-muted"
                  aria-describedby={describedBy}
                >
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
                    <span id={limitationId} data-testid="municipal-cost-row-limitation">
                      {limitation}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                  {/* `w-fit` so the disclosure shrinks to its label instead of
                      stretching across the widest column and doubling every row's
                      height — the comparison has to stay scannable down the value
                      columns. The mobile card keeps it full-width, where it is the
                      only thing on its line. */}
                  <div className="mt-1 w-fit max-w-full">
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
 * field — 지자체, 소속·유형, 상태, 1인당 지급액, 총 지급액, and the essential
 * limitation — with the technical detail behind the same disclosure the table uses.
 * Nothing overflows horizontally.
 */
function MunicipalCostCards({ rows, idPrefix }: { rows: MunicipalCostRow[]; idPrefix: string }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="municipal-cost-cards">
      {rows.map((row, index) => {
        const perCapita = formatPaymentPerCapita(row.payment_per_capita_krw);
        const total = formatPayment(row.total_eligible_payment_krw);
        const limitation = primaryLimitation(row);
        const partial = row.status === "PARTIAL";
        const limitationId = `${idPrefix}-limit-${index}`;
        const describedBy = partial && limitation ? limitationId : undefined;
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
                <ScopeCaption row={row} />
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
                <dd className="mt-0.5 tabular-nums text-ink" aria-describedby={describedBy}>
                  {perCapita ?? (
                    <UnavailableValue testId="municipal-cost-card-per-capita-unavailable" />
                  )}
                  {partial && perCapita !== null && (
                    <PartialMarker testId="municipal-cost-card-partial-marker" />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">{MUNICIPAL_COST_TOTAL_LABEL}</dt>
                <dd className="mt-0.5 tabular-nums text-ink" aria-describedby={describedBy}>
                  {total ?? <UnavailableValue testId="municipal-cost-card-total-unavailable" />}
                </dd>
              </div>
            </dl>
            {limitation && (
              <p
                id={limitationId}
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
