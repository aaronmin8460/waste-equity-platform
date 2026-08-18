"use client";

/**
 * 후보지 심층 비교 — the SELECTED CANDIDATE half of Page 5 (Page 5C, Figma 167:10554).
 *
 * Page 5A resolves the A/B pair and previews both sides once; this section sits
 * beneath it and answers one further question: for ONE candidate cell, how does each
 * factor's weighted contribution differ between A안 and B안, and what does that cell
 * look like on the map under each side.
 *
 * ── WHAT THIS LANE DOES NOT DO ───────────────────────────────────────────────────
 * It never reads `localStorage`, never parses `cmpA`/`cmpB`, never resolves a saved
 * scenario, and never calls `POST /suitability/scenarios/preview`. It receives a
 * finished {@link ScenarioComparison} as a prop
 * (docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §9.2). The only request it makes is
 * to the SEPARATE, pre-existing candidate-detail endpoint, which already serves the
 * per-scenario `contributions` this screen shows — so no contribution is derived here
 * and no backend contract is invented.
 *
 * ── WHAT THE FIGMA FRAME ASKS FOR, AND WHERE THIS DEPARTS FROM IT ────────────────
 * The frame's 선택 지역 상세 비교 card names its factor rows 시설부담 정도 /
 * 토지피복 기반 적합도 / 장래 쓰레기 발생량 / 주민 반응 and its map legend
 * 신규 통과 / 통과 유지 / 통과 → 제외 / 양쪽 제외. None of that exists in this model:
 * three of the four factors are not scoring components (and the fourth inverts E),
 * and a weight scenario cannot change a screening status at all — screening is
 * rule-based and does not move with the weights. So the LAYOUT is the frame's and the
 * CONTENT is the model's: the four rows are `COMPONENT_ORDER` with the glossary's own
 * labels, and the map keeps the product's existing ELIGIBLE / REVIEW_REQUIRED /
 * EXCLUDED legend unchanged under both sides.
 *
 * The frame's 주요 영향 column reads "가중치 감소로 영향 ↓" — a causal claim. What is
 * actually computable is descriptive and is stated as such: the factor whose weighted
 * contribution changed most between the reader's own two weightings.
 *
 * ── ONE MAP, TWO SOURCES ─────────────────────────────────────────────────────────
 * A안 and B안 share a SINGLE MapLibre instance. Toggling re-points `candidateTileUrl`
 * at the other side's scenario tiles; `MapView` swaps the vector source in place
 * (components/MapView.tsx) rather than remounting, so the viewport, the zoom and the
 * selected candidate all survive the toggle.
 */

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import { userScenarioTileUrl, type RegionBoundaryCollection, type UserScenarioWeights } from "../../lib/api";
import { COMPONENT_ORDER, SUITABILITY_SCREENING_SHORT_LABEL, statusLabel } from "../../lib/glossary";
import { defaultCoverageVisibility, emptyAvailableClasses } from "../../lib/landCoverLayer";
import {
  CANDIDATE_EXCLUDED_COLOR,
  CANDIDATE_REVIEW_COLOR,
  CANDIDATE_SCORE_BREAKS,
  CANDIDATE_SCORE_PALETTE_5,
} from "../../lib/metrics";
import {
  SCENARIO_COMPARISON_TOP_N,
  type ComparisonSide,
  type ScenarioComparison,
} from "../../lib/scenarioComparison";
import {
  candidateChoices,
  candidateContributionRows,
  candidateIdentityConflict,
  findChoice,
  formatContributionDelta,
  majorImpactFactor,
  majorImpactSentence,
  previewPlacement,
  resolvedCandidateKey,
  totalScoreDelta,
  type CandidateContributionRow,
  type CandidateSideResult,
} from "../../lib/scenarioCandidateComparison";
import {
  comparisonExportScopeNote,
  downloadScenarioComparisonWorkbook,
  type ScenarioComparisonExportExtension,
  type ScenarioComparisonExportInput,
} from "../../lib/scenarioComparisonExport";
import { WETLAND_TYPES, type WetlandType } from "../../lib/wetland";
import { type StatusVisibility } from "../MapView";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";
import { COMPONENT_ACCENT } from "./factorAccents";
import { groupRowsBySigungu } from "../../lib/scenarioSigunguGroups";
import {
  SCOPE_ALL,
  scopeKey,
  scopeToQuery,
  type SuitabilityScope,
} from "../../lib/suitabilityScope";
import {
  COMPONENT_MODEL_SUCCESSOR,
  type ComponentModelVersion,
} from "../../lib/componentModelWeights";
import { STATUS_LABELS } from "./shared";
import { useScenarioCandidateDetail } from "./useScenarioCandidateDetail";

