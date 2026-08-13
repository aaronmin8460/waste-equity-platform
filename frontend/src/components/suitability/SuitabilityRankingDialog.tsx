"use client";

/**
 * 순위 전체보기 — the complete scoped candidate ranking, in a modal (Figma 138:415).
 *
 * ③ 종합 점수와 후보 순위 shows a top-N cut. This shows the same ranking with no
 * cut, one page at a time, and offers it as a CSV.
 *
 * ── IT INHERITS THE ACTIVE PAGE-4 STATE, IT DOES NOT RE-CHOOSE IT ────────────────
 * run, ② 점수 반영 기준, ① 분석 범위 and ③ 순위 방향 all arrive as props from the
 * page, and every page of rows is read through `lib/suitabilityRanking.ts` — the
 * SAME query builder the card's ranking uses. So the dialog's first page is
 * literally the card's rows continued, and there is no way to open "the ranking"
 * unfiltered. Changing the direction in here calls the page's OWN `onSortChange`,
 * so the card behind the dialog moves with it rather than disagreeing with it.
 *
 * ── THE ROW IS A CANDIDATE CELL ──────────────────────────────────────────────────
 * The Figma rows read "1 · 안산시 · 94.8", which would present the municipality as
 * the scored object. It is not: every row is one 500 m grid cell that happens to
 * lie in that 시·군·구. So each row names the 시·군·구 as a LOCATION, states
 * 500m 후보 구역 beneath it, and carries the cell's own `candidate_key` — nothing
 * is aggregated, averaged, or reduced to one row per city.
 *
 * ── NO 62점 기준 ─────────────────────────────────────────────────────────────────
 * The Figma subtitle ends "스크리닝 통과 62점 기준". No such threshold exists in the
 * analysis — screening status is a rule-based verdict, and A/B/C is a RELATIVE band
 * within the scored eligible population. The subtitle here states what is actually
 * true: which profile, which scope, which direction, over 스크리닝 통과 후보 구역.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────────
 * The shared `ui/Dialog` primitive owns the dialog role, the accessible name, the
 * focus trap, Escape, the visible close control, the body scroll lock, and focus
 * restoration to the 전체보기 trigger. Nothing is re-implemented here and nothing
 * about that primitive was changed for this third consumer. The rows are a real
 * `<table>` with a caption and scoped column headers; paging and sorting are
 * ordinary buttons.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CandidateFeature,
  SuitabilityCandidateCollection,
  SuitabilityProfile,
  SuitabilitySort,
} from "../../lib/api";
import { ApiError } from "../../lib/api";
import { downloadCsv, safeFilename } from "../../lib/csv";
import {
  buildSuitabilityRankingCsv,
  suitabilityRankingFilenameBase,
} from "../../lib/exports";
import { plainError, profileLabel, statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import { GRADE_LABELS, gradeFor, type GradeThresholds } from "../../lib/relativeGrade";
import {
  RANKING_PAGE_SIZE,
  fetchEntireRanking,
  fetchRankingPage,
  pageCount,
  pageRange,
  type RankingRequest,
} from "../../lib/suitabilityRanking";
import type { SuitabilityScope } from "../../lib/suitabilityScope";
import { scopeKey } from "../../lib/suitabilityScope";
import Dialog from "../ui/Dialog";
import EmptyState from "../ui/EmptyState";
import InfoBanner from "../ui/InfoBanner";
import StabilityBadge from "./StabilityBadge";

/** The two ranking directions — the same values and wording the card uses. */
const SORT_OPTIONS: readonly { value: SuitabilitySort; label: string }[] = [
  { value: "score_desc", label: "높은 순" },
  { value: "score_asc", label: "낮은 순" },
];

export const RANKING_DIALOG_TITLE = "순위 전체보기";

export interface SuitabilityRankingDialogProps {
  open: boolean;
  onClose: () => void;
  /** The active run. Null while the run metadata is still loading. */
  runId: number | null;
  profile: SuitabilityProfile;
  scope: SuitabilityScope;
  /** The active scope's visible name, resolved by the page. */
  scopeName: string;
  sort: SuitabilitySort;
  /** The PAGE's sort setter — so the card behind moves with the dialog. */
  onSortChange: (sort: SuitabilitySort) => void;
  /** The scoped A/B/C boundaries, or null when they could not be established. */
  thresholds: Pick<GradeThresholds, "p25" | "p75"> | null;
  /** The selected candidate, if any — highlighted, and selectable from a row. */
  selectedCandidateId: number | null;
  onSelect: (candidateId: number) => void;
}

