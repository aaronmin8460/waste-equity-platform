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
 * Ranking first, candidate second (Figma 167:10554): the ranking establishes WHICH
 * candidates moved, and the candidate section then explains ONE of them in depth. A
 * reader who arrives at the contribution bars without the ranking above has no way to
 * know whether the cell they are reading is a notable mover or an arbitrary one.
 */

import { useMemo } from "react";

import { buildScenarioRankingComparison } from "../../../lib/scenarioRankingComparison";
import { rankingComparisonExportExtension } from "../../../lib/scenarioRankingExport";
import type { ScenarioComparison } from "../../../lib/scenarioComparison";
import SuitabilityScenarioCandidateComparison from "../SuitabilityScenarioCandidateComparison";
import SuitabilityScenarioRankingAnalytics from "./SuitabilityScenarioRankingAnalytics";

export interface SuitabilityScenarioAnalysisSectionsProps {
  comparison: ScenarioComparison;
  /** A legacy `?cand=` id, passed through as a SEED for the candidate selection only. */
  initialCandidateId?: number | null;
}

export default function SuitabilityScenarioAnalysisSections({
  comparison,
  initialCandidateId = null,
}: SuitabilityScenarioAnalysisSectionsProps) {
  // The single derivation. `null` whenever Page 5B has nothing truthful to show.
  const rankingModel = useMemo(
    () => buildScenarioRankingComparison(comparison),
    [comparison],
  );

  // `undefined` for a null model, so the workbook falls back to Page 5C's own three
  // sheets rather than carrying an empty one captioned 순위 비교.
  const exportExtension = useMemo(
    () => rankingComparisonExportExtension(rankingModel, comparison),
    [rankingModel, comparison],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="scenario-analysis-sections">
      <SuitabilityScenarioRankingAnalytics comparison={comparison} model={rankingModel} />
      <SuitabilityScenarioCandidateComparison
        comparison={comparison}
        initialCandidateId={initialCandidateId}
        exportExtension={exportExtension}
      />
    </div>
  );
}