/**
 * MapLibre needs `window`, so the map is client-only — the same `next/dynamic`
 * treatment `app/page.tsx` gives the shared MapView, and the same single module: this
 * section reuses the product's ONE map component rather than introducing a second
 * map engine.
 */
const MapView = dynamic(() => import("../MapView"), { ssr: false });

const SLOT_LABEL = { A: "A안", B: "B안" } as const;

/** The map's own filter state, owned by this section and not shared with the page. */
const ALL_STATUSES_VISIBLE: StatusVisibility = {
  ELIGIBLE: true,
  REVIEW_REQUIRED: true,
  EXCLUDED: true,
};

/**
 * The environmental overlays are OFF here. This section's map exists to show one
 * cell under two weightings; adding optional layers would be a second question on a
 * surface that is already answering one.
 */
const NO_WETLAND_TYPES: Record<WetlandType, boolean> = WETLAND_TYPES.reduce(
  (acc, type) => ({ ...acc, [type]: false }),
  {} as Record<WetlandType, boolean>,
);

/**
 * No region choropleth on this map: suitability mode draws the candidate grid, and the
 * SIGUNGU boundaries are an equity-mode layer. An empty collection is the honest way
 * to say "no region values here" — `count: 0` is the true count of what is supplied,
 * not a claim about any dataset.
 */
const EMPTY_BOUNDARIES: RegionBoundaryCollection = {
  type: "FeatureCollection",
  reference_year: 0,
  count: 0,
  features: [],
};

export interface SuitabilityScenarioCandidateComparisonProps {
  /** Page 5A's finished comparison. Never re-derived, never re-requested. */
  comparison: ScenarioComparison;
  /**
   * A legacy `?cand=` candidate id, when the link carried one. It only SEEDS the
   * selection — nothing is written back to the URL, and an id that neither side's
   * preview lists still resolves through the detail contract.
   */
  initialCandidateId?: number | null;
  /**
   * Extra workbook sheets contributed by another Page-5 lane (the integration passes
   * the Page-5B ranking sheet). Optional: without it the export is exactly this lane's
   * three single-candidate sheets, and the scope note printed by the button says so.
   */
  exportExtension?: ScenarioComparisonExportExtension;
}

/**
 * The lane's whole state, derived once.
 *
 * Extracted from the component because the Figma frame puts the two cards this lane
 * owns in DIFFERENT bands — 후보 결과 변화 지도 sits in Row3 beside the slope chart,
 * and 선택 지역 상세 비교 in Row4 — so they can no longer be siblings under one
 * wrapper. The Page-5 grid renders them into their own cells and calls this hook
 * ONCE above both, which keeps the single source of truth that the sibling layout
 * used to get for free: one selection, one detail request pair, one export input.
 */
export function useScenarioCandidateSelection(
  comparison: ScenarioComparison,
  initialCandidateId: number | null = null,
  /**
   * The analysis scope the comparison was previewed within.
   *
   * The pickable cells already come from the two SCOPED previews, so the selector
   * lists only in-scope candidates automatically. This is passed on to the DETAIL
   * request, whose `custom_rank` is a position in a population and would otherwise be
   * counted capital-region-wide beside a regional ranking.
   */
  scope: SuitabilityScope = SCOPE_ALL,
  componentModelVersion: ComponentModelVersion = COMPONENT_MODEL_SUCCESSOR,
) {
  const { sideA, sideB } = comparison;

  // The pickable cells, drawn from the two ALREADY-LOADED previews.
  const choices = useMemo(
    () => candidateChoices(sideA.preview, sideB.preview),
    [sideA.preview, sideB.preview],
  );

  // NO auto-selection. A Figma mock names 시흥시; picking a cell on the reader's
  // behalf would present an arbitrary candidate as if the product had chosen it.
  // The only seed is an explicit id the reader's own link carried.
  const [picked, setPicked] = useState<number | null>(null);
  const candidateId = picked ?? initialCandidateId;

  const details = useScenarioCandidateDetail(comparison, candidateId, scope, componentModelVersion);
  const rows = useMemo(
    () => candidateContributionRows(details.a.detail, details.b.detail),
    [details.a.detail, details.b.detail],
  );
  const impact = useMemo(() => majorImpactFactor(rows), [rows]);

  const choice = findChoice(choices, candidateId);
  const candidateKey = resolvedCandidateKey(details.a, details.b, choice?.candidateKey ?? null);
  const placementA = useMemo(
    () => previewPlacement(sideA.preview, candidateId),
    [sideA.preview, candidateId],
  );
  const placementB = useMemo(
    () => previewPlacement(sideB.preview, candidateId),
    [sideB.preview, candidateId],
  );

  const exportInput: ScenarioComparisonExportInput = useMemo(
    () => ({
      comparison,
      candidateKey,
      candidateId,
      detailA: details.a.detail,
      detailB: details.b.detail,
      placementA,
      placementB,
      rows,
      majorImpact: impact,
      previewTopN: SCENARIO_COMPARISON_TOP_N,
    }),
    [comparison, candidateKey, candidateId, details.a.detail, details.b.detail, placementA, placementB, rows, impact],
  );

  return {
    sideA,
    sideB,
    choices,
    candidateId,
    onPick: setPicked,
    details,
    rows,
    impact,
    placementA,
    placementB,
    candidateKey,
    exportInput,
  };
}

