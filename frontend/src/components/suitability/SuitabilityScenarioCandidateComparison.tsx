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

import { userScenarioTileUrl, type RegionBoundaryCollection } from "../../lib/api";
import { SUITABILITY_SCREENING_SHORT_LABEL, statusLabel } from "../../lib/glossary";
import { defaultCoverageVisibility, emptyAvailableClasses } from "../../lib/landCoverLayer";
import {
  CANDIDATE_EXCLUDED_COLOR,
  CANDIDATE_REVIEW_COLOR,
  CANDIDATE_SCORE_BREAKS,
  CANDIDATE_SCORE_PALETTE_5,
  CANDIDATE_STABLE_OUTLINE_COLOR,
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
  type ScenarioComparisonExportInput,
} from "../../lib/scenarioComparisonExport";
import { WETLAND_TYPES, type WetlandType } from "../../lib/wetland";
import MapLegendOverlay from "../MapLegendOverlay";
import { type StatusVisibility } from "../MapView";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";
import { COMPONENT_ACCENT } from "./factorAccents";
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
}

export default function SuitabilityScenarioCandidateComparison({
  comparison,
  initialCandidateId = null,
}: SuitabilityScenarioCandidateComparisonProps) {
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

  const details = useScenarioCandidateDetail(comparison, candidateId);
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

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="scenario-candidate-comparison">
      <CandidateDetailCard
        choices={choices}
        candidateId={candidateId}
        onPick={setPicked}
        details={details}
        rows={rows}
        impact={impact}
        placementA={placementA}
        placementB={placementB}
        candidateKey={candidateKey}
        exportInput={exportInput}
      />
      <ScenarioMapCard
        sideA={sideA}
        sideB={sideB}
        details={details}
        candidateKey={candidateKey}
      />
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
}: DetailCardProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = useCallback(() => {
    setExporting(true);
    setExportError(null);
    downloadScenarioComparisonWorkbook(exportInput)
      .catch(() => setExportError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."))
      .finally(() => setExporting(false));
  }, [exportInput]);

  // Both sides served a detail: the only state in which the contribution table is a
  // like-for-like comparison. One side alone is reported, not half-drawn.
  const bothReady = details.a.state === "READY" && details.b.state === "READY";
  const conflict = candidateIdentityConflict(details.a, details.b);

  return (
    <SectionCard
      title="선택 후보지 상세 비교"
      testId="scenario-candidate-detail"
      className="wep-figma-card"
      description="한 후보 구역을 A안과 B안의 가중치로 각각 다시 계산해 평가 요소별 기여도를 비교합니다."
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
            {choices.map((item) => (
              <option key={item.candidateId} value={item.candidateId}>
                {[item.sigunguRegionName, item.candidateKey].filter(Boolean).join(" · ")}
                {item.inA && item.inB ? "" : item.inA ? " (A안 목록)" : " (B안 목록)"}
              </option>
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
            {comparisonExportScopeNote(exportInput)}
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
      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
        가중 기여도 = 요소 점수 × 가중치. 요소 점수는 분석 실행의 값이라 두 안에서 같고, 달라지는 것은
        가중치뿐입니다.
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

function ScenarioMapCard({
  sideA,
  sideB,
  details,
  candidateKey,
}: {
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  details: ReturnType<typeof useScenarioCandidateDetail>;
  candidateKey: string | null;
}) {
  const [slot, setSlot] = useState<"A" | "B">("A");
  const active = slot === "A" ? sideA : sideB;

  // The REAL scenario tile contract: the run, the server's canonical weights, and the
  // server's scenario hash. All three come from that side's own preview response, so
  // the tiles rendered are the tiles that side's numbers were computed from.
  const tileUrl = useMemo(() => {
    if (active.runId === null || active.canonicalWeights === null || active.preview === null) {
      return null;
    }
    return userScenarioTileUrl(active.runId, active.canonicalWeights, active.preview.scenario_hash);
  }, [active.runId, active.canonicalWeights, active.preview]);

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
      description="같은 후보 격자를 A안과 B안의 가중치로 각각 채색합니다. 배제·검토 판정은 두 안에서 동일합니다."
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
        // 520px, not the ~420 the Figma card implies: the product's floating legend
        // is CSS-forced open at md+ (`.map-legend` in globals.css) and is a tall card.
        // At 420 it covered most of a half-width map. Heightening this section is the
        // local fix; collapsing the shared legend would change it on every map.
        <div className="relative h-[520px] overflow-hidden rounded-card" data-testid="scenario-map-canvas">
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
          {/* The product's EXISTING suitability legend, unchanged. A/B does not create
              new pass/fail categories, so the legend keeps its three screening statuses
              and its score classes rather than being reinterpreted per side. */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[min(90%,260px)]">
            <div className="pointer-events-auto">
              <MapLegendOverlay
                mode="suitability"
                scoreClasses={CANDIDATE_SCORE_PALETTE_5.map((color, index) => {
                  const lower = index === 0 ? null : CANDIDATE_SCORE_BREAKS[index - 1];
                  const upper =
                    index < CANDIDATE_SCORE_BREAKS.length ? CANDIDATE_SCORE_BREAKS[index] : null;
                  return {
                    color,
                    range:
                      lower === null ? `< ${upper}` : upper === null ? `≥ ${lower}` : `${lower} – ${upper}`,
                  };
                })}
                eligibleColor={CANDIDATE_SCORE_PALETTE_5[3]}
                reviewColor={CANDIDATE_REVIEW_COLOR}
                excludedColor={CANDIDATE_EXCLUDED_COLOR}
                statusVisibility={ALL_STATUSES_VISIBLE}
                // Read-only here: this map shows one cell in context, and hiding a
                // status would change what the two sides are compared against.
                onToggleStatus={() => undefined}
                statusLabels={STATUS_LABELS}
                statusCounts={null}
                stabilityAvailable={false}
                stableOnly={false}
                onToggleStableOnly={() => undefined}
                stableOutlineColor={CANDIDATE_STABLE_OUTLINE_COLOR}
                disclaimer={SUITABILITY_SCREENING_SHORT_LABEL}
                scenarioActive
                scenarioWeights={active.canonicalWeights}
              />
            </div>
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-map-note">
        지도의 색은 해당 시나리오 가중치로 다시 계산한 점수입니다. 배제·검토 판정(스크리닝)은 규칙
        기반이며 A안과 B안에서 달라지지 않습니다.
      </p>
    </SectionCard>
  );
}
