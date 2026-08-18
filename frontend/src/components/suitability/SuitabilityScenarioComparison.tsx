"use client";

/**
 * 후보지 심층 비교 — the A/B comparison FOUNDATION (Page 5A, Figma frame 167:10554).
 *
 * This is the structural upper half of Page 5: who A안 and B안 are, which analysis
 * run they were revalidated against, and how their four weights differ — the frame's
 * single 1392×311.5 top card, whose header row IS the two A/B chips.
 *
 * Everything below it in the frame (the slope chart, the A/B map, the selected-cell
 * comparison, the movement distribution, the comparison table) is composed through the
 * `analysisSections` seam and is drawn ONLY in `READY`. Nothing is stubbed while it
 * waits: an empty card captioned "순위 변동" reads as "no candidate moved", which
 * would be a fabricated finding.
 *
 * ── WHAT THE FIGMA FRAME ASKS FOR, AND WHERE THIS DEPARTS FROM IT ────────────────
 * The frame's weight table names its four rows 시설부담 정도 / 토지피복 기반 적합도 /
 * 장래 쓰레기 발생량 / 주민 반응, with mock percentages. Three of those four factors
 * DO NOT EXIST in this product's model, and the fourth is inverted:
 *
 *   - "시설부담 정도" would invert E — a HIGH E score means the area carries LESS
 *     existing facility burden, so naming the factor after the burden reverses its
 *     direction (components/suitability/shared.ts `COMPONENT_DIRECTION`);
 *   - "장래 쓰레기 발생량" would promise a forecast: D is PRESENT-DAY served demand
 *     for the run's reference year, and no future-generation model exists;
 *   - "토지피복 기반 적합도" is not a scoring component — land cover is a separate
 *     map layer and a candidate-cell statistic, not a term in Z/R/E/D;
 *   - "주민 반응" has no data source anywhere in this platform.
 *
 * So the LAYOUT is the frame's and the CONTENT is the model's: the four rows are
 * `COMPONENT_ORDER` with the glossary's own citizen labels, and every percentage is
 * the SERVER's canonical weight for that side. The frame's 기준일 slot likewise
 * becomes the scenario's real 저장 date and the run's real reference year, because a
 * date the product does not have is not a date it may print.
 *
 * ── STORAGE IS A BOOKMARK, NOT EVIDENCE ──────────────────────────────────────────
 * Everything numeric on this screen comes from `POST /suitability/scenarios/preview`,
 * re-run against the run currently on screen. The stored scenario supplies the name
 * and the *request*; it never supplies a displayed number. See
 * docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §6 and `useScenarioComparison`.
 *
 * ── NO NEW ANALYTICS ─────────────────────────────────────────────────────────────
 * No pass/fail, no 60점 threshold, no "newly passed" region, no sensitivity band. A
 * scenario reweights the RANKING; it does not re-run screening, which is rule-based
 * and independent of the weights. This file introduces no finding of any kind.
 */

import { useMemo, type ReactNode } from "react";

import type { SuitabilityRun } from "../../lib/api";
import {
  activeRunResolution,
  comparisonWeightRows,
  formatWeightDelta,
  type ComparisonSide,
  type ScenarioComparison,
} from "../../lib/scenarioComparison";
import { SCOPE_ALL, type SuitabilityScope } from "../../lib/suitabilityScope";
import {
  SAVED_SCENARIO_OTHER_RUN_NOTICE,
  type ComparisonResolution,
} from "../../lib/savedScenarios";
import InfoBanner from "../ui/InfoBanner";
import PageHeader from "../ui/PageHeader";
import { useScenarioComparison } from "./useScenarioComparison";

