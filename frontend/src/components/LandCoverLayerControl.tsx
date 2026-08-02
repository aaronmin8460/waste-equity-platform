"use client";

/**
 * Land-cover candidate-cell layer (토지피복 격자 통계) — floating layer control,
 * visualization-mode switch, filters and DYNAMIC legend (Phase 1B-LC5B).
 *
 * A SEPARATE, optional map layer over the same 500 m candidate grid the suitability
 * map already draws. This control is pure presentation: it owns no map state, only
 * surfacing the on/off toggle, the visualization mode, the L1/L2/L3 selector, the
 * coverage-status filters, the dominant-class filters, and the lifecycle/licence
 * disclosure. It never shows a score, rank, exclusion, or legal determination.
 *
 * The legend and the filters are ONE list: each row is both the swatch that explains
 * the current map styling and the checkbox that drives the MapLibre filter, so the
 * legend can never describe styling the map is not applying. Rows are produced by
 * `landCoverLegendEntries`, from the same values the paint/filter expressions are
 * built from.
 *
 * The class vocabulary comes from the classes the active release actually served into
 * the loaded tiles — never from a hardcoded list — so no class is invented and no
 * "기타"/"Unknown" bucket is synthesized for uncovered cells.
 */

import { useId, useMemo, useState } from "react";

import type { LandCoverCoverageStatus } from "../lib/api";
import {
  CLASS_LEVELS,
  CLASS_LEVEL_LABELS,
  landCoverAttributionText,
  landCoverOfficialSourceUrl,
  type ClassLevel,
  type LandCoverDisclosureLike,
} from "../lib/landCover";
import {
  LAND_COVER_COVERAGE_LEGEND_LABELS,
  LAND_COVER_COVERAGE_STATUSES,
  LAND_COVER_MODE_LABELS,
  LAND_COVER_VISUALIZATION_MODES,
  type LandCoverAvailableClasses,
  type LandCoverCoverageVisibility,
  type LandCoverVisualizationMode,
  landCoverLegendEntries,
  landCoverSelectionEmpty,
} from "../lib/landCoverLayer";

/** Canonical Korean label for the layer. */
export const LAND_COVER_LAYER_LABEL = "토지피복 격자 통계";

/**
 * The layer's own public-operation disclosure (Phase 1B-LC8). Restated in the
 * platform's voice beside the backend's served status; it asserts no EGIS KOGL type
 * and no raw-data redistribution right, and it keeps the scoring non-use statement.
 */
export const LAND_COVER_LAYER_DISCLAIMER =
  "본 플랫폼은 협력 정부기관이 확인한 프로젝트 차원의 공공데이터 활용 범위에 따라 공개 운영됩니다. 원본 SHP 파일과 원본 토지피복 도형은 제공하지 않습니다. 이 레이어는 설명용이며 적합성 점수·순위·제외 판정에 사용되지 않습니다.";

/** Explains where the class-filter vocabulary comes from — loaded tiles, not a list. */
export const LAND_COVER_CLASS_SOURCE_NOTE =
  "분류 목록은 현재 지도에 불러온 격자에서 실제로 제공된 공식 분류만 표시합니다. 지도를 이동하면 늘어날 수 있습니다.";

interface LandCoverLayerControlProps {
  /** Whether the layer is currently shown. Default OFF (the parent owns the state). */
  show: boolean;
  onToggleShow: () => void;
  /** False when no active release resolved: the whole control is disabled. */
  available: boolean;
  /**
   * A bounded, user-facing explanation when the layer cannot be shown or a tile
   * request failed. Never a stack trace, SQL, path, or raw backend message.
   */
  unavailableMessage?: string | null;
  mode: LandCoverVisualizationMode;
  onModeChange: (mode: LandCoverVisualizationMode) => void;
  classLevel: ClassLevel;
  onClassLevelChange: (level: ClassLevel) => void;
  coverage: LandCoverCoverageVisibility;
  onToggleCoverage: (status: LandCoverCoverageStatus) => void;
  /** Official classes observed in the loaded tiles, per level. */
  availableClasses: LandCoverAvailableClasses;
  /** Explicitly-unchecked class codes at the ACTIVE level. */
  hiddenClassCodes: readonly string[];
  onToggleClass: (code: string) => void;
  /** Show / hide every class at the active level in one action. */
  onSetAllClasses: (visible: boolean) => void;
  /** Statistics version pinned into the tile URL, shown as provenance. */
  statisticsVersionId: number | null;
  /**
   * Disclosures served with the active release, used for the mandatory source
   * attribution. Optional and possibly partial: attribution still renders from the
   * canonical project constants when the release has not loaded or omits them.
   */
  disclosures?: LandCoverDisclosureLike;
}

