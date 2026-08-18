"use client";

/**
 * The Page-5 analytical body: Page-5B ranking analytics above Page-5C candidate detail.
 *
 * ── IT IS A COMPOSITION, NOT A THIRD LANE ────────────────────────────────────────
 * This component owns no analysis. It is what fills Page 5A's `analysisSections` seam,
 * and it exists for two reasons that a bare fragment could not serve:
 *
 *   1. ONE DERIVATION. `buildScenarioRankingComparison` runs here exactly once. The
 *      ranking sections and the XLSX ranking sheet are then fed the SAME model object,
 *      so the file a reader downloads cannot disagree with the table they were reading.
 *   2. ONE EXPORT. Page 5C's workbook takes an extension; Page 5B produces the sheet
 *      that fills it. Wiring them here keeps the two lanes ignorant of each other —
 *      the ranking module never learns the export exists, and the export module never
 *      imports the ranking module.
 *
 * ── THE ONE COMPARISON ───────────────────────────────────────────────────────────
 * `comparison` is the finished {@link ScenarioComparison} the foundation resolved,
 * run-validated and previewed ONCE. Nothing below re-resolves `cmpA`/`cmpB`, re-reads
 * `localStorage`, or re-issues the preview. Page 5A renders this only in `READY`, so
 * neither section is ever drawn under a status the shell refused to stand behind.
 *
 * ── ORDER ────────────────────────────────────────────────────────────────────────
 * The frame interleaves the two lanes rather than stacking them:
 *
 *   Row3   [ 후보지 순위 변화 TOP 10 (ranking) | 후보 결과 변화 지도 (candidate) ]
 *   Row4   [ 선택 지역 상세 비교     (candidate) | 순위 변동 분포     (ranking) ]
 *
 * So the two lanes can no longer each render one contiguous block. The grid itself is
 * owned by `SuitabilityScenarioRankingAnalytics`, and this component hands it the two
 * CANDIDATE cards as slots. The reading order the previous stack existed to protect is
 * unchanged: the KPI row and the slope chart still establish WHICH candidates moved
 * before the contribution bars explain ONE of them.
 *
 * ── ONE SELECTION, ACROSS TWO BANDS ──────────────────────────────────────────────
 * The map and the detail card share a selected candidate, and the frame puts them in
 * different rows. `useScenarioCandidateSelection` is therefore called ONCE here, above
 * both, so there is still exactly one selection, one pair of detail requests and one
 * export input — the guarantees the sibling layout used to get from being siblings.
 */

import { useMemo } from "react";

import { buildScenarioRankingComparison } from "../../../lib/scenarioRankingComparison";
import { rankingComparisonExportExtension } from "../../../lib/scenarioRankingExport";
import type { ScenarioComparison } from "../../../lib/scenarioComparison";
import {
  ScenarioCandidateDetailCard,
  ScenarioCandidateMapCard,
  useScenarioCandidateSelection,
} from "../SuitabilityScenarioCandidateComparison";
import SuitabilityScenarioRankingAnalytics from "./SuitabilityScenarioRankingAnalytics";
import { SCOPE_ALL, type SuitabilityScope } from "../../../lib/suitabilityScope";

export interface SuitabilityScenarioAnalysisSectionsProps {
  comparison: ScenarioComparison;
  /** A legacy `?cand=` id, passed through as a SEED for the candidate selection only. */
  initialCandidateId?: number | null;
  /**
   * The analysis scope the comparison was previewed within, forwarded so the
   * candidate detail counts its rank over the SAME population the ranking did.
   */
  scope?: SuitabilityScope;
  /** The scope's visible name, for the sections that state which 범위 they describe. */
  scopeName?: string;
}

export default function SuitabilityScenarioAnalysisSections({
  comparison,
  initialCandidateId = null,
  scope = SCOPE_ALL,
  scopeName,
}: SuitabilityScenarioAnalysisSectionsProps) {
  // The single derivation. `null` whenever Page 5B has nothing truthful to show.
  const rankingModel = useMemo(
    // The scope's NAME travels into every figure's scope sentence — the table
    // caption and the exported workbook's own note — so a scoped comparison never
    // reads as a capital-region one that mysteriously shrank.
    () => buildScenarioRankingComparison(comparison, scopeName),
    [comparison, scopeName],
  );

  // `undefined` for a null model, so the workbook falls back to Page 5C's own three
  // sheets rather than carrying an empty one captioned 순위 비교.
  const exportExtension = useMemo(
    () => rankingComparisonExportExtension(rankingModel, comparison),
    [rankingModel, comparison],
  );

  const selection = useScenarioCandidateSelection(comparison, initialCandidateId, scope);

  const detailCard = (
    // The candidate lane's own marker travels with its card, so the lane stays
    // addressable even though it no longer has a wrapper of its own.
    <div data-testid="scenario-candidate-comparison" className="flex min-w-0 flex-col">
      <ScenarioCandidateDetailCard selection={selection} exportExtension={exportExtension} />
    </div>
  );

  // The ranking grid owns the frame's bands, and it draws nothing without a model. The
  // candidate lane does not depend on the ranking model, so it keeps its own
  // two-column layout rather than disappearing with the grid that would have hosted it.
  if (rankingModel === null) {
    return (
      <div className="grid gap-4 xl:grid-cols-2" data-testid="scenario-analysis-sections">
        {detailCard}
        <ScenarioCandidateMapCard selection={selection} scope={scope} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="scenario-analysis-sections">
      <SuitabilityScenarioRankingAnalytics
        comparison={comparison}
        model={rankingModel}
        mapSlot={<ScenarioCandidateMapCard selection={selection} scope={scope} />}
        detailSlot={detailCard}
      />
    </div>
  );
}