/** The 시·군·구 the cell lies in. An unassigned cell keeps an explicit fallback. */
function cellLocationLabel(sigungu: string | null): string {
  return sigungu == null || sigungu === "" ? "(지역 미배정)" : sigungu;
}

export default function SuitabilityRankingDialog({
  open,
  onClose,
  runId,
  profile,
  scope,
  scopeName,
  sort,
  onSortChange,
  thresholds,
  selectedCandidateId,
  onSelect,
}: SuitabilityRankingDialogProps) {
  const [page, setPage] = useState(0);
  const [collection, setCollection] = useState<SuitabilityCandidateCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const scopeQueryKey = scopeKey(scope);

  // A new scope, direction, profile or run is a DIFFERENT ranking, so paging
  // restarts at its first page. Staying on page 7 of the previous population
  // would open on an offset that may not exist in the new one.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the
       page when the ranking's identity changes is precisely this effect's job. */
    setPage(0);
  }, [scopeQueryKey, sort, profile, runId]);

  // Reopening must reflect whatever the page state is NOW, not what it was when
  // the dialog last closed.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh open
       starts at the first page of the currently-active ranking. */
    setPage(0);
    setExportNote(null);
  }, [open]);

  // One page of the ranking, from the shared query builder. Nothing is fetched
  // while the dialog is closed — 전체보기 costs nothing until it is opened.
  useEffect(() => {
    if (!open || runId === null) return;
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect -- clear the PREVIOUS page
       before the new one lands, so a page of 인천 rows is never shown for one
       frame under a 경기 heading. */
    setCollection(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    const request: RankingRequest = { runId, profile, scope, sort };
    fetchRankingPage(request, page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCollection(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // A failure is NEVER folded into the empty state: `범위 내 0개` is a real
        // analytical answer and must stay distinguishable from "we could not ask".
        setCollection(null);
        setError(
          cause instanceof ApiError
            ? plainError(cause.detail?.error ?? cause.message).primary
            : "후보 순위를 불러올 수 없습니다.",
        );
      });
    return () => controller.abort();
    // `scopeQueryKey` stands in for `scope`: a new object with the same codes
    // must not re-request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId, profile, sort, scopeQueryKey, page]);

  // Abort an in-flight export when the dialog closes or the ranking changes.
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => exportAbort.current?.abort();
  }, []);
  useEffect(() => {
    if (open) return;
    exportAbort.current?.abort();
    exportAbort.current = null;
  }, [open]);

  const total = collection?.total_matched ?? 0;
  const rows = collection?.features ?? [];
  const pages = pageCount(total, RANKING_PAGE_SIZE);
  const range = pageRange(page, total, RANKING_PAGE_SIZE);

  const onExport = useCallback(async () => {
    if (runId === null || collection === null || total === 0) return;
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;
    setExporting(true);
    setExportNote(null);
    try {
      // The COMPLETE filtered ranking, collected by paging the SAME query — never
      // the page of rows currently on screen relabelled as the full ranking.
      const result = await fetchEntireRanking({ runId, profile, scope, sort }, controller.signal);
      if (controller.signal.aborted) return;
      const when = new Date();
      const filename = safeFilename(
        suitabilityRankingFilenameBase({ runId, profile, scopeName, sort }),
        "csv",
        when,
      );
      downloadCsv(
        filename,
        buildSuitabilityRankingCsv({
          runId,
          profile,
          scopeName,
          sort,
          totalMatched: result.totalMatched,
          features: result.features,
          truncated: result.truncated,
          thresholds,
          referenceYear: result.collection?.reference_year ?? null,
          policyVersion: result.collection?.policy_version ?? null,
          derivationVersion: result.collection?.derivation_version ?? null,
          candidateGridVersion: result.collection?.candidate_grid_version ?? null,
          when,
        }),
      );
      setExportNote(
        result.truncated
          ? `${filename} — 안전 상한에 걸려 상위 ${formatCount(result.features.length)}개까지만 ` +
            `내보냈습니다. 파일 안에도 같은 내용이 적혀 있습니다.`
          : `${filename} — ${scopeName} 범위의 순위 ${formatCount(result.features.length)}개를 ` +
            `내보냈습니다.`,
      );
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      setExportNote(
        cause instanceof ApiError
          ? plainError(cause.detail?.error ?? cause.message).primary
          : "순위를 모두 불러오지 못해 내보내기를 중단했습니다. 일부만 담긴 파일은 만들지 않았습니다.",
      );
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }, [runId, collection, total, profile, scope, scopeName, sort, thresholds]);

  // What this ranking IS, in one line. Every clause is served or selected — and
  // there is deliberately no point threshold in it (see the header).
  //
  // `profileLabel` is used BARE. Several profile labels already end in 기준
  // ("기본 기준"), so appending another would read "기본 기준 기준".
  const basis = [
    profileLabel(profile),
    scopeName,
    sort === "score_asc" ? "낮은 순" : "높은 순",
    `${statusLabel("ELIGIBLE")} 후보 구역`,
  ].join(" · ");

  const exportDisabled = exporting || collection === null || total === 0;

  return (
    <Dialog
      open={open}
      title={RANKING_DIALOG_TITLE}
      description={basis}
      testId="suitability-ranking-dialog"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <p className="text-xs text-ink-subtle" data-testid="ranking-dialog-framing">
          각 행은 시·군·구 자체가 아니라 그 안에 있는 500m 후보 구역 한 곳입니다. 순위 번호는 분석 실행
          전체에서의 순위이며, 고른 범위 안에서 다시 매긴 번호가 아닙니다. 지도 표시 설정(상태 표시,
          안정 후보만 보기)은 이 순위에 적용되지 않습니다.
        </p>

        {/* ③ 순위 방향, driving the PAGE's state. Both directions are served by the
            backend (sort=score_desc / score_asc) over the whole scoped population —
            never by reversing the page of rows already on screen. */}
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="순위 정렬"
          data-testid="ranking-dialog-sort"
        >
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={sort === option.value}
              onClick={() => onSortChange(option.value)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                sort === option.value
                  ? "border-primary-border bg-primary-soft font-semibold text-ink"
                  : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
              }`}
              data-testid={`ranking-dialog-sort-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error !== null ? (
          <InfoBanner tone="error" role="alert">
            <p data-testid="ranking-dialog-error">{error}</p>
          </InfoBanner>
        ) : collection === null ? (
          <p className="text-sm text-ink-muted" role="status" data-testid="ranking-dialog-loading">
            후보 순위를 불러오는 중…
          </p>
        ) : total === 0 ? (
          // A real, correct zero — never widened, dropped, or back-filled with
          // capital-region rows.
          <EmptyState
            title={`${scopeName} 범위 내 0개`}
            description={`선택한 범위에는 현재 기준으로 점수가 계산된 ${statusLabel(
              "ELIGIBLE",
            )} 후보 구역이 없습니다. 자료를 불러오지 못한 것이 아닙니다. 내보낼 순위도 없습니다.`}
            testId="ranking-dialog-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[36rem] border-collapse text-sm"
              data-testid="ranking-dialog-table"
            >
              <caption className="sr-only">
                {`${scopeName} ${profileLabel(profile)} 기준 후보 구역 전체 순위`}
              </caption>
              <thead>
                <tr className="border-b border-[var(--figma-rule)] text-xs text-ink-subtle">
                  <th scope="col" className="w-16 py-2 pr-2 text-left font-semibold">
                    순위
                  </th>
                  <th scope="col" className="py-2 pr-2 text-left font-semibold">
                    위치 · 후보 구역
                  </th>
                  <th scope="col" className="w-28 py-2 pr-2 text-left font-semibold">
                    상대 구간
                  </th>
                  <th scope="col" className="w-32 py-2 pr-2 text-left font-semibold">
                    안정성
                  </th>
                  <th scope="col" className="w-24 py-2 text-right font-semibold">
                    종합 점수
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((feature: CandidateFeature) => {
                  const c = feature.properties;
                  const isSelected = selectedCandidateId === Number(c.candidate_id);
                  const grade = gradeFor(c.status, c.total_score, thresholds);
                  return (
                    <tr
                      key={c.candidate_key}
                      data-testid="ranking-dialog-row"
                      // Selection carries aria-current, a ✓ glyph and a weight
                      // change as well as the tint — never colour alone.
                      aria-current={isSelected ? "true" : undefined}
                      className={`border-b border-[var(--figma-rule)] ${
                        isSelected ? "bg-primary-soft font-semibold text-ink" : "text-ink-muted"
                      }`}
                    >
                      <td className="py-2 pr-2 align-top text-sm font-bold tabular-nums text-ink">
                        {c.rank}위
                      </td>
                      <td className="py-2 pr-2 align-top">
                        <button
                          type="button"
                          onClick={() => onSelect(Number(c.candidate_id))}
                          className="min-h-[1.75rem] w-full rounded-control px-1 text-left hover:bg-surface-muted"
                        >
                          <span className="block text-ink">
                            {isSelected && <span className="mr-1 text-primary">✓</span>}
                            {cellLocationLabel(c.sigungu_region_name)}
                          </span>
                          {/* The scored object, and the cell's own identity —
                              this is what keeps a row from reading as a city. */}
                          <span className="block text-[11px] text-ink-subtle">
                            500m 후보 구역 ·{" "}
                            <span data-testid="ranking-dialog-candidate-key">
                              {c.candidate_key}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="py-2 pr-2 align-top text-xs" data-testid="ranking-dialog-grade">
                        {/* Empty when the bands could not be established — never
                            a guessed grade. */}
                        {grade === null ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          GRADE_LABELS[grade]
                        )}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        {c.stability_class != null && c.stable_count != null && (
                          <StabilityBadge
                            stabilityClass={String(c.stability_class)}
                            stableCount={Number(c.stable_count)}
                          />
                        )}
                      </td>
                      <td className="py-2 text-right align-top text-sm font-bold tabular-nums text-ink">
                        {c.total_score}점
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Figma's footer: the counts on the left, the two actions on the right.
            PINNED to the bottom of the scrolling body, as the Figma frame draws
            it. A page holds 50 rows, so a footer that scrolled with them would
            put 순위 CSV 내보내기 and the pager a full screen below the fold —
            the count line has to stay visible beside the rows it is counting.
            The negative margins let it span the body's full width while the
            content above keeps its padding. */}
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-3 border-t border-hairline bg-surface px-4 pb-4 pt-3 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-5">
          <div className="min-w-0">
            {/* THE AUTHORITATIVE COUNT. 범위 내 is the backend's `total_matched`
                over the same WHERE clause — never inferred from the page length. */}
            <p className="text-xs text-ink-muted" data-testid="ranking-dialog-counts">
              {total === 0 ? (
                <>
                  {scopeName} 범위 내{" "}
                  <span className="font-semibold tabular-nums text-ink">0</span>개
                </>
              ) : (
                <>
                  {formatCount(range.first)}–{formatCount(range.last)}번째 표시 · {scopeName} 범위 내{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatCount(total)}
                  </span>
                  개
                </>
              )}
            </p>
            {exportNote !== null && (
              <p
                className="mt-1 text-xs text-ink-subtle"
                role="status"
                data-testid="ranking-dialog-export-note"
              >
                {exportNote}
              </p>
            )}
          </div>

          <div className="flex flex-none flex-wrap items-center gap-2">
            {pages > 1 && (
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="순위 페이지 이동"
                data-testid="ranking-dialog-pager"
              >
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={page === 0}
                  className="rounded-control border border-hairline px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-muted disabled:opacity-40"
                  data-testid="ranking-dialog-prev"
                >
                  이전
                </button>
                <span
                  className="px-1 text-xs tabular-nums text-ink-muted"
                  data-testid="ranking-dialog-page-label"
                >
                  {formatCount(page + 1)} / {formatCount(pages)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
                  disabled={page >= pages - 1}
                  className="rounded-control border border-hairline px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-muted disabled:opacity-40"
                  data-testid="ranking-dialog-next"
                >
                  다음
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onExport}
              // Disabled on an empty scope: there is nothing honest to put in a
              // file, and an "empty full ranking" is worse than no file.
              disabled={exportDisabled}
              className="rounded-control border border-primary-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-40"
              data-testid="ranking-dialog-export"
            >
              {exporting ? "내보내는 중…" : "순위 CSV 내보내기"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-control bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
              data-testid="ranking-dialog-close-action"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