export type ScenarioCandidateSelection = ReturnType<typeof useScenarioCandidateSelection>;

/**
 * 선택 지역 상세 비교 — the frame's Row4-left card, as a standalone cell.
 * Presentational: every value comes from the selection the caller already derived.
 */
export function ScenarioCandidateDetailCard({
  selection,
  exportExtension,
}: {
  selection: ScenarioCandidateSelection;
  exportExtension?: ScenarioComparisonExportExtension;
}) {
  return (
    <CandidateDetailCard
      choices={selection.choices}
      candidateId={selection.candidateId}
      onPick={selection.onPick}
      details={selection.details}
      rows={selection.rows}
      impact={selection.impact}
      placementA={selection.placementA}
      placementB={selection.placementB}
      candidateKey={selection.candidateKey}
      exportInput={selection.exportInput}
      exportExtension={exportExtension}
    />
  );
}

/** 후보 결과 변화 지도 — the frame's Row3-right card, as a standalone cell. */
export function ScenarioCandidateMapCard({
  selection,
  scope = SCOPE_ALL,
}: {
  selection: ScenarioCandidateSelection;
  scope?: SuitabilityScope;
}) {
  return (
    <ScenarioMapCard
      sideA={selection.sideA}
      sideB={selection.sideB}
      details={selection.details}
      candidateKey={selection.candidateKey}
      scope={scope}
    />
  );
}

/**
 * The lane's OWN two-column composition, kept for the standalone Page-5C view and its
 * unit test. The assembled Page-5 grid does not use it — it places the two cards in
 * the frame's own bands via the exports above — but the lane still has to be
 * renderable on its own, and this is what proves it.
 */
export default function SuitabilityScenarioCandidateComparison({
  comparison,
  initialCandidateId = null,
  exportExtension,
}: SuitabilityScenarioCandidateComparisonProps) {
  const selection = useScenarioCandidateSelection(comparison, initialCandidateId);

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="scenario-candidate-comparison">
      <ScenarioCandidateDetailCard selection={selection} exportExtension={exportExtension} />
      <ScenarioCandidateMapCard selection={selection} />
    </div>
  );
}

// --------------------------------------------------------------------------- //
// 선택 후보지 상세 비교
// --------------------------------------------------------------------------- //

interface DetailCardProps {
  choices: ReturnType<typeof candidateChoices>;
  candidateId: number | null;
  onPick: (id: number | null) => void;
  details: ReturnType<typeof useScenarioCandidateDetail>;
  rows: CandidateContributionRow[];
  impact: ReturnType<typeof majorImpactFactor>;
  placementA: ReturnType<typeof previewPlacement>;
  placementB: ReturnType<typeof previewPlacement>;
  candidateKey: string | null;
  exportInput: ScenarioComparisonExportInput;
  exportExtension?: ScenarioComparisonExportExtension;
}

