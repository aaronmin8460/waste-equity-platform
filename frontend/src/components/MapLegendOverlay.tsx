"use client";

/**
 * Floating map legend (Phase 2/3 UX cleanup).
 *
 * Renders the equity choropleth legend and the suitability status/score legend as
 * a single floating control over the map, rather than in the long sidebar. It is a
 * PURE PRESENTATION component: it never computes color classes, breaks, thresholds,
 * or the no-data color itself — every value (palette colors, class ranges, unit,
 * status colors, status visibility) is passed in from the page, which derives them
 * from the SAME `activeScale`/candidate constants the MapLibre fill uses (see
 * page.tsx and MapView.tsx). This guarantees the map colors and the legend can
 * never silently diverge.
 *
 * Responsive behaviour is a native <details> disclosure:
 *  - mobile: collapsed by default behind a labelled "범례" summary, so it never
 *    covers most of the map; the body scrolls internally when long;
 *  - md+ (tablet-landscape/desktop): the summary is hidden and the body is forced
 *    open by CSS (see `.map-legend` in globals.css), so the legend reads as an
 *    always-expanded floating card. No sidebar-specific disclosure behaviour is
 *    reproduced.
 *
 * The suitability status checkboxes here drive the page's CANONICAL `statusVisibility`
 * state (via `onToggleStatus`), the same state MapView filters its candidate layer
 * on — there is no duplicate local visibility state.
 */

import type { SuitabilityStatus } from "../lib/api";
import type { StatusVisibility } from "./MapView";

export type MapLegendMode = "equity" | "suitability";

/** One equity choropleth class row: swatch color, its numeric range, its class number. */
export interface EquityLegendRow {
  color: string;
  range: string;
  classNumber: number;
}

/** One suitability eligible-score class: swatch color and its score range label. */
export interface SuitabilityScoreClass {
  color: string;
  range: string;
}

interface EquityLegendProps {
  mode: "equity";
  /** Active metric label (e.g. "인구 (Population)"). */
  metricLabel: string;
  /** Metric unit (may be ""). */
  unit: string;
  /** Human note describing the classification method (from scaleMethodNote). */
  methodNote: string;
  /** Pre-computed class rows (from the page's active scale — never recomputed here). */
  rows: EquityLegendRow[];
  /** The explicit no-data color the map fill uses for regions with no served value. */
  noDataColor: string;
}

interface SuitabilityLegendProps {
  mode: "suitability";
  /** Pre-computed eligible score classes (from CANDIDATE_SCORE_PALETTE_5 + breaks). */
  scoreClasses: SuitabilityScoreClass[];
  /** Representative eligible swatch color for the ELIGIBLE checkbox. */
  eligibleColor: string;
  /** REVIEW_REQUIRED status color (amber). */
  reviewColor: string;
  /** EXCLUDED status color (muted gray). */
  excludedColor: string;
  /** Canonical page state — which statuses are visible on the candidate layer. */
  statusVisibility: StatusVisibility;
  /** Flip one status' visibility in the canonical page state. */
  onToggleStatus: (status: SuitabilityStatus) => void;
  /** Bilingual labels for each status. */
  statusLabels: Record<SuitabilityStatus, string>;
  /**
   * Whether the selected run carries CRITIC/stability results. When false, the
   * stability control + outline legend are hidden (an old run has no stable data).
   */
  stabilityAvailable: boolean;
  /** Stable-only display state (independent of statusVisibility). */
  stableOnly: boolean;
  /** Flip the stable-only restriction. */
  onToggleStableOnly: () => void;
  /** Outline color for STABLE eligible cells (matches the map's stable outline). */
  stableOutlineColor: string;
  /** Concise analytical-screening disclaimer. */
  disclaimer: string;
  /**
   * When true, the candidate tiles are a user-weight scenario (사용자 가정 기반 점수):
   * the legend heads the score classes with the applied Z/R/E/D weights + a scenario
   * disclaimer, and clarifies that stability is the STORED run's, not the scenario's.
   */
  scenarioActive?: boolean;
  /** Applied scenario weights as canonical strings (shown when scenarioActive). */
  scenarioWeights?: { zoning: string; road: string; equity: string; demand: string } | null;
}

export type MapLegendOverlayProps = EquityLegendProps | SuitabilityLegendProps;