export interface SuitabilityScenarioComparisonProps {
  /** ⑤'s resolved pair — step 1 of the contract flow, performed once by the page. */
  selection: ComparisonResolution;
  /** The run on screen. `null` while the suitability meta is still loading. */
  run: SuitabilityRun | null;
  /** Why the run could not be loaded, when it could not be. */
  runError: string | null;
  /** The view's `<h1>` — the destination label, as every other area titles itself. */
  title: string;
  /** The shared orientation strip, kept a sibling so it follows the `<h1>`. */
  orientation?: ReactNode;
  /** Back to 후보지 심층 분석, where scenarios are saved and the pair is chosen. */
  onBackToSelection: () => void;
  /**
   * The later Page-5 analytical sections, composed BELOW this shell.
   *
   * This is the seam §9.2 of the contract describes: the foundation performs the one
   * resolve-verify-preview pass and hands the finished {@link ScenarioComparison}
   * down, so a section never re-resolves the pair or re-issues the preview. It is a
   * render prop rather than `children` because the comparison does not exist until
   * this component has run the hook.
   *
   * Called ONLY when `status === "READY"` — both sides revalidated against the run on
   * screen. Every blocked status is already stated above by `StatusNotice`, and a
   * section drawn beneath one would be analysis of numbers the shell just said it
   * could not stand behind.
   */
  analysisSections?: (comparison: ScenarioComparison) => ReactNode;
  /**
   * THE ANALYSIS SCOPE carried over from 후보지 심층 분석's ① 지역 선택.
   *
   * The page owns it — it is the same one state that scopes Page 4's ranking, its
   * A/B/C population and its map — and it is passed here so BOTH sides of the
   * comparison are previewed over that one candidate universe. A and B differ by
   * WEIGHTS only; they must never differ by geography.
   */
  scope?: SuitabilityScope;
  /** The scope's visible name, so the page can say which 범위 it is comparing. */
  scopeName?: string;
}

const SLOT_LABEL = { A: "A안", B: "B안" } as const;