function CandidateDetailCard({
  choices,
  candidateId,
  onPick,
  details,
  rows,
  impact,
  placementA,
  placementB,
  candidateKey,
  exportInput,
  exportExtension,
}: DetailCardProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = useCallback(() => {
    setExporting(true);
    setExportError(null);
    downloadScenarioComparisonWorkbook(exportInput, exportExtension)
      .catch(() => setExportError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."))
      .finally(() => setExporting(false));
  }, [exportInput, exportExtension]);

  // Both sides served a detail: the only state in which the contribution table is a
  // like-for-like comparison. One side alone is reported, not half-drawn.
  const bothReady = details.a.state === "READY" && details.b.state === "READY";
  const conflict = candidateIdentityConflict(details.a, details.b);

  return (
    <SectionCard
      title="선택 후보지 상세 비교"
      testId="scenario-candidate-detail"
      className="wep-figma-card"
      // "평가 요소별 기여도" is the <h3> of the table this card contains, so naming it
      // here too described the same thing twice before the reader saw either. The card
      // description now says only what the card uniquely offers: one chosen cell.
      description="한 후보 구역을 골라 A안과 B안의 결과를 나란히 비교합니다."
      headerAside={
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="scenario-candidate-picker">
            비교할 후보 구역
          </label>
          <select
            id="scenario-candidate-picker"
            className="min-h-8 max-w-[220px] rounded-control border border-hairline-strong bg-surface px-2 py-1 text-xs text-ink"
            value={candidateId ?? ""}
            onChange={(event) => onPick(event.target.value === "" ? null : Number(event.target.value))}
            data-testid="scenario-candidate-picker"
          >
            <option value="">후보 구역 선택…</option>
            {/* GROUPED BY 시·군·구, not a flat list.
                Every option used to lead with its own fully-qualified region name, so
                a picker over one municipality's cells read "인천광역시 옹진군 · …"
                twenty times over — the exact repetition the owner rejected. The
                시·군·구 is now the `<optgroup>` label, said once, and each option
                carries only what distinguishes it: the cell's own key and which side's
                list it came from.

                `<optgroup>` is the native grouping primitive, so this costs no custom
                listbox and keeps the control keyboard- and screen-reader-native.
                NOTHING is aggregated: a group is a label over its members, and no
                average, median or group rank is computed anywhere here. */}
            {groupRowsBySigungu(
              choices.map((item) => ({
                ...item,
                sigunguName: item.sigunguRegionName,
                sidoName: item.sidoRegionName,
              })),
            ).map((group) => (
              <optgroup
                key={group.key}
                label={`${group.label}${group.sidoLabel === null ? "" : ` (${group.sidoLabel})`}`}
              >
                {group.rows.map((item) => (
                  <option key={item.candidateId} value={item.candidateId}>
                    {item.candidateKey}
                    {item.inA && item.inB ? "" : item.inA ? " (A안 목록)" : " (B안 목록)"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className="wep-btn-primary text-xs"
            onClick={onExport}
            // Nothing to export until at least one side served a real result. A
            // workbook of empty cells is not a smaller export, it is a false one.
            disabled={exporting || candidateId === null || (!details.a.detail && !details.b.detail)}
            data-testid="scenario-candidate-export"
          >
            {exporting ? "만드는 중…" : "엑셀 다운로드"}
          </button>
        </div>
      }
    >
      {candidateId === null ? (
        <p
          className="rounded-card border border-dashed border-hairline px-3 py-6 text-center text-[13px] text-ink-muted"
          data-testid="scenario-candidate-empty"
        >
          비교할 후보 구역을 선택해 주세요. 위 목록은 A안·B안 미리보기에 포함된 후보 구역입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {conflict ? (
            <InfoBanner
              tone="error"
              title="두 결과가 서로 다른 후보 구역을 가리킵니다"
              role="alert"
              testId="scenario-candidate-conflict"
            >
              <p>같은 후보 구역의 결과가 아니므로 비교를 표시하지 않습니다.</p>
            </InfoBanner>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <SideResultCard
              slot="A"
              result={details.a}
              placement={placementA}
              candidateKey={candidateKey}
            />
            <SideResultCard
              slot="B"
              result={details.b}
              placement={placementB}
              candidateKey={candidateKey}
            />
          </div>

          {bothReady && !conflict ? (
            <ContributionTable
              rows={rows}
              impact={impact}
              aTotal={details.a.detail?.custom_score ?? null}
              bTotal={details.b.detail?.custom_score ?? null}
            />
          ) : null}

          {/* The scope the workbook will state, printed where the button is, so the
              reader knows what they are downloading before they download it. */}
          <p className="text-[11px] leading-snug text-ink-subtle" data-testid="scenario-candidate-export-scope">
            {comparisonExportScopeNote(exportInput, exportExtension)}
          </p>
          {exportError ? (
            <p className="text-[11px] text-danger" role="alert" data-testid="scenario-candidate-export-error">
              {exportError}
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

/** One side's result for the selected cell: rank, screening status, total score. */
function SideResultCard({
  slot,
  result,
  placement,
  candidateKey,
}: {
  slot: "A" | "B";
  result: CandidateSideResult;
  placement: ReturnType<typeof previewPlacement>;
  candidateKey: string | null;
}) {
  const detail = result.detail;
  return (
    <div
      className="rounded-card border border-hairline bg-surface p-3"
      data-testid={`scenario-candidate-side-${slot.toLowerCase()}`}
      data-state={result.state}
    >
      <div className="flex items-center gap-2">
        <span className="flex-none rounded-full border border-primary-border bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-ink">
          {SLOT_LABEL[slot]}
        </span>
        <span className="text-[11px] text-ink-muted">결과</span>
      </div>

      {result.state === "LOADING" ? (
        <p className="mt-2 text-[11px] text-ink-muted" role="status" data-testid="scenario-candidate-side-loading">
          이 후보 구역을 {SLOT_LABEL[slot]} 가중치로 다시 계산하는 중…
        </p>
      ) : null}

      {result.state === "BLOCKED" ? (
        <p className="mt-2 text-[11px] leading-snug text-warn" data-testid="scenario-candidate-side-blocked">
          {SLOT_LABEL[slot]}이 현재 분석 실행 기준으로 검증되지 않아 이 후보 구역의 결과를 계산하지
          않았습니다.
        </p>
      ) : null}

      {result.state === "ERROR" ? (
        <p className="mt-2 text-[11px] leading-snug text-danger" data-testid="scenario-candidate-side-error">
          {result.errorMessage}
        </p>
      ) : null}

      {detail ? (
        <>
          <p className="mt-2 text-[13px] font-bold text-ink" data-testid="scenario-candidate-side-placement">
            {/* A rank the bounded preview did not carry is stated as unavailable —
                never replaced by a number, and never by the other side's rank. */}
            {placement.inPreview && placement.rank !== null
              ? `${placement.rank}위`
              : "순위 미제공"}
            <span className="font-normal text-ink-muted"> · {statusLabel(detail.status)}</span>
          </p>
          {!placement.inPreview ? (
            <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-candidate-side-rank-note">
              이 후보 구역은 {SLOT_LABEL[slot]}의 상위 {SCENARIO_COMPARISON_TOP_N}개 미리보기 목록에
              없어 순위가 제공되지 않았습니다. 순위가 낮다는 뜻이 아닙니다.
            </p>
          ) : null}
          <p className="mt-1 text-[13px] tabular-nums text-ink" data-testid="scenario-candidate-side-score">
            종합 점수 <span className="text-[15px] font-bold">{detail.custom_score ?? "자료 없음"}</span>
          </p>
          <p className="mt-1 text-[11px] text-ink-subtle" data-testid="scenario-candidate-side-key">
            {[detail.sigungu_region_name, candidateKey].filter(Boolean).join(" · ")}
          </p>
        </>
      ) : null}
    </div>
  );
}

/** The Z/R/E/D contribution comparison — paired bars, a signed delta, and a total. */
function ContributionTable({
  rows,
  impact,
  aTotal,
  bTotal,
}: {
  rows: CandidateContributionRow[];
  impact: ReturnType<typeof majorImpactFactor>;
  aTotal: string | null;
  bTotal: string | null;
}) {
  // The bars are scaled against the largest contribution ON SCREEN, so the two sides
  // are directly comparable to each other. A per-row scale would make a small factor
  // look as large as a dominant one.
  const peak = Math.max(
    1,
    ...rows.flatMap((row) =>
      [row.aContribution, row.bContribution]
        .map((value) => (value === null ? 0 : Number(value)))
        .filter((value) => Number.isFinite(value)),
    ),
  );
  const totalDelta = totalScoreDelta(aTotal, bTotal);

  return (
    <div data-testid="scenario-candidate-contribution">
      <h3 className="text-[13px] font-bold text-ink">평가 요소별 기여도 비교</h3>
      {/* The formula, and the one thing it implies that a reader would not assume: the
          component scores are the run's and are identical on both sides, so every
          difference in this table comes from the weights. Stated as one clause rather
          than the previous two sentences. */}
      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
        가중 기여도 = 요소 점수 × 가중치. 요소 점수는 두 안에서 같으므로 차이는 모두 가중치에서
        나옵니다.
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <caption className="sr-only">A안과 B안의 평가 요소별 가중 기여도</caption>
          <thead>
            <tr className="border-b border-hairline text-[11px] font-semibold text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                평가 요소
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                A안 기여도
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                B안 기여도
              </th>
              <th scope="col" className="py-2 font-semibold">
                기여도 차이
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta = formatContributionDelta(row.deltaContribution);
              return (
                <tr
                  key={row.component}
                  className="border-b border-hairline last:border-b-0"
                  data-testid={`scenario-candidate-contribution-row-${row.component}`}
                >
                  <th scope="row" className="py-2.5 pr-3 text-[13px] font-normal text-ink">
                    {/* A code is never shown bare — always beside its Korean name. */}
                    {row.label}
                    <span className="text-ink-subtle">（{row.code}）</span>
                    <span className="mt-0.5 block text-[11px] tabular-nums text-ink-subtle">
                      요소 점수 {row.componentScore ?? "자료 없음"}
                      {row.componentScoreConflict ? " · 두 결과의 요소 점수가 다릅니다" : ""}
                    </span>
                  </th>
                  <td className="py-2.5 pr-3">
                    <ContributionCell
                      value={row.aContribution}
                      percent={row.aWeightPercent}
                      peak={peak}
                      accent={COMPONENT_ACCENT[row.component]}
                      testId="scenario-candidate-contribution-a"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <ContributionCell
                      value={row.bContribution}
                      percent={row.bWeightPercent}
                      peak={peak}
                      accent={COMPONENT_ACCENT[row.component]}
                      testId="scenario-candidate-contribution-b"
                    />
                  </td>
                  <td
                    className="py-2.5 text-[13px] font-semibold tabular-nums text-ink"
                    data-testid="scenario-candidate-contribution-delta"
                  >
                    {/* An em dash, not 0: an uncomputable delta is not "no change". */}
                    {delta ?? "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-hairline" data-testid="scenario-candidate-contribution-total">
              <th scope="row" className="py-2.5 pr-3 text-[13px] font-bold text-ink">
                종합 점수
              </th>
              <td className="py-2.5 pr-3 text-[13px] font-bold tabular-nums text-ink">
                {aTotal ?? "자료 없음"}
              </td>
              <td className="py-2.5 pr-3 text-[13px] font-bold tabular-nums text-ink">
                {bTotal ?? "자료 없음"}
              </td>
              <td className="py-2.5 text-[13px] font-bold tabular-nums text-ink">
                {formatContributionDelta(totalDelta) ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 주요 영향 요인 — descriptive. It names the factor whose contribution moved
          most between the reader's own two weightings; it does not claim the cell
          passed, failed, rose or fell "because of" it, and it cannot: screening is
          rule-based and unaffected by the weights. */}
      <p
        className="mt-3 rounded-card bg-surface-muted px-3 py-2 text-[12px] leading-snug text-ink"
        data-testid="scenario-candidate-major-impact"
      >
        <span className="font-semibold">주요 영향 요인 </span>
        {majorImpactSentence(impact)}
      </p>

      {/* The exact served decimals stay reachable, as everywhere else a rounded
          figure is shown. The percentages above are presentation; these are values. */}
      <details className="mt-2" data-testid="scenario-candidate-precise">
        <summary className="cursor-pointer text-[11px] text-ink-muted">정밀값 보기</summary>
        <dl className="mt-2 grid gap-1 text-[11px] text-ink-muted">
          {rows.map((row) => (
            <div key={row.component} className="flex flex-wrap gap-x-3">
              <dt className="font-medium">
                {row.label}（{row.code}）
              </dt>
              <dd className="tabular-nums">
                요소 점수 A안 {row.aComponentScore ?? "자료 없음"} · B안{" "}
                {row.bComponentScore ?? "자료 없음"} / 가중치 A안 {row.aWeight ?? "자료 없음"} · B안{" "}
                {row.bWeight ?? "자료 없음"} / 기여도 A안 {row.aContribution ?? "자료 없음"} · B안{" "}
                {row.bContribution ?? "자료 없음"}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function ContributionCell({
  value,
  percent,
  peak,
  accent,
  testId,
}: {
  value: string | null;
  percent: number | null;
  peak: number;
  accent: string;
  testId: string;
}) {
  if (value === null) {
    return (
      <span className="text-[13px] text-ink-subtle" data-testid={testId}>
        자료 없음
      </span>
    );
  }
  const numeric = Number(value);
  const width = Number.isFinite(numeric) ? Math.max(0, Math.min(100, (numeric / peak) * 100)) : 0;
  return (
    <span className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-full max-w-[120px] flex-1 rounded-pill bg-surface-muted" aria-hidden="true">
          <span
            className="block h-2.5 rounded-pill"
            style={{ width: `${width}%`, backgroundColor: accent }}
          />
        </span>
        <span className="flex-none text-[13px] font-semibold tabular-nums text-ink">{value}</span>
      </span>
      <span className="text-[11px] tabular-nums text-ink-subtle">
        가중치 {percent === null ? "자료 없음" : `${percent}%`}
      </span>
    </span>
  );
}

// --------------------------------------------------------------------------- //
// 후보 결과 변화 지도 — one MapLibre instance, two scenario sources
// --------------------------------------------------------------------------- //

/**
 * "35% / 25% / 25% / 15%" — the weights the tiles on screen were coloured by, so the
 * map states its own provenance now that the legend overlay no longer carries it.
 * `자료 없음` rather than a guess when a side has no served weights.
 */
function weightSummary(weights: UserScenarioWeights | null): string {
  if (weights === null) return "자료 없음";
  return COMPONENT_ORDER.map((component) => {
    const value = Number(weights[component]);
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "자료 없음";
  }).join(" / ");
}

function ScenarioMapCard({
  sideA,
  sideB,
  details,
  candidateKey,
  scope = SCOPE_ALL,
}: {
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  details: ReturnType<typeof useScenarioCandidateDetail>;
  candidateKey: string | null;
  /** The analysis scope, so the map draws the population the ranking described. */
  scope?: SuitabilityScope;
}) {
  const [slot, setSlot] = useState<"A" | "B">("A");
  const active = slot === "A" ? sideA : sideB;
  // Stable identity for equal scopes, so a re-rendered scope object does not
  // rebuild the tile URL (and therefore does not re-create the map source).
  const scopeQueryKey = scopeKey(scope);

  // The REAL scenario tile contract: the run, the server's canonical weights, and the
  // server's scenario hash. All three come from that side's own preview response, so
  // the tiles rendered are the tiles that side's numbers were computed from.
  const tileUrl = useMemo(() => {
    if (active.runId === null || active.canonicalWeights === null || active.preview === null) {
      return null;
    }
    // …AND the analysis scope, so the cells drawn are the cells ranked. Without it a
    // 경기-scoped comparison drew 인천 cells its own ranking had excluded.
    return userScenarioTileUrl(
      active.runId,
      active.canonicalWeights,
      active.preview.scenario_hash,
      scopeToQuery(scope),
    );
    // `scopeQueryKey` stands in for `scope` (stable identity for equal scopes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.runId, active.canonicalWeights, active.preview, scopeQueryKey]);

  // The selected cell's geometry, from whichever side served a detail. The GEOMETRY IS
  // THE RUN'S and does not change with the weights, so the same cell is highlighted
  // under both sides and the toggle never moves or reselects it.
  const selectedCandidate = useMemo(() => {
    const detail = details.a.detail ?? details.b.detail;
    if (!detail) return null;
    return { candidate_id: detail.candidate_id, geometry: detail.geometry };
  }, [details.a.detail, details.b.detail]);

  const toggle = (
    // The shared segmented control (`.wep-segment`), so the A/B switch looks and
    // behaves like every other segmented choice in the product and its selected state
    // is carried by `aria-pressed` rather than by colour alone.
    <div
      className="wep-segment-track"
      role="group"
      aria-label="지도에 표시할 시나리오"
      data-testid="scenario-map-toggle"
    >
      {(["A", "B"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setSlot(value)}
          aria-pressed={slot === value}
          className="wep-segment text-xs"
          data-testid={`scenario-map-toggle-${value.toLowerCase()}`}
        >
          {SLOT_LABEL[value]} 지도
        </button>
      ))}
    </div>
  );

  return (
    <SectionCard
      title="후보 결과 변화 지도"
      testId="scenario-map"
      className="wep-figma-card"
      // The screening-invariance caveat is NOT repeated here. It is stated under the
      // map (`scenario-map-note`), where the legend a reader might misread sits, and
      // once more as the page's standing limit. Three times on one screen is where a
      // standing caveat stops being read.
      description="같은 후보 격자를 A안과 B안의 가중치로 각각 채색합니다."
      headerAside={toggle}
    >
      {tileUrl === null ? (
        // The map alone fails; the contribution/detail sections above are untouched.
        <div
          className="rounded-card border border-dashed border-hairline px-3 py-10 text-center"
          data-testid="scenario-map-unavailable"
        >
          <p className="text-[13px] font-semibold text-ink">지도 비교를 불러올 수 없습니다.</p>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
            {SLOT_LABEL[slot]}의 시나리오 지도 정보를 확인할 수 없습니다. 위의 상세 비교는 그대로
            사용할 수 있습니다.
          </p>
        </div>
      ) : (
        // The frame's map区 is 272 tall inside a 636-wide card. 360 here: tall enough
        // that the capital region is legible at this width, short enough that Row3
        // stays close to the frame's 478.
        //
        // The floating `MapLegendOverlay` was REMOVED from this card (only this one).
        // It is CSS-forced open at md+ (`.map-legend` in globals.css) and is a tall
        // card; at 636 wide it covered roughly half the map and most of its height,
        // which is what the previous 520px height was working around. The frame puts a
        // one-line legend UNDER the map instead, and that is what this card now does —
        // same screening statuses, same score ramp, same colours, no map obscured.
        // The shared overlay is untouched, so every other map keeps it.
        <div className="relative h-[360px] overflow-hidden rounded-card" data-testid="scenario-map-canvas">
          <MapView
            boundaries={EMPTY_BOUNDARIES}
            regionValues={new Map()}
            breaks={[]}
            palette={CANDIDATE_SCORE_PALETTE_5}
            metricLabel=""
            metricUnit=""
            metricReferencePeriod=""
            facilities={[]}
            showFacilities={false}
            mode="suitability"
            showWetlands={false}
            wetlandTileUrl={null}
            wetlandTypeVisibility={NO_WETLAND_TYPES}
            wetlandDesignationOnly={false}
            showLandCover={false}
            landCoverTileUrl={null}
            landCoverMode="coverage"
            landCoverClassLevel={1}
            landCoverCoverage={defaultCoverageVisibility()}
            landCoverHiddenClassCodes={[]}
            landCoverClasses={emptyAvailableClasses()}
            // Toggling A/B changes ONLY this prop. MapView swaps the vector source in
            // place, so the instance, the viewport and the highlight all persist.
            candidateTileUrl={tileUrl}
            candidateBreaks={CANDIDATE_SCORE_BREAKS}
            candidateContext="scenario"
            statusVisibility={ALL_STATUSES_VISIBLE}
            stableOnly={false}
            selectedCandidate={selectedCandidate}
            // The cell is chosen in the picker above; a map click would need to write
            // back into that selection, which this lane deliberately does not do.
            onCandidateClick={() => undefined}
            ariaLabel={`${SLOT_LABEL[slot]} 시나리오 후보 격자 지도 (suitability candidate grid, interactive map)`}
            ariaDescription={
              `${SLOT_LABEL[slot]}의 가중치로 다시 계산한 500m 후보 격자 지도입니다. ` +
              (candidateKey
                ? `선택한 후보 구역 ${candidateKey}이 강조되어 있으며, 같은 구역이 두 안에서 동일하게 표시됩니다. `
                : "") +
              "배제·검토 판정은 규칙 기반이라 A안과 B안에서 같습니다. 상세 값은 왼쪽 '선택 후보지 상세 비교'에서 확인할 수 있습니다."
            }
          />
        </div>
      )}

      {/* The frame's legend row, with the product's OWN categories. A/B does not create
          new pass/fail categories, so this is the existing screening triple and the
          existing score ramp — never 신규 통과 / 통과 유지 / 통과 → 제외, which would
          describe a status change a reweighting cannot cause. */}
      {tileUrl !== null ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="scenario-map-legend">
          {(
            [
              [STATUS_LABELS.ELIGIBLE, CANDIDATE_SCORE_PALETTE_5[3]],
              [STATUS_LABELS.REVIEW_REQUIRED, CANDIDATE_REVIEW_COLOR],
              [STATUS_LABELS.EXCLUDED, CANDIDATE_EXCLUDED_COLOR],
            ] as const
          ).map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <span
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              {label}
            </span>
          ))}

          <span className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
              {CANDIDATE_SCORE_PALETTE_5.map((color) => (
                <span key={color} className="h-2.5 w-3.5" style={{ backgroundColor: color }} />
              ))}
            </span>
            통과 셀 점수 0–100
          </span>
        </div>
      ) : null}

      {/* The map's own provenance: which weights coloured the tiles now on screen —
          that changes with the A/B toggle, so it cannot be read off the weight table
          alone. The screening sentence stays HERE (and only here, among the card's
          three text slots) because the legend directly above shows 배제/검토 swatches
          that a reader could otherwise take as moving with the weights. */}
      <p className="mt-2 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-map-note">
        색은 이 시나리오 가중치(Z/R/E/D {weightSummary(active.canonicalWeights)})로 다시 계산한
        점수입니다. 배제·검토 판정(스크리닝)은 규칙 기반이며 A안과 B안에서 달라지지 않습니다.{" "}
        {SUITABILITY_SCREENING_SHORT_LABEL}.
      </p>
    </SectionCard>
  );
}