export default function LandCoverLayerControl({
  show,
  onToggleShow,
  available,
  unavailableMessage = null,
  mode,
  onModeChange,
  classLevel,
  onClassLevelChange,
  coverage,
  onToggleCoverage,
  availableClasses,
  hiddenClassCodes,
  onToggleClass,
  onSetAllClasses,
  statisticsVersionId,
  disclosures,
}: LandCoverLayerControlProps) {
  const modeGroupId = useId();
  const levelGroupId = useId();
  const [classQuery, setClassQuery] = useState("");

  const entries = useMemo(
    () => landCoverLegendEntries(mode, classLevel, coverage, availableClasses, hiddenClassCodes),
    [mode, classLevel, coverage, availableClasses, hiddenClassCodes],
  );
  const selectionEmpty = landCoverSelectionEmpty(
    mode,
    classLevel,
    coverage,
    availableClasses,
    hiddenClassCodes,
  );
  // A 세분류 legend can hold dozens of rows, so it gets a search box on top of the
  // bounded scroll region. Filtering the LIST never filters the MAP: a row hidden by
  // the search box keeps whatever visibility its checkbox has.
  const normalizedQuery = classQuery.trim().toLowerCase();
  const shownEntries =
    mode === "dominant" && normalizedQuery !== ""
      ? entries.filter(
          (entry) =>
            entry.secondary.toLowerCase().includes(normalizedQuery) ||
            entry.label.toLowerCase().includes(normalizedQuery),
        )
      : entries;
  const controlsDisabled = !available || !show;

  return (
    <details
      className="w-full min-w-0 rounded-card border border-hairline-strong bg-white/90 text-ink-muted shadow-float backdrop-blur-sm"
      data-testid="land-cover-layer-control"
    >
      <summary
        className="flex cursor-pointer items-center justify-between gap-2 rounded-card px-3 py-2 text-sm font-semibold text-ink"
        data-testid="land-cover-layer-summary"
      >
        <span>{LAND_COVER_LAYER_LABEL}</span>
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
            disabled={!available}
            data-testid="land-cover-layer-toggle"
          />
          <span className="font-medium text-ink">지도에 토지피복 격자 통계 표시</span>
        </label>

        {/* Bounded failure explanation. Never a stack trace, SQL, or raw error. */}
        {unavailableMessage ? (
          <p
            className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
            role="status"
            data-testid="land-cover-layer-unavailable"
          >
            {unavailableMessage}
          </p>
        ) : null}

        {/* Visualization mode. A labelled radio group, not colored chips: the mode is
            conveyed by the visible label and by checked state, never by color. */}
        <div
          className="mt-2 border-t border-hairline pt-2"
          role="radiogroup"
          aria-labelledby={modeGroupId}
          data-testid="land-cover-mode-group"
        >
          <p id={modeGroupId} className="mb-1 text-[11px] font-medium text-ink-subtle">
            표시 방식
          </p>
          <div className="flex flex-col gap-1">
            {LAND_COVER_VISUALIZATION_MODES.map((option) => (
              <label key={option} className="flex items-center gap-2 text-ink-muted">
                <input
                  type="radio"
                  name={`${modeGroupId}-mode`}
                  checked={mode === option}
                  onChange={() => onModeChange(option)}
                  disabled={controlsDisabled}
                  data-testid={`land-cover-mode-${option}`}
                />
                <span>{LAND_COVER_MODE_LABELS[option]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Official hierarchy level, offered only when it governs the map. */}
        {mode === "dominant" ? (
          <div
            className="mt-2 border-t border-hairline pt-2"
            role="radiogroup"
            aria-labelledby={levelGroupId}
            data-testid="land-cover-level-group"
          >
            <p id={levelGroupId} className="mb-1 text-[11px] font-medium text-ink-subtle">
              분류 단계
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {CLASS_LEVELS.map((level) => (
                <label key={level} className="flex items-center gap-1.5 text-ink-muted">
                  <input
                    type="radio"
                    name={`${levelGroupId}-level`}
                    checked={classLevel === level}
                    onChange={() => onClassLevelChange(level)}
                    disabled={controlsDisabled}
                    data-testid={`land-cover-level-${level}`}
                  />
                  <span>
                    L{level} {CLASS_LEVEL_LABELS[level]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Coverage-status filters. Always offered — they govern the map in BOTH
            modes, because a dominant class only ever describes the evaluated part. */}
        <div
          className="mt-2 border-t border-hairline pt-2"
          role="group"
          aria-label="평가 범위 필터"
          data-testid="land-cover-coverage-filters"
        >
          <p className="mb-1 text-[11px] font-medium text-ink-subtle">평가 범위 필터</p>
          <div className="flex flex-col gap-1">
            {LAND_COVER_COVERAGE_STATUSES.map((status) => (
              <label key={status} className="flex items-center gap-2 text-ink-muted">
                <input
                  type="checkbox"
                  checked={coverage[status]}
                  onChange={() => onToggleCoverage(status)}
                  disabled={controlsDisabled}
                  data-testid={`land-cover-coverage-toggle-${status}`}
                />
                {/* Korean label plus the API's own machine status, so the vocabulary
                    the backend uses stays visible and greppable. */}
                <span className="min-w-0 break-words">
                  {LAND_COVER_COVERAGE_LEGEND_LABELS[status]}{" "}
                  <span className="text-ink-subtle">({status})</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* --- Dynamic legend. Reflects the ACTIVE mode, level and filters. --- */}
        <div className="mt-2 border-t border-hairline pt-2" data-testid="land-cover-legend">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-ink-subtle">
              {mode === "coverage"
                ? "범례 · 평가 범위"
                : `범례 · 우세 분류 (L${classLevel} ${CLASS_LEVEL_LABELS[classLevel]})`}
            </p>
            {mode === "dominant" && entries.length > 0 ? (
              <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                {entries.length}개
              </span>
            ) : null}
          </div>

          {/* Search + bulk actions keep a 34-row 세분류 legend usable. */}
          {mode === "dominant" && entries.length > 0 ? (
            <div className="mb-1 flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className="sr-only">분류 코드 또는 이름으로 범례 검색</span>
                <input
                  type="search"
                  value={classQuery}
                  onChange={(event) => setClassQuery(event.target.value)}
                  placeholder="분류 코드·이름 검색"
                  disabled={controlsDisabled}
                  className="w-full min-w-0 rounded border border-hairline-strong px-2 py-1 text-[11px] text-ink"
                  data-testid="land-cover-class-search"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSetAllClasses(true)}
                  disabled={controlsDisabled}
                  className="rounded border border-hairline-strong px-2 py-0.5 text-[11px] text-ink-muted"
                  data-testid="land-cover-class-show-all"
                >
                  모두 표시
                </button>
                <button
                  type="button"
                  onClick={() => onSetAllClasses(false)}
                  disabled={controlsDisabled}
                  className="rounded border border-hairline-strong px-2 py-0.5 text-[11px] text-ink-muted"
                  data-testid="land-cover-class-hide-all"
                >
                  모두 숨김
                </button>
              </div>
            </div>
          ) : null}

          {/* Bounded scroll region: many categories never push the card off-screen,
              and `min-w-0` + wrapping keeps long official names from overflowing. */}
          {shownEntries.length > 0 ? (
            <ul
              className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1"
              data-testid="land-cover-legend-rows"
            >
              {shownEntries.map((entry) =>
                mode === "dominant" ? (
                  // Dominant-class rows ARE the class filter: one control, so the
                  // legend can never disagree with what the map is filtering.
                  <li key={entry.key} data-testid="land-cover-legend-row">
                    <label className="flex items-start gap-2 text-ink-muted">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={entry.visible}
                        onChange={() => onToggleClass(entry.key)}
                        disabled={controlsDisabled}
                        data-testid={`land-cover-legend-toggle-${entry.key}`}
                      />
                      <span
                        aria-hidden
                        className="mt-0.5 inline-block h-4 w-6 shrink-0 rounded-sm border border-hairline-strong"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="min-w-0">
                        {/* Official Korean name and official code, verbatim. */}
                        <span className="break-words">{entry.label}</span>{" "}
                        <span className="tabular-nums text-ink-subtle">({entry.secondary})</span>
                      </span>
                    </label>
                  </li>
                ) : (
                  // Coverage rows explain the styling; the canonical checkboxes for
                  // these three states are the 평가 범위 필터 group above, so the row is
                  // read-only and states its visibility in TEXT rather than by color.
                  <li
                    key={entry.key}
                    className="flex items-start gap-2"
                    data-testid="land-cover-legend-row"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 inline-block h-4 w-6 shrink-0 rounded-sm border border-hairline-strong"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="min-w-0">
                      <span className="break-words font-medium text-ink">{entry.label}</span>{" "}
                      <span className="text-ink-subtle">({entry.secondary})</span>{" "}
                      <span
                        className="text-ink-subtle"
                        data-testid={`land-cover-legend-state-${entry.key}`}
                      >
                        · {entry.visible ? "표시 중" : "숨김"}
                      </span>
                      {entry.note ? (
                        <span className="mt-0.5 block text-[11px] text-ink-subtle">
                          {entry.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-subtle" data-testid="land-cover-legend-empty">
              {mode === "dominant" && entries.length > 0
                ? "검색어와 일치하는 분류가 없습니다."
                : "표시할 분류가 아직 없습니다. 지도를 이동하거나 확대하면 불러온 격자에서 분류가 채워집니다."}
            </p>
          )}

          {mode === "dominant" ? (
            <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-class-source-note">
              {LAND_COVER_CLASS_SOURCE_NOTE}
            </p>
          ) : null}
        </div>

        {/* Explicit empty-selection state. The map is NOT silently reverted to
            "show everything" — the reader is told the current filters select none. */}
        {selectionEmpty ? (
          <p
            className="mt-2 rounded border border-hairline-strong bg-surface-muted p-2 text-[11px] text-ink-muted"
            role="status"
            data-testid="land-cover-selection-empty"
          >
            현재 필터로 선택된 격자가 없습니다. 위 필터를 다시 선택하세요.
          </p>
        ) : null}

        {/* Public-operation / non-scoring disclosure. */}
        <p
          className="mt-2 border-t border-hairline pt-2 text-[11px] text-ink-subtle"
          data-testid="land-cover-layer-disclaimer"
        >
          {LAND_COVER_LAYER_DISCLAIMER}
        </p>
        {/* Mandatory source attribution. Rendered from the served disclosures when
            available and from the canonical project constant otherwise, so the
            attribution can never be missing from a public surface. */}
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-layer-attribution">
          {landCoverAttributionText(disclosures)}{" "}
          <a
            className="underline"
            href={landCoverOfficialSourceUrl(disclosures)}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="land-cover-layer-source-link"
          >
            원본 자료 안내
          </a>
        </p>
        {statisticsVersionId !== null ? (
          <p
            className="mt-1 text-[11px] text-ink-subtle"
            data-testid="land-cover-layer-version"
            data-diagnostic
          >
            통계 릴리스 버전 {statisticsVersionId} · 기준 시점 2025 · 파생 통계 (land-cover-v1 ·
            capital-grid-500m-v1)
          </p>
        ) : null}
      </div>
    </details>
  );
}
