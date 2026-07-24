"use client";

/**
 * Inland-wetland inventory (내륙습지 목록) — floating layer control + legend +
 * source disclosure (Phase 1B-2).
 *
 * A SEPARATE, optional environmental layer. This control is pure presentation: it
 * owns no map state, only surfacing the on/off toggle, the per-type filter (which
 * doubles as the categorical legend), the designation-note filter, the source
 * disclosure, and the required statutory-status / UM901-distinction text. It never
 * shows a score, exclusion, or legal determination.
 *
 * Positioned at the map's TOP-LEFT so it never overlaps the score/status legend
 * (bottom-left) or the navigation control (top-right). Collapsed by default so it
 * never covers the map on first load.
 */

import {
  WETLAND_INVENTORY_DISCLAIMER,
  WETLAND_LAYER_LABEL,
  WETLAND_PROVIDER,
  WETLAND_REFERENCE_DATE,
  WETLAND_SOURCE_CRS,
  WETLAND_SOURCE_DATASET,
  WETLAND_STORAGE_CRS,
  WETLAND_TYPES,
  WETLAND_TYPE_COLORS,
  WETLAND_UM901_DISTINCTION,
  type WetlandType,
} from "../lib/wetland";

interface WetlandLayerControlProps {
  /** Whether the wetland layer is currently shown. */
  show: boolean;
  onToggleShow: () => void;
  /** Per-type visibility — the legend rows double as the type filter. */
  typeVisibility: Record<WetlandType, boolean>;
  onToggleType: (type: WetlandType) => void;
  /** Restrict to features carrying a source designation note (EXP). */
  designationOnly: boolean;
  onToggleDesignationOnly: () => void;
}

export default function WetlandLayerControl({
  show,
  onToggleShow,
  typeVisibility,
  onToggleType,
  designationOnly,
  onToggleDesignationOnly,
}: WetlandLayerControlProps) {
  return (
    <details
      className="absolute left-2 top-2 z-10 w-[min(86vw,272px)] rounded-card border border-hairline-strong bg-white/90 text-ink-muted shadow-float backdrop-blur-sm md:left-3 md:top-3"
      data-testid="wetland-layer-control"
    >
      <summary
        className="flex cursor-pointer items-center justify-between gap-2 rounded-card px-3 py-2 text-sm font-semibold text-ink"
        data-testid="wetland-layer-summary"
      >
        <span>{WETLAND_LAYER_LABEL}</span>
        <span aria-hidden className="text-xs text-ink-subtle">
          ▾
        </span>
      </summary>
      <div className="max-h-[52vh] overflow-y-auto px-3 pb-3 text-xs">
        {/* Layer on/off. Default off (the parent owns the state). */}
        <label className="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={show}
            onChange={onToggleShow}
            data-testid="wetland-layer-toggle"
          />
          <span className="font-medium text-ink">지도에 내륙습지 목록 표시</span>
        </label>

        {/* Categorical legend + per-type filter (never a red danger palette). A
            plain group (not a <fieldset>) so it does not join the page's metric
            radio-group structure. */}
        <div
          className="mt-2 border-t border-hairline pt-2"
          role="group"
          aria-label="습지 유형 색상 및 필터"
          data-testid="wetland-type-filters"
        >
          <p className="mb-1 text-[11px] font-medium text-ink-subtle">습지 유형 (색상 · 필터)</p>
          <div className="flex flex-col gap-1">
            {WETLAND_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-ink-muted">
                <input
                  type="checkbox"
                  checked={typeVisibility[type]}
                  onChange={() => onToggleType(type)}
                  disabled={!show}
                  data-testid={`wetland-type-toggle-${type}`}
                />
                <span
                  aria-hidden
                  className="inline-block h-4 w-6 shrink-0 rounded-sm border border-hairline-strong"
                  style={{ backgroundColor: WETLAND_TYPE_COLORS[type] }}
                />
                <span>{type}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="mt-2 flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={designationOnly}
            onChange={onToggleDesignationOnly}
            disabled={!show}
            data-testid="wetland-designation-toggle"
          />
          <span>원자료 지정 메모가 있는 항목만</span>
        </label>

        {/* Statutory-status disclosure — the inventory is NOT a protection area. */}
        <p className="mt-2 border-t border-hairline pt-2 text-[11px] text-ink-subtle" data-testid="wetland-disclaimer">
          {WETLAND_INVENTORY_DISCLAIMER}
        </p>
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="wetland-um901-distinction">
          {WETLAND_UM901_DISTINCTION}
        </p>

        {/* Source disclosure. */}
        <dl className="mt-2 border-t border-hairline pt-2 text-[11px] text-ink-subtle" data-testid="wetland-source-disclosure">
          <div className="flex gap-1">
            <dt className="shrink-0">제공기관</dt>
            <dd>· {WETLAND_PROVIDER}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">자료</dt>
            <dd>· {WETLAND_SOURCE_DATASET}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">기준일</dt>
            <dd>· {WETLAND_REFERENCE_DATE}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">좌표계</dt>
            <dd>
              · 원자료 {WETLAND_SOURCE_CRS} · 저장 {WETLAND_STORAGE_CRS}
            </dd>
          </div>
          <p className="mt-1">법정 보호지역과 별도</p>
        </dl>
      </div>
    </details>
  );
}