export default function MapLegendOverlay(props: MapLegendOverlayProps) {
  return (
    // A floating card at the lower-left of the map. Absolute within the relative
    // `.map-pane` wrapper (page.tsx), above the map canvas (z-10) but clear of the
    // top-right navigation control and the bottom-right OSM attribution. Only this
    // small card overlays the map, so the rest of the map stays interactive — no
    // full-container wrapper blocks pointer events.
    <details
      className="map-legend absolute bottom-8 left-2 z-10 w-[min(86vw,288px)] rounded-card border border-hairline-strong bg-white/90 text-ink-muted shadow-float backdrop-blur-sm md:left-3"
      data-testid="map-legend"
    >
      <summary
        className="flex cursor-pointer items-center justify-between gap-2 rounded-card px-3 py-2 text-sm font-semibold text-ink"
        data-testid="map-legend-summary"
      >
        {/* Korean-only primary label (Phase 4). The English gloss is not lost — the
            scale method note below still carries the technical description. */}
        <span>범례</span>
        <span aria-hidden className="map-legend-chevron text-xs text-ink-subtle">
          ▾
        </span>
      </summary>
      <div className="map-legend-body max-h-[40vh] overflow-y-auto px-3 pb-3 md:max-h-[46vh]">
        {props.mode === "equity" ? (
          <EquityLegend {...props} />
        ) : (
          <SuitabilityLegend {...props} />
        )}
      </div>
    </details>
  );
}

function EquityLegend({ metricLabel, unit, methodNote, rows, noDataColor }: EquityLegendProps) {
  return (
    <section aria-label="범례" data-testid="legend">
      {/* Korean-only primary heading (Phase 4). Every analytical element below is
          unchanged: the same class rows in the same order, the same class numbers,
          the same numeric ranges from the active scale breaks, the same unit, the
          same method note, and the same explicit no-data row and wording. The
          palette and the break values still come solely from lib/metrics.ts. */}
      <h2 className="mb-1 text-sm font-semibold text-ink">
        범례{unit ? ` — ${unit}` : ""}
      </h2>
      <p className="mb-1 text-[11px] text-ink-subtle" data-testid="legend-metric-label">
        {metricLabel}
      </p>
      <p className="mb-2 text-[11px] text-ink-subtle" data-testid="choropleth-scale-method">
        {methodNote}
      </p>
      <ul className="flex flex-col gap-1" data-testid="choropleth-legend">
        {rows.map((row) => (
          <li
            key={row.color}
            className="flex items-center gap-2 text-xs text-ink-muted"
            data-testid="choropleth-legend-row"
          >
            <span
              className="inline-block h-4 w-6 shrink-0 rounded-sm border border-hairline-strong"
              style={{ backgroundColor: row.color }}
            />
            {/* Class number so the class is identifiable without color. */}
            <span className="w-8 shrink-0 font-medium tabular-nums text-ink-subtle">
              {row.classNumber}급
            </span>
            <span className="tabular-nums">
              {row.range}
              {unit ? ` ${unit}` : ""}
            </span>
          </li>
        ))}
        {/* Explicit no-data category (never rendered as a 0 class). The parenthetical
            here is the analytical no-data WORDING, not an English duplicate of the
            heading, and is deliberately preserved. */}
        <li
          className="flex items-center gap-2 text-xs text-ink-muted"
          data-testid="choropleth-legend-nodata"
        >
          <span
            className="inline-block h-4 w-6 shrink-0 rounded-sm border border-hairline-strong"
            style={{ backgroundColor: noDataColor }}
          />
          <span className="w-8 shrink-0 font-medium text-ink-subtle">—</span>
          <span>데이터 없음 (no served value)</span>
        </li>
      </ul>
    </section>
  );
}

