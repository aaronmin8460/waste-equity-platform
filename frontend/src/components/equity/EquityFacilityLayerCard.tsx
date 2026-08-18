"use client";

/**
 * 폐기물 처리시설 — the facility layer's control and its type legend, floating over
 * the map.
 *
 * ── WHY IT MOVED (Figma frame 222:439, page-1 기술요청) ───────────────────────────
 * The toggle used to live at the bottom of the sidebar inside a 시설 위치 표시
 * disclosure, three scroll-lengths below the markers it governs. The annotation asks
 * for "폐기물 처리시설 버튼 위치 수정 및 신규 아이콘 삽입", and the frame puts the
 * control on the map, under the choropleth legend, with a legend of its own. A layer
 * control belongs beside the layer.
 *
 * ── THE TYPE LEGEND IS THE POINT ─────────────────────────────────────────────────
 * The Chrome audit found the markers were colour-coded with nothing anywhere saying
 * what the colours meant. This card is that explanation, and it is built from the
 * SAME two constants the MapLibre circle layer paints from — `FACILITY_CATEGORY_*`
 * in lib/metrics.ts — so a swatch here cannot drift from the dot on the map. No
 * category is invented: the list is exactly the served `facility_category` values the
 * platform recognises.
 *
 * ── THE OWNERSHIP COLOUR SCHEME (page-1 기술요청, icon sheet 314:592) ─────────────
 * The annotation asks for these icons to be redrawn like its own rendered sheet, and
 * tells the implementer how to read it: "아이콘 더블 클릭하면 컬러 넘버 확인 가능". The
 * sheet paints all 공공 rows `#5EB140` and all 민간 rows `#C64670`. That is now what
 * `FACILITY_CATEGORY_COLORS` holds, so this legend, the MapLibre circle fill and the
 * marker glyph images all changed together — the swatch here is still a faithful
 * miniature of the mark on the map, which is the whole point of this card.
 *
 * One deliberate departure from the sheet remains, and it is a coverage one, not a
 * style one: the sheet lists FIVE rows because the prototype knew five categories.
 * Production serves SIX — 민간 최종처분 is real and is drawn on the map — so all six
 * are listed. Omitting it would hide facilities the reader can see.
 *
 * The swatch carries its category's Korean initial from `FACILITY_CATEGORY_GLYPHS`,
 * as the map's markers do. That glyph now does more work than it used to: with the
 * three 공공 categories sharing one colour and the three 민간 categories the other,
 * it is what separates two rows of the same ownership. The annotation anticipates
 * exactly this — "아이콘 내부 글씨 크기는 지도 축소했을 때에도 보일정도로" — so the
 * six glyphs stay six distinct characters and the badge is sized to keep them legible.
 *
 * ── INK IS CHOSEN FOR CONTRAST, NOT COPIED FROM THE SHEET ────────────────────────
 * The sheet draws every glyph white. White on `#C64670` clears 4.5:1 and is used;
 * white on `#5EB140` measures 2.7:1 and would fail, so `markerGlyphInk` picks the
 * near-black that measures 7.8:1 there instead. The annotation's own instruction is
 * that the glyph must stay READABLE, and a glyph that now carries category identity
 * cannot be the one thing on the card that fails contrast.
 *
 * The superseded six-colour scheme is recorded in
 * docs/figma-redesign/PAGE_1_REGIONAL_INDICATORS.md.
 *
 * The swatch stays a faithful miniature of the mark: same colour, same glyph, and
 * the same luminance-chosen ink (`markerGlyphInk`), so a reader matching a dot on
 * the map to a row in this list is comparing like with like.
 *
 * Colour is never the only signal: every row's category NAME is beside its swatch,
 * and the popup a marker opens names its category in words too.
 *
 * The served coverage note (how many facilities have official coordinates, and the
 * source/frequency/accounting basis behind them) stays — it is the disclosure that
 * stops the map from reading as "every facility in the capital region". It sits in a
 * closed `<details>` so the card keeps the design's height while the numbers remain
 * one interaction away.
 *
 * `.wep-map-overlay-card` bounds the card's height and scrolls it internally, on the
 * same height query the floating legend beside it already uses — the two share the
 * map's bottom band and would otherwise compete for it at a 768/800-tall viewport.
 */

