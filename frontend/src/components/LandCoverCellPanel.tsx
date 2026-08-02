"use client";

/**
 * 토지피복 section of the suitability candidate-detail panel (Phase 1B-LC5A).
 *
 * Given the SELECTED candidate's own stable `candidate_key`, this reads the two
 * read-only LC4 endpoints — the cell's statistics and its complete L1/L2/L3 class
 * distribution — and presents them beside the existing suitability details. It is
 * DESCRIPTIVE only: the served `used_in_suitability_scoring` is false and the panel
 * says so in plain Korean rather than leaving the reader to assume either way.
 *
 * Boundaries this component holds:
 *
 *  - The key is the candidate's served identity, never derived from coordinates,
 *    array order, rank, or display text, and no request is issued without one.
 *  - Only aggregated per-cell statistics are requested. Raw land-cover features and
 *    original land-cover geometry are never fetched or rendered.
 *  - A superseded candidate can never paint over the current one: each selection
 *    change aborts the in-flight requests AND the late resolution is dropped by an
 *    explicit key check before any state is written.
 *  - A land-cover failure is contained here. It renders a bounded Korean message
 *    inside this section and leaves every existing suitability detail intact; no
 *    backend internals (status text, SQL, paths, stack traces) are surfaced.
 *  - Uncovered area is displayed as a coverage measurement, never as a class. No
 *    Unknown/Unclassified/기타 row is ever synthesized, and a NO_COVERAGE cell shows
 *    no class rows at all.
 *
 * This phase is candidate-detail only: no map-wide choropleth, no land-cover map
 * layer, no legend, and no land-cover filter (those are Phase 1B-LC5B).
 */

import { useEffect, useMemo, useState } from "react";

import SegmentedControl from "./ui/SegmentedControl";
import {
  fetchLandCoverCellClasses,
  fetchLandCoverCellStatistics,
  type LandCoverCellClassDistribution,
  type LandCoverCellStatistics,
} from "../lib/api";
import {
  CLASS_LEVELS,
  CLASS_LEVEL_LABELS,
  COVERAGE_STATUS_CAVEATS,
  COVERAGE_STATUS_LABELS,
  COVERAGE_STATUS_TONES,
  LAND_COVER_ERROR_MESSAGES,
  LAND_COVER_SOURCE_LABEL,
  classCountForLevel,
  classRowsForLevel,
  formatAreaKm2,
  formatAreaM2,
  formatCoverageRatioPercent,
  formatDominantClass,
  formatSharePercent,
  formatUncoveredRatioPercent,
  landCoverErrorKind,
  validateCellStatistics,
  validateClassDistribution,
  type ClassLevel,
  type LandCoverErrorKind,
} from "../lib/landCover";

/** How many class rows are shown before the "전체 보기" expansion. */
const COLLAPSED_ROW_LIMIT = 8;

/** SegmentedControl is keyed by string; the numeric class level is mapped at the edges. */
type ClassLevelKey = "1" | "2" | "3";

interface LoadedStatistics {
  detail: LandCoverCellStatistics;
  classes: LandCoverCellClassDistribution;
}

/** The settled outcome of one candidate's pair of requests. */
type LandCoverOutcome =
  | { kind: "ready"; data: LoadedStatistics }
  | { kind: "error"; errorKind: LandCoverErrorKind };

/**
 * A settled outcome TAGGED with the candidate key that produced it — the same
 * request-state convention the dashboard already uses for the flow-mode filters.
 *
 * Loading is therefore DERIVED ("no settled outcome for the current key") rather
 * than stored, which makes a stale render structurally impossible: an outcome tagged
 * with a previous candidate can never satisfy the current key, so a superseded
 * response cannot be displayed even if it arrives late. Deriving it also keeps the
 * effect free of any synchronous setState.
 */
interface TaggedOutcome {
  key: string;
  outcome: LandCoverOutcome;
}

type PanelState = { kind: "idle" } | { kind: "loading" } | LandCoverOutcome;

/** Tone → container classes. Each state also carries its own label and sentence. */
const TONE_CLASSES: Record<string, string> = {
  informational: "border-hairline bg-surface-muted",
  warning: "border-amber-300 bg-amber-50",
  unevaluated: "border-slate-400 bg-slate-100",
};

export interface LandCoverCellPanelProps {
  /**
   * The selected candidate's stable `candidate_key` as served by the suitability
   * API, or null when nothing is selected. Nothing is requested while it is null.
   */
  candidateKey: string | null;
}