function SuitabilityLegend({
  scoreClasses,
  eligibleColor,
  reviewColor,
  excludedColor,
  statusVisibility,
  onToggleStatus,
  statusLabels,
  stabilityAvailable,
  stableOnly,
  onToggleStableOnly,
  stableOutlineColor,
  disclaimer,
  scenarioActive = false,
  scenarioWeights = null,
}: SuitabilityLegendProps) {
  const pct = (w: string | undefined): string =>
    w == null ? "—" : `${Math.round(Number(w) * 100)}%`;
  // The status → representative swatch color, matching the candidate fill: eligible
  // cells are score-shaded (a representative mid class), review cells amber, excluded
  // gray. Status is ALSO conveyed by the text label and (for review) a dashed sample,
  // never by color alone.
  const swatch: Record<SuitabilityStatus, { color: string; dashed?: boolean }> = {
    ELIGIBLE: { color: eligibleColor },
    REVIEW_REQUIRED: { color: reviewColor, dashed: true },
    EXCLUDED: { color: excludedColor },
  };
  return (
    <section aria-label="상태 범례 및 필터" data-testid="suitability-legend">
      {/* Phase 7: Phase 4 removed `범례 (Legend)` from the equity legend but this
          suitability heading kept its English gloss. Korean-only, per G3. */}
      <h2 className="mb-1 text-sm font-semibold text-slate-800">상태 · 점수 범례</h2>
      {scenarioActive && (
        <div
          className="mb-2 rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-900"
          data-testid="scenario-legend-header"
        >
          <p className="font-semibold">사용자 가정 기반 점수</p>
          <p className="mt-0.5">
            적용 가중치 Z/R/E/D: {pct(scenarioWeights?.zoning)} / {pct(scenarioWeights?.road)} /{" "}
            {pct(scenarioWeights?.equity)} / {pct(scenarioWeights?.demand)}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1 text-xs text-slate-600" data-testid="status-filters">
        {(Object.keys(statusVisibility) as SuitabilityStatus[]).map((st) => (
          <label key={st} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={statusVisibility[st]}
              onChange={() => onToggleStatus(st)}
              data-testid={`status-toggle-${st}`}
            />
            {/* Review cells carry a dashed outline sample; the sample is decorative
                (the visible label conveys the status), hence aria-hidden. */}
            <span
              aria-hidden
              className="inline-block h-4 w-6 shrink-0 rounded-sm"
              style={{
                backgroundColor: swatch[st].color,
                border: swatch[st].dashed ? "1.5px dashed #b45309" : "1px solid #cbd5e1",
              }}
            />
            <span>{statusLabels[st]}</span>
          </label>
        ))}
      </div>

      {/* Weight-sensitivity stability control + outline sample (only for a run that
          computed CRITIC/stability). The stable-only restriction is INDEPENDENT of
          the status checkboxes above and only limits ELIGIBLE cells. */}
      {stabilityAvailable ? (
        <div className="mt-2 border-t border-slate-200 pt-2" data-testid="stability-legend">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={stableOnly}
              onChange={onToggleStableOnly}
              data-testid="stable-only-toggle"
            />
            <span
              aria-hidden
              className="inline-block h-4 w-6 shrink-0 rounded-sm bg-white"
              style={{ border: `2px solid ${stableOutlineColor}` }}
            />
            <span>안정 후보만 보기 (eligible 안정 후보만 제한)</span>
          </label>
          <p className="mt-1 text-[11px] text-slate-500" data-testid="stability-legend-note">
            안정 후보(baseline·equal·critic 상위 10% 모두 포함)는 굵은 자홍색 외곽선으로 표시됩니다.
            검토/제외 셀은 안정성 평가 대상이 아닙니다.
            {scenarioActive && (
              <span data-testid="scenario-stability-note" className="mt-1 block">
                안정성 표시는 저장된 run의 baseline/equal/CRITIC 비교 결과이며 현재 사용자 시나리오의
                안정성 평가가 아닙니다. 사용자 가중치를 바꿔도 안정성은 재계산되지 않습니다.
              </span>
            )}
          </p>
        </div>
      ) : null}

      {/* Eligible score classes (0–100), shown with the same palette and thresholds
          the map's candidate fill uses. */}
      <div className="mt-2" data-testid="score-classes">
        <p className="mb-1 text-[11px] font-medium text-slate-500">
          스크리닝 통과 셀 점수 등급 (0–100)
        </p>
        <ul className="flex flex-col gap-1 text-xs text-slate-600">
          {scoreClasses.map((cls, index) => (
            <li key={cls.color} className="flex items-center gap-2" data-testid="score-class-row">
              <span
                aria-hidden
                className="inline-block h-4 w-6 shrink-0 rounded-sm border border-slate-300"
                style={{ backgroundColor: cls.color }}
              />
              <span className="w-8 shrink-0 font-medium tabular-nums text-slate-500">
                {index + 1}급
              </span>
              <span className="tabular-nums">{cls.range}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-[11px] text-slate-500" data-testid="suitability-legend-note">
        스크리닝 통과 셀은 점수(0–100)로 음영, 추가 검토 필요 셀은 주황 점선, 제외 셀은 회색입니다.{" "}
        {disclaimer}
      </p>
    </section>
  );
}