import { accountingBasisLabel } from "../../lib/glossary";
import {
  FACILITY_CATEGORY_COLORS,
  FACILITY_CATEGORY_GLYPHS,
  FACILITY_CATEGORY_LABELS,
  formatCount,
  markerGlyphInk,
} from "../../lib/metrics";

export interface FacilityCoverage {
  total: number;
  withCoordinates: number;
  withoutCoordinates: number;
  referencePeriod: string;
  frequency: string;
  accountingBasis: string | null;
}

export interface EquityFacilityLayerCardProps {
  show: boolean;
  onToggleShow: (show: boolean) => void;
  /** Served facility coverage. `null` before the dataset resolves — never faked. */
  coverage: FacilityCoverage | null;
}

/**
 * The categories, in the order the design lists them: public facilities first, then
 * private. Keys only — every label and colour is read from lib/metrics.ts.
 */
const CATEGORY_ORDER: readonly string[] = [
  "PUBLIC_INCINERATION",
  "PUBLIC_LANDFILL",
  "PUBLIC_OTHER",
  "PRIVATE_INTERMEDIATE_INCINERATION",
  "PRIVATE_FINAL_DISPOSAL",
  "PRIVATE_RECYCLING",
];

export default function EquityFacilityLayerCard({
  show,
  onToggleShow,
  coverage,
}: EquityFacilityLayerCardProps) {
  return (
    <section
      aria-label="시설 레이어"
      className="wep-map-overlay-card w-[min(86vw,265px)] rounded-card bg-surface/95 p-4 shadow-float backdrop-blur-sm"
      data-testid="facility-layer-card"
    >
      <h2 className="text-base font-bold leading-[19px] text-brand">폐기물 처리시설</h2>

      <label className="mt-2.5 flex items-center gap-3 text-[13px] text-ink">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-[var(--color-brand)]"
          checked={show}
          onChange={(event) => onToggleShow(event.target.checked)}
          data-testid="facilities-toggle"
        />
        지도에 시설 위치 표시
      </label>

      <hr className="mt-2.5 border-t-[1.5px] border-[var(--figma-rule)]" />

      <h3 className="mt-2.5 text-base font-bold leading-[19px] text-brand">시설 유형 범례</h3>
      <ul className="mt-2.5 flex flex-col gap-2" data-testid="facility-type-legend">
        {CATEGORY_ORDER.map((category) => (
          <li
            key={category}
            className="flex items-center gap-2 text-[13px] text-ink"
            data-testid="facility-type-legend-row"
          >
            {/* Decorative: the category name beside it is the row's text, so the
                glyph is never the only way to read the row. */}
            <span
              aria-hidden
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-surface text-[10px] font-bold leading-none"
              style={{
                backgroundColor: FACILITY_CATEGORY_COLORS[category],
                color: markerGlyphInk(FACILITY_CATEGORY_COLORS[category]),
              }}
            >
              {FACILITY_CATEGORY_GLYPHS[category]}
            </span>
            <span className="min-w-0">{FACILITY_CATEGORY_LABELS[category]}</span>
          </li>
        ))}
      </ul>

      {coverage && (
        <details className="mt-2.5 border-t border-[var(--figma-rule)] pt-2.5">
          <summary
            className="cursor-pointer text-[11px] font-medium text-ink-muted"
            data-testid="facility-metadata-summary"
          >
            표시 범위와 출처
          </summary>
          <div className="mt-1.5 text-[11px] leading-snug text-ink-subtle" data-testid="facility-metadata">
            <p>
              좌표 보유 시설 {formatCount(coverage.withCoordinates)} /{" "}
              {formatCount(coverage.total)}개 표시.{" "}
              <strong>{formatCount(coverage.withoutCoordinates)}개</strong>는 공식 지오코딩이
              실패하여 지도에 표시하지 않습니다.
            </p>
            <p className="mt-1">
              출처: waste_statistics · 기준 기간: {coverage.referencePeriod} · 갱신 주기:{" "}
              {coverage.frequency}
            </p>
            <p className="mt-1">집계 기준: {accountingBasisLabel(coverage.accountingBasis ?? undefined)}</p>
          </div>
        </details>
      )}
    </section>
  );
}