/** `2026-01-01` in the reader's locale; empty for an unparseable stored value. */
function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function SuitabilityScenarioComparison({
  selection,
  run,
  runError,
  title,
  orientation,
  onBackToSelection,
  analysisSections,
  scope = SCOPE_ALL,
  scopeName,
}: SuitabilityScenarioComparisonProps) {
  // Memoised on the two primitives so the hook's dependency is stable across
  // renders in which the run did not actually change.
  const runResolution = useMemo(
    () => activeRunResolution(run?.id ?? null, runError),
    [run?.id, runError],
  );

  // THE single data load for Page 5. Later sections receive `comparison`; none of
  // them resolves the pair or calls the preview API again.
  const comparison = useScenarioComparison(selection, runResolution, scope);
  const { sideA, sideB, status } = comparison;

  const rows = comparisonWeightRows(sideA.canonicalWeights, sideB.canonicalWeights);
  // One served side is enough to show the table: the other column renders as
  // explicitly unavailable, which is more informative than hiding both.
  const anyWeights = sideA.canonicalWeights !== null || sideB.canonicalWeights !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-5 md:px-6">
      {/* NO `description`. The orientation strip immediately below is this area's own
          one-line statement of purpose ("점수 반영 기준을 바꾸어 두 가정의 순위를
          비교합니다.", lib/glossary.ts), and a header description saying the same thing
          put two near-identical sentences in the page's most valuable copy space. What
          the description uniquely carried — that the weights are re-applied to the run
          on screen rather than read back from storage — is now stated once, under the
          weight table it qualifies, and the run itself is named by `RunMeta`. */}
      <PageHeader title={title} meta={<RunMeta run={run} runError={runError} />} />
      {orientation}

      <StatusNotice
        status={status}
        sideA={sideA}
        sideB={sideB}
        runError={runError}
        onBackToSelection={onBackToSelection}
      />

      {/* ── SECTION 1 — the frame's single top card (167:10554 Body>Card, 1392×311.5)
          The frame puts the A/B identity chips and the weight table in ONE card, with
          the chips acting as the card's header row rather than a separate 비교 대상
          section. Merged here to match; the two testids are kept on the regions they
          named before so nothing that addressed them has to learn a new name. */}
      <section
        className="wep-card wep-figma-card flex flex-col gap-4"
        aria-labelledby="scenario-comparison-heading"
        data-testid="scenario-comparison-identity"
      >
        <h2 id="scenario-comparison-heading" className="sr-only">
          비교 대상과 가중치 비교
        </h2>

        {/* WHICH 범위 IS BEING COMPARED — stated, not implied.
            The candidate universe is fixed by 후보지 심층 분석's ① 지역 선택, and both
            sides are ranked within it. A comparison that did not name its 범위 would
            leave a reader unable to tell a 경기-only A/B from a capital-region one,
            which is precisely the confusion this page had while the scope was being
            discarded. Only shown when a 범위 is actually narrower than 수도권 전체;
            the whole-region case needs no qualification. */}
        {scopeName !== undefined && scope.kind !== "all" && (
          <p
            className="text-[11px] leading-snug text-ink-muted"
            data-testid="scenario-comparison-scope"
          >
            분석 범위 <span className="font-semibold text-ink">{scopeName}</span> · A안과 B안 모두
            이 범위의 스크리닝 통과 후보 구역만을 대상으로 다시 순위를 매긴 결과입니다. 두 안은
            가중치만 다르며, 비교 대상 지역은 같습니다.
          </p>
        )}

        {/* The two chips, side by side and equal — the frame's 662+24+662. */}
        <div className="grid gap-4 md:grid-cols-2">
          <SideIdentity side={sideA} />
          <SideIdentity side={sideB} />
        </div>

        {/* ── Z/R/E/D weight comparison ─────────────────────────────────────── */}
        {anyWeights ? (
          <div data-testid="scenario-comparison-weights">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
                <caption className="sr-only">
                  A안과 B안의 평가 요소별 가중치와 그 차이
                </caption>
                <colgroup>
                  {/* The frame's 295 / 400 / 454 / 130 of 1348. */}
                  <col style={{ width: "21.9%" }} />
                  <col style={{ width: "29.7%" }} />
                  <col style={{ width: "33.7%" }} />
                  <col style={{ width: "14.7%" }} />
                </colgroup>
                <thead>
                  {/* The frame rules the head off in 1.5px NAVY, not a hairline — it is
                      the only rule on the card that separates head from body. */}
                  <tr className="border-b-[1.5px] border-primary text-[11.5px] font-bold text-ink-muted">
                    <th scope="col" className="pb-2 pr-3 font-bold">
                      평가 요소
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-bold">
                      A안 가중치
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-bold">
                      B안 가중치
                    </th>
                    <th scope="col" className="pb-2 font-bold">
                      가중치 차이
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const delta = formatWeightDelta(row.deltaPercentPoints);
                    return (
                      <tr
                        key={row.component}
                        className="border-b border-[var(--figma-rule)] last:border-b-0"
                        data-testid={`scenario-comparison-weight-row-${row.component}`}
                      >
                        <th
                          scope="row"
                          className="py-3 pr-3 text-[13.5px] font-normal text-ink"
                        >
                          {/* The frame numbers its four rows; the numeral is kept and the
                              CONTENT is the model's — a code is never shown bare. */}
                          <span className="mr-1.5 tabular-nums text-ink-subtle">{index + 1}</span>
                          {row.label}
                          <span className="text-ink-subtle">（{row.code}）</span>
                        </th>
                        <td className="py-3 pr-3">
                          <WeightCell percent={row.aPercent} testId="scenario-comparison-weight-a" />
                        </td>
                        <td className="py-3 pr-3">
                          <WeightCell percent={row.bPercent} testId="scenario-comparison-weight-b" />
                        </td>
                        {/* The frame tints this cell red for a rise and blue for a
                            fall. Kept neutral: a weight going up is not "good" and down
                            is not "bad", and the slope chart already refuses the same
                            red/green reading for rank direction. The sign and the arrow
                            carry the direction without the judgement.

                            The arrow is a SIBLING of the tested span, not inside it:
                            `formatWeightDelta` is the repo's one formatter for this
                            figure and the element carrying its testid must read exactly
                            what it returned — decoration cannot join the value. */}
                        <td className="py-3 text-[13.5px] font-bold tabular-nums text-ink">
                          <span data-testid="scenario-comparison-weight-delta">
                            {/* An em dash, not 0: an uncomputable delta is not "no change". */}
                            {delta ?? "—"}
                          </span>
                          {row.deltaPercentPoints !== null && row.deltaPercentPoints !== 0 ? (
                            <span aria-hidden="true">
                              {row.deltaPercentPoints > 0 ? " ↑" : " ↓"}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* The one place that says whose numbers these are. The header states the
                page's purpose; this states the provenance of the figures in this table,
                which is the fact a reader can actually be misled about. The two per-side
                chips no longer repeat it — see `scenario-comparison-side-ready`. */}
            <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
              · 저장 당시 값이 아니라 현재 분석 실행이 정규화해 돌려준 값입니다. 백분율은 반올림,
              차이는 표시된 두 값의 차(%p)입니다.
            </p>

            {/* The exact served decimals stay reachable, as everywhere else a rounded
                figure is shown. The rounding above is presentation; this is the value. */}
            <details className="mt-2" data-testid="scenario-comparison-weight-precise">
              <summary className="cursor-pointer text-[11px] text-ink-muted">정밀값 보기</summary>
              <dl className="mt-2 grid gap-1 text-[11px] text-ink-muted">
                {rows.map((row) => (
                  <div key={row.component} className="flex flex-wrap gap-x-3">
                    <dt className="font-medium">
                      {row.label}（{row.code}）
                    </dt>
                    <dd className="tabular-nums">
                      {SLOT_LABEL.A} {row.aWeight ?? "자료 없음"} · {SLOT_LABEL.B}{" "}
                      {row.bWeight ?? "자료 없음"}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        ) : null}
      </section>

      {/* The later Page-5 sections — ranking analytics, then candidate/contribution/
          map/export — composed under the shell with the ONE comparison this component
          loaded. They arrive through this single seam rather than being imported here,
          so the shell stays independent of which analytical lanes exist. Gated on
          READY: nothing analytical is drawn beneath a status the shell has just
          refused to stand behind. */}
      {status === "READY" ? analysisSections?.(comparison) : null}

      {/* The standing limit on what a scenario changes. Stated on the page that
          shows the reweighting, not only on the page that produced it. */}
      <p className="text-[11px] leading-snug text-ink-subtle" data-testid="scenario-comparison-method-note">
        시나리오는 이미 계산된 Z·R·E·D 점수를 다시 가중해 순위를 바꿉니다. 배제·검토 판정(스크리닝)은
        규칙 기반이며 가중치를 바꿔도 달라지지 않습니다.
      </p>
    </div>
  );
}

/** The run the comparison is validated against — never an assumed or stored one. */
function RunMeta({ run, runError }: { run: SuitabilityRun | null; runError: string | null }) {
  if (run === null) {
    return (
      <span data-testid="scenario-comparison-run-meta">
        {runError !== null ? "분석 실행 정보 없음" : "분석 실행 정보를 불러오는 중…"}
      </span>
    );
  }
  return (
    <span className="tabular-nums" data-testid="scenario-comparison-run-meta">
      분석 실행 #{run.id} · 기준연도 {run.reference_year}
    </span>
  );
}

/**
 * A weight bar + its percentage. The frame's track is 310×10 with the figure to its
 * right, which is what makes the two columns readable as a comparison at a glance —
 * the previous 220px cap made a 35% and a 25% bar look nearly identical.
 */
function WeightCell({ percent, testId }: { percent: number | null; testId: string }) {
  if (percent === null) {
    return (
      <span className="text-[13px] text-ink-subtle" data-testid={testId}>
        자료 없음
      </span>
    );
  }
  return (
    <span className="flex items-center gap-3" data-testid={testId}>
      <span
        className="h-2.5 min-w-0 flex-1 rounded-pill bg-[var(--figma-rule)]"
        aria-hidden="true"
      >
        <span className="block h-2.5 rounded-pill bg-primary" style={{ width: `${percent}%` }} />
      </span>
      <span className="w-9 flex-none text-right text-[13px] font-bold tabular-nums text-ink">
        {percent}%
      </span>
    </span>
  );
}

/**
 * One side's identity: slot, name, save date, provenance, and — when it is not
 * usable — the specific reason, in that side's own card. A reader must be able to
 * tell WHICH side is the problem without reading a page-level banner.
 */
function SideIdentity({ side }: { side: ComparisonSide }) {
  const { slot, state, savedScenario } = side;
  return (
    // The frame's chip: a filled #F7F8FC block, r14, pad 16/12 — a quiet band inside
    // the white card rather than a second bordered card. `--color-surface-muted` is
    // the shipped role for exactly that ("a quiet block inside a white surface").
    <div
      className="rounded-[14px] bg-surface-muted px-4 py-3"
      data-testid={`scenario-comparison-side-${slot.toLowerCase()}`}
      data-state={state}
    >
      <div className="flex items-center gap-3">
        <span className="flex-none rounded-full border border-primary-border bg-primary-soft px-2.5 py-1 text-[12.5px] font-bold text-ink">
          {SLOT_LABEL[slot]}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink"
          data-testid="scenario-comparison-side-name"
        >
          {/* The placeholder is state-specific. A `MISSING` slot must NOT read
              "선택 없음" — an id WAS chosen, and calling it an empty selection is the
              exact conflation §3 of the contract forbids. */}
          {savedScenario?.name ?? (state === "MISSING" ? "찾을 수 없는 시나리오" : "선택 없음")}
        </span>
        {/* The frame's right-aligned 기준일. The product has no such field, so the slot
            carries what it really knows: when the reader saved this scenario. */}
        {savedScenario ? (
          <span
            className="flex-none text-[12px] tabular-nums text-ink-subtle"
            data-testid="scenario-comparison-side-saved-at"
          >
            저장 {formatSavedAt(savedScenario.createdAt)} · 저장 시 실행 #{savedScenario.runId}
          </span>
        ) : null}
      </div>

      {/* A per-side MARKER, not a sentence. The full statement — that these are the
          current run's normalised values and not the stored ones — is made once under
          the weight table; repeating it in both chips said the same thing three times
          before the reader reached a single number. The run id is not repeated either:
          `RunMeta` already names the run in the page header. */}
      {state === "READY" ? (
        <p className="mt-1 text-[11px] text-ink-muted" data-testid="scenario-comparison-side-ready">
          현재 실행 기준으로 재계산됨
        </p>
      ) : null}

      {state === "LOADING" ? (
        <p className="mt-1 text-[11px] text-ink-muted" role="status" data-testid="scenario-comparison-side-loading">
          현재 분석 실행 기준으로 다시 계산하는 중…
        </p>
      ) : null}

      {state === "EMPTY" ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-comparison-side-empty">
          {SLOT_LABEL[slot]}이 선택되지 않았습니다. 후보지 심층 분석에서 시나리오를 선택해 주세요.
        </p>
      ) : null}

      {/* An id that resolves to nothing is a REAL state — a link opened in a browser
          that never held the scenario. Page 4D's exact wording, so the two screens
          describe the same situation identically. */}
      {state === "MISSING" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-missing">
          이 링크가 가리키는 시나리오를 이 브라우저에서 찾을 수 없습니다. 시나리오는 저장한 브라우저에만
          남아 있습니다.
        </p>
      ) : null}

      {state === "OTHER_RUN" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-other-run">
          {SAVED_SCENARIO_OTHER_RUN_NOTICE}
        </p>
      ) : null}

      {state === "PREVIEW_ERROR" ? (
        <p className="mt-1 text-[11px] leading-snug text-danger" data-testid="scenario-comparison-side-error">
          {side.errorMessage}
        </p>
      ) : null}

      {/* The run itself failed to load, so this side was never checked against one.
          Saying "다른 분석 실행" here would blame the reader's scenario for a fault
          that is not theirs and is not even known to exist. */}
      {state === "RUN_UNKNOWN" ? (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-comparison-side-run-unknown">
          현재 분석 실행을 확인할 수 없어 이 시나리오를 검증하지 못했습니다.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The page-level statement of what is wrong, when something is — plus the way back.
 *
 * It never replaces the per-side detail above; it names the situation once, in one
 * sentence, so a reader is not left to infer it from two cards. `READY` renders
 * nothing at all: a screen with nothing wrong says nothing.
 */
function StatusNotice({
  status,
  sideA,
  sideB,
  runError,
  onBackToSelection,
}: {
  status: ScenarioComparison["status"];
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  runError: string | null;
  onBackToSelection: () => void;
}) {
  if (status === "READY") return null;

  if (status === "LOADING") {
    return (
      <p className="text-sm text-ink-muted" role="status" data-testid="scenario-comparison-loading">
        저장한 시나리오를 현재 분석 실행 기준으로 다시 계산하는 중입니다…
      </p>
    );
  }

  const message = ((): { tone: "warning" | "error"; title: string; body: string } => {
    switch (status) {
      case "NO_RUN":
        return {
          tone: "error",
          title: "분석 실행을 확인할 수 없습니다",
          body:
            runError ??
            "현재 분석 실행을 불러오지 못해 두 시나리오를 검증할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        };
      case "DUPLICATE_SELECTION":
        return {
          tone: "warning",
          title: "같은 시나리오가 두 번 선택되었습니다",
          body: "서로 다른 시나리오 2개를 선택해야 비교할 수 있습니다.",
        };
      case "INCOMPLETE_SELECTION":
        return {
          tone: "warning",
          title: "비교할 시나리오가 2개가 아닙니다",
          body: "후보지 심층 분석에서 A안과 B안을 각각 선택하면 비교를 볼 수 있습니다.",
        };
      case "MISSING_A":
      case "MISSING_B":
      case "MISSING_BOTH":
        return {
          tone: "warning",
          title: "이 브라우저에 없는 시나리오입니다",
          body:
            "시나리오는 저장한 브라우저에만 남아 있어, 다른 기기나 브라우저에서 연 링크로는 불러올 수 " +
            "없습니다. 이 브라우저에서 다시 저장한 뒤 비교해 주세요.",
        };
      case "OTHER_RUN_A":
      case "OTHER_RUN_B":
      case "OTHER_RUN_BOTH":
        return {
          tone: "warning",
          title: "다른 분석 실행에서 저장된 시나리오입니다",
          body:
            "다른 분석 실행에서 저장된 시나리오입니다. 현재 분석 실행에서 다시 저장하거나 선택해 " +
            "주세요.",
        };
      case "PREVIEW_ERROR_A":
      case "PREVIEW_ERROR_B":
      case "PREVIEW_ERROR_BOTH":
        return {
          tone: "error",
          // The per-side cards carry the backend's own message, which names the
          // offending value; this only says which step failed.
          title: "가중치를 다시 적용하지 못했습니다",
          body: "현재 분석 실행에 시나리오를 다시 적용하는 중 오류가 발생했습니다.",
        };
      default:
        // MIXED — two different problems. Each side already states its own, so this
        // says only that there are two, rather than picking one and hiding the other.
        return {
          tone: "warning",
          title: "두 시나리오에 각각 다른 문제가 있습니다",
          body: "A안과 B안의 상태를 아래에서 각각 확인해 주세요.",
        };
    }
  })();

  const blocked = [sideA, sideB].filter((side) => side.state !== "READY").map((side) => side.slot);

  return (
    <InfoBanner
      tone={message.tone}
      title={message.title}
      role={message.tone === "error" ? "alert" : undefined}
      testId="scenario-comparison-status"
    >
      <p data-testid="scenario-comparison-status-body">{message.body}</p>
      {blocked.length > 0 ? (
        <p className="mt-1 text-[11px]" data-testid="scenario-comparison-status-sides">
          확인이 필요한 쪽: {blocked.map((slot) => SLOT_LABEL[slot]).join(" · ")}
        </p>
      ) : null}
      {/* RECOVERY: a link back to where scenarios are saved and chosen. Page 5 never
          creates a replacement scenario and never edits stored ones on the reader's
          behalf — the selection is theirs to make. */}
      <button
        type="button"
        onClick={onBackToSelection}
        className="wep-btn-primary mt-2 text-xs"
        data-testid="scenario-comparison-back"
      >
        후보지 심층 분석에서 시나리오 선택하기 <span aria-hidden="true">→</span>
      </button>
    </InfoBanner>
  );
}
