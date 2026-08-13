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
 * KPI row → 순위 이동 + 순위 변화가 큰 후보 → 상세 비교표. The frame's other two
 * cards in this region (후보 결과 변화 지도, 선택 지역 상세 비교, 가중치 민감도)
 * belong to the candidate-detail lane and are deliberately absent rather than
 * stubbed.
 */

import { useMemo } from "react";

import SectionCard from "../../ui/SectionCard";
import {
  RANKING_COMPARISON_TOP_N,
  RANKING_MOVEMENT_LIST_SIZE,
  buildScenarioRankingComparison,
  topRankMovements,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";
import type { ScenarioComparison } from "../../../lib/scenarioComparison";
import ScenarioRankMovementList from "./ScenarioRankMovementList";
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
}

export default function SuitabilityScenarioRankingAnalytics({
  comparison,
  model: providedModel,
}: SuitabilityScenarioRankingAnalyticsProps) {
  const derived = useMemo(
    // Skipped entirely when the caller already derived it.
    () => (providedModel === undefined ? buildScenarioRankingComparison(comparison) : null),
    [comparison, providedModel],
  );
  const model = providedModel === undefined ? derived : providedModel;
  const movements = useMemo(() => (model === null ? [] : topRankMovements(model)), [model]);

  if (model === null) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="scenario-ranking-analytics">
      <ScenarioRankingKpiRow model={model} />

      {/* The scope every figure above and below is bounded by, stated once in full
          rather than repeated in five captions. */}
      <p
        className="text-[11px] leading-snug text-ink-subtle"
        data-testid="scenario-ranking-scope"
      >
        {model.scopeDescription}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={`후보지 순위 이동 (상위 ${RANKING_COMPARISON_TOP_N})`}
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

        <SectionCard
          title="순위 변화가 큰 후보 구역"
          testId="scenario-ranking-movement-card"
          className="wep-figma-card"
          description={`양쪽 상위 목록에서 순위가 모두 확인된 후보 구역 중, 변화가 큰 ${RANKING_MOVEMENT_LIST_SIZE}개입니다.`}
        >
          <ScenarioRankMovementList rows={movements} model={model} />
        </SectionCard>
      </div>

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