export default function LandCoverCellPanel({ candidateKey }: LandCoverCellPanelProps) {
  const [result, setResult] = useState<TaggedOutcome | null>(null);

  useEffect(() => {
    // No valid candidate key → no request is issued at all.
    if (!candidateKey) return;

    const controller = new AbortController();
    // Captured so the late-resolution guard compares against the key this request
    // was actually made for, not whatever is selected by the time it settles.
    const requestedKey = candidateKey;
    let superseded = false;

    Promise.all([
      fetchLandCoverCellStatistics(requestedKey, controller.signal),
      fetchLandCoverCellClasses(requestedKey, controller.signal),
    ])
      .then(([rawDetail, rawClasses]) => {
        if (superseded || controller.signal.aborted) return;
        const detail = validateCellStatistics(rawDetail, requestedKey);
        const classes = validateClassDistribution(rawClasses, requestedKey);
        // A response that does not cohere is reported as such — never rendered with
        // defaulted areas or shares, which would fabricate measurements.
        if (!detail || !classes || detail.coverage_status !== classes.coverage_status) {
          setResult({ key: requestedKey, outcome: { kind: "error", errorKind: "MALFORMED" } });
          return;
        }
        setResult({ key: requestedKey, outcome: { kind: "ready", data: { detail, classes } } });
      })
      .catch((error: unknown) => {
        if (superseded || controller.signal.aborted) return;
        setResult({
          key: requestedKey,
          outcome: { kind: "error", errorKind: landCoverErrorKind(error) },
        });
      });

    return () => {
      superseded = true;
      controller.abort();
    };
  }, [candidateKey]);

  // Only an outcome tagged with the CURRENT key may be shown. Anything else is
  // still loading as far as this candidate is concerned.
  const state: PanelState = !candidateKey
    ? { kind: "idle" }
    : result?.key === candidateKey
      ? result.outcome
      : { kind: "loading" };

  if (state.kind === "idle") {
    return (
      <section
        className="mt-2 rounded-card border border-hairline bg-surface-muted p-3 text-xs text-ink-muted"
        data-testid="land-cover-cell-panel"
        aria-label={`${LAND_COVER_SOURCE_LABEL} 격자 통계`}
      >
        <LandCoverHeading />
        <p className="mt-1" data-testid="land-cover-idle">
          후보 구역을 선택하면 해당 격자의 토지피복 통계를 표시합니다.
        </p>
      </section>
    );
  }

  return (
    <section
      className="mt-2 rounded-card border border-hairline bg-surface p-3 text-xs text-ink-muted"
      data-testid="land-cover-cell-panel"
      aria-label={`${LAND_COVER_SOURCE_LABEL} 격자 통계`}
    >
      <LandCoverHeading />

      {state.kind === "loading" && (
        <p className="mt-2 text-ink-subtle" role="status" data-testid="land-cover-loading">
          토지피복 통계를 불러오는 중입니다…
        </p>
      )}

      {state.kind === "error" && (
        <p
          className="mt-2 rounded border border-hairline-strong bg-surface-muted p-2 text-ink-muted"
          data-testid="land-cover-error"
        >
          {LAND_COVER_ERROR_MESSAGES[state.errorKind]}
        </p>
      )}

      {/* Keyed by the candidate: selecting a different cell remounts the body, so the
          chosen class level and the row expansion reset to their defaults rather than
          carrying one candidate's view state onto another's numbers. */}
      {state.kind === "ready" && <LandCoverBody key={candidateKey} data={state.data} />}
    </section>
  );
}

function LandCoverHeading() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-1">
      <h3 className="text-sm font-semibold text-ink">
        {LAND_COVER_SOURCE_LABEL} <span className="font-normal text-ink-subtle">격자 통계</span>
      </h3>
      <span className="text-[11px] text-ink-subtle" data-testid="land-cover-scoring-badge">
        점수 미반영 · 참고용
      </span>
    </div>
  );
}

