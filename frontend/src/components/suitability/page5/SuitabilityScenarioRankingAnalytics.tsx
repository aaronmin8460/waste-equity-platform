"use client";

/**
 * 순위 비교 분석 — the Page-5B analytical block (Figma 167:10554).
 *
 * The ONE consumer boundary for Page 5B: it takes the foundation's
 * {@link ScenarioComparison} as a prop, derives the ranking model once, and hands
 * the same model to every section. It does not resolve `cmpA`/`cmpB`, read
 * `localStorage`, call the preview API, or canonicalise weights — Page 5A did all
 * four exactly once (PAGE_5_SCENARIO_CONTRACT.md §9).
 *
 * ── IT RENDERS NOTHING UNLESS BOTH SIDES ARE READY ───────────────────────────────
 * `buildScenarioRankingComparison` returns `null` for every other state, and this
 * component returns `null` with it. Page 5A already owns the recovery UI for
 * MISSING / OTHER_RUN / PREVIEW_ERROR / LOADING; duplicating it here would give a
 * reader two banners for one problem, and — worse — showing the previous
 * comparison's cards while the foundation has moved out of READY would leave stale
 * analytics on screen under a fresh error message.
 *
 * ── SECTION ORDER FOLLOWS THE FRAME ──────────────────────────────────────────────
 * This component owns the frame's whole analytical grid:
 *
 *   ResultKPIRow   five tiles
 *   Row3           [ 후보지 순위 변화 TOP 10 | 후보 결과 변화 지도 ]
 *   Row4           [ 선택 지역 상세 비교     | 순위 변동 분포      ]
 *   Card5          후보지 상세 비교표 (full width, last)
 *
 * Two of those four cells belong to the CANDIDATE lane, and the frame separates them
 * — the map in Row3, the detail card in Row4 — so they can no longer be rendered as
 * siblings by that lane. They arrive here as SLOTS. This component still derives no
 * candidate state and issues no request; it only decides where a finished card sits.
 * Without the slots (the standalone Page-5B view) the ranking cards simply take the
 * full width, so the lane remains renderable on its own.
 *
 * ── THE MOVEMENT CARD HOLDS THE SCATTER AND NOTHING ELSE ─────────────────────────
 * It used to also carry a 순위 변화가 큰 후보 구역 list of up to ten rows. That list
 * was the comparison table below it, minus the score columns and under a different
 * heading: the table's DEFAULT sort is `movement_desc` — literally "순위 변화가 큰
 * 순" — so the two printed the same cells in the same order. Carrying it also made
 * Row4 ragged, where the frame draws two EQUAL 688×458 cards: the list pushed the
 * right card to roughly two and a half times the height of the left, leaving the
 * left column ending in ~400px of white. Removed — the scatter shows the shape and
 * the table carries the numbers. `topRankMovements` survives in `lib/` (still
 * exported, still tested) for the export sheet and any later consumer.
 */

import { useMemo, type ReactNode } from "react";

import SectionCard from "../../ui/SectionCard";
import {
  RANKING_COMPARISON_TOP_N,
  buildScenarioRankingComparison,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";
import type { ScenarioComparison } from "../../../lib/scenarioComparison";
import ScenarioRankMovementScatter from "./ScenarioRankMovementScatter";
import ScenarioRankSlopeChart from "./ScenarioRankSlopeChart";
import ScenarioRankingKpiRow from "./ScenarioRankingKpiRow";
import ScenarioRankingTable from "./ScenarioRankingTable";

export interface SuitabilityScenarioRankingAnalyticsProps {
  comparison: ScenarioComparison;
  /**
   * The already-derived model, when the caller needs the SAME one for something else
   * (the Page-5 integration also feeds it to the XLSX ranking sheet).
   *
   * Omitted, this derives its own from `comparison` — the standalone behaviour. Passed,
   * the derivation happens once for the whole page, so the sheet a reader downloads
   * cannot be built from a different model than the table they are looking at.
   */
  model?: ScenarioRankingComparison | null;
  /** 후보 결과 변화 지도 — the frame's Row3-right cell. */
  mapSlot?: ReactNode;
  /** 선택 지역 상세 비교 — the frame's Row4-left cell. */
  detailSlot?: ReactNode;
}

export default function SuitabilityScenarioRankingAnalytics({
  comparison,
  model: providedModel,
  mapSlot,
  detailSlot,
}: SuitabilityScenarioRankingAnalyticsProps) {
  const derived = useMemo(
    // Skipped entirely when the caller already derived it.
    () => (providedModel === undefined ? buildScenarioRankingComparison(comparison) : null),
    [comparison, providedModel],
  );
  const model = providedModel === undefined ? derived : providedModel;

  if (model === null) return null;

  return (
    <div className="flex flex-col gap-5" data-testid="scenario-ranking-analytics">
      {/* ── SECTION 2 — ResultKPIRow ──────────────────────────────────────── */}
      <ScenarioRankingKpiRow model={model} />

      {/* The scope every figure above and below is bounded by, stated once in full
          rather than repeated in five captions. */}
      <p
        className="-mt-2 text-[11px] leading-snug text-ink-subtle"
        data-testid="scenario-ranking-scope"
      >
        {model.scopeDescription}
      </p>

      {/* ── SECTION 3 — the frame's Row3: 740 | 636 ───────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[740fr_636fr]">
        <SectionCard
          title={`후보지 순위 변화 TOP ${RANKING_COMPARISON_TOP_N}`}
          testId="scenario-ranking-slope-card"
          className="wep-figma-card"
          description={`A안 또는 B안에서 상위 ${RANKING_COMPARISON_TOP_N}위에 든 후보 구역의 순위가 어떻게 이동했는지 보여줍니다.`}
        >
          <ScenarioRankSlopeChart
            rows={model.slopeRows}
            boundaryA={model.boundaryA}
            boundaryB={model.boundaryB}
          />
        </SectionCard>

        {mapSlot}
      </div>

      {/* ── SECTION 4 — the frame's Row4: 688 | 688 ───────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        {detailSlot}

        <SectionCard
          // NOT 가중치 민감도. The product runs no weight sweep; this is the rank
          // difference between the reader's own two scenarios. See the scatter's
          // own header comment.
          title="순위 변동 분포"
          testId="scenario-ranking-movement-card"
          className="wep-figma-card"
          // One line, as the frame's captions are. The "not a sensitivity sweep"
          // qualifier is kept — it is the one misreading this chart invites.
          description="두 시나리오 사이의 순위 차이입니다. 가중치를 여러 번 바꿔 본 민감도 분석이 아닙니다."
        >
          <ScenarioRankMovementScatter model={model} />
        </SectionCard>
      </div>

      {/* ── SECTION 5 — the frame's last full-width card ──────────────────── */}
      <SectionCard
        title="후보지 상세 비교표"
        testId="scenario-ranking-table-card"
        className="wep-figma-card"
        description="두 시나리오의 후보 구역 순위와 점수를 나란히 비교합니다."
      >
        <ScenarioRankingTable model={model} />
      </SectionCard>
    </div>
  );
}