function LandCoverBody({ data }: { data: LoadedStatistics }) {
  const [level, setLevel] = useState<ClassLevel>(1);
  const [showAllRows, setShowAllRows] = useState(false);

  const { detail, classes } = data;
  const status = detail.coverage_status;
  const tone = COVERAGE_STATUS_TONES[status];
  // A NO_COVERAGE cell has no dominant class at ANY level, so the per-level
  // independence note below would describe nothing. Keyed off the served L1 code
  // rather than off the status, so it follows the data even if the two ever diverge.
  const hasDominantClass = detail.dominant_class.l1_code != null;
  // Deterministic: the API's own order (level ascending, then area descending) is
  // preserved by filtering; nothing is re-sorted, re-grouped, or merged here.
  const rows = useMemo(() => classRowsForLevel(classes.items, level), [classes.items, level]);
  const visibleRows = showAllRows ? rows : rows.slice(0, COLLAPSED_ROW_LIMIT);
  const hiddenCount = rows.length - visibleRows.length;

  const onLevelChange = (next: ClassLevel) => {
    setLevel(next);
    setShowAllRows(false);
  };
  const onToggleRows = () => setShowAllRows((current) => !current);

  return (
    <div data-testid="land-cover-body">
      {/* Coverage state first: every number below it is qualified by this. */}
      <div
        className={`mt-2 rounded border p-2 ${TONE_CLASSES[tone]}`}
        data-testid="land-cover-coverage"
        data-coverage-status={status}
        data-coverage-tone={tone}
      >
        <p className="font-semibold text-ink" data-testid="land-cover-coverage-label">
          {COVERAGE_STATUS_LABELS[status]} · 평가 비율 {formatCoverageRatioPercent(detail.coverage_ratio, status)}
        </p>
        <p className="mt-1" data-testid="land-cover-coverage-caveat">
          {COVERAGE_STATUS_CAVEATS[status]}
        </p>
        {/* The backend's own served meaning, verbatim, beside our summary. */}
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-coverage-meaning">
          {detail.coverage_status_meaning}
        </p>
        {status === "PARTIAL" && (
          <p className="mt-1 font-medium text-amber-800" data-testid="land-cover-partial-warning">
            평가된 면적 {formatAreaM2(detail.evaluated_area_m2)} (
            {formatCoverageRatioPercent(detail.coverage_ratio, status)}) · 미평가 면적{" "}
            {formatAreaM2(detail.uncovered_area_m2)} (
            {formatUncoveredRatioPercent(detail.coverage_ratio, status)}). 아래 분류 구성은 격자 전체가
            아니라 평가된 부분의 구성입니다.
          </p>
        )}
        {status === "NO_COVERAGE" && (
          <p className="mt-1 font-medium text-ink" data-testid="land-cover-no-coverage-warning">
            {detail.disclosures.no_coverage_warning_ko}
          </p>
        )}
      </div>

      {/* Measurements. The cell area is the candidate cell's ACTUAL area in the
          release's area CRS, not a nominal 500 × 500 m. */}
      <dl
        className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2"
        data-testid="land-cover-measurements"
      >
        <Measurement label="기준연도" value={detail.release.reference_period} testId="land-cover-reference-period" />
        <Measurement label="평가 비율" value={formatCoverageRatioPercent(detail.coverage_ratio, status)} />
        <Measurement
          label="격자 실면적"
          value={`${formatAreaM2(detail.cell_area_m2)} (${formatAreaKm2(detail.cell_area_m2)})`}
          testId="land-cover-cell-area"
        />
        <Measurement
          label="평가된 면적"
          value={formatAreaM2(detail.evaluated_area_m2)}
          testId="land-cover-evaluated-area"
        />
        <Measurement
          label="미평가 면적"
          value={formatAreaM2(detail.uncovered_area_m2)}
          testId="land-cover-uncovered-area"
          note="미평가 면적은 격자의 피복 여부 측정값이며, 하나의 토지피복 분류가 아닙니다."
        />
        <Measurement
          label="면적 기준 좌표계"
          value={detail.area_crs}
        />
      </dl>

      {/* Dominant class at all three official levels. Absent for NO_COVERAGE — shown
          as an explicit 해당 없음, never a blank or a zero code. */}
      <div className="mt-2" data-testid="land-cover-dominant">
        <p className="font-medium text-ink">우세 분류</p>
        <dl className="mt-1 flex flex-col gap-0.5">
          <Measurement
            label={`${CLASS_LEVEL_LABELS[1]} (L1)`}
            value={formatDominantClass(detail.dominant_class.l1_code, detail.dominant_class.l1_name)}
            testId="land-cover-dominant-l1"
          />
          <Measurement
            label={`${CLASS_LEVEL_LABELS[2]} (L2)`}
            value={formatDominantClass(detail.dominant_class.l2_code, detail.dominant_class.l2_name)}
            testId="land-cover-dominant-l2"
          />
          <Measurement
            label={`${CLASS_LEVEL_LABELS[3]} (L3)`}
            value={formatDominantClass(detail.dominant_class.l3_code, detail.dominant_class.l3_name)}
            testId="land-cover-dominant-l3"
          />
        </dl>
        {/* Each level's dominant class is the largest class AT THAT LEVEL, computed
            independently. The three therefore need not nest: in the active release
            3,518 of 47,893 cells (7.3%) have a 중분류 outside their 대분류, because a
            대분류 total is a SUM over its 중분류 members and the largest sum need not
            contain the largest single member. Stated so a reader never reads a correct
            non-nesting triple as a data error. Absent for NO_COVERAGE, which has no
            dominant class at any level. */}
        {hasDominantClass ? (
          <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-dominant-note">
            각 수준의 우세 분류는 해당 수준에서 면적이 가장 큰 분류를 따로 계산한 값입니다. 대분류
            면적은 그 하위 중분류 면적의 합이므로, 중분류·세분류 우세 분류가 대분류 우세 분류에
            속하지 않을 수 있습니다.
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-class-counts">
          분류 개수 — {CLASS_LEVEL_LABELS[1]} {classCountForLevel(detail.class_counts, 1) ?? "—"}개 ·{" "}
          {CLASS_LEVEL_LABELS[2]} {classCountForLevel(detail.class_counts, 2) ?? "—"}개 ·{" "}
          {CLASS_LEVEL_LABELS[3]} {classCountForLevel(detail.class_counts, 3) ?? "—"}개
        </p>
      </div>

      {/* Class distribution. */}
      <div className="mt-3" data-testid="land-cover-distribution">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-ink">분류 구성</p>
          <SegmentedControl<ClassLevelKey>
            options={CLASS_LEVELS.map((value) => ({
              key: String(value) as ClassLevelKey,
              label: `${CLASS_LEVEL_LABELS[value]} (L${value})`,
              testId: `land-cover-level-${value}`,
            }))}
            value={String(level) as ClassLevelKey}
            onChange={(next) => onLevelChange(Number(next) as ClassLevel)}
            ariaLabel="토지피복 분류 단계 선택"
            testId="land-cover-level-switch"
          />
        </div>

        {classes.items.length === 0 ? (
          <p className="mt-2" data-testid="land-cover-no-classes">
            {status === "NO_COVERAGE"
              ? "이 격자에는 분류 항목이 없습니다. 확보된 토지피복 자료가 이 격자를 평가하지 않았기 때문이며, 대체 분류를 만들어 표시하지 않습니다."
              : "표시할 분류 항목이 없습니다. 값을 만들어 채우지 않습니다."}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-2" data-testid="land-cover-level-empty">
            이 단계({CLASS_LEVEL_LABELS[level]})에는 분류 항목이 없습니다.
          </p>
        ) : (
          <>
            {/* Four columns, not five: the official code shares a cell with its
                official name so that BOTH share columns fit the narrow sidebar
                without horizontal scrolling. The whole-cell column is the one that
                carries "this is not the whole cell" for a PARTIAL cell, so it must
                not sit off-screen by default. The scroll container stays as a safety
                net for very narrow viewports. */}
            <div className="mt-2 overflow-x-auto">
              <table
                className="w-full min-w-[17rem] text-left tabular-nums"
                data-testid="land-cover-class-table"
              >
                <caption className="sr-only">
                  {CLASS_LEVEL_LABELS[level]} 토지피복 분류별 공식 코드·공식 분류명·면적과 비율. 비율은
                  평가된 면적 기준과 격자 전체 면적 기준을 각각 표시합니다.
                </caption>
                {/* `break-keep` (word-break: keep-all) so the Korean headers wrap
                    between words rather than mid-word ("평가면적 / 대비", not "대 / 비"). */}
                <thead>
                  <tr className="break-keep text-ink-subtle">
                    <th scope="col" className="pr-2 font-medium">
                      코드 · 공식 분류명
                    </th>
                    <th scope="col" className="pr-2 text-right font-medium">
                      면적
                    </th>
                    <th scope="col" className="pr-2 text-right font-medium">
                      평가면적 대비
                    </th>
                    <th scope="col" className="text-right font-medium">
                      격자 전체 대비
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={`${row.class_level}-${row.class_code}`} data-testid="land-cover-class-row">
                      {/* Official code and official Korean name, both verbatim. */}
                      <td className="pr-2 break-keep">
                        <span
                          className="mr-1 font-mono text-[11px] text-ink-subtle"
                          data-testid="land-cover-class-code"
                        >
                          {row.class_code}
                        </span>
                        <span data-testid="land-cover-class-name">{row.class_name}</span>
                      </td>
                      <td className="pr-2 text-right">{formatAreaM2(row.class_area_m2)}</td>
                      <td className="pr-2 text-right" data-testid="land-cover-share-evaluated">
                        {formatSharePercent(row.share_of_evaluated_area)}
                      </td>
                      <td className="text-right" data-testid="land-cover-share-cell">
                        {formatSharePercent(row.share_of_cell_area)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={onToggleRows}
                className="mt-1 text-primary underline"
                data-testid="land-cover-expand-rows"
              >
                {`나머지 ${hiddenCount}개 분류 더 보기 (전체 ${rows.length}개)`}
              </button>
            )}
            {showAllRows && rows.length > COLLAPSED_ROW_LIMIT && (
              <button
                type="button"
                onClick={onToggleRows}
                className="mt-1 text-primary underline"
                data-testid="land-cover-collapse-rows"
              >
                {`분류 목록 접기 (상위 ${COLLAPSED_ROW_LIMIT}개만 보기)`}
              </button>
            )}

            {/* Both denominators named explicitly. No column is normalized to sum to
                100%: the evaluated-area shares sum to the evaluated part only, and for
                a PARTIAL cell the whole-cell shares deliberately do NOT reach 100%. */}
            <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-denominators">
              &lsquo;평가면적 대비&rsquo;의 분모는 평가된 면적 {formatAreaM2(detail.evaluated_area_m2)},
              &lsquo;격자 전체 대비&rsquo;의 분모는 격자 실면적 {formatAreaM2(detail.cell_area_m2)}입니다.
              {status === "PARTIAL"
                ? " 미평가 면적이 있으므로 격자 전체 대비 비율의 합은 100%에 이르지 않으며, 합계를 100%로 맞추지 않습니다."
                : " 두 비율의 합계를 100%로 맞추지 않습니다."}
            </p>
          </>
        )}
      </div>

      {/* Scoring + licence disclosures — always visible body text, never tucked
          inside a tooltip or a collapsed element the reader may never open. */}
      <div className="mt-3 border-t border-hairline pt-2">
        <p className="font-medium text-ink" data-testid="land-cover-scoring-disclosure">
          점수 반영: 미반영 (used_in_suitability_scoring:{" "}
          {String(detail.used_in_suitability_scoring)})
        </p>
        <p className="mt-0.5" data-testid="land-cover-scoring-statement">
          이 토지피복 통계는 설명용 자료이며, 적합성 점수·순위·적격 상태·제외 사유·검토 사유에 사용되지
          않습니다.
        </p>
        <p className="mt-1" data-testid="land-cover-license-disclosure">
          공공이용/라이선스 상태: {detail.disclosures.license_status}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-subtle" data-testid="land-cover-license-statement">
          {detail.disclosures.license_statement}
        </p>
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-availability">
          {detail.disclosures.availability_statement}
        </p>
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-class-label-statement">
          {detail.disclosures.class_label_statement}
        </p>
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="land-cover-uncovered-statement">
          {detail.disclosures.uncovered_area_statement}
        </p>
        {/* Compact provenance: which frozen derivation produced these numbers. */}
        <p
          className="mt-1 font-mono text-[11px] break-all text-ink-subtle"
          data-testid="land-cover-provenance"
        >
          {detail.derivation_version} · 통계 릴리스 #{detail.release.statistics_version_id} · 자료판
          #{detail.release.land_cover_dataset_version_id} · {detail.release.candidate_grid_version}
        </p>
      </div>
    </div>
  );
}

function Measurement({
  label,
  value,
  testId,
  note,
}: {
  label: string;
  value: string;
  testId?: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="min-w-[6.5rem] shrink-0 text-ink-subtle">{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
        {note && <span className="mt-0.5 block text-[11px] normal-nums text-ink-subtle">{note}</span>}
      </dd>
    </div>
  );
}
